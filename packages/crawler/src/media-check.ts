// Do the images and media a page references actually exist?
//
// The crawler used to fetch pages and nothing else, and CONTENT-004 turned that
// gap into a finding: "internal media not confirmed by the crawl", Medium
// severity, a score penalty, on files nobody had ever requested. Checked by
// hand on 2026-09-21, all three files in one report's evidence answered 200.
//
// So the crawl asks. One HEAD per distinct internal media URL, inside a budget,
// through the same fetcher and the same egress as the pages — and whatever does
// not fit the budget is reported as unchecked, never as broken.

import { normalizeUrl } from '@fluxradar/fingerprint';

import { extractMediaUrls } from './link-extractor.js';
import { isSuccessfulHtmlPage } from './crawl-outcome.js';
import type { CrawlFetcher, PageSnapshot } from './types.js';

export interface MediaCheckOutcome {
  /** One snapshot per media URL actually requested, as `PageSnapshot` records it. */
  readonly checks: readonly PageSnapshot[];
  /**
   * Internal media addresses found but left unrequested because the budget ran
   * out. Named so a report can say "not checked" rather than imply "broken".
   */
  readonly overBudget: readonly string[];
}

export interface MediaCheckOptions {
  /** Maximum HEAD requests; 0 disables media verification entirely. */
  readonly budget: number;
  /** Only media on these hosts is checked — someone else's CDN is not ours to poll. */
  readonly isInScope: (hostname: string) => boolean;
}

/**
 * Verifies the internal media referenced by the pages that were read.
 *
 * Deliberately sequential: this runs after the page crawl on a site that has
 * just been crawled at its own pace, and turning a media sweep into a burst is
 * how an audit becomes an incident.
 */
export async function checkReferencedMedia(
  pages: readonly PageSnapshot[],
  fetchMedia: CrawlFetcher,
  options: MediaCheckOptions,
): Promise<MediaCheckOutcome> {
  if (options.budget <= 0) return { checks: [], overBudget: [] };

  const targets = collectTargets(pages, options.isInScope);
  const checks: PageSnapshot[] = [];
  const overBudget: string[] = [];
  for (const target of targets) {
    if (checks.length >= options.budget) {
      overBudget.push(target.normalized);
      continue;
    }
    checks.push(await headSnapshot(fetchMedia, target.href, target.normalized));
  }
  return { checks, overBudget };
}

interface MediaTarget {
  readonly href: string;
  readonly normalized: string;
}

/**
 * Every distinct in-scope media address the read pages point at.
 *
 * Only pages we actually read contribute: a media reference can only come from
 * markup we hold, and a page that failed has no references to give.
 */
function collectTargets(
  pages: readonly PageSnapshot[],
  isInScope: (hostname: string) => boolean,
): readonly MediaTarget[] {
  const byNormalized = new Map<string, MediaTarget>();
  const alreadyFetched = new Set(pages.map((page) => page.normalizedUrl));
  for (const page of pages) {
    if (!isSuccessfulHtmlPage(page) || page.html === null) continue;
    for (const href of extractMediaUrls(page.html, page.finalUrl)) {
      let target: URL;
      let normalized: string;
      try {
        target = new URL(href);
        normalized = normalizeUrl(target.href);
      } catch {
        continue;
      }
      // A media URL the page crawl already fetched has a snapshot of its own,
      // and asking again would spend the budget on an answer we hold.
      if (alreadyFetched.has(normalized) || byNormalized.has(normalized)) continue;
      if (!isInScope(target.hostname)) continue;
      byNormalized.set(normalized, { href: target.href, normalized });
    }
  }
  return [...byNormalized.values()];
}

/** One HEAD, recorded in the same shape a page fetch produces. */
async function headSnapshot(
  fetchMedia: CrawlFetcher,
  href: string,
  normalized: string,
): Promise<PageSnapshot> {
  try {
    const response = await fetchMedia(href);
    return {
      requestedUrl: href,
      normalizedUrl: normalized,
      finalUrl: response.finalUrl,
      status: response.status,
      headers: response.headers,
      redirectChain: response.redirectChain,
      // A HEAD has no body by definition, and a media file would not be markup
      // if it did. `null` keeps it out of every rule that reads pages.
      html: null,
      contentType: response.headers['content-type'] ?? null,
      timingMs: response.timingMs,
      truncated: false,
    };
  } catch (error) {
    return {
      requestedUrl: href,
      normalizedUrl: normalized,
      finalUrl: href,
      status: 0,
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
