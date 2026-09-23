// Can we read this site at all — asked before the owner pays, not after.
//
// A customer could buy a $120 audit of a site that refuses our crawler, wait
// for it to run, and get a refund and no report. Nothing before the pay button
// had ever tried to fetch the site. This probe does, and the checkout refuses
// to open without a fresh successful one.
//
// It is deliberately the same request the crawl will make: the same fetcher,
// the same user agent, the same egress proxy, and the same verdict function
// (`assessSiteReach`). A probe that took a different route would answer a
// different question, and a cheerful "reachable" followed by a blocked scan is
// worse than no check at all.

import {
  assessSiteReach,
  CRAWLER_USER_AGENT,
  isPathAllowed,
  parseRobotsTxt,
  type CrawlResult,
  type PageSnapshot,
  type SiteReachKind,
} from '@fluxradar/crawler';
import { normalizeUrl } from '@fluxradar/fingerprint';
import { safeFetch, type EgressProxy, type SafeFetchResult } from '@fluxradar/safe-fetch';

/** Shorter than a crawl's: this one runs while somebody is watching a spinner. */
const PROBE_TIMEOUT_MS = 10_000;

/** Enough of a robots.txt or a challenge page to classify it; not a crawl. */
const PROBE_MAX_BODY_BYTES = 512 * 1024;

export interface SiteReachabilityProbeResult {
  readonly state: SiteReachKind;
  /** The start page's status, or null when no response arrived. */
  readonly startStatus: number | null;
  /** safe-fetch's reason when nothing came back at all. */
  readonly fetchError: string | null;
  /** `server: cloudflare` and friends — evidence for the owner, not the verdict. */
  readonly accessControlSignals: readonly string[];
  readonly checkedAt: Date;
}

export interface SiteReachabilityOptions {
  readonly egressProxy?: EgressProxy | null;
  /** Test seam, matching `WorkerCrawlOptions`: a fixture site lives on loopback. */
  readonly dangerouslyAllowLoopback?: boolean;
  /** Test seam for a deterministic probe; production uses `safeFetch`. */
  readonly fetcher?: (url: string) => Promise<SafeFetchResult>;
  readonly now?: () => Date;
}

export async function probeSiteReachability(
  origin: string,
  options: SiteReachabilityOptions = {},
): Promise<SiteReachabilityProbeResult> {
  const now = options.now ?? ((): Date => new Date());
  const fetcher = options.fetcher ?? defaultProbeFetcher(options);
  const startUrl = new URL(origin);
  const robotsAllows = await robotsAllowsRoot(fetcher, startUrl);

  if (!robotsAllows) {
    // The site told us not to read it. We do not fetch the page to confirm —
    // asking anyway would be the one thing this product promises not to do.
    return verdict(
      assessSiteReach(crawlResultOf([], [safeNormalize(startUrl.href)]), origin),
      now(),
    );
  }

  const page = await fetchAsSnapshot(fetcher, startUrl.href);
  return verdict(assessSiteReach(crawlResultOf([page], []), origin), now());
}

function verdict(
  reach: ReturnType<typeof assessSiteReach>,
  checkedAt: Date,
): SiteReachabilityProbeResult {
  return {
    state: reach.kind,
    startStatus: reach.startStatus,
    fetchError: reach.startFetchError,
    accessControlSignals: reach.accessControlSignals,
    checkedAt,
  };
}

/**
 * Whether robots.txt lets us read the site root.
 *
 * Same policy as the crawl (D-141): only a 200 is a robots.txt. Anything else,
 * including a network failure, leaves the host open — the probe's job is to
 * report what the start page does, and a missing robots.txt is not a refusal.
 */
async function robotsAllowsRoot(
  fetcher: (url: string) => Promise<SafeFetchResult>,
  origin: URL,
): Promise<boolean> {
  try {
    const response = await fetcher(`${origin.protocol}//${origin.host}/robots.txt`);
    if (response.status !== 200) return true;
    return isPathAllowed(parseRobotsTxt(response.body), CRAWLER_USER_AGENT, '/');
  } catch {
    return true;
  }
}

/**
 * One fetch as the crawler would record it.
 *
 * Built as a `PageSnapshot` so the verdict comes from `assessSiteReach` — the
 * same function the scan uses — rather than from a second copy of the status
 * rules that could drift away from it.
 */
async function fetchAsSnapshot(
  fetcher: (url: string) => Promise<SafeFetchResult>,
  url: string,
): Promise<PageSnapshot> {
  const normalized = safeNormalize(url);
  try {
    const response = await fetcher(url);
    const contentType = response.headers['content-type'] ?? null;
    const isHtml = contentType !== null && contentType.toLowerCase().includes('text/html');
    return {
      requestedUrl: url,
      normalizedUrl: normalized,
      finalUrl: response.finalUrl,
      status: response.status,
      // The probe reads the origin and its robots.txt, and nothing they link to.
      depth: 0,
      headers: response.headers,
      redirectChain: response.redirectChain,
      html: isHtml ? response.body : null,
      contentType,
      timingMs: response.timingMs,
      truncated: response.truncated,
    };
  } catch (error) {
    return {
      requestedUrl: url,
      normalizedUrl: normalized,
      finalUrl: url,
      status: 0,
      depth: 0,
      headers: {},
      redirectChain: [],
      html: null,
      contentType: null,
      timingMs: 0,
      truncated: false,
      fetchError: error instanceof Error ? error.message : String(error),
    };
  }
}

function crawlResultOf(
  pages: readonly PageSnapshot[],
  blockedByRobots: readonly string[],
): CrawlResult {
  return {
    pages,
    skippedOverLimit: [],
    blockedByRobots,
    errors: [],
    urlVariants: {},
    sitemapUrls: [],
    rejectedSeeds: [],
    // The probe reads the origin as the server sends it: it answers "does this
    // site let our crawler in", which is a question about the response, not
    // about what its scripts would have drawn.
    rendering: { status: 'NotRequested' },
    resources: [],
    pendingQueue: [],
    stoppedEarly: false,
  };
}

function defaultProbeFetcher(
  options: SiteReachabilityOptions,
): (url: string) => Promise<SafeFetchResult> {
  const proxy = options.egressProxy ?? null;
  return (url) =>
    safeFetch(url, {
      headers: { 'user-agent': CRAWLER_USER_AGENT },
      timeoutMs: PROBE_TIMEOUT_MS,
      maxBodyBytes: PROBE_MAX_BODY_BYTES,
      ...(options.dangerouslyAllowLoopback === true ? { dangerouslyAllowLoopback: true } : {}),
      ...(proxy === null ? {} : { proxy }),
    });
}

function safeNormalize(url: string): string {
  try {
    return normalizeUrl(url);
  } catch {
    return url;
  }
}
