// Which of a crawl's bytes this attempt actually pulled through the proxy.
//
// The counter behind it (integrations/crawl-egress-usage.ts) is a floor, not a
// bill — headers, TLS and retries are not in it, and `vnstat` on the VPS stays
// the authority. What it must not be is *wrong by a whole crawl*, which is what
// a resumed attempt made it: the crawler hands restored pages back inside
// `crawlResult.pages` (crawler.ts, `restorePreviousAttempt`), so counting the
// result's total again booked every byte of the first attempt a second time.

import type { CrawlResult, PageSnapshot } from '@fluxradar/crawler';

function pageBytes(page: PageSnapshot): number {
  return page.html === null ? 0 : Buffer.byteLength(page.html, 'utf8');
}

/**
 * Bytes of page bodies in this crawl that have not been counted before.
 *
 * `alreadyCounted` is the page set a previous attempt of the same scan read
 * *and* booked — restored pages whose checkpoint says their bytes reached the
 * location's total. Everything else in the result is new traffic:
 *
 * - a fresh scan counts its whole result, because nothing was counted before;
 * - a page carried over from a previous attempt was not re-fetched, so it costs
 *   nothing and is subtracted in full;
 * - a page the resume *did* re-read — its evidence did not fit the store, so it
 *   is absent from `alreadyCounted` — crossed the proxy again and is counted
 *   again, which is what happened on the wire;
 * - a restored page that came back larger is counted for the difference only.
 *
 * Per page rather than as one total: a subtraction of totals would go negative
 * on a shrunken page and quietly hide the re-read traffic of another. The
 * result is never negative and never exceeds the crawl's own byte total.
 */
export function uncountedCrawlBytes(
  crawlResult: CrawlResult,
  alreadyCounted: readonly PageSnapshot[],
): number {
  const counted = new Map(alreadyCounted.map((page) => [page.normalizedUrl, pageBytes(page)]));
  return crawlResult.pages.reduce(
    (total, page) => total + Math.max(0, pageBytes(page) - (counted.get(page.normalizedUrl) ?? 0)),
    0,
  );
}
