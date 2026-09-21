// What a finished crawl actually achieved, as two questions a report has to be
// able to answer honestly:
//
//   1. did we read the site at all, and if not, why (`assessSiteReach`);
//   2. how much of it did we read (`crawlCoverage`).
//
// Both used to be inferred at the call site, and both were inferred wrongly. A
// scan of a site behind a WAF that answered every request with a 403 challenge
// page counted as "reachable" — `pages.some((page) => page.fetchError ===
// undefined)` is true of a challenge page, which arrives over a perfectly
// healthy connection — so the report described a site that had never been read
// as a site with no robots.txt. And coverage was only ever module coverage
// ("checks completed / checks applicable"), which says nothing about the pages
// those checks ran on: 15 pages of a 334-page site scored 100%.

import { normalizeUrl } from '@fluxradar/fingerprint';

import type { CrawlResult, PageSnapshot } from './types.js';

/**
 * A page whose HTML we hold: a 2xx response that carried a document.
 *
 * Everything that reads a site — every rule that needs markup, the coverage
 * count, the reachability verdict — means this and not "the request did not
 * throw". A 403 challenge page, a 500, and a 200 image are all responses; none
 * of them is a page of the site under audit.
 */
export function isSuccessfulHtmlPage(page: PageSnapshot): boolean {
  return (
    page.fetchError === undefined && page.status >= 200 && page.status < 300 && page.html !== null
  );
}

/** How much of the site the crawl read, in addresses rather than in checks. */
export interface CrawlCoverage {
  /** Pages whose HTML was read (`isSuccessfulHtmlPage`). */
  readonly pagesRead: number;
  /** Addresses fetched, including the ones that answered with an error. */
  readonly pagesFetched: number;
  /**
   * In-scope addresses the crawl knew about and was allowed to fetch — read,
   * failed, or left over the page limit.
   *
   * This is a floor, not a census: links on a page we never fetched were never
   * discovered. Anything shown to an owner has to be worded as "addresses we
   * found", which is what this counts.
   */
  readonly urlsDiscovered: number;
  /** In-scope addresses left unread because the page limit was reached. */
  readonly urlsOverLimit: number;
  /** In-scope addresses the site's own robots.txt told us not to fetch. */
  readonly urlsBlockedByRobots: number;
}

export function crawlCoverage(result: CrawlResult): CrawlCoverage {
  const pagesFetched = result.pages.length;
  const urlsOverLimit = result.skippedOverLimit.length;
  return {
    pagesRead: result.pages.filter(isSuccessfulHtmlPage).length,
    pagesFetched,
    // robots-blocked addresses are deliberately outside the denominator: the
    // site asked us not to read them, so not reading them is compliance, not a
    // gap in the audit. They are counted separately so a report can say so.
    urlsDiscovered: pagesFetched + urlsOverLimit,
    urlsOverLimit,
    urlsBlockedByRobots: result.blockedByRobots.length,
  };
}

/**
 * Why a crawl read nothing — or that it read something.
 *
 * `access-denied` is kept apart from `bad-response` because the two need
 * different words and different follow-up: a site that is refusing *us* can be
 * fixed by its owner in an allowlist, while a site that is returning 500s is
 * broken for everybody.
 */
export type SiteReachKind =
  'reachable' | 'access-denied' | 'blocked-by-robots' | 'unreachable' | 'bad-response';

export interface SiteReach {
  readonly kind: SiteReachKind;
  /** Normalized start address the verdict is about. */
  readonly startUrl: string;
  /** Status of the start page; null when no response arrived at all. */
  readonly startStatus: number | null;
  /** safe-fetch's reason when the request never produced a response. */
  readonly startFetchError: string | null;
  /**
   * Response headers that name an access-control layer rather than the site —
   * `server: cloudflare`, `cf-mitigated`, and the equivalents of the other
   * common vendors. Evidence for the owner, never the verdict on its own: the
   * status code decides, and a site may sit behind Cloudflare and answer
   * perfectly well.
   */
  readonly accessControlSignals: readonly string[];
}

/**
 * HTTP statuses that mean "this request was refused", not "this page is broken".
 *
 * 401/403 are the refusal itself; 407 is a proxy refusing on the way out; 429
 * and 503 are what a WAF returns while rate-limiting or challenging, and both
 * are indistinguishable from a genuine overload — which is why the header
 * signals are collected alongside them instead of being guessed at.
 */
const ACCESS_DENIED_STATUSES: readonly number[] = [401, 403, 407, 429, 503];

/** Headers whose mere presence names the vendor in front of the site. */
const VENDOR_HEADERS: readonly string[] = [
  'cf-mitigated',
  'cf-ray',
  'x-sucuri-id',
  'x-iinfo',
  'x-akamai-transformed',
  'x-datadome',
];

/** `server:` values that name an access-control layer rather than a web server. */
const VENDOR_SERVER_VALUES: readonly string[] = [
  'cloudflare',
  'sucuri',
  'incapsula',
  'imperva',
  'akamai',
  'awselb',
  'datadome',
];

export function assessSiteReach(result: CrawlResult, origin: string): SiteReach {
  const startUrl = safeNormalize(origin);
  const startPage = findStartPage(result, startUrl);
  const accessControlSignals = startPage === null ? [] : vendorSignals(startPage.headers);
  const base = {
    startUrl,
    startStatus: startPage?.status ?? null,
    startFetchError: startPage?.fetchError ?? null,
    accessControlSignals,
  };

  // One readable page anywhere is enough: the audit has something of the site
  // to look at, whatever the start page did.
  if (result.pages.some(isSuccessfulHtmlPage)) {
    return { ...base, kind: 'reachable' };
  }
  if (startPage === null) {
    return {
      ...base,
      kind: result.blockedByRobots.includes(startUrl) ? 'blocked-by-robots' : 'unreachable',
    };
  }
  if (startPage.fetchError !== undefined || startPage.status === 0) {
    return { ...base, kind: 'unreachable' };
  }
  if (ACCESS_DENIED_STATUSES.includes(startPage.status)) {
    return { ...base, kind: 'access-denied' };
  }
  return { ...base, kind: 'bad-response' };
}

/**
 * The start page among the fetched pages.
 *
 * Matched by normalized address rather than taken as `pages[0]`: the origin is
 * enqueued first, but a robots rule or the page limit can keep it out of the
 * list entirely, and then `pages[0]` is some sitemap address whose 200 would be
 * read as the homepage answering.
 */
function findStartPage(result: CrawlResult, startUrl: string): PageSnapshot | null {
  return (
    result.pages.find(
      (page) => page.normalizedUrl === startUrl || safeNormalize(page.finalUrl) === startUrl,
    ) ?? null
  );
}

function vendorSignals(headers: Readonly<Record<string, string>>): readonly string[] {
  const lowerCased = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const present = VENDOR_HEADERS.filter((name) => lowerCased.has(name)).map(
    (name) => `${name}: ${lowerCased.get(name) ?? ''}`,
  );
  const server = lowerCased.get('server');
  const namedServer =
    server !== undefined &&
    VENDOR_SERVER_VALUES.some((vendor) => server.toLowerCase().includes(vendor))
      ? [`server: ${server}`]
      : [];
  return [...namedServer, ...present];
}

/** Normalization that never throws: an unparseable address compares as itself. */
function safeNormalize(url: string): string {
  try {
    return normalizeUrl(url);
  } catch {
    return url;
  }
}
