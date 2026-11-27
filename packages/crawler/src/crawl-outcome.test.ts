import { describe, expect, it } from 'vitest';

import {
  assessSiteReach,
  crawlCoverage,
  isSuccessfulHtmlPage,
  sitemapCoverage,
} from './crawl-outcome.js';
import { SITEMAP_MAX_URLS } from './sitemap.js';
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
    scope: { origin: ORIGIN, includeSubdomains: false, maxPages: 50 },
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

describe('sitemapCoverage', () => {
  it('counts the sitemap pages a homepage-only check never read', () => {
    // The Free check: depth 0 drops every sitemap address before the queue, so
    // crawlCoverage reports one address found on a site that lists fifteen.
    const crawled = result({
      pages: [page({ url: `${ORIGIN}/` })],
      sitemapUrls: [`${ORIGIN}/`, ...Array.from({ length: 14 }, (unused, i) => `${ORIGIN}/p${i}`)],
      scope: { origin: ORIGIN, includeSubdomains: false, maxPages: 1, maxDepth: 0 },
    });

    expect(crawlCoverage(crawled).urlsDiscovered).toBe(1);
    expect(sitemapCoverage(crawled)).toEqual({ urls: 15, unread: 14, capped: false });
  });

  it('counts one page once, however the sitemap spells it', () => {
    const crawled = result({
      pages: [page({ url: `${ORIGIN}/` })],
      sitemapUrls: [
        `${ORIGIN}/pricing`,
        `${ORIGIN}/pricing#plans`,
        `${ORIGIN}/pricing?utm_source=sitemap`,
      ],
      scope: { origin: ORIGIN, includeSubdomains: false, maxPages: 1, queryPolicy: 'ignore' },
    });

    expect(sitemapCoverage(crawled)).toEqual({ urls: 1, unread: 1, capped: false });
  });

  it('leaves out addresses the scan scope does not cover', () => {
    const crawled = result({
      pages: [page({ url: `${ORIGIN}/` })],
      sitemapUrls: [
        `${ORIGIN}/blog/a`,
        `${ORIGIN}/admin/users`,
        'https://shop.example.test/cart',
        'https://elsewhere.test/',
        'not an address',
      ],
      scope: {
        origin: ORIGIN,
        includeSubdomains: false,
        maxPages: 1,
        excludePatterns: ['/admin/*'],
      },
    });

    expect(sitemapCoverage(crawled)).toEqual({ urls: 1, unread: 1, capped: false });
  });

  it('does not count a page as unread when it was reached through a redirect', () => {
    const crawled = result({
      pages: [page({ url: `${ORIGIN}/`, finalUrl: `${ORIGIN}/home` })],
      sitemapUrls: [`${ORIGIN}/home`, `${ORIGIN}/about`],
    });

    expect(sitemapCoverage(crawled)).toEqual({ urls: 2, unread: 1, capped: false });
  });

  it('does not count the homepage as unread because the sitemap still says http', () => {
    // A site moved to https years ago; its sitemap was never regenerated.
    const crawled = result({
      pages: [page({ url: `${ORIGIN}/` })],
      sitemapUrls: ['http://example.test/', 'http://example.test/about', `${ORIGIN}/about`],
    });

    expect(sitemapCoverage(crawled)).toEqual({ urls: 2, unread: 1, capped: false });
  });

  it('counts a page reached through a redirect hop as read', () => {
    // `/` → `/start` → `/en/`: the crawl keeps `/` and `/en/`; the sitemap
    // lists the hop in between.
    const crawled = result({
      pages: [
        page({
          url: `${ORIGIN}/`,
          finalUrl: `${ORIGIN}/en/`,
          redirectChain: [
            { url: `${ORIGIN}/`, status: 301, location: '/start' },
            { url: `${ORIGIN}/start`, status: 302, location: '/en/' },
          ],
        }),
      ],
      sitemapUrls: [`${ORIGIN}/legacy`, `${ORIGIN}/start`, `${ORIGIN}/en/`],
    });

    expect(sitemapCoverage(crawled)).toEqual({ urls: 3, unread: 1, capped: false });
  });

  it('reads the homepage listed as its index file as the homepage', () => {
    const crawled = result({
      pages: [page({ url: `${ORIGIN}/` })],
      sitemapUrls: [`${ORIGIN}/index.html`, `${ORIGIN}/index.php`, `${ORIGIN}/about`],
    });

    expect(sitemapCoverage(crawled)).toEqual({ urls: 2, unread: 1, capped: false });
  });

  it('does not count files as pages', () => {
    const crawled = result({
      pages: [page({ url: `${ORIGIN}/` })],
      sitemapUrls: [
        `${ORIGIN}/price-list.pdf`,
        `${ORIGIN}/images/hero.JPG`,
        `${ORIGIN}/feed.xml`,
        `${ORIGIN}/pricing`,
      ],
    });

    expect(sitemapCoverage(crawled)).toEqual({ urls: 1, unread: 1, capped: false });
  });

  it('never reports more unread pages than it lists, and none when all were read', () => {
    const urls = [`${ORIGIN}/`, `${ORIGIN}/a`, `${ORIGIN}/b`];
    const crawled = result({ pages: urls.map((url) => page({ url })), sitemapUrls: urls });

    expect(sitemapCoverage(crawled)).toEqual({ urls: 3, unread: 0, capped: false });
  });

  it('keeps query variants apart when the scan does', () => {
    const crawled = result({
      pages: [page({ url: `${ORIGIN}/` })],
      sitemapUrls: [`${ORIGIN}/list?page=1`, `${ORIGIN}/list?page=2`],
      scope: { origin: ORIGIN, includeSubdomains: false, maxPages: 1, queryPolicy: 'include' },
    });

    expect(sitemapCoverage(crawled)).toEqual({ urls: 2, unread: 2, capped: false });
  });

  it('is exact one entry under the ceiling', () => {
    const crawled = result({
      pages: [page({ url: `${ORIGIN}/` })],
      sitemapUrls: Array.from({ length: SITEMAP_MAX_URLS - 1 }, (unused, i) => `${ORIGIN}/p${i}`),
    });

    expect(sitemapCoverage(crawled)?.capped).toBe(false);
  });

  // The crawl does not follow its homepage to another host, `www.` included;
  // counting that host's pages would sell an audit that does not read them.
  it('counts nothing on a host the crawl would not read, www included', () => {
    const toWww = result({
      pages: [
        page({
          url: `${ORIGIN}/`,
          finalUrl: 'https://www.example.test/',
          redirectChain: [
            { url: `${ORIGIN}/`, status: 301, location: 'https://www.example.test/' },
          ],
        }),
      ],
      sitemapUrls: ['https://www.example.test/', 'https://www.example.test/about'],
      scope: { origin: ORIGIN, includeSubdomains: false, maxPages: 1 },
    });
    const elsewhere = result({
      pages: [
        page({
          url: `${ORIGIN}/`,
          finalUrl: 'https://other-company.test/',
          redirectChain: [
            { url: `${ORIGIN}/`, status: 301, location: 'https://other-company.test/' },
          ],
        }),
      ],
      sitemapUrls: Array.from({ length: 400 }, (unused, i) => `https://other-company.test/p${i}`),
      scope: { origin: ORIGIN, includeSubdomains: false, maxPages: 1 },
    });

    expect(sitemapCoverage(toWww)).toBeNull();
    expect(sitemapCoverage(elsewhere)).toBeNull();
  });

  it('reads the homepage it reached on www as the homepage the sitemap names', () => {
    const crawled = result({
      pages: [
        page({
          url: `${ORIGIN}/`,
          finalUrl: 'https://www.example.test/',
          redirectChain: [
            { url: `${ORIGIN}/`, status: 301, location: 'https://www.example.test/' },
          ],
        }),
      ],
      sitemapUrls: [`${ORIGIN}/`, `${ORIGIN}/about`],
    });

    expect(sitemapCoverage(crawled)).toEqual({ urls: 2, unread: 1, capped: false });
  });

  it('reads a doubled slash as the path it doubles', () => {
    const crawled = result({
      pages: [page({ url: `${ORIGIN}/` })],
      sitemapUrls: [`${ORIGIN}/`, `${ORIGIN}//`, `${ORIGIN}/a//`, `${ORIGIN}/a/`],
    });

    expect(sitemapCoverage(crawled)).toEqual({ urls: 2, unread: 1, capped: false });
  });

  it('reads index documents of every common kind as their directory', () => {
    const crawled = result({
      pages: [page({ url: `${ORIGIN}/` })],
      sitemapUrls: [
        `${ORIGIN}/default.aspx`,
        `${ORIGIN}/index.shtml`,
        `${ORIGIN}/index.jsp`,
        `${ORIGIN}/blog/index.html`,
        `${ORIGIN}/myindex.html`,
      ],
    });

    // `/blog/` and `/myindex.html` are pages of their own and were not read.
    expect(sitemapCoverage(crawled)).toEqual({ urls: 3, unread: 2, capped: false });
  });

  it('reads a page listed without the trailing slash it was fetched with', () => {
    const crawled = result({
      pages: [
        page({
          url: `${ORIGIN}/`,
          finalUrl: `${ORIGIN}/en/`,
          redirectChain: [{ url: `${ORIGIN}/`, status: 301, location: '/en/' }],
        }),
      ],
      sitemapUrls: [`${ORIGIN}/en`, `${ORIGIN}/`],
    });

    expect(sitemapCoverage(crawled)).toEqual({ urls: 2, unread: 0, capped: false });
  });

  it('keeps an index document with its own query apart from the homepage', () => {
    const crawled = result({
      pages: [page({ url: `${ORIGIN}/` })],
      sitemapUrls: [`${ORIGIN}/index.php?route=product/1`, `${ORIGIN}/index.php`],
      scope: { origin: ORIGIN, includeSubdomains: false, maxPages: 1, queryPolicy: 'include' },
    });

    expect(sitemapCoverage(crawled)).toEqual({ urls: 2, unread: 1, capped: false });
  });

  it('applies the scan query policy to the addresses a page answered at', () => {
    const crawled = result({
      pages: [
        page({
          url: `${ORIGIN}/`,
          finalUrl: `${ORIGIN}/home?src=redirect`,
          redirectChain: [{ url: `${ORIGIN}/`, status: 302, location: '/home?src=redirect' }],
        }),
      ],
      sitemapUrls: [`${ORIGIN}/home`],
      scope: { origin: ORIGIN, includeSubdomains: false, maxPages: 1, queryPolicy: 'ignore' },
    });

    expect(sitemapCoverage(crawled)).toEqual({ urls: 1, unread: 0, capped: false });
  });

  it('leaves fonts, videos, archives and calendar files out of the pages', () => {
    const crawled = result({
      pages: [page({ url: `${ORIGIN}/` })],
      sitemapUrls: [
        `${ORIGIN}/fonts/a.woff2`,
        `${ORIGIN}/video/tour.mkv`,
        `${ORIGIN}/files/catalog.tgz`,
        `${ORIGIN}/events/open-day.ics`,
        `${ORIGIN}/partners/acme.com`,
        `${ORIGIN}/v2.0-release`,
      ],
    });

    // A dot in a slug is still a page.
    expect(sitemapCoverage(crawled)).toEqual({ urls: 2, unread: 2, capped: false });
  });

  it('says the counts are floors when the sitemap was cut at the ceiling', () => {
    const crawled = result({
      pages: [page({ url: `${ORIGIN}/` })],
      sitemapUrls: Array.from({ length: SITEMAP_MAX_URLS }, (unused, i) => `${ORIGIN}/p${i}`),
    });

    expect(sitemapCoverage(crawled)).toEqual({
      urls: SITEMAP_MAX_URLS,
      unread: SITEMAP_MAX_URLS,
      capped: true,
    });
  });

  it('returns null rather than a zero when the site has no sitemap', () => {
    expect(sitemapCoverage(result({ pages: [page({ url: `${ORIGIN}/` })] }))).toBeNull();
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

it.each([
  ['User-agent: *\nDisallow: /', true],
  ['User-agent: FluxRadarBot\nDisallow: /', false],
  ['User-agent: *\nDisallow: /\nUser-agent: Googlebot\nAllow: /', true],
])('robots refusal search-engine flag %s', (robotsTxt, blocked) => {
  const reach = assessSiteReach(result({ blockedByRobots: [`${ORIGIN}/`], robotsTxt }), ORIGIN);
  expect(reach).toMatchObject({ kind: 'blocked-by-robots', searchEnginesBlocked: blocked });
});

it.each([
  ['Googlebot', ['Google']],
  ['Bingbot', ['Bing']],
  ['*', ['Bing', 'Google']],
] as const)('names blocked search engines for %s', (agent, names) => {
  const robotsTxt = `User-agent: FluxRadarBot\nDisallow: /\nUser-agent: ${agent}\nDisallow: /`;
  expect(
    assessSiteReach(result({ blockedByRobots: [`${ORIGIN}/`], robotsTxt }), ORIGIN)
      .blockedSearchEngines,
  ).toEqual(names);
});
