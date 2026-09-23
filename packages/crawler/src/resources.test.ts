// What the media probe is allowed to conclude.
//
// The failure this file exists to prevent is a confident wrong answer: calling
// an image broken because robots.txt kept us away from it, because the budget
// ran out, or because our own request timed out. Each of those has to come back
// as "not verified", and only a real HTTP status may become evidence.

import { describe, expect, it, vi } from 'vitest';

import { MEDIA_PROBE_LIMITS } from '@fluxradar/contracts';
import { HostLimiter, SsrfBlockedError, type SafeFetchResult } from '@fluxradar/safe-fetch';

import { crawl } from './crawler.js';
import { probeMediaResources, type ProbeMediaOptions } from './resources.js';
import type { CrawlFetcher, CrawlScope, CrawlerLogger, PageSnapshot } from './types.js';

const ORIGIN = 'https://media.example';
const silentLogger: CrawlerLogger = { warn: () => undefined };

function response(url: string, overrides: Partial<SafeFetchResult> = {}): SafeFetchResult {
  return {
    finalUrl: url,
    status: 200,
    headers: { 'content-type': 'image/png' },
    body: '',
    redirectChain: [],
    timingMs: 2,
    truncated: false,
    ...overrides,
  };
}

function page(pathname: string, html: string): PageSnapshot {
  const url = `${ORIGIN}${pathname}`;
  return {
    requestedUrl: url,
    normalizedUrl: url,
    depth: 0,
    finalUrl: url,
    status: 200,
    headers: { 'content-type': 'text/html' },
    redirectChain: [],
    html,
    contentType: 'text/html; charset=utf-8',
    timingMs: 1,
    truncated: false,
  };
}

function options(overrides: Partial<ProbeMediaOptions> = {}): ProbeMediaOptions {
  return {
    head: (url) => Promise.resolve(response(url)),
    get: (url) => Promise.resolve(response(url)),
    acquire: () => Promise.resolve(() => undefined),
    isAllowed: () => Promise.resolve(true),
    isInScope: (url) => url.host === new URL(ORIGIN).host,
    shouldStop: () => false,
    ...overrides,
  };
}

const PAGE_WITH_IMAGES = page(
  '/gallery',
  '<html><body><img src="/img/ok.png"><img src="/img/gone.png">' +
    '<img src="https://cdn.elsewhere.example/x.png"></body></html>',
);

describe('media probe: what it asks for', () => {
  it('probes same-host media with HEAD and leaves third parties alone', async () => {
    const asked: { url: string; method: string }[] = [];
    const resources = await probeMediaResources(
      [PAGE_WITH_IMAGES],
      options({
        head: (url) => {
          asked.push({ url, method: 'HEAD' });
          return Promise.resolve(response(url));
        },
      }),
    );

    expect(asked.map((entry) => entry.url)).toEqual([
      `${ORIGIN}/img/ok.png`,
      `${ORIGIN}/img/gone.png`,
    ]);
    expect(resources).toHaveLength(2);
    expect(resources.every((resource) => resource.method === 'HEAD')).toBe(true);
  });

  it('records a 404 as a real status, with the page that referenced it', async () => {
    const resources = await probeMediaResources(
      [PAGE_WITH_IMAGES],
      options({
        head: (url) =>
          Promise.resolve(
            url.endsWith('gone.png')
              ? response(url, { status: 404, headers: { 'content-type': 'text/html' } })
              : response(url),
          ),
      }),
    );

    const gone = resources.find((resource) => resource.normalizedUrl.endsWith('gone.png'));
    expect(gone).toMatchObject({ status: 404, referencedBy: `${ORIGIN}/gallery` });
    expect(gone?.unverifiedReason).toBeUndefined();
  });

  it('falls back to a bounded GET only when HEAD is refused', async () => {
    const methods: string[] = [];
    const resources = await probeMediaResources(
      [page('/one', '<html><body><img src="/img/head-405.png"></body></html>')],
      options({
        head: (url) => {
          methods.push('HEAD');
          return Promise.resolve(response(url, { status: 405 }));
        },
        get: (url) => {
          methods.push('GET');
          return Promise.resolve(response(url, { status: 200 }));
        },
      }),
    );

    expect(methods).toEqual(['HEAD', 'GET']);
    expect(resources[0]).toMatchObject({ status: 200, method: 'GET' });
  });

  it('does not re-ask for a resource the crawl already fetched as a page', async () => {
    const asked: string[] = [];
    const alreadyCrawled = page('/img/ok.png', '');
    await probeMediaResources(
      [PAGE_WITH_IMAGES, { ...alreadyCrawled, html: null, contentType: 'image/png' }],
      options({
        head: (url) => {
          asked.push(url);
          return Promise.resolve(response(url));
        },
      }),
    );

    expect(asked).toEqual([`${ORIGIN}/img/gone.png`]);
  });
});

describe('media probe: what it refuses to conclude', () => {
  it('reports a robots-disallowed resource as unverified, not as broken', async () => {
    const head = vi.fn<CrawlFetcher>();
    const resources = await probeMediaResources(
      [page('/one', '<html><body><img src="/img/secret.png"></body></html>')],
      options({ isAllowed: () => Promise.resolve(false), head }),
    );

    expect(head).not.toHaveBeenCalled();
    expect(resources[0]).toMatchObject({ status: 0, unverifiedReason: 'RobotsDisallowed' });
  });

  it('reports a transport failure as unverified — it may be ours, not the site’s', async () => {
    const resources = await probeMediaResources(
      [page('/one', '<html><body><img src="/img/x.png"></body></html>')],
      options({
        head: () =>
          Promise.reject(
            new SsrfBlockedError({
              url: `${ORIGIN}/img/x.png`,
              host: 'media.example',
              ip: '10.0.0.1',
              reason: 'rfc1918',
            }),
          ),
        get: () =>
          Promise.reject(
            new SsrfBlockedError({
              url: `${ORIGIN}/img/x.png`,
              host: 'media.example',
              ip: '10.0.0.1',
              reason: 'rfc1918',
            }),
          ),
      }),
    );

    expect(resources[0]).toMatchObject({ status: 0, unverifiedReason: 'RequestFailed' });
    expect(resources[0]?.fetchError).toContain('SsrfBlockedError');
  });

  it('stops asking when the scan stops, and says which ones it never reached', async () => {
    let stopped = false;
    const asked: string[] = [];
    const html = `<html><body>${[1, 2, 3, 4]
      .map((index) => `<img src="/img/${index}.png">`)
      .join('')}</body></html>`;
    const resources = await probeMediaResources(
      [page('/one', html)],
      options({
        head: (url) => {
          asked.push(url);
          stopped = true;
          return Promise.resolve(response(url));
        },
        shouldStop: () => stopped,
      }),
    );

    expect(asked).toHaveLength(1);
    expect(resources.slice(1).every((resource) => resource.unverifiedReason === 'Stopped')).toBe(
      true,
    );
  });

  it('marks everything past the probe budget unverified instead of dropping it', async () => {
    const total = MEDIA_PROBE_LIMITS.maxProbes + 5;
    const html = `<html><body>${Array.from(
      { length: total },
      (_, index) => `<img src="/img/${index}.png">`,
    ).join('')}</body></html>`;
    const resources = await probeMediaResources([page('/one', html)], options());

    expect(resources).toHaveLength(total);
    expect(
      resources.filter((resource) => resource.unverifiedReason === 'BudgetExhausted'),
    ).toHaveLength(5);
  });
});

describe('crawl: media probes do not move page counts', () => {
  const html = '<html><head><title>T</title></head><body><img src="/img/a.png"></body></html>';
  const fetcher: CrawlFetcher = (url, init) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/img/a.png') {
      return Promise.resolve(
        response(url, { status: 404, headers: { 'content-type': 'text/plain' } }),
      );
    }
    if (pathname === '/' && init === undefined) {
      return Promise.resolve(
        response(url, { headers: { 'content-type': 'text/html' }, body: html }),
      );
    }
    return Promise.resolve(
      response(url, { status: 404, headers: { 'content-type': 'text/plain' } }),
    );
  };

  const scope: CrawlScope = { origin: ORIGIN, includeSubdomains: false, maxPages: 1, maxDepth: 0 };

  it('keeps a probed resource out of pages and out of the page limit', async () => {
    const result = await crawl(scope, {
      fetcher,
      limiter: new HostLimiter({ rps: 1000, concurrency: 4 }),
      logger: silentLogger,
    });

    expect(result.pages).toHaveLength(1);
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]).toMatchObject({ status: 404 });
    expect(result.pages.map((entry) => entry.normalizedUrl)).not.toContain(`${ORIGIN}/img/a.png`);
  });

  it('does not probe at all when the crawl was stopped', async () => {
    const result = await crawl(scope, {
      fetcher,
      limiter: new HostLimiter({ rps: 1000, concurrency: 4 }),
      logger: silentLogger,
      shouldStop: () => true,
    });

    expect(result.resources).toEqual([]);
  });

  it('can be switched off entirely', async () => {
    const result = await crawl(scope, {
      fetcher,
      limiter: new HostLimiter({ rps: 1000, concurrency: 4 }),
      logger: silentLogger,
      probeMedia: false,
    });

    expect(result.resources).toEqual([]);
    expect(result.pages).toHaveLength(1);
  });
});

// A probe is a request to the owner's server, and pausing does not change its
// answer. Re-issuing the whole set on every resume — including a resume whose
// pages are all restored and whose frontier is empty — is a cost the owner
// pays for nothing.
describe('media probes across a resume', () => {
  const html =
    '<html><head><title>T</title></head><body>' +
    '<img src="/img/known.png"><img src="/img/unchecked.png"></body></html>';
  const scope: CrawlScope = { origin: ORIGIN, includeSubdomains: false, maxPages: 1, maxDepth: 0 };

  function restoredPage(): PageSnapshot {
    return { ...page('/', html), html };
  }

  function countingFetcher(asked: string[]): CrawlFetcher {
    return (url, init) => {
      const pathname = new URL(url).pathname;
      if (init !== undefined) asked.push(pathname);
      if (pathname === '/' && init === undefined) {
        return Promise.resolve(
          response(url, { headers: { 'content-type': 'text/html' }, body: html }),
        );
      }
      return Promise.resolve(response(url));
    };
  }

  it('reuses an answer it already has and asks again only for what it never checked', async () => {
    const asked: string[] = [];
    const result = await crawl(scope, {
      fetcher: countingFetcher(asked),
      limiter: new HostLimiter({ rps: 1000, concurrency: 4 }),
      logger: silentLogger,
      restored: {
        pages: [restoredPage()],
        coverage: {
          skippedOverLimit: [],
          blockedByRobots: [],
          errors: [],
          rejectedSeeds: [],
          urlVariants: {},
        },
        resources: [
          {
            requestedUrl: `${ORIGIN}/img/known.png`,
            normalizedUrl: `${ORIGIN}/img/known.png`,
            finalUrl: `${ORIGIN}/img/known.png`,
            status: 404,
            contentType: null,
            method: 'HEAD',
            timingMs: 5,
            referencedBy: `${ORIGIN}/`,
          },
          {
            requestedUrl: `${ORIGIN}/img/unchecked.png`,
            normalizedUrl: `${ORIGIN}/img/unchecked.png`,
            finalUrl: `${ORIGIN}/img/unchecked.png`,
            status: 0,
            contentType: null,
            timingMs: 0,
            unverifiedReason: 'BudgetExhausted',
            referencedBy: `${ORIGIN}/`,
          },
        ],
      },
    });

    // The 404 is carried over verbatim; only the one that was never actually
    // checked costs the site another request.
    expect(asked).not.toContain('/img/known.png');
    expect(asked).toContain('/img/unchecked.png');
    const known = result.resources.find((entry) => entry.normalizedUrl.endsWith('/known.png'));
    const rechecked = result.resources.find((entry) =>
      entry.normalizedUrl.endsWith('/unchecked.png'),
    );
    expect(known).toMatchObject({ status: 404, timingMs: 5 });
    expect(rechecked).toMatchObject({ status: 200 });
    expect(rechecked?.unverifiedReason).toBeUndefined();
  });

  it('hands the probes back unchanged when the resumed run is stopped again', async () => {
    const carried = [
      {
        requestedUrl: `${ORIGIN}/img/known.png`,
        normalizedUrl: `${ORIGIN}/img/known.png`,
        finalUrl: `${ORIGIN}/img/known.png`,
        status: 200,
        contentType: 'image/png',
        method: 'HEAD' as const,
        timingMs: 4,
        referencedBy: `${ORIGIN}/`,
      },
    ];

    const result = await crawl(scope, {
      fetcher: countingFetcher([]),
      limiter: new HostLimiter({ rps: 1000, concurrency: 4 }),
      logger: silentLogger,
      shouldStop: () => true,
      restored: {
        pages: [restoredPage()],
        coverage: {
          skippedOverLimit: [],
          blockedByRobots: [],
          errors: [],
          rejectedSeeds: [],
          urlVariants: {},
        },
        resources: carried,
      },
    });

    // A stopped run probes nothing, but it must not report that the site
    // suddenly has no media either.
    expect(result.resources).toEqual(carried);
  });
});
