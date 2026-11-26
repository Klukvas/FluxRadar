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

import { blockedSearchEngines } from './robots.js';
import { applyQueryPolicy, isHostInScope, isPathnameAllowedByPatterns } from './scope.js';
import { SITEMAP_MAX_URLS } from './sitemap.js';

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

/** What the site's own sitemap lists, set against what the crawl fetched. */
export interface SitemapCoverage {
  /** Distinct in-scope addresses the sitemap lists. */
  readonly urls: number;
  /** Of those, the ones this crawl never fetched. */
  readonly unread: number;
  /** The sitemap was cut at `SITEMAP_MAX_URLS`, so both counts are floors. */
  readonly capped: boolean;
}

/**
 * How many pages the site itself says it has, and how many of them were left.
 *
 * `crawlCoverage` cannot answer this for a crawl with a depth limit: the queue
 * drops a sitemap address deeper than `maxDepth` before it is counted anywhere,
 * so a homepage-only check of a 300-page site reported "1 of 1 addresses". The
 * sitemap was downloaded all the same, and it is the site's own statement of
 * its size.
 *
 * Addresses are keyed as the queue keys them, so one page listed twice or under
 * a query variant is one page — and then compared without the scheme, which the
 * queue does not do. A site long since moved to https whose sitemap still says
 * `http://` would otherwise have its own homepage counted as a page nobody read.
 *
 * robots.txt is not consulted: a listed address the site also disallows is
 * still counted, which is why anything shown to an owner says "listed in your
 * sitemap" and not "pages we could have read". When `capped`, the count is of
 * what survived dedup and scope out of the first `SITEMAP_MAX_URLS` entries, so
 * it can understate a large site by a wide margin; it never overstates one.
 *
 * Returns null when the sitemap lists nothing in scope — no sitemap is not a
 * site of zero pages.
 */
export function sitemapCoverage(result: CrawlResult): SitemapCoverage | null {
  const listed = new Set(
    result.sitemapUrls.flatMap((rawUrl) => {
      const url = sitemapPageAddress(rawUrl, result.scope);
      return url === null ? [] : [comparisonKey(url)];
    }),
  );
  if (listed.size === 0) return null;
  // Every address a fetched page answered at, hops included: a sitemap that
  // lists `/start` while `/` redirected through it to `/en/` has had all three
  // read, whichever spelling the crawl kept.
  const fetched = new Set(
    result.pages.flatMap((page) =>
      [page.normalizedUrl, page.finalUrl, ...page.redirectChain.map((hop) => hop.url)].flatMap(
        (rawUrl) => {
          const url = queuedForm(rawUrl, result.scope.queryPolicy);
          return url === null ? [] : [comparisonKey(url)];
        },
      ),
    ),
  );
  return {
    urls: listed.size,
    unread: [...listed].filter((key) => !fetched.has(key)).length,
    capped: result.sitemapUrls.length >= SITEMAP_MAX_URLS,
  };
}

/**
 * A sitemap entry as the queue would key it, or null when the crawl would not
 * read it: another host, a path the scope leaves out, or a file.
 *
 * The host rule is the crawl's own (`isHostInScope` against the origin), on
 * purpose. A site saved as `a.com` that answers at `www.a.com` publishes a
 * sitemap of `www.` addresses, and the crawl does not follow its homepage
 * there — so counting them would promise, in the block that sells the full
 * audit, pages the full audit will not read either. The count disappears
 * instead, which understates and is allowed.
 */
function sitemapPageAddress(rawUrl: string, scope: CrawlResult['scope']): string | null {
  const url = queuedForm(rawUrl, scope.queryPolicy);
  if (url === null) return null;
  const { hostname, pathname } = new URL(url);
  const originHostname = new URL(scope.origin).hostname;
  if (!isHostInScope(hostname, originHostname, scope.includeSubdomains)) return null;
  if (!isPathnameAllowedByPatterns(pathname, scope)) return null;
  return FILE_EXTENSION.test(pathname) ? null : url;
}

/**
 * An address in the form the crawl's queue keys it: no fragment, the scan's
 * query policy applied, normalized. Null for anything that is not an address —
 * a sitemap is the site's own file and may hold anything, and the crawl skips
 * such an entry the same way.
 */
function queuedForm(
  rawUrl: string,
  queryPolicy: CrawlResult['scope']['queryPolicy'],
): string | null {
  try {
    const hashAt = rawUrl.indexOf('#');
    const parsed = applyQueryPolicy(
      new URL(hashAt === -1 ? rawUrl : rawUrl.slice(0, hashAt)),
      queryPolicy,
    );
    return normalizeUrl(parsed.href);
  } catch {
    return null;
  }
}

/**
 * Extensions that name a file rather than a page. A sitemap may list a price
 * list or a photo, and "14 more pages" must not count them; the paid crawl's
 * own count is untouched by this.
 */
const FILE_EXTENSION =
  /\.(pdf|epub|docx?|xlsx?|xlsm|pptx?|ppsx|odt|ods|odp|csv|txt|rtf|ics|vcf|zip|rar|7z|gz|tgz|tar|bz2|xz|exe|dmg|msi|apk|jpe?g|jfif|png|gif|webp|avif|heic|svg|ico|bmp|tiff?|psd|eps|ai|dwg|mp3|m4a|aac|flac|wav|ogg|mp4|m4v|mov|mkv|wmv|mpe?g|webm|avi|kml|kmz|gpx|woff2?|ttf|otf|js|css|xml|json|rss|atom|m3u8|vtt|srt|glb|gltf|usdz|stl|md|mobi|djvu|iso|webmanifest)$/i;

/** A directory's index document: the same page as the directory itself. */
const INDEX_FILE = /\/(index|default)\.(s?html?|php\d?|aspx?|jsp|cfm)$/i;

/**
 * The key two spellings of one page share, for this count only: no scheme, no
 * `www.`, no index document and no trailing slash, so `http://www.a.com/b/`,
 * `https://a.com/b` and `https://a.com/b/index.html` are one page. Both sides of
 * the count go through it, so it only ever merges keys: it can lower the count
 * and never raise it. The crawler's own `normalizeUrl` is left alone — its keys
 * are fingerprints and cannot change.
 */
function comparisonKey(url: string): string {
  const { hostname, port, pathname, search } = new URL(url);
  const folded = pathname.replace(INDEX_FILE, '/');
  // `//` and `/a//` collapse like `/` and `/a/`; the root keeps its one slash.
  const path = folded.replace(/\/+$/, '') || '/';
  return `${hostname.replace(/^www\./i, '')}${port === '' ? '' : `:${port}`}${path}${search}`;
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
  readonly searchEnginesBlocked?: boolean;
  readonly blockedSearchEngines?: readonly ('Google' | 'Bing')[];
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
      ...(result.blockedByRobots.includes(startUrl)
        ? {
            searchEnginesBlocked:
              result.robotsTxt !== undefined &&
              blockedSearchEngines(result.robotsTxt, origin).length > 0,
            blockedSearchEngines:
              result.robotsTxt === undefined
                ? []
                : blockedSearchEngines(result.robotsTxt, origin).map((agent): 'Google' | 'Bing' =>
                    agent === 'Googlebot' ? 'Google' : 'Bing',
                  ),
          }
        : {}),
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
