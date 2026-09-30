// Языковые версии одной страницы, объявленные самим сайтом:
// `<link rel="alternate" hreflang="…" href="…">`. Единственный вопрос этого
// файла — «объяснил ли сайт совпадение заголовков тем, что это одна страница на
// разных языках».
//
// ЗАЧЕМ ЭТО ДУБЛЯМ TITLE. Двуязычный сайт вакансий пишет название должности
// по-английски на обеих версиях страницы («Senior Backend Engineer»), потому что
// так его и называют в отрасли, — а всё остальное переводит. SEO-ONPAGE-004
// видел два одинаковых title и говорил «заголовок не уникален»: вердикт о
// странице, которая ни с кем за выдачу не конкурирует, потому что сайт прямо
// сказал поисковику, кому какую версию показывать. Десять таких находок в
// отчёте-эталоне — ровно этот случай.
//
// ЗАЯВЛЕНИЕ ДОЛЖНО БЫТЬ ВЗАИМНЫМ И НЕПРОТИВОРЕЧИВЫМ. Односторонняя ссылка ничего
// не объявляет: hreflang — это набор, и Google читает его только когда каждая
// версия называет остальных. Поэтому пара принимается, когда A назвала B, B
// назвала A, и о языке КАЖДОЙ из них все заявления сходятся на одном языке, а
// эти два языка различны.
//
// Заявления о странице — три, и читаются все, какие есть: её собственный
// `<html lang>`, её же hreflang на саму себя и hreflang партнёра о ней. Если они
// расходятся — партнёр называет страницу украинской, а сама она объявлена
// `lang="en"` — сайт себе противоречит, и из противоречия не следует, что
// заголовок повторён законно: находка остаётся. Так же остаётся находка у двух
// страниц, о которых всё сходится на ОДНОМ языке: это настоящий дубль, просто
// перелинкованный hreflang. Языка не заявил никто — заявления нет, находка тоже
// остаётся. Никакой язык здесь не определяется по тексту страницы: судим только
// то, что сайт сказал сам.
//
// СРАВНИВАЕТСЯ ПЕРВИЧНЫЙ SUBTAG, А НЕ ТЕГ ЦЕЛИКОМ. `en` и `uk` — разные языки,
// а `en-us` и `en-gb` — один: две английские страницы с одним заголовком делят
// одну выдачу, и молчать о них значило бы спрятать настоящий дубль за регионом.
//
// И МУСОРНОЕ ОБЪЯВЛЕНИЕ НЕ СЧИТАЕТСЯ. hreflang принимается только в форме тега
// BCP-47 (`uk`, `en-gb`, `zh-hant-tw`, `es-419`): `en_US`, пустое значение и
// опечатка языка не объявляют. `x-default` — валидное значение, но не язык: оно
// говорит «сюда, если ничего не подошло», и пару им не составить.
//
// ЗАГЛУШЕНА СТРАНИЦА, ТОЛЬКО ЕСЛИ АЛЬТЕРНАТИВЫ — ВСЯ ОСТАЛЬНАЯ ГРУППА. Хватает
// одного партнёра по заголовку, который языковой версией не объявлен, — и
// находка остаётся: сайт объяснил не то совпадение, о котором речь.

import type { CrawlResult, PageSnapshot } from '@fluxradar/crawler';

import type { SiteContext } from '../engine/types.js';
import { duplicateIndex, type DuplicateGroup } from '../shared/duplicate-groups.js';
import { parsePage, relTokens } from './dom.js';
import { addressJudges, canonicalAddress, crawlKey } from './site-index.js';

/**
 * Тег языка в форме BCP-47, которую пишут в hreflang: язык, необязательный
 * script и необязательный регион (код страны или числовой код макрорегиона).
 *
 * `x-default` сюда не подходит намеренно — одна буква до дефиса не язык.
 */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z]{4})?(-(?:[a-z]{2}|\d{3}))?$/;

const answeredCache = new WeakMap<CrawlResult, ReadonlySet<string>>();

/**
 * Адреса страниц, чей дубль title сайт объяснил языковыми версиями.
 *
 * Считается один раз на обход (WeakMap, как остальные индексы): правило
 * остаётся чистой функцией от ctx, а разбор `<link>` каждой страницы группы —
 * одной работой на прогон, а не на каждую находку.
 */
export function titleDuplicatesAnsweredByLanguageAlternates(ctx: SiteContext): ReadonlySet<string> {
  const cached = answeredCache.get(ctx.crawl);
  if (cached !== undefined) {
    return cached;
  }
  const answered = buildAnswered(ctx);
  answeredCache.set(ctx.crawl, answered);
  return answered;
}

function buildAnswered(ctx: SiteContext): ReadonlySet<string> {
  const groups = new Set<DuplicateGroup>(duplicateIndex(ctx, 'title').groups.values());
  const judges = judgedSnapshots(ctx.crawl);
  const answered = new Set<string>();
  for (const group of groups) {
    for (const address of membersAnsweredByAlternates(group, judges, ctx.crawl)) {
      answered.add(address);
    }
  }
  return answered;
}

/** Адрес документа → снимок, который о нём судит (тот же, что у групп дублей). */
function judgedSnapshots(crawl: CrawlResult): ReadonlyMap<string, PageSnapshot> {
  const byAddress = new Map<string, PageSnapshot>();
  for (const page of addressJudges(crawl)) {
    byAddress.set(canonicalAddress(crawl, page.normalizedUrl), page);
  }
  return byAddress;
}

/**
 * Члены группы, для которых ВСЯ остальная группа — объявленные языковые версии.
 *
 * Заявления читаются по одному разу на члена группы, а пара проверяется по уже
 * прочитанным картам: обход группы стоит её размер, а не квадрат.
 */
function membersAnsweredByAlternates(
  group: DuplicateGroup,
  judges: ReadonlyMap<string, PageSnapshot>,
  crawl: CrawlResult,
): readonly string[] {
  const inGroup = new Set(group.addresses);
  const declared = new Map<string, ReadonlyMap<string, ReadonlySet<string>>>();
  const selfDeclared = new Map<string, ReadonlySet<string>>();
  for (const address of group.addresses) {
    const page = judges.get(address);
    const alternates = page === undefined ? new Map() : declaredAlternates(page, crawl, inGroup);
    declared.set(address, alternates);
    selfDeclared.set(address, selfDeclaredLanguages(page, alternates.get(address)));
  }
  const answered: string[] = [];
  for (const address of group.addresses) {
    const own = declared.get(address) ?? new Map<string, ReadonlySet<string>>();
    let mutual = 0;
    for (const [partner, languages] of own) {
      // Что партнёр сказал об ЭТОЙ странице — вторая половина заявления.
      if (
        partner !== address &&
        isAnsweredPair({
          selfAboutMe: selfDeclared.get(address),
          partnerAboutMe: declared.get(partner)?.get(address),
          selfAboutPartner: selfDeclared.get(partner),
          myLabelsForPartner: languages,
        })
      ) {
        mutual += 1;
      }
    }
    if (mutual === group.addresses.length - 1) {
      answered.push(address);
    }
  }
  return answered;
}

/**
 * Что страница объявила языковыми версиями СЕБЯ, среди членов группы: адрес
 * документа → языки, названные в её hreflang.
 *
 * href разрешается ровно так, как его разобрал бы краулер (crawlKey →
 * canonicalAddress): иначе заявление указывало бы на адрес, которого у группы
 * нет. Всё, что за пределами группы, отброшено сразу — вопрос только о тех
 * страницах, с которыми совпал заголовок.
 */
function declaredAlternates(
  page: PageSnapshot,
  crawl: CrawlResult,
  inGroup: ReadonlySet<string>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const byAddress = new Map<string, Set<string>>();
  for (const link of parsePage(page).querySelectorAll('link')) {
    if (!relTokens(link).includes('alternate')) {
      continue;
    }
    const language = primaryLanguageSubtag(link.getAttribute('hreflang'));
    const href = link.getAttribute('href')?.trim();
    if (language === null || href === undefined || href === '') {
      continue;
    }
    const key = crawlKey(href, page.finalUrl, crawl.scope);
    const address = key === null ? null : canonicalAddress(crawl, key);
    if (address === null || !inGroup.has(address)) {
      continue;
    }
    const languages = byAddress.get(address);
    if (languages === undefined) {
      byAddress.set(address, new Set([language]));
      continue;
    }
    languages.add(language);
  }
  return byAddress;
}

/** Первичный subtag валидного тега языка; null — значение языком не является. */
function primaryLanguageSubtag(value: string | undefined): string | null {
  const tag = value?.trim().toLowerCase();
  if (tag === undefined || !LANGUAGE_TAG.test(tag)) {
    return null;
  }
  return tag.split('-')[0] ?? null;
}

/**
 * Что страница заявила о СЕБЕ: `<html lang>` документа и hreflang её собственной
 * ссылки на себя. Первичные subtag'и, как и у заявлений о партнёрах.
 */
function selfDeclaredLanguages(
  page: PageSnapshot | undefined,
  selfHreflangs: ReadonlySet<string> | undefined,
): ReadonlySet<string> {
  const languages = new Set<string>(selfHreflangs ?? []);
  const documentLanguage =
    page === undefined
      ? null
      : primaryLanguageSubtag(parsePage(page).querySelector('html')?.getAttribute('lang'));
  if (documentLanguage !== null) {
    languages.add(documentLanguage);
  }
  return languages;
}

/**
 * Взаимное и непротиворечивое объявление: обе стороны назвали друг друга, о
 * каждой из них все заявления сходятся на одном языке, и языки разные.
 *
 * Расхождение заявлений о странице (`lang="en"` против партнёрского `uk`) и
 * молчание о её языке одинаково означают, что сайт совпадение заголовков не
 * объяснил, — как и согласие обеих сторон на ОДНОМ языке.
 */
function isAnsweredPair(declarations: {
  readonly selfAboutMe: ReadonlySet<string> | undefined;
  readonly partnerAboutMe: ReadonlySet<string> | undefined;
  readonly selfAboutPartner: ReadonlySet<string> | undefined;
  readonly myLabelsForPartner: ReadonlySet<string>;
}): boolean {
  if (declarations.partnerAboutMe === undefined) {
    return false;
  }
  const mine = agreedLanguage(declarations.selfAboutMe, declarations.partnerAboutMe);
  const theirs = agreedLanguage(declarations.selfAboutPartner, declarations.myLabelsForPartner);
  return mine !== null && theirs !== null && mine !== theirs;
}

/** Единственный язык, на котором сошлись все заявления; null — их ноль или больше одного. */
function agreedLanguage(...claims: readonly (ReadonlySet<string> | undefined)[]): string | null {
  const languages = new Set<string>();
  for (const claim of claims) {
    for (const language of claim ?? []) {
      languages.add(language);
    }
  }
  return languages.size === 1 ? ([...languages][0] ?? null) : null;
}
