// Индексы уровня обхода для правил, которым нужен контекст всего сайта
// (TECH-006 битые ссылки, TECH-008 противоречие noindex, TECH-009/010/011
// перелинковка). Строятся один раз на CrawlResult (WeakMap-кэш) — правила
// остаются чистыми функциями от ctx.
//
// Ключ адреса здесь тот же, что у обхода: сначала queryPolicy, потом
// normalizeUrl v1 (crawlKey). Правило, нормализующее ссылку иначе, чем краулер,
// спрашивает его о несуществующем адресе: под queryPolicy 'ignore' (default
// профиля) ссылка `/p?page=2` ведёт на прочитанную страницу `/p`, а не в
// пустоту.

import type { CrawlResult, CrawlScope, PageSnapshot } from '@fluxradar/crawler';
import { applyQueryPolicy, isHostInScope, isPathnameAllowedByPatterns } from '@fluxradar/crawler';
import { normalizeUrl } from '@fluxradar/fingerprint';

import type { SiteContext } from '../engine/types.js';
import { hasHttpResponse, isSuccessfulHtmlPage } from '../engine/types.js';
import { parsePage } from './dom.js';

export interface PageLink {
  /** href как он записан в разметке (селектор для evidence). */
  readonly rawHref: string;
  /** Абсолютный нормализованный target (normalizeUrl v1), как написан в разметке. */
  readonly normalizedTarget: string;
  /**
   * Тот же target под ключом дедупа обхода: query-политика применена.
   *
   * Отличается от normalizedTarget только при queryPolicy 'ignore', и тогда
   * именно этот ключ совпадает с normalizedUrl снимков. Оба поля нужны рядом:
   * вердикт о СТРАНИЦЕ (TECH-008/009/010/011) выносится по ключу обхода, а
   * вердикт о самой ССЫЛКЕ (TECH-006 «ссылка ведёт на 404») — по адресу, как он
   * написан в разметке, потому что снимок `/p` о статусе `/p?page=2` не
   * свидетельствует (D-152).
   */
  readonly crawlTarget: string;
}

/**
 * Кэш ссылок: сначала обход, потом снимок.
 *
 * Ключ обхода нельзя кэшировать на одном снимке: crawlTarget зависит от
 * queryPolicy ОБХОДА, и снимок, прочитанный сначала правилом одного прогона, а
 * потом правилом другого, отдал бы второму ключи первого.
 */
const pageLinksCache = new WeakMap<CrawlResult, WeakMap<PageSnapshot, readonly PageLink[]>>();

/**
 * <a href> страницы: разрешение против finalUrl; мусор и не-http(s) отброшены.
 * Кэш на снимок: результат нужен и TECH-006 (по страницам), и TECH-008/009/011
 * (через internalLinkSources) — извлекаем и нормализуем один раз.
 */
export function pageLinks(page: PageSnapshot, crawl: CrawlResult): readonly PageLink[] {
  const byPage = pageLinksCache.get(crawl) ?? new WeakMap<PageSnapshot, readonly PageLink[]>();
  const cached = byPage.get(page);
  if (cached !== undefined) {
    return cached;
  }
  const links = parsePage(page)
    .querySelectorAll('a')
    .map((anchor) => anchor.getAttribute('href')?.trim())
    .filter((href): href is string => href !== undefined && href !== '')
    .map((rawHref) => toPageLink(rawHref, page.finalUrl, crawl.scope))
    .filter((link): link is PageLink => link !== null);
  byPage.set(page, links);
  pageLinksCache.set(crawl, byPage);
  return links;
}

function toPageLink(rawHref: string, baseUrl: string, scope: CrawlScope): PageLink | null {
  const normalizedTarget = resolveAndNormalize(rawHref, baseUrl);
  if (normalizedTarget === null) {
    return null;
  }
  const crawlTarget = crawlKey(rawHref, baseUrl, scope) ?? normalizedTarget;
  return { rawHref, normalizedTarget, crawlTarget };
}

const snapshotIndexCache = new WeakMap<CrawlResult, ReadonlyMap<string, PageSnapshot>>();

/** normalizedUrl → снимок обхода (первый выигрывает — краулер дедупит сам). */
export function snapshotByNormalizedUrl(crawl: CrawlResult): ReadonlyMap<string, PageSnapshot> {
  const cached = snapshotIndexCache.get(crawl);
  if (cached !== undefined) {
    return cached;
  }
  const index = new Map<string, PageSnapshot>();
  for (const page of crawl.pages) {
    if (!index.has(page.normalizedUrl)) {
      index.set(page.normalizedUrl, page);
    }
  }
  snapshotIndexCache.set(crawl, index);
  return index;
}

const aliasCache = new WeakMap<CrawlResult, ReadonlyMap<string, string>>();

/**
 * Запрошенный адрес → адрес, по которому страница на самом деле живёт.
 *
 * Редирект — это заявление сайта «эта страница здесь»: ссылка на `/about`,
 * отвечающий 301 на `/about/`, ведёт на страницу `/about/`. Без этой карты
 * правила графа считают входящие ссылки по буквальному адресу и получают две
 * ложные картины: страница-цель редиректа выглядит orphan-ом, а сам адрес
 * редиректа — страницей, которую держит одна ссылка.
 */
export function redirectAliases(crawl: CrawlResult): ReadonlyMap<string, string> {
  const cached = aliasCache.get(crawl);
  if (cached !== undefined) {
    return cached;
  }
  const aliases = new Map<string, string>();
  for (const page of crawl.pages) {
    const final = crawlKey(page.finalUrl, page.finalUrl, crawl.scope);
    if (final !== null && final !== page.normalizedUrl) {
      aliases.set(page.normalizedUrl, final);
    }
  }
  aliasCache.set(crawl, aliases);
  return aliases;
}

const linkSourcesCache = new WeakMap<CrawlResult, ReadonlyMap<string, ReadonlySet<string>>>();

/**
 * target → normalizedUrl-ы страниц (2xx HTML), ссылающихся на него.
 *
 * Ссылка засчитывается И запрошенному адресу, И адресу, на который он ведёт
 * редиректом (redirectAliases): для вопроса «сколько ссылок держит страницу»
 * это один и тот же документ, и спросить о нём вправе как правило, судящее
 * адрес из sitemap, так и правило, судящее прочитанный снимок.
 */
export function internalLinkSources(crawl: CrawlResult): ReadonlyMap<string, ReadonlySet<string>> {
  const cached = linkSourcesCache.get(crawl);
  if (cached !== undefined) {
    return cached;
  }
  const aliases = redirectAliases(crawl);
  const sources = new Map<string, Set<string>>();
  const credit = (target: string, source: string): void => {
    const existing = sources.get(target);
    if (existing === undefined) {
      sources.set(target, new Set([source]));
      return;
    }
    existing.add(source);
  };
  for (const page of crawl.pages.filter(isSuccessfulHtmlPage)) {
    for (const link of pageLinks(page, crawl)) {
      credit(link.crawlTarget, page.normalizedUrl);
      const alias = aliases.get(link.crawlTarget);
      if (alias !== undefined) {
        credit(alias, page.normalizedUrl);
      }
    }
  }
  linkSourcesCache.set(crawl, sources);
  return sources;
}

const sitemapUrlsCache = new WeakMap<CrawlResult, ReadonlySet<string>>();

/** URL из sitemap-seed-ов обхода под ключом обхода (queryPolicy применена). */
export function sitemapNormalizedUrls(crawl: CrawlResult): ReadonlySet<string> {
  const cached = sitemapUrlsCache.get(crawl);
  if (cached !== undefined) {
    return cached;
  }
  const normalized = new Set(
    crawl.sitemapUrls
      .map((url) => crawlKey(url, url, crawl.scope))
      .filter((url): url is string => url !== null),
  );
  sitemapUrlsCache.set(crawl, normalized);
  return normalized;
}

/**
 * Все снимки обхода, которые правило может спросить о чужом URL.
 *
 * Это входы CONTENT-004: любой снимок media — вердикт (transport-сбой,
 * 4xx/5xx, HTML вместо картинки), а его отсутствие означает «не проверяли».
 * Пропавший снимок делает находку невидимой, ничего не починив, поэтому
 * политика Resolved сравнивает именно этот набор (§14,
 * RuleEvaluation.inputTargets).
 */
export function crawledTargets(crawl: CrawlResult): readonly string[] {
  return [...snapshotByNormalizedUrl(crawl).keys()];
}

/**
 * Снимки, на которые получен HTTP-ответ.
 *
 * Входы SEO-TECH-006: «ссылка битая» это вывод из статуса цели, и снимок с
 * transport-сбоем говорит о ней ровно столько же, сколько отсутствующий —
 * ничего (D-152). Поэтому такая цель входом не считается, и прогон, у которого
 * она перестала отвечать, прошлую находку не закрывает.
 */
export function respondingTargets(crawl: CrawlResult): readonly string[] {
  return [...snapshotByNormalizedUrl(crawl).values()]
    .filter((page) => hasHttpResponse(page))
    .map((page) => page.normalizedUrl);
}

/**
 * Все цели внутренних ссылок, о которых правило спрашивало обход.
 *
 * Это спрос SEO-TECH-006: правило смотрит снимок КАЖДОЙ ссылки загруженных
 * страниц. Цель, которой здесь больше нет, сайтом больше не упоминается — и
 * прошлая находка о ней говорит об удалённой ссылке, а не о потерянном снимке
 * (§14, RuleEvaluation.requestedInputs).
 */
export function linkTargets(crawl: CrawlResult): readonly string[] {
  return [
    ...new Set(
      crawl.pages
        .filter((page) => isSuccessfulHtmlPage(page))
        .flatMap((page) => pageLinks(page, crawl).map((link) => link.normalizedTarget)),
    ),
  ];
}

/**
 * Все URL, которые обход вообще увидел: загруженные, не влезшие в лимит,
 * закрытые robots.txt, упавшие с ошибкой и пришедшие из sitemap.
 *
 * Это спрос правил, чей вердикт строится на наборе страниц (SEO-TECH-007,
 * SEO-TECH-008): страница, которой здесь нет, больше не существует для сайта —
 * ни ссылки, ни sitemap на неё не ведут. А страница, которая здесь есть, но
 * снимка не получила, — потерянные данные, и находку закрывать нельзя.
 */
export function discoveredTargets(crawl: CrawlResult): readonly string[] {
  return [
    ...new Set([
      ...crawl.pages.map((page) => page.normalizedUrl),
      ...crawl.skippedOverLimit,
      ...crawl.blockedByRobots,
      ...crawl.errors.map((error) => error.url),
      ...sitemapNormalizedUrls(crawl),
    ]),
  ];
}

/**
 * Псевдо-вход «sitemap обхода прочитан».
 *
 * У SEO-TECH-008 sitemap — источник, а не наблюдение: если прогон его прочитал,
 * то исчезновение страницы из sitemap — настоящая починка противоречия. А вот
 * прогон, не нашедший sitemap вовсе, о нём ничего не доказывает.
 */
export const SITEMAP_INPUT = 'sitemap:read';

function resolveAndNormalize(href: string, baseUrl: string): string | null {
  try {
    return normalizeUrl(new URL(href, baseUrl).href);
  } catch {
    return null; // не-http(s) схема, userinfo и прочий мусор веба — не target
  }
}

/** Ключ, под которым обход дедупил бы этот адрес: queryPolicy → normalizeUrl. */
function crawlKey(href: string, baseUrl: string, scope: CrawlScope): string | null {
  try {
    return normalizeUrl(applyQueryPolicy(new URL(href, baseUrl), scope.queryPolicy).href);
  } catch {
    return null;
  }
}

/**
 * Почему граф внутренних ссылок этого обхода нельзя считать полным.
 *
 * Вывод «на эту страницу никто не ссылается» держится на том, что ссылки
 * ПРОЧИТАНЫ у каждой страницы сайта. Любой непрочитанный документ мог нести
 * ровно ту ссылку, которой правило не нашло, поэтому SEO-TECH-009/010/011 при
 * непустом пробеле молчат (и отчитываются Not applicable — см. шапки правил).
 */
export type LinkGraphGap =
  /** URL-ы не влезли в лимит тарифа: skippedOverLimit. */
  | 'page-limit'
  /** Обход прервали паузой или отменой — очередь осталась необработанной. */
  | 'stopped'
  /** Страница не отдала тела: transport-сбой или остановка хоста (D-030). */
  | 'unread-page'
  /**
   * Ссылка на адрес, который обход считал своим, но нигде о нём не отчитался.
   *
   * Так выглядит расхождение между тем, что обход обещал прочитать, и тем, что
   * прочитал: адрес прошёл все фильтры scope, но снимка, лимита, robots.txt или
   * ошибки под ним нет. Адрес, отброшенный самим scope (чужой хост, шаблоны
   * include/exclude, maxDepth), пробелом НЕ считается — см. isDeliberatelyUncrawled.
   */
  | 'unreached-url';

const gapCache = new WeakMap<CrawlResult, LinkGraphGap | null>();

/**
 * Пробел зависит только от обхода, поэтому считается один раз на CrawlResult:
 * его спрашивает и site-правило (однажды), и page-правило TECH-010 — у каждой
 * страницы, а «есть ли среди 50 тысяч страниц недочитанная» сама по себе задача
 * на весь набор.
 */
export function linkGraphGap(ctx: SiteContext): LinkGraphGap | null {
  const { crawl } = ctx;
  if (gapCache.has(crawl)) {
    return gapCache.get(crawl) ?? null;
  }
  const gap = computeLinkGraphGap(crawl);
  gapCache.set(crawl, gap);
  return gap;
}

/**
 * Последний из пробелов — внутренняя ссылка, о судьбе которой обход молчит,
 * хотя обещал её пройти.
 *
 * Сравнение идёт по ключу обхода и по фильтрам обхода (crawl.scope), поэтому
 * «пробел» здесь означает ровно одно: адрес, который краулер поставил бы в
 * очередь, нигде в его отчёте не появился. Это страховка от расхождения правил
 * с краулером, а не отчёт об области: всё, что scope отбрасывает сам,
 * отсеивается раньше (isDeliberatelyUncrawled).
 */
function computeLinkGraphGap(crawl: CrawlResult): LinkGraphGap | null {
  if (crawl.skippedOverLimit.length > 0) {
    return 'page-limit';
  }
  if (crawl.stoppedEarly || crawl.pendingQueue.length > 0) {
    return 'stopped';
  }
  if (crawl.errors.length > 0 || crawl.pages.some((page) => page.fetchError !== undefined)) {
    return 'unread-page';
  }
  const accounted = accountedUrls(crawl);
  const unreached = crawl.pages
    .filter(isSuccessfulHtmlPage)
    .some((page) =>
      pageLinks(page, crawl).some(
        (link) =>
          !accounted.has(link.crawlTarget) &&
          !isDeliberatelyUncrawled(crawl.scope, link.crawlTarget, page.depth + 1),
      ),
    );
  return unreached ? 'unreached-url' : null;
}

/**
 * Адрес, который обход и не собирался читать, — решение области, а не пробел.
 *
 * Три причины, и все три — выбор владельца, записанный в scope:
 *  • чужой хост (включая свой поддомен при includeSubdomains=false): обход туда
 *    не ходит, и требовать от него blog.example.com значило бы молчать на каждом
 *    сайте с поддоменом. Проверка по хосту, а не по origin: http- и https-форма
 *    одного хоста для scope краулера — одна область (isHostInScope);
 *  • pathname, отброшенный шаблонами include/exclude;
 *  • ссылка глубже maxDepth: краулер отбрасывает её при постановке в очередь
 *    (enqueue), и глубина ссылки — это глубина несущей её страницы + 1. Очередь
 *    обхода — BFS, поэтому первый раз адрес обнаруживается на своей минимальной
 *    глубине: «глубже maxDepth хотя бы на этой странице» и есть «глубже
 *    maxDepth вообще».
 *
 * Считать такой адрес пробелом означало бы гасить TECH-009/010/011 на любом
 * сайте, у которого есть ссылка на шаг глубже maxDepth (в профиле по умолчанию
 * maxDepth = 5) — то есть почти на каждом, и молча. Цена решения честна и
 * названа в самой находке: её evidence говорит «ни одна из N ПРОЧИТАННЫХ
 * страниц не ссылается», а не «на странице нет ссылок вообще». Пробелом
 * остаётся только то, что обход читать СОБИРАЛСЯ и не прочитал: лимит тарифа,
 * пауза, упавшая страница — там неизвестна не область, а сам ответ сайта.
 */
function isDeliberatelyUncrawled(scope: CrawlScope, url: string, linkDepth: number): boolean {
  if (scope.maxDepth !== undefined && linkDepth > scope.maxDepth) {
    return true;
  }
  let parsed: URL;
  let originHostname: string;
  try {
    parsed = new URL(url);
    originHostname = new URL(scope.origin).hostname;
  } catch {
    return true; // адрес, который краулер и разобрать бы не смог, он не просил
  }
  return (
    !isHostInScope(parsed.hostname, originHostname, scope.includeSubdomains) ||
    !isPathnameAllowedByPatterns(parsed.pathname, scope)
  );
}

/**
 * URL-ы, о которых обход что-то сказал: снимок, лимит, robots.txt или ошибка.
 *
 * finalUrl снимка входит наравне с запрошенным: страницу, на которую вёл
 * redirect, обход прочитал (markFinalUrlSeen), и ссылка прямо на неё пробелом
 * не является.
 */
function accountedUrls(crawl: CrawlResult): ReadonlySet<string> {
  const accounted = new Set<string>([
    ...crawl.skippedOverLimit,
    ...crawl.blockedByRobots,
    ...crawl.errors.map((error) => error.url),
  ]);
  for (const page of crawl.pages) {
    accounted.add(page.normalizedUrl);
    const final = crawlKey(page.finalUrl, page.finalUrl, crawl.scope);
    if (final !== null) {
      accounted.add(final);
    }
  }
  return accounted;
}

/**
 * Адреса точки входа обхода: запрошенный и тот, на который он уводит редиректом.
 *
 * Её входящие ссылки ничего не говорят о доступности, поэтому ни TECH-009, ни
 * TECH-011 о ней не судят: «на главную никто не ссылается» — утверждение о
 * навигации сайта, а не о том, что страницу нельзя найти. Берётся именно
 * ctx.origin, а не всякая страница глубины 0: явный seed владельца говорит, как
 * МЫ нашли страницу, а не как на неё ссылается сайт. Адрес назначения редиректа
 * исключается вместе с ним: `https://site/` → `https://site/en/` это одна
 * страница, и судить её под вторым именем значило бы объявить главную orphan-ом.
 */
export function entryPageUrls(ctx: SiteContext): ReadonlySet<string> {
  const entry = normalizeUrl(ctx.origin);
  const requested = crawlKey(entry, entry, ctx.crawl.scope) ?? entry;
  const alias = redirectAliases(ctx.crawl).get(requested);
  return new Set(alias === undefined ? [requested] : [requested, alias]);
}

/**
 * Страницы sitemap, о которых правило вообще вправе судить.
 *
 * Только успешно загруженный HTML: URL из sitemap, отдавший 404, — предмет
 * SEO-TECH-003, а не разговора о перелинковке. URL, уехавший редиректом на
 * другой адрес, тоже не кандидат: страница живёт по адресу назначения, ссылки
 * ведут туда же, и «на этот URL никто не ссылается» сказало бы о содержимом
 * sitemap (SEO-TECH-005), а не о доступности страницы.
 *
 * Порядок — по normalizedUrl, чтобы набор findings не зависел от порядка
 * очереди обхода.
 */
export function sitemapPages(crawl: CrawlResult): readonly PageSnapshot[] {
  const sitemap = sitemapNormalizedUrls(crawl);
  const snapshots = snapshotByNormalizedUrl(crawl);
  return [...sitemap]
    .map((url) => snapshots.get(url))
    .filter((page): page is PageSnapshot => page !== undefined && isOwnAddress(page, crawl))
    .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl));
}

/** Снимок 2xx HTML, отданный по самому запрошенному адресу, а не через редирект. */
export function isOwnAddress(page: PageSnapshot, crawl: CrawlResult): boolean {
  return isSuccessfulHtmlPage(page) && !redirectAliases(crawl).has(page.normalizedUrl);
}

/**
 * Страницы обхода, чьи ссылки правило прочитало (и на которых строит вердикт).
 *
 * Это же множество — вход internalLinkSources, поэтому оба правила графа
 * называют входами ровно его.
 */
export function linkSourcePages(crawl: CrawlResult): readonly PageSnapshot[] {
  return crawl.pages.filter((page) => isSuccessfulHtmlPage(page));
}

/**
 * Сколько ЧУЖИХ страниц обхода ссылается на цель (ссылка на себя не считается).
 *
 * Оба правила графа спрашивают о размере, а не о списке: на сайте в 50 тысяч
 * страниц навигационная цель собирает десятки тысяч источников, и копировать их
 * в массив ради `.length` значило бы строить такой массив на каждую страницу.
 */
export function inboundSourceCount(crawl: CrawlResult, target: string): number {
  const sources = internalLinkSources(crawl).get(target);
  if (sources === undefined) {
    return 0;
  }
  return sources.has(target) ? sources.size - 1 : sources.size;
}

/** Единственная чужая страница-источник, либо null, если их не ровно одна. */
export function soleInboundSource(crawl: CrawlResult, target: string): string | null {
  if (inboundSourceCount(crawl, target) !== 1) {
    return null;
  }
  const sources = internalLinkSources(crawl).get(target) ?? new Set<string>();
  for (const source of sources) {
    if (source !== target) {
      return source;
    }
  }
  return null;
}

const clickDepthCache = new WeakMap<CrawlResult, Map<string, ReadonlyMap<string, number>>>();

/**
 * Глубина клика каждой страницы от точки входа — BFS по прочитанным ссылкам.
 *
 * Считает правило, а не обход: depth снимка это длина пути от БЛИЖАЙШЕГО seed-а
 * обхода, а seed-ом служит и каждый URL из sitemap (crawler.ts enqueue(url, 1)).
 * На сайте, чей sitemap перечисляет все страницы, такая глубина всегда ≤ 1 и о
 * навигации не говорит ничего. Здесь же корень ровно один — точка входа, — и
 * рёбра только те, которые правило действительно прочитало.
 *
 * Редирект прозрачен: ссылка на `/about` ведёт к странице `/about/`
 * (redirectAliases), поэтому переход считается один раз, а не дважды. Страница,
 * до которой от точки входа ссылками не дойти, в карте отсутствует: у неё нет
 * глубины, а не «глубина большая» — это предмет TECH-009, а не TECH-010.
 */
export function clickDepthsFromEntry(ctx: SiteContext): ReadonlyMap<string, number> {
  const { crawl } = ctx;
  const entryKey = [...entryPageUrls(ctx)].sort().join(' ');
  const byEntry = clickDepthCache.get(crawl) ?? new Map<string, ReadonlyMap<string, number>>();
  const cached = byEntry.get(entryKey);
  if (cached !== undefined) {
    return cached;
  }
  const depths = breadthFirstDepths(crawl, entryPageUrls(ctx));
  byEntry.set(entryKey, depths);
  clickDepthCache.set(crawl, byEntry);
  return depths;
}

function breadthFirstDepths(
  crawl: CrawlResult,
  entryUrls: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const snapshots = snapshotByNormalizedUrl(crawl);
  const aliases = redirectAliases(crawl);
  const depths = new Map<string, number>();
  const queue: string[] = [];
  for (const entry of entryUrls) {
    if (snapshots.has(entry)) {
      depths.set(entry, 0);
      queue.push(entry);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    const page = current === undefined ? undefined : snapshots.get(current);
    const depth = current === undefined ? 0 : (depths.get(current) ?? 0);
    if (page === undefined || !isSuccessfulHtmlPage(page)) {
      continue; // непрочитанная страница ссылок не отдаёт — её путей мы не знаем
    }
    for (const link of pageLinks(page, crawl)) {
      for (const target of [link.crawlTarget, aliases.get(link.crawlTarget)]) {
        if (target === undefined || depths.has(target) || !snapshots.has(target)) {
          continue;
        }
        depths.set(target, depth + 1);
        queue.push(target);
      }
    }
  }
  return depths;
}
