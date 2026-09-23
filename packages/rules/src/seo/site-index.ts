// Индексы уровня обхода для правил, которым нужен контекст всего сайта
// (TECH-006 битые ссылки, TECH-008 противоречие noindex). Строятся один раз
// на CrawlResult (WeakMap-кэш) — правила остаются чистыми функциями от ctx.

import type { CrawlResult, PageSnapshot } from '@fluxradar/crawler';
import { normalizeUrl } from '@fluxradar/fingerprint';

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
