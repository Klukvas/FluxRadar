// How many pages the site's own sitemap lists beyond the one a Free check read.
//
// A Free check reads the homepage and nothing else, so its crawl "found" one
// address on a site of any size and the report said "1 of 1". The sitemap is
// the only measure of what was left, and it is the site's own statement.

import type { CrawlSummary } from './api';

export interface UnreadSitemapPages {
  readonly count: number;
  /** The sitemap was cut at the crawler's ceiling: `count` is a floor. */
  readonly capped: boolean;
}

/**
 * The sitemap pages a homepage-only check left unread, or null when there is
 * no such number to state: the site was not read, it has no sitemap, the scan
 * predates the record, or the sitemap lists nothing but the page that was read.
 */
export function unreadSitemapPages(
  summary: CrawlSummary | null | undefined,
): UnreadSitemapPages | null {
  if (summary === null || summary === undefined || summary.reach !== 'reachable') return null;
  const { sitemap } = summary;
  if (sitemap === undefined || sitemap.unread === 0) return null;
  return { count: sitemap.unread, capped: sitemap.capped };
}
