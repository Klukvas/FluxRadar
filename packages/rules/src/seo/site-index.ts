// Индексы уровня обхода для правил, которым нужен контекст всего сайта
// (TECH-006 битые ссылки, TECH-008 противоречие noindex, TECH-009/011
// перелинковка). Строятся один раз на CrawlResult (WeakMap-кэш) — правила
// остаются чистыми функциями от ctx.

import type { CrawlResult, PageSnapshot } from '@fluxradar/crawler';
import { normalizeUrl } from '@fluxradar/fingerprint';

import type { SiteContext } from '../engine/types.js';
import { hasHttpResponse, isSuccessfulHtmlPage } from '../engine/types.js';
import { parsePage } from './dom.js';

export interface PageLink {
  /** href как он записан в разметке (селектор для evidence). */
  readonly rawHref: string;
  /** Абсолютный нормализованный target (normalizeUrl v1). */
  readonly normalizedTarget: string;
}

const pageLinksCache = new WeakMap<PageSnapshot, readonly PageLink[]>();

/**
 * <a href> страницы: разрешение против finalUrl; мусор и не-http(s) отброшены.
 * Кэш на снимок: результат нужен и TECH-006 (по страницам), и TECH-008
 * (через internalLinkSources) — извлекаем и нормализуем один раз.
 */
export function pageLinks(page: PageSnapshot): readonly PageLink[] {
  const cached = pageLinksCache.get(page);
  if (cached !== undefined) {
    return cached;
  }
  const links = parsePage(page)
    .querySelectorAll('a')
    .map((anchor) => anchor.getAttribute('href')?.trim())
    .filter((href): href is string => href !== undefined && href !== '')
    .map((rawHref) => {
      const normalizedTarget = resolveAndNormalize(rawHref, page.finalUrl);
      return normalizedTarget === null ? null : { rawHref, normalizedTarget };
    })
    .filter((link): link is PageLink => link !== null);
  pageLinksCache.set(page, links);
  return links;
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

const linkSourcesCache = new WeakMap<CrawlResult, ReadonlyMap<string, ReadonlySet<string>>>();

/** target normalizedUrl → normalizedUrl-ы страниц (2xx HTML), ссылающихся на него. */
export function internalLinkSources(crawl: CrawlResult): ReadonlyMap<string, ReadonlySet<string>> {
  const cached = linkSourcesCache.get(crawl);
  if (cached !== undefined) {
    return cached;
  }
  const sources = new Map<string, Set<string>>();
  for (const page of crawl.pages.filter(isSuccessfulHtmlPage)) {
    for (const link of pageLinks(page)) {
      const existing = sources.get(link.normalizedTarget) ?? new Set<string>();
      existing.add(page.normalizedUrl);
      sources.set(link.normalizedTarget, existing);
    }
  }
  linkSourcesCache.set(crawl, sources);
  return sources;
}

const sitemapUrlsCache = new WeakMap<CrawlResult, ReadonlySet<string>>();

/** Нормализованные URL из sitemap-seed-ов обхода. */
export function sitemapNormalizedUrls(crawl: CrawlResult): ReadonlySet<string> {
  const cached = sitemapUrlsCache.get(crawl);
  if (cached !== undefined) {
    return cached;
  }
  const normalized = new Set(
    crawl.sitemapUrls
      .map((url) => resolveAndNormalize(url, url))
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
        .flatMap((page) => pageLinks(page).map((link) => link.normalizedTarget)),
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

/**
 * Почему граф внутренних ссылок этого обхода нельзя считать полным.
 *
 * Вывод «на эту страницу никто не ссылается» держится на том, что ссылки
 * ПРОЧИТАНЫ у каждой страницы сайта. Любой непрочитанный документ мог нести
 * ровно ту ссылку, которой правило не нашло, поэтому SEO-TECH-009/011 при
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
   * Ссылка на страницу того же хоста, о которой обход не отчитался нигде.
   *
   * Так выглядит усечение по scope: URL, отброшенный шаблонами include/exclude
   * или лимитом глубины, нигде не отмечается (run-context.ts, crawlScopeKey) —
   * единственный его след это ссылка, ведущая в никуда.
   */
  | 'unreached-url';

export function linkGraphGap(ctx: SiteContext): LinkGraphGap | null {
  const { crawl } = ctx;
  if (crawl.skippedOverLimit.length > 0) {
    return 'page-limit';
  }
  if (crawl.stoppedEarly || crawl.pendingQueue.length > 0) {
    return 'stopped';
  }
  if (crawl.errors.length > 0 || crawl.pages.some((page) => page.fetchError !== undefined)) {
    return 'unread-page';
  }
  return hasUnreachedInScopeUrl(crawl, hostnameOf(ctx.domain)) ? 'unreached-url' : null;
}

const unreachedCache = new WeakMap<CrawlResult, Map<string, boolean>>();

/**
 * Есть ли внутренняя ссылка на тот же хост, о судьбе которой обход молчит.
 *
 * Чужой хост — включая собственный поддомен — пробелом не считается: обход по
 * умолчанию туда не ходит (includeSubdomains=false), и требовать от него чужой
 * хост значило бы молчать на каждом сайте, у которого есть blog.example.com.
 * Проверка идёт по хосту, а не по origin: http- и https-форма одного хоста для
 * scope краулера — одна и та же область (isHostInScope).
 */
function hasUnreachedInScopeUrl(crawl: CrawlResult, hostname: string): boolean {
  const cached = unreachedCache.get(crawl)?.get(hostname);
  if (cached !== undefined) {
    return cached;
  }
  const accounted = accountedUrls(crawl);
  const unreached = linkTargets(crawl).some(
    (target) => hostnameOf(target) === hostname && !accounted.has(target),
  );
  const byHost = unreachedCache.get(crawl) ?? new Map<string, boolean>();
  byHost.set(hostname, unreached);
  unreachedCache.set(crawl, byHost);
  return unreached;
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
    const final = resolveAndNormalize(page.finalUrl, page.finalUrl);
    if (final !== null) {
      accounted.add(final);
    }
  }
  return accounted;
}

/** hostname URL-а; пустая строка — строка не разбирается как URL. */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Точка входа обхода: страница, к которой приходят по адресу, а не по ссылке.
 *
 * Её входящие ссылки ничего не говорят о доступности, поэтому ни TECH-009, ни
 * TECH-011 о ней не судят: «на главную никто не ссылается» — утверждение о
 * навигации сайта, а не о том, что страницу нельзя найти. Берётся именно
 * ctx.origin, а не всякая страница глубины 0: явный seed владельца говорит, как
 * МЫ нашли страницу, а не как на неё ссылается сайт.
 */
export function entryPageUrl(ctx: SiteContext): string {
  return normalizeUrl(ctx.origin);
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
    .filter((page): page is PageSnapshot => page !== undefined && isOwnAddress(page))
    .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl));
}

/** Снимок 2xx HTML, отданный по самому запрошенному адресу, а не через редирект. */
function isOwnAddress(page: PageSnapshot): boolean {
  return (
    isSuccessfulHtmlPage(page) &&
    resolveAndNormalize(page.finalUrl, page.finalUrl) === page.normalizedUrl
  );
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

/** normalizedUrl-ы страниц, ссылающихся на цель, кроме самой цели. */
export function inboundSources(crawl: CrawlResult, target: string): readonly string[] {
  const sources = internalLinkSources(crawl).get(target) ?? new Set<string>();
  return [...sources].filter((source) => source !== target).sort();
}
