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

describe('crawl: проверка media (CONTENT-004)', () => {
  it('asks the real server about each referenced image, and records what it said', async () => {
    const result = await crawl(fixtureScope(), fastOptions({ probeMedia: true }));

    const byPath = new Map(
      result.resources.map((resource) => [new URL(resource.finalUrl).pathname, resource]),
    );
    // /img/pixel.png is served as a real 1×1 PNG; /img/missing.png is not there.
    // Before this pass the crawl requested neither, and CONTENT-004 called both
    // "internal media not confirmed by the crawl" — a Medium finding and −3.
    expect(byPath.get('/img/pixel.png')?.status).toBe(200);
    expect(byPath.get('/img/pixel.png')?.contentType).toBe('image/png');
    expect(byPath.get('/img/missing.png')?.status).toBe(404);
    // Every resource carried a verdict, so none of them is unverified.
    expect(result.resources.every((resource) => resource.unverifiedReason === undefined)).toBe(
      true,
    );
  });

  it('checks no media at all when the crawl was told not to', async () => {
    const result = await crawl(fixtureScope(), fastOptions({ probeMedia: false }));

    expect(result.resources).toEqual([]);
  });

  it('keeps media out of the page count, so site coverage stays about pages', async () => {
    const result = await crawl(fixtureScope(), fastOptions({ probeMedia: true }));

    expect(result.pages.every((page) => !page.finalUrl.includes('/img/'))).toBe(true);
  });
});

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

  it('excludePatterns исключают ветку, onProgress считает прочитанные страницы', async () => {
    const progress: Array<{ done: number; total: number }> = [];
    const result = await crawl(
      fixtureScope({ excludePatterns: ['/deep/*'] }),
      fastOptions({ onProgress: (_url, done, total) => progress.push({ done, total }) }),
    );
    const crawled = result.pages.map((page) => page.normalizedUrl);
    expect(crawled.filter((url) => url.includes('/deep/'))).toEqual([]);
    expect(progress.length).toBeGreaterThan(0);
    // Прогресс монотонен и никогда не обгоняет число реально прочитанных
    // страниц: URL, закрытый robots.txt или срезанный лимитом, не «прочитан».
    for (const [index, tick] of progress.entries()) {
      expect(tick.done).toBeLessThanOrEqual(tick.total);
      if (index > 0) {
        expect(tick.done).toBeGreaterThanOrEqual(progress[index - 1]?.done ?? 0);
      }
    }
    const last = progress.at(-1);
    expect(last?.done).toBe(result.pages.length);
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

describe('crawl: кооперативная отмена (мок-fetcher)', () => {
  const MOCK_ORIGIN = 'http://cancel-host.test';

  function htmlResponse(url: string, body: string): SafeFetchResult {
    return {
      finalUrl: url,
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body,
      redirectChain: [],
      timingMs: 1,
      truncated: false,
    };
  }

  const PAGE_PATHS = ['/p1', '/p2', '/p3', '/p4', '/p5'] as const;

  /** Фетчер, который записывает каждый запрошенный URL и абортит после N страниц. */
  function countingFetcher(
    requested: string[],
    controller: AbortController,
    abortAfterPages: number,
  ): CrawlFetcher {
    return (url) => {
      requested.push(url);
      const pathname = new URL(url).pathname;
      if (pathname === '/') {
        const links = PAGE_PATHS.map((path) => `<a href="${path}">${path}</a>`).join('');
        return Promise.resolve(htmlResponse(url, `<html><body>${links}</body></html>`));
      }
      const pageRequests = requested.filter(
        (entry) => !entry.endsWith('.txt') && !entry.endsWith('.xml'),
      );
      if (pageRequests.length >= abortAfterPages) {
        controller.abort();
      }
      return Promise.resolve(htmlResponse(url, '<html><body>page</body></html>'));
    };
  }

  it('после отмены новых запросов не делает и отдаёт собранное', async () => {
    const controller = new AbortController();
    const requested: string[] = [];
    const result = await crawl(
      { origin: MOCK_ORIGIN, includeSubdomains: false, maxPages: 20 },
      fastOptions({
        fetcher: countingFetcher(requested, controller, 3),
        signal: controller.signal,
      }),
    );
    // Обход прекращён: / + 2 страницы до аборта, остальные три не запрашивались.
    expect(result.pages).toHaveLength(3);
    const pagePaths = requested
      .map((url) => new URL(url).pathname)
      .filter((path) => path.startsWith('/p'));
    expect(pagePaths).toHaveLength(2);
    expect(pagePaths).not.toContain('/p5');
  });

  it('страница, запрос которой прервала отмена, не становится снимком', async () => {
    // safeFetch на отменённом сигнале бросает AbortedError. Записать такой
    // снимок значило бы сказать «страница недоступна» о странице, которую никто
    // не дослушал — и это попало бы в evidence и в покрытие проверок.
    const controller = new AbortController();
    const result = await crawl(
      { origin: MOCK_ORIGIN, includeSubdomains: false, maxPages: 20 },
      fastOptions({
        fetcher: (url) => {
          const pathname = new URL(url).pathname;
          if (pathname !== '/p1') {
            return Promise.resolve(
              htmlResponse(url, '<html><body><a href="/p1">p1</a></body></html>'),
            );
          }
          // Отмена приходит, пока запрос /p1 в полёте: safeFetch его прерывает.
          controller.abort();
          return Promise.reject(new Error('safe-fetch: request was aborted by the caller'));
        },
        signal: controller.signal,
      }),
    );
    expect(result.pages.map((page) => new URL(page.normalizedUrl).pathname)).toEqual(['/']);
    expect(result.pages.some((page) => page.fetchError !== undefined)).toBe(false);
  });

  // Пауза (`shouldStop`) и отмена (`signal`) пришли разными дорогами и обязаны
  // означать одно и то же для всего, что умеет останавливаться на границе шага:
  // иначе отменённый скан пропускал бы `shouldStop`-проверки и продолжал
  // спрашивать сайт — в частности, зондировать его media уже после отмены.
  it('отмена останавливает и то, что спрашивает shouldStop: probe media и stoppedEarly', async () => {
    const controller = new AbortController();
    const requested: string[] = [];
    const result = await crawl(
      { origin: MOCK_ORIGIN, includeSubdomains: false, maxPages: 20 },
      fastOptions({
        fetcher: (url) => {
          requested.push(url);
          if (new URL(url).pathname === '/') {
            controller.abort();
            return Promise.resolve(
              htmlResponse(url, '<html><body><img src="/img/a.png" /></body></html>'),
            );
          }
          return Promise.resolve(htmlResponse(url, '<html><body>page</body></html>'));
        },
        signal: controller.signal,
      }),
    );
    // Прерванный обход — это остановленный обход, а не законченный: worker
    // разбирает `stoppedEarly`, чтобы отличить «дошли до конца» от «нас
    // попросили прекратить».
    expect(result.stoppedEarly).toBe(true);
    // И ни одной пробы media: они идут после обхода и спрашивают ровно тот же
    // `shouldStop`, что и сам цикл.
    expect(result.resources).toEqual([]);
    expect(requested.filter((url) => url.includes('/img/'))).toEqual([]);
  });

  it('уже отменённый сигнал не даёт сделать ни одного запроса', async () => {
    const controller = new AbortController();
    controller.abort();
    const requested: string[] = [];
    const result = await crawl(
      { origin: MOCK_ORIGIN, includeSubdomains: false, maxPages: 20 },
      fastOptions({
        fetcher: (url) => {
          requested.push(url);
          return Promise.resolve(htmlResponse(url, '<html><body>page</body></html>'));
        },
        signal: controller.signal,
      }),
    );
    expect(requested).toEqual([]);
    expect(result.pages).toEqual([]);
  });
});
