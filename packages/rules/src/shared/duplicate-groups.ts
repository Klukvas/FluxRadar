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
// CANONICAL — ЭТО ОТВЕТ САЙТА, А НЕ НАРУШЕНИЕ. `<link rel="canonical">`,
// указывающий на другого члена группы, и есть правильный способ заявить дубль:
// такая страница находки не даёт. Не даёт её и та, НА КОТОРУЮ указали, — сайт
// назвал её настоящей версией. Находку получает страница, которая делит значение
// и при этом не связана canonical ни с кем из группы: без canonical вовсе или с
// canonical на себя. Ссылка разбирается ровно так, как её разобрал бы краулер
// (crawlKey → canonicalAddress): правило, нормализующее адрес иначе, спрашивало
// бы группу о несуществующем члене.
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
  /** Члены группы, назвавшие canonical-ом ДРУГОГО её члена. */
  readonly declaredDuplicates: ReadonlySet<string>;
  /** Члены группы, которых кто-то из неё назвал canonical-ом. */
  readonly declaredCanonicals: ReadonlySet<string>;
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

/**
 * Нормализованное значение страницы: trim и схлопнутые пробелы, регистр НЕ
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
      return visibleText(page);
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
 * Адреса-партнёры, о которых говорит находка, либо null — находки нет.
 *
 * null приходит в трёх разных случаях, и все три означают «правило молчит»:
 * значение уникально, страница сама объявила себя дублем через canonical, или
 * сайт назвал каноничной именно её.
 */
export function unclaimedDuplicatesOf(
  index: DuplicateIndex,
  address: string,
): readonly string[] | null {
  const group = index.groups.get(address);
  if (group === undefined) {
    return null;
  }
  if (group.declaredDuplicates.has(address) || group.declaredCanonicals.has(address)) {
    return null;
  }
  return group.addresses.filter((member) => member !== address);
}

/**
 * Адреса, которые называет evidence: первые MAX_LISTED_DUPLICATES из
 * отсортированного списка.
 *
 * Список ограничен намеренно: на сайте с общим шаблоном группа бывает в тысячи
 * страниц, и ни excerpt (§16), ни dependencyTargets каждой находки не вправе
 * расти вместе с ней — иначе одна группа стоила бы квадрат своего размера.
 */
export function listedDuplicates(partners: readonly string[]): readonly string[] {
  return partners.slice(0, MAX_LISTED_DUPLICATES);
}

function buildIndex(crawl: CrawlResult, kind: DuplicateValueKind): DuplicateIndex {
  // Адреса лежат параллельно снимкам: addressJudges уже отдал по одному снимку
  // на адрес документа, поэтому индекс — это и есть личность страницы.
  const judged = [...addressJudges(crawl)];
  const addresses = judged.map((page) => canonicalAddress(crawl, page.normalizedUrl));
  const byValue = groupAddressesByValue(judged, addresses, kind);
  const declared = declaredCanonicals(judged, addresses, crawl, byValue);
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
  return { judged, addresses, groups };
}

/** Ключ значения → адреса страниц, которые его несут (одна Map, один проход). */
function groupAddressesByValue(
  judged: readonly PageSnapshot[],
  addresses: readonly string[],
  kind: DuplicateValueKind,
): ReadonlyMap<string, readonly string[]> {
  const byValue = new Map<string, string[]>();
  judged.forEach((page, index) => {
    const value = duplicateValueOf(page, kind);
    if (value === '') {
      return;
    }
    const address = addresses[index] ?? page.normalizedUrl;
    const key = groupingKey(value, kind);
    const members = byValue.get(key);
    if (members === undefined) {
      byValue.set(key, [address]);
      return;
    }
    members.push(address);
  });
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
  judged: readonly PageSnapshot[],
  addresses: readonly string[],
  crawl: CrawlResult,
  byValue: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, string> {
  const duplicated = new Set([...byValue.values()].filter((members) => members.length > 1).flat());
  const canonicalByAddress = new Map<string, string>();
  judged.forEach((page, index) => {
    const address = addresses[index] ?? page.normalizedUrl;
    if (!duplicated.has(address)) {
      return;
    }
    const declared = declaredCanonicalAddress(page, crawl);
    if (declared !== null) {
      canonicalByAddress.set(address, declared);
    }
  });
  return canonicalByAddress;
}

function toGroup(
  members: readonly string[],
  canonicalByAddress: ReadonlyMap<string, string>,
): DuplicateGroup {
  const addresses = [...members].sort((left, right) => left.localeCompare(right));
  const inGroup = new Set(addresses);
  const declaredDuplicates = new Set<string>();
  const declaredCanonicals = new Set<string>();
  for (const address of addresses) {
    const declared = canonicalByAddress.get(address);
    // canonical на саму себя ничего о дубле не заявляет: страница говорит
    // «я и есть оригинал», ровно то же говорит и вторая — заявления нет.
    if (declared === undefined || declared === address || !inGroup.has(declared)) {
      continue;
    }
    declaredDuplicates.add(address);
    declaredCanonicals.add(declared);
  }
  return { addresses, declaredDuplicates, declaredCanonicals };
}

/**
 * Адрес документа, который страница объявила своей канонической версией.
 *
 * href разрешается против finalUrl (как в SEO-TECH-004) и приводится к ключу
 * ОБХОДА: под queryPolicy 'ignore' canonical `/p?utm=x` — это адрес `/p`, а не
 * несуществующий адрес с параметром. Дальше — canonicalAddress, потому что
 * группа названа адресами документов: canonical на `/p` при `/p` → 301 → `/p/`
 * указывает на страницу `/p/`.
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
  return value.replace(/\s+/g, ' ').trim();
}
