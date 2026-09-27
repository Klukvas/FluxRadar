// Страницы обхода, у которых одно и то же значение: title (SEO-ONPAGE-004),
// meta description (SEO-ONPAGE-006) и видимый текст (CONTENT-001). Единственный
// вопрос этого файла — «с кем эта страница делит значение и объявил ли сайт, кто
// из них настоящий».
//
// СУДИМ СТРАНИЦЫ, А НЕ СНИМКИ. Кандидаты — addressJudges: один снимок на адрес
// документа, только успешный HTML, и ничего, что уехало редиректом за область
// обхода (site-index.ts). Отсюда сразу следует главное свойство: два снимка
// одного документа (`/p` с 301 и `/p/`) дублями друг друга не бывают, потому что
// в группировку попадает ровно один из них. Без этого каждый сайт, чья навигация
// пишет `/p`, а сервер уводит на `/p/`, получал бы дубль на ровном месте — и
// «исправить» его было бы нечем.
//
// ГРУППИРОВКА O(n): одна Map по значению, никаких попарных сравнений. Значение
// длинного текста в ключ не кладётся — вместо него sha256: на сайте в 50 тысяч
// страниц ключи-тексты означали бы держать в памяти весь сайт целиком.
// Результат кэшируется на CrawlResult (WeakMap, как в site-index.ts), отдельно
// на каждый вид значения: правила остаются чистыми функциями от ctx.
//
// И ОТВЕТ О ГРУППЕ ТОЖЕ O(1). Сайт с общим шаблоном даёт группу в десятки тысяч
// страниц, и вопрос «с кем совпало» задают каждой из них: ответ, перечисляющий
// партнёров, стоил бы квадрат размера группы на каждое из трёх правил (замер:
// 20 000 страниц — 3.3 с только на этот перечень). Поэтому ответ — счёт и первые
// MAX_LISTED_DUPLICATES адресов, а не список.
//
// CANONICAL — ЭТО ОТВЕТ САЙТА, А НЕ НАРУШЕНИЕ. `<link rel="canonical">`,
// указывающий на другого члена группы, и есть правильный способ заявить дубль.
// Но ответом это становится только тогда, когда цепочка заявлений КОНЧАЕТСЯ
// внутри группы: страница, назвавшая канонической ту, которая сама указывает
// наружу, не названа настоящей никем, и молчать о ней значило бы принять за
// ответ вопрос (см. «ЦЕПОЧКА, А НЕ ОДИН ШАГ» у silencedMembers). Ссылка
// разбирается ровно так, как её разобрал бы краулер (crawlKey →
// canonicalAddress): правило, нормализующее адрес иначе, спрашивало бы группу о
// несуществующем члене.
//
// И ПОТОМУ У НАХОДКИ ДВЕ ПРИЧИНЫ, А НЕ ОДНА. «Canonical не связывает эту
// страницу ни с одной из них» — правда только о странице, которая никого не
// назвала. Страница в петле назвала партнёра прямо, и то же предложение о ней
// было бы ложью: её находка стоит на том, что цепочка ничем не кончилась
// (UnclaimedReason).
//
// ПОЧЕМУ ЗДЕСЬ НЕТ ПОЧТИ-ДУБЛЕЙ. Этот файл судит только ПОЛНОЕ совпадение
// значения. Подпись почти-дубля (simhash/minhash по шинглам текста) встала бы
// ровно в одно место — рядом с groupingKey: вместо одного ключа страница
// получала бы набор ключей-бэндов, а группа превращалась бы в «кандидаты на
// сравнение», после которых нужен порог схожести и вердикт о нём. Это другой
// оракул с другой ценой ошибки, и в этот релиз он не входит.

import { createHash } from 'node:crypto';
import type { CrawlResult, PageSnapshot } from '@fluxradar/crawler';

import type { SiteContext } from '../engine/types.js';
import { visibleText } from '../content/visible-text.js';
import { metaContent, parsePage } from '../seo/dom.js';
import { canonicalHref } from '../seo/indexing.js';
import { addressJudges, canonicalAddress, crawlKey } from '../seo/site-index.js';

/** Какое значение страницы сравнивается на совпадение. */
export type DuplicateValueKind = 'title' | 'meta-description' | 'visible-text';

/** Страницы, делящие одно значение (всегда две и больше). */
export interface DuplicateGroup {
  /** Адреса документов группы, лексикографически: набор findings не зависит от очереди обхода. */
  readonly addresses: readonly string[];
  /** Члены, о которых сайт уже ответил canonical-ом: правило о них молчит. */
  readonly silenced: ReadonlySet<string>;
  /** Члены, чья цепочка canonical кончается вне группы или в петле (unresolvedMembers). */
  readonly unresolved: ReadonlySet<string>;
}

export interface DuplicateIndex {
  /** Снимки, о которых правило судит: один на адрес документа (addressJudges). */
  readonly judged: readonly PageSnapshot[];
  /**
   * Их адреса документов — входы правила.
   *
   * Вердикт о странице выносят ЗНАЧЕНИЯ ДРУГИХ прочитанных страниц: выпавшая из
   * обхода страница превращает дубль в уникальное значение, ничего не починив
   * (§14, RuleEvaluation.inputTargets).
   */
  readonly addresses: readonly string[];
  /** Адрес документа → его группа; адреса без совпадений здесь нет. */
  readonly groups: ReadonlyMap<string, DuplicateGroup>;
}

/** Сколько адресов-партнёров называет evidence (и на скольких держится находка). */
export const MAX_LISTED_DUPLICATES = 3;

/** Снимок и адрес документа, под которым он судится, — всегда вместе. */
interface JudgedPage {
  readonly page: PageSnapshot;
  readonly address: string;
}

/**
 * Что находка говорит о группе: сколько в ней ещё страниц и первые из них.
 *
 * Списка «все партнёры» здесь нет намеренно. Группа бывает размером со сайт, а
 * спрашивают о ней каждого её члена: материализовать партнёров значило бы
 * заплатить квадрат размера группы за ответ, из которого evidence всё равно
 * покажет три адреса (§16), а dependencyTargets — те же три (§14).
 */
export interface UnclaimedDuplicates {
  /** Сколько ещё прочитанных страниц несут то же значение. */
  readonly count: number;
  /** Первые MAX_LISTED_DUPLICATES адресов группы по алфавиту, кроме своего. */
  readonly listed: readonly string[];
  /** Почему сайт о дубле не ответил — это разные предложения в evidence. */
  readonly reason: UnclaimedReason;
}

/**
 * Почему находка осталась: двум причинам соответствуют два РАЗНЫХ утверждения.
 *
 * 'no-canonical' — canonical не связывает страницу ни с одним членом группы:
 * его нет, он указывает на саму страницу или его href вообще не адрес
 * (declaredCanonicalAddress). 'unresolved-chain' — страница canonical-ом
 * НАЗЫВАЕТ кого-то, но цепочка заявлений кончается вне группы или в петле.
 * Сказать о второй странице «canonical не связывает её ни с одной из них» было
 * бы неправдой: её canonical может указывать прямо на названного партнёра.
 */
export type UnclaimedReason = 'no-canonical' | 'unresolved-chain';

/**
 * Нормализованное значение страницы: trim, схлопнутые пробелы и NFC, регистр НЕ
 * меняется. `Pricing` и `pricing` — разные заголовки: поисковая выдача
 * показывает их как написано, и объявить их одним значило бы придумать дубль.
 *
 * Пустая строка означает «значения нет»: отсутствующий title — предмет
 * SEO-ONPAGE-001, а не разговора об уникальности, и десять страниц без title не
 * дубли друг друга.
 */
export function duplicateValueOf(page: PageSnapshot, kind: DuplicateValueKind): string {
  switch (kind) {
    case 'title':
      return collapse(parsePage(page).querySelector('title')?.text ?? '');
    case 'meta-description':
      return collapse(metaContent(parsePage(page), 'description') ?? '');
    case 'visible-text':
      // visibleText уже схлопывает пробелы и обрезает края (content/visible-text.ts).
      return normalizeUnicode(visibleText(page));
  }
}

const indexCache = new WeakMap<CrawlResult, Map<DuplicateValueKind, DuplicateIndex>>();

/** Индекс одного вида значения: считается один раз на обход. */
export function duplicateIndex(ctx: SiteContext, kind: DuplicateValueKind): DuplicateIndex {
  const byKind = indexCache.get(ctx.crawl) ?? new Map<DuplicateValueKind, DuplicateIndex>();
  const cached = byKind.get(kind);
  if (cached !== undefined) {
    return cached;
  }
  const built = buildIndex(ctx.crawl, kind);
  byKind.set(kind, built);
  indexCache.set(ctx.crawl, byKind);
  return built;
}

/**
 * Счёт и первые адреса-партнёры для находки, либо null — находки нет.
 *
 * null приходит в двух случаях, и оба означают «правило молчит»: значение
 * уникально или сайт уже ответил canonical-ом (silencedMembers).
 */
export function unclaimedDuplicatesOf(
  index: DuplicateIndex,
  address: string,
): UnclaimedDuplicates | null {
  const group = index.groups.get(address);
  if (group === undefined || group.silenced.has(address)) {
    return null;
  }
  return {
    count: group.addresses.length - 1,
    listed: leadingPartners(group.addresses, address),
    reason: group.unresolved.has(address) ? 'unresolved-chain' : 'no-canonical',
  };
}

/**
 * Первые MAX_LISTED_DUPLICATES членов группы, кроме самой страницы.
 *
 * Адреса уже отсортированы, поэтому достаточно прочитать голову списка: не
 * больше MAX_LISTED_DUPLICATES + 1 элементов независимо от размера группы.
 */
function leadingPartners(addresses: readonly string[], address: string): readonly string[] {
  const listed: string[] = [];
  for (const member of addresses) {
    if (member === address) {
      continue;
    }
    listed.push(member);
    if (listed.length === MAX_LISTED_DUPLICATES) {
      break;
    }
  }
  return listed;
}

function buildIndex(crawl: CrawlResult, kind: DuplicateValueKind): DuplicateIndex {
  // Снимок и его адрес документа едут вместе: addressJudges уже отдал по одному
  // снимку на адрес, и пара — это и есть личность страницы.
  const judges: readonly JudgedPage[] = [...addressJudges(crawl)].map((page) => ({
    page,
    address: canonicalAddress(crawl, page.normalizedUrl),
  }));
  const byValue = groupAddressesByValue(judges, kind);
  const declared = declaredCanonicals(judges, crawl, byValue);
  const groups = new Map<string, DuplicateGroup>();
  for (const members of byValue.values()) {
    if (members.length < 2) {
      continue;
    }
    const group = toGroup(members, declared);
    for (const address of group.addresses) {
      groups.set(address, group);
    }
  }
  return {
    judged: judges.map((judge) => judge.page),
    addresses: judges.map((judge) => judge.address),
    groups,
  };
}

/** Ключ значения → адреса страниц, которые его несут (одна Map, один проход). */
function groupAddressesByValue(
  judges: readonly JudgedPage[],
  kind: DuplicateValueKind,
): ReadonlyMap<string, readonly string[]> {
  const byValue = new Map<string, string[]>();
  for (const { page, address } of judges) {
    const value = duplicateValueOf(page, kind);
    if (value === '') {
      continue;
    }
    const key = groupingKey(value, kind);
    const members = byValue.get(key);
    if (members === undefined) {
      byValue.set(key, [address]);
      continue;
    }
    members.push(address);
  }
  return byValue;
}

/**
 * Адрес страницы → адрес документа, который она объявила каноническим.
 *
 * Читается только у страниц, у которых вообще есть с кем совпадать: на сайте без
 * дублей разбор link[rel=canonical] каждой страницы был бы работой ради пустого
 * ответа (а SEO-TECH-004 всё равно разбирает его сам, на своём кэше DOM).
 */
function declaredCanonicals(
  judges: readonly JudgedPage[],
  crawl: CrawlResult,
  byValue: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, string> {
  const duplicated = new Set([...byValue.values()].filter((members) => members.length > 1).flat());
  const canonicalByAddress = new Map<string, string>();
  for (const { page, address } of judges) {
    if (!duplicated.has(address)) {
      continue;
    }
    const declared = declaredCanonicalAddress(page, crawl);
    if (declared !== null) {
      canonicalByAddress.set(address, declared);
    }
  }
  return canonicalByAddress;
}

function toGroup(
  members: readonly string[],
  canonicalByAddress: ReadonlyMap<string, string>,
): DuplicateGroup {
  const addresses = [...members].sort((left, right) => left.localeCompare(right));
  const inGroup = new Set(addresses);
  const terminals = chainTerminals(addresses, canonicalByAddress, inGroup);
  return {
    addresses,
    silenced: silencedMembers(addresses, terminals),
    unresolved: unresolvedMembers(addresses, terminals),
  };
}

/**
 * Член группы → член, на котором его цепочка canonical заканчивается ВНУТРИ
 * группы, либо null — конца нет.
 *
 * Конец цепочки — член без canonical или с canonical на себя: дальше идти
 * некуда, и именно он объявлен настоящей версией. Конца не существует в двух
 * случаях: цепочка ушла из группы (canonical на чужой хост, на непрочитанный
 * адрес, на страницу с другим значением) или замкнулась в петлю — сайт не
 * назвал настоящей ни одну из них.
 *
 * Проход по всем членам линеен: пройденный путь запоминается целиком, поэтому
 * каждый адрес разрешается один раз, а цепочка из g членов не стоит g².
 */
function chainTerminals(
  addresses: readonly string[],
  canonicalByAddress: ReadonlyMap<string, string>,
  inGroup: ReadonlySet<string>,
): ReadonlyMap<string, string | null> {
  const terminals = new Map<string, string | null>();
  for (const start of addresses) {
    if (terminals.has(start)) {
      continue;
    }
    const walked: string[] = [];
    const onPath = new Set<string>();
    let cursor = start;
    let terminal: string | null = null;
    for (;;) {
      if (terminals.has(cursor)) {
        terminal = terminals.get(cursor) ?? null;
        break;
      }
      if (onPath.has(cursor)) {
        break;
      }
      walked.push(cursor);
      onPath.add(cursor);
      const declared = canonicalByAddress.get(cursor);
      if (declared === undefined || declared === cursor) {
        terminal = cursor;
        break;
      }
      if (!inGroup.has(declared)) {
        break;
      }
      cursor = declared;
    }
    for (const member of walked) {
      terminals.set(member, terminal);
    }
  }
  return terminals;
}

/**
 * Члены группы, о которых правило молчит: сайт о них уже ответил.
 *
 * ЦЕПОЧКА, А НЕ ОДИН ШАГ. Молчать о странице, НА КОТОРУЮ указали, правильно
 * ровно тогда, когда указавший на неё сам дошёл до конца цепочки: `/b` →
 * `/a`, и `/a` собой цепочку закрывает — сайт назвал `/a` настоящей версией, и
 * сказано всё. Но если `/a` сама указывает наружу группы, то она настоящей не
 * названа никем: молчать о ней значило бы принять за ответ вопрос, и обе
 * страницы остаются находками. Петля (`/a` ↔ `/b`) — тот же случай: сайт
 * сообщил, что настоящая версия есть, и не сообщил, какая.
 *
 * Конец цепочки молчит только тогда, когда кто-то ещё из группы до него дошёл:
 * иначе это просто страница с canonical на себя, а две страницы, каждая из
 * которых зовёт настоящей себя, заявления о дубле не сделали вовсе.
 */
function silencedMembers(
  addresses: readonly string[],
  terminals: ReadonlyMap<string, string | null>,
): ReadonlySet<string> {
  const claimed = new Set<string>();
  for (const member of addresses) {
    const terminal = terminals.get(member) ?? null;
    if (terminal !== null && terminal !== member) {
      claimed.add(terminal);
    }
  }
  const silenced = new Set<string>();
  for (const member of addresses) {
    const terminal = terminals.get(member) ?? null;
    if (terminal === null) {
      continue;
    }
    if (terminal !== member || claimed.has(member)) {
      silenced.add(member);
    }
  }
  return silenced;
}

/**
 * Члены, чья цепочка canonical не кончается внутри группы.
 *
 * Это ровно те находки, о которых нельзя сказать «canonical не связывает эту
 * страницу ни с одной из них»: у каждой из них canonical ЕСТЬ и называет другой
 * адрес — просто цепочка уходит наружу или замыкается в петлю (chainTerminals).
 * С silencedMembers этот набор не пересекается: тот молчит только о членах, у
 * которых конец цепочки нашёлся.
 */
function unresolvedMembers(
  addresses: readonly string[],
  terminals: ReadonlyMap<string, string | null>,
): ReadonlySet<string> {
  const unresolved = new Set<string>();
  for (const member of addresses) {
    if ((terminals.get(member) ?? null) === null) {
      unresolved.add(member);
    }
  }
  return unresolved;
}

/**
 * Адрес документа, который страница объявила своей канонической версией.
 *
 * href разрешается против finalUrl (как в SEO-TECH-004) и приводится к ключу
 * ОБХОДА: под queryPolicy 'ignore' canonical `/p?utm=x` — это адрес `/p`, а не
 * несуществующий адрес с параметром. Дальше — canonicalAddress, потому что
 * группа названа адресами документов: canonical на `/p` при `/p` → 301 → `/p/`
 * указывает на страницу `/p/`.
 *
 * HREF, КОТОРЫЙ ВООБЩЕ НЕ АДРЕС, — это «canonical-а нет». `mailto:`, `tel:` и
 * `javascript:` нормализация адресов v1 не покрывает (D-113), и crawlKey отдаёт
 * null: страница становится концом своей цепочки, поэтому указавший на неё
 * партнёр молчит, а сама она молчит как названная. Мусор в href при этом не
 * теряется — его называет SEO-TECH-004 («canonical не разрешается»), у которого
 * это и есть предмет. Выдумывать здесь второй вердикт о том же теге значило бы
 * показать читателю одну ошибку дважды и под двумя разными именами.
 */
function declaredCanonicalAddress(page: PageSnapshot, crawl: CrawlResult): string | null {
  const href = canonicalHref(page);
  if (href === null) {
    return null;
  }
  const key = crawlKey(href, page.finalUrl, crawl.scope);
  return key === null ? null : canonicalAddress(crawl, key);
}

/**
 * Ключ группировки: короткое значение само себе ключ, длинный текст — sha256.
 *
 * Хеш здесь только про память: совпадение остаётся точным, а коллизия sha256 на
 * двух текстах одного сайта — событие, которого не бывает.
 */
function groupingKey(value: string, kind: DuplicateValueKind): string {
  if (kind !== 'visible-text') {
    return value;
  }
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function collapse(value: string): string {
  return normalizeUnicode(value.replace(/\s+/g, ' ').trim());
}

/**
 * NFC — та же форма, к которой приводят адреса (нормализация URL v1) и
 * normalizeField.
 *
 * «Café», набранное составным é, и «Café» с готовым é — одно и то же слово для
 * читателя и для выдачи; разными их делает только кодировка, и не свести их
 * значило бы пропустить дубль на любом сайте, который редактируют на macOS.
 */
function normalizeUnicode(value: string): string {
  return value.normalize('NFC');
}
