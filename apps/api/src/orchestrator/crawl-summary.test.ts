import { scanScopeSchema } from '@fluxradar/contracts';
import type { CrawlResult, PageSnapshot } from '@fluxradar/crawler';
import { describe, expect, it } from 'vitest';

import { buildCrawlSummary } from './crawl-summary.ts';

const ORIGIN = 'https://example.com';

function scope(overrides: Record<string, unknown> = {}) {
  return scanScopeSchema.parse({ includeSubdomains: false, ...overrides });
}

function page(url: string): PageSnapshot {
  return {
    requestedUrl: url,
    normalizedUrl: url,
    finalUrl: url,
    status: 200,
    headers: {},
    redirectChain: [],
    html: '<html><body>page</body></html>',
    contentType: 'text/html',
    timingMs: 4,
    truncated: false,
  };
}

function crawl(pageCount: number, overCount: number): CrawlResult {
  return {
    pages: Array.from({ length: pageCount }, (unused, index) => page(`${ORIGIN}/p${index}`)),
    skippedOverLimit: Array.from({ length: overCount }, (unused, index) => `${ORIGIN}/x${index}`),
    blockedByRobots: [],
    errors: [],
    urlVariants: {},
    sitemapUrls: [],
    mediaChecks: [],
    mediaOverBudget: [],
  };
}

describe('buildCrawlSummary', () => {
  it('reports how much of the site was read, not how many checks closed', () => {
    const summary = buildCrawlSummary(
      crawl(15, 319),
      ORIGIN,
      scope({ maxPages: 15 }),
      'Complete',
      15,
    );

    expect(summary.pagesRead).toBe(15);
    expect(summary.urlsDiscovered).toBe(334);
  });

  it('attributes the stopped crawl to the owner when their setting is the smaller one', () => {
    // Complete sells 50,000 URLs; a 15-page crawl was this account's own choice,
    // and telling them the plan ran out would send them to the pricing page.
    const summary = buildCrawlSummary(
      crawl(15, 319),
      ORIGIN,
      scope({ maxPages: 15 }),
      'Complete',
      15,
    );

    expect(summary.limitedBy).toBe('owner');
    expect(summary.maxPages).toBe(15);
  });

  it('attributes it to the plan when no smaller setting was asked for', () => {
    const summary = buildCrawlSummary(crawl(5000, 900), ORIGIN, scope(), 'Basic', 5000);

    expect(summary.limitedBy).toBe('plan');
  });

  it('attributes it to the plan when the owner asked for the whole tariff', () => {
    const summary = buildCrawlSummary(
      crawl(5000, 900),
      ORIGIN,
      scope({ maxPages: 5000 }),
      'Basic',
      5000,
    );

    expect(summary.limitedBy).toBe('plan');
  });

  it('blames nobody when the crawl read everything it found', () => {
    const summary = buildCrawlSummary(
      crawl(12, 0),
      ORIGIN,
      scope({ maxPages: 15 }),
      'Complete',
      15,
    );

    expect(summary.limitedBy).toBeNull();
    expect(summary.pagesRead).toBe(summary.urlsDiscovered);
  });
});
