// Что обход делает с JS-рендером, явными seed-URL и сигналом остановки.
//
// Три свойства, за которые отвечает этот файл: рендер НИКОГДА не выдумывает
// DOM (нет рантайма — есть явный Unavailable и статический HTML), seed-ы
// проходят те же фильтры scope, и пауза действительно прекращает исходящие
// запросы, а не просто меняет статус.

import { describe, expect, it, vi } from 'vitest';

import type { SafeFetchResult } from '@fluxradar/safe-fetch';
import { HostLimiter } from '@fluxradar/safe-fetch';

import type { CrawlOptions } from './crawler.js';
import { crawl } from './crawler.js';
import {
  renderRequestHeaders,
  sanitizeResponseHeaders,
  subresourceVerdict,
} from './render/request-policy.js';
import type { RenderOutcome, RenderRequest, RenderRuntime } from './render/types.js';
import type { CrawlFetcher, CrawlScope, CrawlerLogger } from './types.js';

const silentLogger: CrawlerLogger = { warn: () => undefined };

const ORIGIN = 'https://render.example';

function pageResponse(url: string, html: string): SafeFetchResult {
  return {
    finalUrl: url,
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: html,
    redirectChain: [],
    timingMs: 1,
    truncated: false,
  };
}

/** Отдаёт статический HTML и 404 на robots/sitemap, чтобы обход был детерминированным. */
function staticSite(pages: Readonly<Record<string, string>>): CrawlFetcher {
  return (url: string) => {
    const path = new URL(url).pathname;
    const html = pages[path];
    if (html === undefined) {
      return Promise.resolve({
        finalUrl: url,
        status: 404,
        headers: { 'content-type': 'text/plain' },
        body: 'not found',
        redirectChain: [],
        timingMs: 1,
        truncated: false,
      });
    }
    return Promise.resolve(pageResponse(url, html));
  };
}

function options(overrides: Partial<CrawlOptions> = {}): CrawlOptions {
  return {
    limiter: new HostLimiter({ rps: 1000, concurrency: 4 }),
    logger: silentLogger,
    ...overrides,
  };
}

function scope(overrides: Partial<CrawlScope> = {}): CrawlScope {
  return { origin: ORIGIN, includeSubdomains: false, maxPages: 20, ...overrides };
}

/** Рантайм, который просто заменяет DOM на заранее заданный. */
function stubRuntime(html: string, seen: RenderRequest[] = []): RenderRuntime {
  return {
    engine: 'stub',
    version: '1.0',
    render(request: RenderRequest): Promise<RenderOutcome> {
      seen.push(request);
      return Promise.resolve({
        kind: 'rendered',
        html,
        subresourceCount: 2,
        subresourceBytes: 100,
        blocked: [],
        timingMs: 5,
      });
    },
    close: () => Promise.resolve(),
  };
}

describe('crawl: JS-рендер', () => {
  const staticHtml = '<!doctype html><html><head><title>Shell</title></head><body></body></html>';
  const renderedHtml =
    '<!doctype html><html><head><title>Shell</title></head><body><h1>Rendered</h1></body></html>';

  it('подменяет тело страницы отрендеренным DOM и помечает страницу Rendered', async () => {
    const seen: RenderRequest[] = [];
    const result = await crawl(
      scope({ renderJs: true, maxDepth: 0 }),
      options({
        fetcher: staticSite({ '/': staticHtml }),
        renderRuntime: { kind: 'ready', runtime: stubRuntime(renderedHtml, seen) },
      }),
    );

    const page = result.pages[0];
    expect(page?.html).toBe(renderedHtml);
    expect(page?.rendering).toEqual({
      status: 'Rendered',
      subresourceCount: 2,
      subresourceBytes: 100,
      blocked: [],
      timingMs: 5,
    });
    expect(result.rendering).toEqual({
      status: 'Rendered',
      engine: 'stub',
      version: '1.0',
      renderedPages: 1,
      failedPages: 0,
      incompletePages: 0,
      incompleteReasons: [],
    });
    // Документ переиспользуется: сайт не запрашивают второй раз ради браузера.
    expect(seen[0]?.document?.html).toBe(staticHtml);
  });

  it('страница, отрендеренная без своих же ресурсов, помечается неполной', async () => {
    // Главный бандл не поместился в бюджет: DOM построен, но это ДРУГОЙ DOM.
    // Раньше такая страница попадала в renderedPages наравне с полными, и отчёт
    // утверждал «прочитано после выполнения скриптов» о разметке, которой там
    // не было. Отказы-политики (картинки, навигация) неполнотой не считаются:
    // их браузер посетителя тоже не применил бы к DOM.
    const runtime: RenderRuntime = {
      engine: 'stub',
      version: '1.0',
      render: (): Promise<RenderOutcome> =>
        Promise.resolve({
          kind: 'rendered',
          html: renderedHtml,
          subresourceCount: 1,
          subresourceBytes: 10,
          blocked: [
            { url: `${ORIGIN}/app.js`, reason: 'budget' },
            { url: `${ORIGIN}/logo.png`, reason: 'resource-kind' },
          ],
          timingMs: 5,
        }),
      close: () => Promise.resolve(),
    };
    const result = await crawl(
      scope({ renderJs: true, maxDepth: 0 }),
      options({
        fetcher: staticSite({ '/': staticHtml }),
        renderRuntime: { kind: 'ready', runtime },
      }),
    );

    expect(result.rendering).toEqual({
      status: 'Rendered',
      engine: 'stub',
      version: '1.0',
      renderedPages: 1,
      failedPages: 0,
      // The page rendered, so it is not an unrendered one — and it is not a
      // complete one either, which is the distinction the report needs.
      incompletePages: 1,
      incompleteReasons: ['budget'],
    });
  });

  it('без рантайма сообщает Unavailable и оставляет статический HTML', async () => {
    const result = await crawl(
      scope({ renderJs: true, maxDepth: 0 }),
      options({
        fetcher: staticSite({ '/': staticHtml }),
        renderRuntime: {
          kind: 'unavailable',
          reason: 'RuntimeNotInstalled',
          detail: 'playwright is not installed',
        },
      }),
    );

    expect(result.rendering).toEqual({
      status: 'Unavailable',
      reason: 'RuntimeNotInstalled',
      detail: 'playwright is not installed',
    });
    expect(result.pages[0]?.html).toBe(staticHtml);
    expect(result.pages[0]?.rendering).toMatchObject({
      status: 'Unavailable',
      reason: 'RuntimeNotInstalled',
    });
  });

  it('страница, которую не удалось отрендерить, помечается, а не подменяется', async () => {
    const failing: RenderRuntime = {
      engine: 'stub',
      version: '1.0',
      render: () =>
        Promise.resolve({
          kind: 'unavailable',
          reason: 'NavigationTimeout',
          detail: 'navigation timed out',
        }),
      close: () => Promise.resolve(),
    };
    const result = await crawl(
      scope({ renderJs: true, maxDepth: 0 }),
      options({
        fetcher: staticSite({ '/': staticHtml }),
        renderRuntime: { kind: 'ready', runtime: failing },
      }),
    );

    expect(result.pages[0]?.html).toBe(staticHtml);
    expect(result.pages[0]?.rendering).toMatchObject({
      status: 'Unavailable',
      reason: 'NavigationTimeout',
    });
    expect(result.rendering).toMatchObject({
      status: 'Rendered',
      renderedPages: 0,
      failedPages: 1,
    });
  });

  it('без scope.renderJs рендер не запрашивается вовсе', async () => {
    const render = vi.fn();
    const result = await crawl(
      scope({ maxDepth: 0 }),
      options({
        fetcher: staticSite({ '/': staticHtml }),
        renderRuntime: {
          kind: 'ready',
          runtime: { engine: 'stub', version: '1', render, close: () => Promise.resolve() },
        },
      }),
    );

    expect(render).not.toHaveBeenCalled();
    expect(result.rendering).toEqual({ status: 'NotRequested' });
    expect(result.pages[0]?.rendering).toBeUndefined();
  });
});

describe('crawl: явные seed-URL', () => {
  const page = (title: string): string =>
    `<!doctype html><html><head><title>${title}</title></head><body></body></html>`;

  it('обходит seed, на который никто не ссылается', async () => {
    const result = await crawl(
      scope({ seedUrls: [`${ORIGIN}/orphan`], maxDepth: 0 }),
      options({ fetcher: staticSite({ '/': page('Home'), '/orphan': page('Orphan') }) }),
    );

    expect(result.pages.map((entry) => entry.normalizedUrl)).toContain(`${ORIGIN}/orphan`);
    expect(result.rejectedSeeds).toEqual([]);
  });

  it('отклоняет seed за пределами сайта и называет причину', async () => {
    const result = await crawl(
      scope({ seedUrls: ['https://elsewhere.example/page', 'not-a-url'], maxDepth: 0 }),
      options({ fetcher: staticSite({ '/': page('Home') }) }),
    );

    expect(result.rejectedSeeds.map((entry) => entry.url)).toEqual([
      'https://elsewhere.example/page',
      'not-a-url',
    ]);
    expect(result.pages.every((entry) => entry.normalizedUrl.startsWith(ORIGIN))).toBe(true);
  });

  it('seed не обходит лимит страниц тарифа', async () => {
    const result = await crawl(
      scope({
        maxPages: 1,
        maxDepth: 0,
        seedUrls: [`${ORIGIN}/a`, `${ORIGIN}/b`, `${ORIGIN}/c`],
      }),
      options({
        fetcher: staticSite({
          '/': page('Home'),
          '/a': page('A'),
          '/b': page('B'),
          '/c': page('C'),
        }),
      }),
    );

    expect(result.pages).toHaveLength(1);
    expect(result.skippedOverLimit.length).toBeGreaterThan(0);
  });

  it('seed вне include-шаблонов отклоняется, как и любой другой URL', async () => {
    const result = await crawl(
      scope({ includePatterns: ['/docs/*'], seedUrls: [`${ORIGIN}/pricing`], maxDepth: 0 }),
      options({ fetcher: staticSite({ '/': page('Home'), '/pricing': page('Pricing') }) }),
    );

    expect(result.rejectedSeeds.map((entry) => entry.url)).toEqual([`${ORIGIN}/pricing`]);
  });
});

describe('crawl: сигнал остановки', () => {
  it('прекращает исходящие запросы и возвращает оставшуюся очередь', async () => {
    let stop = false;
    const fetched: string[] = [];
    const fetcher: CrawlFetcher = (url: string) => {
      fetched.push(url);
      // Останавливаем после первой страницы: очередь к этому моменту не пуста.
      stop = true;
      const html =
        '<!doctype html><html><head><title>T</title></head><body>' +
        '<a href="/one">1</a><a href="/two">2</a></body></html>';
      return Promise.resolve(pageResponse(url, html));
    };

    const result = await crawl(
      scope({ maxPages: 10 }),
      options({ fetcher, shouldStop: () => stop }),
    );

    expect(result.stoppedEarly).toBe(true);
    expect(result.pendingQueue.length).toBeGreaterThan(0);
    // robots.txt + sitemap.xml + одна страница — и ни одного запроса после стопа.
    expect(fetched.filter((url) => url.endsWith('/one') || url.endsWith('/two'))).toEqual([]);
  });

  it('стоп до старта не открывает ни одного соединения', async () => {
    const fetcher = vi.fn<CrawlFetcher>();
    const result = await crawl(scope(), options({ fetcher, shouldStop: () => true }));

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.stoppedEarly).toBe(true);
    expect(result.pages).toEqual([]);
  });
});

describe('crawl: продолжение прошлой попытки', () => {
  const linkPage = (title: string, links: readonly string[] = []): string =>
    `<!doctype html><html><head><title>${title}</title></head><body>` +
    `${links.map((href) => `<a href="${href}">x</a>`).join('')}</body></html>`;

  const restoredHome = {
    requestedUrl: `${ORIGIN}/`,
    normalizedUrl: `${ORIGIN}/`,
    depth: 0,
    finalUrl: `${ORIGIN}/`,
    status: 200,
    headers: { 'content-type': 'text/html' },
    redirectChain: [],
    html: linkPage('Home', ['/one', '/two']),
    contentType: 'text/html; charset=utf-8',
    timingMs: 3,
    truncated: false,
  } as const;

  const emptyCoverage = {
    skippedOverLimit: [],
    blockedByRobots: [],
    errors: [],
    rejectedSeeds: [],
    urlVariants: {},
  } as const;

  it('не запрашивает страницы, которые уже прочитаны', async () => {
    const fetched: string[] = [];
    const fetcher: CrawlFetcher = (url) => {
      fetched.push(new URL(url).pathname);
      return Promise.resolve(pageResponse(url, linkPage('Child')));
    };

    const result = await crawl(
      scope({ maxPages: 10 }),
      options({
        fetcher,
        probeMedia: false,
        restored: { pages: [restoredHome], coverage: emptyCoverage },
      }),
    );

    expect(fetched).not.toContain('/');
    expect(result.pages.map((page) => page.normalizedUrl)).toContain(`${ORIGIN}/`);
  });

  it('заново открывает ссылки восстановленных страниц, даже без frontier-а', async () => {
    const fetcher = staticSite({
      '/one': linkPage('One'),
      '/two': linkPage('Two'),
    });

    const result = await crawl(
      scope({ maxPages: 10 }),
      options({
        fetcher,
        probeMedia: false,
        restored: { pages: [restoredHome], coverage: emptyCoverage },
      }),
    );

    const visited = result.pages.map((page) => page.normalizedUrl);
    expect(visited).toContain(`${ORIGIN}/one`);
    expect(visited).toContain(`${ORIGIN}/two`);
  });

  it('восстановленные страницы считаются в лимит тарифа', async () => {
    const result = await crawl(
      scope({ maxPages: 1 }),
      options({
        fetcher: staticSite({ '/one': linkPage('One') }),
        probeMedia: false,
        restored: { pages: [restoredHome], coverage: emptyCoverage },
      }),
    );

    expect(result.pages).toHaveLength(1);
    expect(result.skippedOverLimit.length).toBeGreaterThan(0);
  });

  it('счётчики рендера описывают скан, а не попытку', async () => {
    // Восстановленные страницы несут собственный rendering: одна прочитана
    // браузером, вторую пауза застала до рендера. Если их не считать, скан
    // после resume сообщает «не отрендерено: 0», хотя одна из его страниц
    // отрендерена не была.
    const result = await crawl(
      scope({ renderJs: true, maxPages: 10 }),
      options({
        fetcher: staticSite({ '/one': linkPage('One'), '/two': linkPage('Two') }),
        renderRuntime: { kind: 'ready', runtime: stubRuntime(linkPage('Rendered')) },
        probeMedia: false,
        restored: {
          pages: [
            {
              ...restoredHome,
              rendering: {
                status: 'Rendered',
                subresourceCount: 1,
                subresourceBytes: 10,
                blocked: [],
                timingMs: 4,
              },
            },
            {
              ...restoredHome,
              requestedUrl: `${ORIGIN}/paused`,
              normalizedUrl: `${ORIGIN}/paused`,
              finalUrl: `${ORIGIN}/paused`,
              html: linkPage('Paused'),
              rendering: {
                status: 'Unavailable',
                reason: 'Stopped',
                detail: 'the scan was stopped mid-render',
              },
            },
          ],
          coverage: emptyCoverage,
        },
      }),
    );

    expect(result.rendering).toEqual({
      status: 'Rendered',
      engine: 'stub',
      version: '1.0',
      // Two pages read after the resume, plus the one restored as rendered.
      renderedPages: 3,
      // And the one the pause caught before its DOM was ever read.
      failedPages: 1,
      // None of them was short of a resource it asked for.
      incompletePages: 0,
      incompleteReasons: [],
    });
  });

  it('покрытие прошлой попытки не теряется', async () => {
    const result = await crawl(
      scope({ maxPages: 10 }),
      options({
        fetcher: staticSite({}),
        probeMedia: false,
        restored: {
          pages: [restoredHome],
          coverage: {
            skippedOverLimit: [`${ORIGIN}/over-limit`],
            blockedByRobots: [`${ORIGIN}/private/x`],
            errors: [{ url: `${ORIGIN}/boom`, reason: 'timeout' }],
            rejectedSeeds: [{ url: 'https://elsewhere.example/', reason: 'outside the site' }],
            urlVariants: { [`${ORIGIN}/dup`]: [`${ORIGIN}/dup`, `${ORIGIN}/dup?a=1`] },
          },
        },
      }),
    );

    expect(result.skippedOverLimit).toContain(`${ORIGIN}/over-limit`);
    expect(result.blockedByRobots).toContain(`${ORIGIN}/private/x`);
    expect(result.errors).toContainEqual({ url: `${ORIGIN}/boom`, reason: 'timeout' });
    expect(result.rejectedSeeds).toContainEqual({
      url: 'https://elsewhere.example/',
      reason: 'outside the site',
    });
    expect(result.urlVariants[`${ORIGIN}/dup`]).toEqual([`${ORIGIN}/dup`, `${ORIGIN}/dup?a=1`]);
  });
});

describe('render request policy', () => {
  const budget = { remainingRequests: 10, remainingBytes: 1000 };

  it('пропускает только GET/HEAD', () => {
    expect(
      subresourceVerdict({ url: `${ORIGIN}/a.js`, method: 'POST', resourceType: 'script' }, budget),
    ).toEqual({ allowed: false, reason: 'method-not-allowed' });
    expect(
      subresourceVerdict({ url: `${ORIGIN}/a.js`, method: 'GET', resourceType: 'script' }, budget)
        .allowed,
    ).toBe(true);
  });

  it('пропускает только типы ресурсов, влияющие на DOM', () => {
    for (const resourceType of ['image', 'font', 'media', 'websocket', 'eventsource']) {
      expect(
        subresourceVerdict({ url: `${ORIGIN}/x`, method: 'GET', resourceType }, budget),
      ).toEqual({ allowed: false, reason: 'resource-kind' });
    }
    for (const resourceType of ['document', 'script', 'stylesheet', 'fetch', 'xhr']) {
      expect(
        subresourceVerdict({ url: `${ORIGIN}/x`, method: 'GET', resourceType }, budget).allowed,
      ).toBe(true);
    }
  });

  it('отклоняет не-http(s) и URL с учётными данными', () => {
    for (const url of ['file:///etc/passwd', 'ftp://host/x', 'https://user:pass@host/x']) {
      expect(subresourceVerdict({ url, method: 'GET', resourceType: 'script' }, budget)).toEqual({
        allowed: false,
        reason: 'url-not-allowed',
      });
    }
  });

  it('останавливается на исчерпанном бюджете', () => {
    expect(
      subresourceVerdict(
        { url: `${ORIGIN}/a.js`, method: 'GET', resourceType: 'script' },
        { remainingRequests: 0, remainingBytes: 1000 },
      ),
    ).toEqual({ allowed: false, reason: 'budget' });
  });

  it('не пропускает в браузер заголовки, создающие состояние', () => {
    expect(
      sanitizeResponseHeaders({
        'content-type': 'text/css',
        'Set-Cookie': 'session=1',
        'content-encoding': 'gzip',
        'content-length': '10',
      }),
    ).toEqual({ 'content-type': 'text/css' });
  });

  it('заголовки запроса строятся с нуля — cookie/authorization передать нечем', () => {
    const headers = renderRequestHeaders('FluxRadarBot/0.1');
    expect(Object.keys(headers).sort()).toEqual(['accept', 'accept-language', 'user-agent']);
    expect(headers['user-agent']).toBe('FluxRadarBot/0.1');
  });
});
