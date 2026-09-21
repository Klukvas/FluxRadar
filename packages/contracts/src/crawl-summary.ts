// What one scan's crawl achieved, as the report is allowed to describe it.
//
// This is the record behind two sentences a report must be able to say and
// previously could not:
//
//   "read 15 of the 334 addresses we found"  — instead of "coverage 100%",
//                                               which only ever counted checks;
//   "the site answered 403 to every request" — instead of "the site has no
//                                               robots.txt and does not answer
//                                               200", which described the
//                                               symptom as the site's fault.
//
// It is stored on the scan (`Scan.crawlSummaryJson`) rather than derived at
// read time because the crawl is gone by the time anyone opens the report, and
// a number a reader is asked to trust must be the one the run actually saw.

import { z } from 'zod';

/**
 * Why the crawl read nothing, or that it read something.
 *
 * `access-denied` is kept apart from `bad-response`: a site refusing *us* is
 * something its owner can fix in an allowlist, a site returning 500s is broken
 * for everybody, and telling an owner the wrong one wastes their afternoon.
 */
export const SITE_REACH_KINDS = [
  'reachable',
  'access-denied',
  'blocked-by-robots',
  'unreachable',
  'bad-response',
] as const;
export type SiteReachKind = (typeof SITE_REACH_KINDS)[number];

/** Who narrowed the crawl, when fewer addresses were read than were found. */
export const CRAWL_LIMITED_BY = ['owner', 'plan'] as const;
export type CrawlLimitedBy = (typeof CRAWL_LIMITED_BY)[number];

export const crawlSummarySchema = z.object({
  reach: z.enum(SITE_REACH_KINDS),
  /** Status of the start page; null when no response arrived at all. */
  startStatus: z.number().int().nullable(),
  /**
   * Response headers naming an access-control layer (`server: cloudflare`,
   * `cf-mitigated`, …). Evidence for the owner, never the verdict on its own.
   */
  accessControlSignals: z.array(z.string()).max(10),
  /** Pages whose HTML was read: a 2xx response that carried a document. */
  pagesRead: z.number().int().min(0),
  /** Addresses fetched, including the ones that answered with an error. */
  pagesFetched: z.number().int().min(0),
  /**
   * In-scope addresses the crawl found and was allowed to fetch. A floor, not
   * a census: links on a page never fetched were never discovered, which is why
   * every sentence built on it says "addresses we found".
   */
  urlsDiscovered: z.number().int().min(0),
  /** In-scope addresses left unread because the page limit was reached. */
  urlsOverLimit: z.number().int().min(0),
  /** In-scope addresses the site's own robots.txt told us not to fetch. */
  urlsBlockedByRobots: z.number().int().min(0),
  /**
   * `owner` when the scan settings asked for fewer pages than the plan allows,
   * `plan` when the tariff ceiling is what stopped the crawl, null when nothing
   * was left over the limit. A report that shows partial coverage has to name
   * which of the two it is, or the owner reads their own setting as our failure.
   */
  limitedBy: z.enum(CRAWL_LIMITED_BY).nullable(),
  /** The page limit actually applied to this crawl. */
  maxPages: z.number().int().min(1),
});
export type CrawlSummary = z.infer<typeof crawlSummarySchema>;

/**
 * The share of the site that was read, as a fraction of what the crawl found.
 *
 * Unlike module coverage ("checks completed / checks applicable"), an address
 * we chose not to read still counts against this. That is the whole point: the
 * module figure cannot fall below 100% for a crawl that never looked, because
 * a check with no page to run on leaves the denominator too.
 *
 * Returns null when nothing was found at all — there is no share of zero, and a
 * report must say "nothing was read" rather than render 0% as a bad grade.
 */
export function crawlCoverageRatio(summary: CrawlSummary): number | null {
  if (summary.urlsDiscovered === 0) return null;
  return summary.pagesRead / summary.urlsDiscovered;
}

/** Whether the crawl read every address it found. */
export function isFullCrawlCoverage(summary: CrawlSummary): boolean {
  return summary.urlsDiscovered > 0 && summary.pagesRead === summary.urlsDiscovered;
}

/** Whether any module may be scored from this crawl at all. */
export function isSiteRead(summary: CrawlSummary): boolean {
  return summary.reach === 'reachable';
}

/**
 * Status reasons a scan carries when the site itself was never read (§15/§18).
 *
 * Separate strings rather than one `TargetsUnreachable` because the refund
 * conversation differs: an owner whose WAF refused us needs the allowlist
 * instructions, an owner whose DNS is down needs to know we never connected.
 */
export const SITE_REACH_STATUS_REASONS: Readonly<Record<SiteReachKind, string>> = {
  reachable: '',
  'access-denied': 'SiteDeniedAccess',
  'blocked-by-robots': 'SiteBlockedByRobots',
  unreachable: 'SiteUnreachable',
  'bad-response': 'SiteReturnedNoReadablePage',
};

/** The status reason for a crawl that read nothing; null when it read something. */
export function siteReachStatusReason(summary: CrawlSummary): string | null {
  return summary.reach === 'reachable' ? null : SITE_REACH_STATUS_REASONS[summary.reach];
}

/** Parses the stored column; unreadable or absent JSON reads as "not recorded". */
export function parseCrawlSummary(json: string | null | undefined): CrawlSummary | null {
  if (json === null || json === undefined || json === '') return null;
  try {
    const parsed = crawlSummarySchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    // A scan written before this column existed, or a row damaged in transit:
    // the report shows no coverage line rather than a fabricated one.
    return null;
  }
}
