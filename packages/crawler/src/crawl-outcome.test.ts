import { describe, expect, it } from 'vitest';

import { assessSiteReach, crawlCoverage, isSuccessfulHtmlPage } from './crawl-outcome.js';
import type { CrawlResult, PageSnapshot } from './types.js';

const ORIGIN = 'https://example.test';

function page(overrides: Partial<PageSnapshot> & { readonly url: string }): PageSnapshot {
  const { url, ...rest } = overrides;
  return {
    requestedUrl: url,
    normalizedUrl: url,
    finalUrl: url,
    status: 200,
    depth: 0,
    headers: {},
    redirectChain: [],
    html: '<html><body>ok</body></html>',
    contentType: 'text/html; charset=utf-8',
    timingMs: 5,
    truncated: false,
    ...rest,
  };
}

function result(overrides: Partial<CrawlResult> = {}): CrawlResult {
  return {
    pages: [],
    skippedOverLimit: [],
    blockedByRobots: [],
    errors: [],
    urlVariants: {},
    sitemapUrls: [],
    rejectedSeeds: [],
    rendering: { status: 'NotRequested' },
    resources: [],
    pendingQueue: [],
    stoppedEarly: false,
    ...overrides,
  };
}

/** The Cloudflare challenge that made a blocked site read as a reachable one. */
function challengePage(url: string): PageSnapshot {
  return page({
    url,
    status: 403,
    headers: { server: 'cloudflare', 'cf-mitigated': 'challenge', 'cf-ray': 'abc123' },
    html: '<html><body>Attention Required!</body></html>',
  });
}

describe('isSuccessfulHtmlPage', () => {
  it('accepts a 2xx response that carried markup', () => {
    expect(isSuccessfulHtmlPage(page({ url: `${ORIGIN}/` }))).toBe(true);
  });

  it('rejects a challenge page, which answers without being a page of the site', () => {
    expect(isSuccessfulHtmlPage(challengePage(`${ORIGIN}/`))).toBe(false);
  });

  it('rejects a 2xx response that carried no markup', () => {
    expect(isSuccessfulHtmlPage(page({ url: `${ORIGIN}/logo.png`, html: null }))).toBe(false);
  });

  it('rejects a request that never produced a response', () => {
    expect(
      isSuccessfulHtmlPage(
        page({ url: `${ORIGIN}/`, status: 0, html: null, fetchError: 'timeout' }),
      ),
    ).toBe(false);
  });
});

describe('crawlCoverage', () => {
  it('counts addresses left over the page limit as found but unread', () => {
    // The ukrdentclub.ua shape: a page limit far below the sitemap.
    const coverage = crawlCoverage(
      result({
        pages: Array.from({ length: 15 }, (unused, index) => page({ url: `${ORIGIN}/p${index}` })),
        skippedOverLimit: Array.from({ length: 319 }, (unused, index) => `${ORIGIN}/rest${index}`),
      }),
    );

    expect(coverage.pagesRead).toBe(15);
    expect(coverage.urlsDiscovered).toBe(334);
    expect(coverage.urlsOverLimit).toBe(319);
    // Whatever the report renders, 15 of 334 must never be able to say 100%.
    expect(coverage.pagesRead / coverage.urlsDiscovered).toBeLessThan(1);
  });

  it('separates pages fetched from pages actually read', () => {
    const coverage = crawlCoverage(
      result({
        pages: [
          page({ url: `${ORIGIN}/` }),
          page({ url: `${ORIGIN}/gone`, status: 404, html: null }),
          page({ url: `${ORIGIN}/down`, status: 0, html: null, fetchError: 'ECONNRESET' }),
        ],
      }),
    );

    expect(coverage.pagesFetched).toBe(3);
    expect(coverage.pagesRead).toBe(1);
    expect(coverage.urlsDiscovered).toBe(3);
  });

  it('keeps robots-blocked addresses out of the denominator and counts them apart', () => {
    const coverage = crawlCoverage(
      result({
        pages: [page({ url: `${ORIGIN}/` })],
        blockedByRobots: [`${ORIGIN}/admin`, `${ORIGIN}/cart`],
      }),
    );

    // Not reading what robots.txt forbids is compliance, not a gap: a site that
    // hides half of itself must still be able to reach full coverage.
    expect(coverage.urlsDiscovered).toBe(1);
    expect(coverage.pagesRead).toBe(1);
    expect(coverage.urlsBlockedByRobots).toBe(2);
  });
});

describe('assessSiteReach', () => {
  it('calls a site reachable once one page has been read', () => {
    const reach = assessSiteReach(result({ pages: [page({ url: `${ORIGIN}/` })] }), ORIGIN);

    expect(reach.kind).toBe('reachable');
  });

  it('calls a 403 challenge on the start page access-denied, not a reachable site', () => {
    const reach = assessSiteReach(result({ pages: [challengePage(`${ORIGIN}/`)] }), ORIGIN);

    expect(reach.kind).toBe('access-denied');
    expect(reach.startStatus).toBe(403);
    expect(reach.accessControlSignals).toContain('server: cloudflare');
    expect(reach.accessControlSignals).toContain('cf-mitigated: challenge');
  });

  it.each([401, 403, 407, 429, 503])('reads %i on the start page as access-denied', (status) => {
    const reach = assessSiteReach(
      result({ pages: [page({ url: `${ORIGIN}/`, status, html: 'denied' })] }),
      ORIGIN,
    );

    expect(reach.kind).toBe('access-denied');
  });

  it('separates a broken site from one that is refusing us', () => {
    const reach = assessSiteReach(
      result({ pages: [page({ url: `${ORIGIN}/`, status: 500, html: 'oops' })] }),
      ORIGIN,
    );

    expect(reach.kind).toBe('bad-response');
    expect(reach.accessControlSignals).toEqual([]);
  });

  it('reads a request that never connected as unreachable', () => {
    const reach = assessSiteReach(
      result({
        pages: [page({ url: `${ORIGIN}/`, status: 0, html: null, fetchError: 'ENOTFOUND' })],
      }),
      ORIGIN,
    );

    expect(reach.kind).toBe('unreachable');
    expect(reach.startFetchError).toBe('ENOTFOUND');
  });

  it('names robots.txt when it is what kept the start page out of the crawl', () => {
    const reach = assessSiteReach(result({ blockedByRobots: [`${ORIGIN}/`] }), ORIGIN);

    expect(reach.kind).toBe('blocked-by-robots');
    expect(reach.startStatus).toBeNull();
  });

  it('reads an empty crawl with no robots rule as unreachable', () => {
    expect(assessSiteReach(result(), ORIGIN).kind).toBe('unreachable');
  });

  it('does not mistake a sitemap page for the start page', () => {
    // robots.txt hides the homepage; the first fetched page is a sitemap seed
    // that answers 200. The start page still has no status of its own.
    const reach = assessSiteReach(
      result({
        pages: [challengePage(`${ORIGIN}/deep`)],
        blockedByRobots: [`${ORIGIN}/`],
      }),
      ORIGIN,
    );

    expect(reach.kind).toBe('blocked-by-robots');
    expect(reach.startStatus).toBeNull();
  });

  it('matches the start page through its redirect target', () => {
    const reach = assessSiteReach(
      result({
        pages: [
          page({
            url: `${ORIGIN}/landing`,
            normalizedUrl: `${ORIGIN}/landing`,
            finalUrl: `${ORIGIN}/`,
            status: 403,
            html: 'denied',
          }),
        ],
      }),
      ORIGIN,
    );

    expect(reach.kind).toBe('access-denied');
  });

  it('does not call a site blocked because it sits behind a CDN that answers', () => {
    const reach = assessSiteReach(
      result({
        pages: [page({ url: `${ORIGIN}/`, headers: { server: 'cloudflare', 'cf-ray': 'abc' } })],
      }),
      ORIGIN,
    );

    expect(reach.kind).toBe('reachable');
  });
});
