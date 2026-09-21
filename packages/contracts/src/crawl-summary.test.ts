import { describe, expect, it } from 'vitest';

import {
  crawlCoverageRatio,
  crawlSummarySchema,
  isFullCrawlCoverage,
  isSiteRead,
  parseCrawlSummary,
  siteReachStatusReason,
  type CrawlSummary,
} from './crawl-summary.js';

function summary(overrides: Partial<CrawlSummary> = {}): CrawlSummary {
  return {
    reach: 'reachable',
    startStatus: 200,
    accessControlSignals: [],
    pagesRead: 15,
    pagesFetched: 15,
    urlsDiscovered: 334,
    urlsOverLimit: 319,
    urlsBlockedByRobots: 0,
    limitedBy: 'owner',
    maxPages: 15,
    ...overrides,
  };
}

describe('crawl coverage', () => {
  it('does not call a partly read site fully covered', () => {
    // The ukrdentclub.ua report: 15 pages of 334, presented as 100%.
    const partial = summary();

    expect(isFullCrawlCoverage(partial)).toBe(false);
    expect(crawlCoverageRatio(partial)).toBeCloseTo(15 / 334);
  });

  it('calls a fully read site fully covered', () => {
    const whole = summary({
      pagesRead: 40,
      pagesFetched: 40,
      urlsDiscovered: 40,
      urlsOverLimit: 0,
      limitedBy: null,
      maxPages: 50_000,
    });

    expect(isFullCrawlCoverage(whole)).toBe(true);
    expect(crawlCoverageRatio(whole)).toBe(1);
  });

  it('has no ratio at all when nothing was found', () => {
    // 0% would read as a bad grade; "nothing was read" is the honest sentence.
    const nothing = summary({ pagesRead: 0, pagesFetched: 0, urlsDiscovered: 0, urlsOverLimit: 0 });

    expect(crawlCoverageRatio(nothing)).toBeNull();
    expect(isFullCrawlCoverage(nothing)).toBe(false);
  });

  it('separates the owner’s own limit from the plan ceiling', () => {
    expect(summary({ limitedBy: 'owner' }).limitedBy).toBe('owner');
    expect(summary({ limitedBy: 'plan', maxPages: 50_000 }).limitedBy).toBe('plan');
  });
});

describe('site reach', () => {
  it('only calls a site read when the crawl reached it', () => {
    expect(isSiteRead(summary())).toBe(true);
    expect(isSiteRead(summary({ reach: 'access-denied' }))).toBe(false);
  });

  it('gives each failing reach its own status reason', () => {
    expect(siteReachStatusReason(summary())).toBeNull();
    expect(siteReachStatusReason(summary({ reach: 'access-denied' }))).toBe('SiteDeniedAccess');
    expect(siteReachStatusReason(summary({ reach: 'unreachable' }))).toBe('SiteUnreachable');
    expect(siteReachStatusReason(summary({ reach: 'blocked-by-robots' }))).toBe(
      'SiteBlockedByRobots',
    );
    expect(siteReachStatusReason(summary({ reach: 'bad-response' }))).toBe(
      'SiteReturnedNoReadablePage',
    );
  });

  it('gives a refused site a different reason from a broken one', () => {
    // The two need different words: an allowlist entry fixes one of them.
    expect(siteReachStatusReason(summary({ reach: 'access-denied' }))).not.toBe(
      siteReachStatusReason(summary({ reach: 'bad-response' })),
    );
  });
});

describe('parseCrawlSummary', () => {
  it('round-trips a stored summary', () => {
    expect(parseCrawlSummary(JSON.stringify(summary()))).toEqual(summary());
  });

  it('reads a scan written before the column existed as "not recorded"', () => {
    expect(parseCrawlSummary(null)).toBeNull();
    expect(parseCrawlSummary('')).toBeNull();
  });

  it('refuses a damaged or incomplete row instead of inventing numbers', () => {
    expect(parseCrawlSummary('{ not json')).toBeNull();
    expect(parseCrawlSummary(JSON.stringify({ reach: 'reachable' }))).toBeNull();
    expect(parseCrawlSummary(JSON.stringify({ ...summary(), reach: 'who-knows' }))).toBeNull();
  });

  it('refuses negative counts', () => {
    expect(crawlSummarySchema.safeParse({ ...summary(), pagesRead: -1 }).success).toBe(false);
  });
});
