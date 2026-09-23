import type { CrawlResult, PageSnapshot } from '@fluxradar/crawler';
import { describe, expect, it } from 'vitest';

import { uncountedCrawlBytes } from './crawl-egress-bytes.ts';

// What a resumed crawl owes the egress counter. The bug this defends against
// was a whole crawl counted twice: the crawler returns restored pages inside
// the resumed attempt's result, and the total of that result was booked again.

const ORIGIN = 'https://example.com';

function page(path: string, html: string | null): PageSnapshot {
  const url = `${ORIGIN}${path}`;
  return {
    requestedUrl: url,
    normalizedUrl: url,
    finalUrl: url,
    status: 200,
    depth: 0,
    headers: {},
    redirectChain: [],
    html,
    contentType: 'text/html',
    timingMs: 4,
    truncated: false,
  };
}

function crawl(pages: readonly PageSnapshot[]): CrawlResult {
  return {
    pages: [...pages],
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
  };
}

const HOME = page('/', '<html><body>home</body></html>');
const PRICING = page('/pricing', '<html><body>pricing is longer</body></html>');
const homeBytes = Buffer.byteLength(HOME.html ?? '', 'utf8');
const pricingBytes = Buffer.byteLength(PRICING.html ?? '', 'utf8');

describe('uncountedCrawlBytes', () => {
  it('counts the whole crawl when nothing was counted before', () => {
    expect(uncountedCrawlBytes(crawl([HOME, PRICING]), [])).toBe(homeBytes + pricingBytes);
  });

  // The regression: the second attempt's result contains the first attempt's
  // pages, and counting its total booked the site's traffic a second time.
  //
  // It is also the case of a page that had to be read again — one whose
  // evidence did not fit the store is absent from the restored set, so it is
  // counted here exactly as it crossed the proxy: twice, once per attempt.
  it('counts only the pages a resumed crawl read itself, not the restored ones', () => {
    expect(uncountedCrawlBytes(crawl([HOME, PRICING]), [HOME])).toBe(pricingBytes);
  });

  it('counts nothing when a resume added no page of its own', () => {
    expect(uncountedCrawlBytes(crawl([HOME, PRICING]), [HOME, PRICING])).toBe(0);
  });

  it('counts the difference when a restored page comes back larger', () => {
    const grown = page('/', '<html><body>home, now with more of it</body></html>');
    const grownBytes = Buffer.byteLength(grown.html ?? '', 'utf8');

    expect(uncountedCrawlBytes(crawl([grown]), [HOME])).toBe(grownBytes - homeBytes);
  });

  it('never goes negative when a restored page comes back smaller', () => {
    const shrunk = page('/', '<p>x</p>');

    expect(uncountedCrawlBytes(crawl([shrunk]), [HOME, PRICING])).toBe(0);
  });

  it('ignores pages that carried no body', () => {
    expect(uncountedCrawlBytes(crawl([page('/image.png', null), HOME]), [])).toBe(homeBytes);
  });
});
