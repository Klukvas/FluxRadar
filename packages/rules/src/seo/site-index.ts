// Индексы уровня обхода для правил, которым нужен контекст всего сайта
// (TECH-006 битые ссылки, TECH-008 противоречие noindex). Строятся один раз
// на CrawlResult (WeakMap-кэш) — правила остаются чистыми функциями от ctx.

import type { CrawlResult, PageSnapshot } from '@fluxradar/crawler';
import { normalizeUrl } from '@fluxradar/fingerprint';

import { isSuccessfulHtmlPage } from '../engine/types.js';
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

function resolveAndNormalize(href: string, baseUrl: string): string | null {
  try {
    return normalizeUrl(new URL(href, baseUrl).href);
  } catch {
    return null; // не-http(s) схема, userinfo и прочий мусор веба — не target
  }
}
