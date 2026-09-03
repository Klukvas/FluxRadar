// Интеграционные тесты обхода fixture-сайта (127.0.0.1, D-126) +
// юнит-тесты авто-throttle 5xx (D-030) на мок-fetcher-е.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SafeFetchResult } from '@fluxradar/safe-fetch';
import { HostLimiter } from '@fluxradar/safe-fetch';

import type { CrawlOptions } from './crawler.js';
import { CONSECUTIVE_5XX_HOST_STOP, crawl } from './crawler.js';
import type { FixtureSite } from './fixture-server.js';
import { startFixtureSite } from './fixture-server.js';
import type { CrawlFetcher, CrawlScope, CrawlerLogger } from './types.js';

let site: FixtureSite;

beforeAll(async () => {
  site = await startFixtureSite();
});

afterAll(async () => {
  await site.close();
});

const silentLogger: CrawlerLogger = { warn: () => undefined };

function fastOptions(overrides: Partial<CrawlOptions> = {}): CrawlOptions {
  return {
    dangerouslyAllowLoopback: true,
    limiter: new HostLimiter({ rps: 1000, concurrency: 4 }),
    logger: silentLogger,
    ...overrides,
  };
}

function fixtureScope(overrides: Partial<CrawlScope> = {}): CrawlScope {
  return { origin: site.origin, includeSubdomains: false, maxPages: 50, ...overrides };
}

describe('crawl: fixture-сайт', () => {
  it('обходит точный ожидаемый набор normalizedUrl с дедупом utm-дублей', async () => {
    const result = await crawl(fixtureScope(), fastOptions());
    const origin = site.origin;
    const expected = [
      `${origin}/`,
      `${origin}/broken-image.html`,
      `${origin}/broken-link.html`,
      `${origin}/deep/`,
      `${origin}/deep/level2/page.html`,
      `${origin}/dup-a.html`,
      `${origin}/dup-b.html`,
      `${origin}/empty.html`,
      `${origin}/form.html`,
      `${origin}/missing`,
      `${origin}/mixed-content.html`,
      `${origin}/no-title.html`,
      `${origin}/noindex.html`,
      `${origin}/orphan.html`,
      `${origin}/redirect-a`,
      `${origin}/trackers.html`,
      `${origin}/wrong-canonical.html`,
    ];
    const crawled = result.pages.map((page) => page.normalizedUrl).sort();
    expect(crawled).toEqual(expected);
    // Дедуп: utm-параметры вырезаны нормализацией, дубликаты не фетчились.
    expect(crawled.filter((url) => url.includes('utm'))).toEqual([]);
    expect(crawled.filter((url) => url.includes('dup-a'))).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.skippedOverLimit).toEqual([]);
  });

  it('robots.txt блокирует /private/ и попадает в результат', async () => {
    const result = await crawl(fixtureScope(), fastOptions());
    expect(result.blockedByRobots).toEqual([`${site.origin}/private/secret.html`]);
    expect(result.pages.some((page) => page.normalizedUrl.includes('/private/'))).toBe(false);
    expect(result.robotsTxt).toContain('Disallow: /private/');
  });

  it('подтверждённый override robots.txt обходит /private/ и логируется', async () => {
    const logger: CrawlerLogger = { warn: vi.fn() };
    const result = await crawl(
      fixtureScope({ respectRobots: false, robotsOverrideConfirmed: true }),
      fastOptions({ logger }),
    );
    expect(result.blockedByRobots).toEqual([]);
    expect(result.pages.some((page) => page.normalizedUrl.endsWith('/private/secret.html'))).toBe(
      true,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('override'),
      expect.anything(),
    );
  });

  it('respectRobots=false без подтверждения — robots.txt всё равно соблюдается', async () => {
    const logger: CrawlerLogger = { warn: vi.fn() };
    const result = await crawl(fixtureScope({ respectRobots: false }), fastOptions({ logger }));
    expect(result.blockedByRobots).toEqual([`${site.origin}/private/secret.html`]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('robotsOverrideConfirmed'),
      expect.anything(),
    );
  });

  it('maxPages=5: лишние URL уходят в skippedOverLimit, robots-блок сохраняется', async () => {
    const result = await crawl(fixtureScope({ maxPages: 5 }), fastOptions());
    expect(result.pages).toHaveLength(5);
    expect(result.skippedOverLimit.length).toBeGreaterThan(0);
    expect(result.blockedByRobots).toEqual([`${site.origin}/private/secret.html`]);
    const overlap = result.skippedOverLimit.filter((url) =>
      result.pages.some((page) => page.normalizedUrl === url),
    );
    expect(overlap).toEqual([]);
  });

  it('redirect-цепочка записана в снимок: 2 hop-а до redirect-final', async () => {
    const result = await crawl(fixtureScope(), fastOptions());
    const snapshot = result.pages.find(
      (page) => page.normalizedUrl === `${site.origin}/redirect-a`,
    );
    expect(snapshot).toBeDefined();
    expect(snapshot?.status).toBe(200);
    expect(snapshot?.finalUrl).toBe(`${site.origin}/redirect-final.html`);
    expect(snapshot?.redirectChain.map((hop) => hop.location)).toEqual([
      '/redirect-b',
      '/redirect-final.html',
    ]);
  });

  it('maxDepth=1 отсекает страницы глубже одного перехода', async () => {
    const result = await crawl(fixtureScope({ maxDepth: 1 }), fastOptions());
    const crawled = result.pages.map((page) => page.normalizedUrl);
    expect(crawled).toContain(`${site.origin}/deep/`);
    expect(crawled).not.toContain(`${site.origin}/deep/level2/page.html`);
    // /missing линкуется со страницы глубины 1 → глубина 2 → отсечён.
    expect(crawled).not.toContain(`${site.origin}/missing`);
  });

  it('sitemap-URL попадают в seed: orphan-страница обойдена без входящих ссылок', async () => {
    const result = await crawl(fixtureScope(), fastOptions());
    expect(result.sitemapUrls).toContain(`${site.origin}/orphan.html`);
    expect(result.pages.some((page) => page.normalizedUrl === `${site.origin}/orphan.html`)).toBe(
      true,
    );
  });

  it('excludePatterns исключают ветку, onProgress считает обработанные URL', async () => {
    const progress: Array<{ done: number; total: number }> = [];
    const result = await crawl(
      fixtureScope({ excludePatterns: ['/deep/*'] }),
      fastOptions({ onProgress: (_url, done, total) => progress.push({ done, total }) }),
    );
    const crawled = result.pages.map((page) => page.normalizedUrl);
    expect(crawled.filter((url) => url.includes('/deep/'))).toEqual([]);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.map((tick) => tick.done)).toEqual(progress.map((_tick, i) => i + 1));
    const last = progress.at(-1);
    expect(last?.done).toBe(last?.total);
  });

  it('urlVariants: raw-варианты дубликата собраны для SEO-TECH-007, одиночные URL не включены', async () => {
    const result = await crawl(fixtureScope(), fastOptions());
    // index.html ссылается на /dup-a.html и /dup-a.html?utm_source=y — один normalizedUrl.
    expect(result.urlVariants[`${site.origin}/dup-a.html`]).toEqual([
      `${site.origin}/dup-a.html`,
      `${site.origin}/dup-a.html?utm_source=y`,
    ]);
    // /dup-b.html обнаружен только в одной raw-форме — не дубликат URL.
    expect(result.urlVariants[`${site.origin}/dup-b.html`]).toBeUndefined();
  });

  it('404-страница фиксируется снимком со статусом, без fetchError', async () => {
    const result = await crawl(fixtureScope(), fastOptions());
    const missing = result.pages.find((page) => page.normalizedUrl === `${site.origin}/missing`);
    expect(missing?.status).toBe(404);
    expect(missing?.fetchError).toBeUndefined();
  });
});

describe('crawl: авто-throttle 5xx (D-030, мок-fetcher)', () => {
  const MOCK_ORIGIN = 'http://fixture-host.test';

  function htmlResponse(url: string, status: number, body: string): SafeFetchResult {
    return {
      finalUrl: url,
      status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body,
      redirectChain: [],
      timingMs: 1,
      truncated: false,
    };
  }

  function mockFetcher(statusByPath: Readonly<Record<string, number>>): CrawlFetcher {
    return (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/') {
        const links = Object.keys(statusByPath)
          .map((path) => `<a href="${path}">${path}</a>`)
          .join('');
        return Promise.resolve(htmlResponse(url, 200, `<html><body>${links}</body></html>`));
      }
      const status = statusByPath[pathname] ?? 404;
      return Promise.resolve(htmlResponse(url, status, '<html><body>page</body></html>'));
    };
  }

  function mockScope(): CrawlScope {
    return { origin: MOCK_ORIGIN, includeSubdomains: false, maxPages: 20 };
  }

  it('останавливает host после 5 последовательных 5xx, остаток — в errors', async () => {
    const statuses = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`/p${i + 1}`, 500]));
    const result = await crawl(mockScope(), fastOptions({ fetcher: mockFetcher(statuses) }));
    // Обойдены: / + ровно 5 страниц с 5xx; p6..p9 не фетчились.
    expect(result.pages).toHaveLength(1 + CONSECUTIVE_5XX_HOST_STOP);
    const stopErrors = result.errors.filter((error) => error.reason.includes('D-030'));
    expect(stopErrors).toHaveLength(1 + 4); // сама остановка + 4 пропущенных URL
    expect(stopErrors.every((error) => error.reason.includes('fixture-host.test'))).toBe(true);
  });

  it('успешный ответ сбрасывает счётчик последовательных 5xx', async () => {
    const statuses = {
      '/a1': 500,
      '/a2': 500,
      '/a3': 500,
      '/a4': 500,
      '/ok': 200,
      '/b1': 500,
      '/b2': 500,
      '/b3': 500,
      '/b4': 500,
    };
    const result = await crawl(mockScope(), fastOptions({ fetcher: mockFetcher(statuses) }));
    expect(result.pages).toHaveLength(10); // все обойдены, стопа не было
    expect(result.errors).toEqual([]);
  });

  it('ошибки фетча попадают в errors и в снимок как fetchError', async () => {
    const failing: CrawlFetcher = (url) => {
      if (url.endsWith('/robots.txt') || url.endsWith('/sitemap.xml')) {
        return Promise.resolve(htmlResponse(url, 404, ''));
      }
      return Promise.reject(new Error('connection refused'));
    };
    const result = await crawl(mockScope(), fastOptions({ fetcher: failing }));
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.fetchError).toBe('connection refused');
    expect(result.pages[0]?.status).toBe(0);
    expect(result.errors).toEqual([{ url: `${MOCK_ORIGIN}/`, reason: 'connection refused' }]);
  });
});
