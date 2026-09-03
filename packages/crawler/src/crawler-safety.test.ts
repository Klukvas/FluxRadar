// Тесты crawl safety (план §25) на мок-fetcher-ах: redirect за пределы scope,
// per-host robots.txt для поддоменов, суммарный лимит sitemap-URL (D-142).

import { describe, expect, it, vi } from 'vitest';

import type { RedirectHop, SafeFetchResult } from '@fluxradar/safe-fetch';
import { HostLimiter } from '@fluxradar/safe-fetch';

import type { CrawlOptions } from './crawler.js';
import { crawl } from './crawler.js';
import { SITEMAP_MAX_URLS } from './sitemap.js';
import type { CrawlFetcher, CrawlScope, CrawlerLogger } from './types.js';

const ORIGIN = 'http://fixture-host.test';

const silentLogger: CrawlerLogger = { warn: () => undefined };

function fastOptions(overrides: Partial<CrawlOptions> = {}): CrawlOptions {
  return {
    limiter: new HostLimiter({ rps: 1000, concurrency: 4 }),
    logger: silentLogger,
    ...overrides,
  };
}

function htmlPage(
  finalUrl: string,
  body: string,
  extra: Partial<Pick<SafeFetchResult, 'status' | 'redirectChain'>> = {},
): SafeFetchResult {
  return {
    finalUrl,
    status: extra.status ?? 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body,
    redirectChain: extra.redirectChain ?? [],
    timingMs: 1,
    truncated: false,
  };
}

function links(hrefs: readonly string[]): string {
  return `<html><body>${hrefs.map((href) => `<a href="${href}">x</a>`).join('')}</body></html>`;
}

describe('crawl: redirect за пределы scope', () => {
  const hop: RedirectHop = {
    url: `${ORIGIN}/offsite`,
    status: 301,
    location: 'http://evil.test/landing',
  };

  const fetcher: CrawlFetcher = (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/robots.txt' || parsed.pathname === '/sitemap.xml') {
      return Promise.resolve(htmlPage(url, '', { status: 404 }));
    }
    if (parsed.pathname === '/offsite') {
      // safeFetch уже прошёл redirect: finalUrl — чужой origin, в HTML —
      // ссылка обратно на наш origin (инъекция) и относительная ссылка.
      return Promise.resolve(
        htmlPage('http://evil.test/landing', links([`${ORIGIN}/injected-from-evil`, '/local']), {
          redirectChain: [hop],
        }),
      );
    }
    if (parsed.pathname === '/') {
      return Promise.resolve(htmlPage(url, links(['/offsite'])));
    }
    return Promise.resolve(htmlPage(url, links([])));
  };

  it('чужая страница остаётся снимком-evidence, но не источником ссылок', async () => {
    const logger: CrawlerLogger = { warn: vi.fn() };
    const scope: CrawlScope = { origin: ORIGIN, includeSubdomains: false, maxPages: 20 };
    const result = await crawl(scope, fastOptions({ fetcher, logger }));

    const crawled = result.pages.map((page) => page.normalizedUrl).sort();
    // Снимок /offsite сохранён (redirectChain — evidence для SEO-TECH-005)…
    expect(crawled).toEqual([`${ORIGIN}/`, `${ORIGIN}/offsite`]);
    // …но ссылки с чужой страницы (в т.ч. указывающие на наш origin) не в обходе.
    expect(crawled).not.toContain(`${ORIGIN}/injected-from-evil`);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('за пределы scope'),
      expect.objectContaining({ finalUrl: 'http://evil.test/landing' }),
    );
  });
});

describe('crawl: per-host robots.txt для поддоменов', () => {
  const SUB = 'http://sub.fixture-host.test';

  const fetcher: CrawlFetcher = (url) => {
    const parsed = new URL(url);
    const isSub = parsed.hostname === 'sub.fixture-host.test';
    if (parsed.pathname === '/robots.txt') {
      return isSub
        ? Promise.resolve({
            ...htmlPage(url, 'User-agent: *\nDisallow: /blocked/'),
            headers: { 'content-type': 'text/plain' },
          })
        : Promise.resolve(htmlPage(url, '', { status: 404 }));
    }
    if (parsed.pathname === '/sitemap.xml') {
      return Promise.resolve(htmlPage(url, '', { status: 404 }));
    }
    if (parsed.pathname === '/') {
      return Promise.resolve(htmlPage(url, links([`${SUB}/blocked/page`, `${SUB}/open/page`])));
    }
    return Promise.resolve(htmlPage(url, links([])));
  };

  it('поддомен блокируется собственным robots.txt, а не robots.txt origin-а', async () => {
    const scope: CrawlScope = { origin: ORIGIN, includeSubdomains: true, maxPages: 20 };
    const result = await crawl(scope, fastOptions({ fetcher }));

    expect(result.blockedByRobots).toEqual([`${SUB}/blocked/page`]);
    const crawled = result.pages.map((page) => page.normalizedUrl);
    expect(crawled).toContain(`${SUB}/open/page`);
    expect(crawled).not.toContain(`${SUB}/blocked/page`);
  });
});

describe('crawl: суммарный лимит sitemap-URL (D-142)', () => {
  const locs = (prefix: string, count: number): string =>
    Array.from({ length: count }, (_, i) => `<url><loc>${ORIGIN}/${prefix}${i}</loc></url>`).join(
      '',
    );

  const fetcher: CrawlFetcher = (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/robots.txt') {
      const body = [
        'User-agent: *',
        `Sitemap: ${ORIGIN}/sm1.xml`,
        `Sitemap: ${ORIGIN}/sm2.xml`,
      ].join('\n');
      return Promise.resolve({ ...htmlPage(url, body), headers: { 'content-type': 'text/plain' } });
    }
    if (parsed.pathname === '/sm1.xml') {
      return Promise.resolve(htmlPage(url, `<urlset>${locs('a', SITEMAP_MAX_URLS)}</urlset>`));
    }
    if (parsed.pathname === '/sm2.xml') {
      return Promise.resolve(htmlPage(url, `<urlset>${locs('b', 3)}</urlset>`));
    }
    return Promise.resolve(htmlPage(url, links([])));
  };

  it('лимит применяется ко всем sitemap-ам вместе, а не к каждому отдельно', async () => {
    const scope: CrawlScope = { origin: ORIGIN, includeSubdomains: false, maxPages: 1 };
    const result = await crawl(scope, fastOptions({ fetcher }));

    expect(result.sitemapUrls).toHaveLength(SITEMAP_MAX_URLS);
    expect(result.sitemapUrls.some((url) => url.includes('/b'))).toBe(false);
  });
});
