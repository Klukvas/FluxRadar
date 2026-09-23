// Checking whether the media a page points at is actually there.
//
// A crawl fetches pages. Until now that meant a rule could only say "this
// image was never confirmed" about every image on the site, which is not a
// finding — it is an admission. So after the pages are in, the media they
// reference is asked for directly: HEAD first, a small GET only where HEAD is
// refused, through the same guard, the same robots.txt and the same per-host
// limiter as everything else.
//
// Three boundaries hold this in place. A resource is never a page: it does not
// enter `pages`, does not count against the tariff's URL limit and does not
// move any coverage denominator. A resource is only probed when it belongs to
// the site being audited. And anything not actually checked is recorded as
// *unverified*, with the reason — never as working, never as broken.

import { MEDIA_PROBE_LIMITS } from '@fluxradar/contracts';
import { normalizeUrl } from '@fluxradar/fingerprint';
import { SafeFetchError } from '@fluxradar/safe-fetch';
import { parse } from 'node-html-parser';

import { MEDIA_SELECTOR } from './link-extractor.js';
import type {
  CrawlFetcher,
  PageSnapshot,
  ResourceSnapshot,
  ResourceUnverifiedReason,
} from './types.js';

/** One media reference, before anything has been asked about it. */
interface MediaCandidate {
  readonly url: URL;
  readonly normalizedUrl: string;
  readonly referencedBy: string;
}

export interface ProbeMediaOptions {
  /** Probes one resource; contract as CrawlFetcher — result or SafeFetchError. */
  readonly head: CrawlFetcher;
  /** Used only where HEAD produced no usable status; reads a bounded prefix. */
  readonly get: CrawlFetcher;
  /** Per-host politeness, shared with the page crawl. */
  readonly acquire: (hostname: string) => Promise<() => void>;
  /** robots.txt, asked the same way a page is. */
  readonly isAllowed: (url: URL) => Promise<boolean>;
  /** True when the resource belongs to the site being audited. */
  readonly isInScope: (url: URL) => boolean;
  readonly shouldStop: () => boolean;
  /**
   * Probes an earlier attempt of the same scan already made.
   *
   * Only the ones that produced an answer are reused: a status is a fact about
   * the resource, and a robots.txt refusal is a decision that does not change.
   * Everything else — a probe the budget or a pause cut short, a request that
   * failed — is asked again, because "we did not check this" is not an answer
   * worth carrying forward.
   */
  readonly known?: readonly ResourceSnapshot[];
}

/** Whether an earlier probe settled the question or merely recorded a gap. */
function isAnswered(resource: ResourceSnapshot): boolean {
  return (
    resource.unverifiedReason === undefined || resource.unverifiedReason === 'RobotsDisallowed'
  );
}

/**
 * Collects the media the crawled pages reference and probes what it can.
 *
 * Returns one entry per distinct resource, in discovery order, including the
 * ones that were deliberately not probed — a silent omission would read as
 * "nothing to report" to every caller downstream.
 */
export async function probeMediaResources(
  pages: readonly PageSnapshot[],
  options: ProbeMediaOptions,
): Promise<readonly ResourceSnapshot[]> {
  const candidates = collectCandidates(pages, options.isInScope);
  const answered = new Map(
    (options.known ?? [])
      .filter(isAnswered)
      .map((resource) => [resource.normalizedUrl, resource] as const),
  );
  const results: ResourceSnapshot[] = [];
  let probes = 0;
  for (const candidate of candidates) {
    if (results.length >= MEDIA_PROBE_LIMITS.maxRecorded) break;
    const alreadyAnswered = answered.get(candidate.normalizedUrl);
    if (alreadyAnswered !== undefined) {
      results.push(alreadyAnswered);
      continue;
    }
    if (options.shouldStop()) {
      results.push(unverified(candidate, 'Stopped'));
      continue;
    }
    if (probes >= MEDIA_PROBE_LIMITS.maxProbes) {
      results.push(unverified(candidate, 'BudgetExhausted'));
      continue;
    }
    if (!(await options.isAllowed(candidate.url))) {
      results.push(unverified(candidate, 'RobotsDisallowed'));
      continue;
    }
    probes += 1;
    results.push(await probeOne(candidate, options));
  }
  return results;
}

/** Distinct in-scope media references of every page that returned HTML. */
function collectCandidates(
  pages: readonly PageSnapshot[],
  isInScope: (url: URL) => boolean,
): readonly MediaCandidate[] {
  const seen = new Set<string>();
  const candidates: MediaCandidate[] = [];
  const fetchedPages = new Set(pages.map((page) => page.normalizedUrl));
  for (const page of pages) {
    if (page.html === null || page.fetchError !== undefined) continue;
    if (page.status < 200 || page.status >= 300) continue;
    for (const element of parse(page.html).querySelectorAll(MEDIA_SELECTOR)) {
      const raw = element.getAttribute('src')?.trim() ?? '';
      const url = resolveHttpUrl(raw, page.finalUrl);
      if (url === null || !isInScope(url)) continue;
      let normalizedUrl: string;
      try {
        normalizedUrl = normalizeUrl(url.href);
      } catch {
        continue;
      }
      // A resource the crawl already fetched as a page has a real snapshot;
      // asking for it twice would be a second request for the same answer.
      if (seen.has(normalizedUrl) || fetchedPages.has(normalizedUrl)) continue;
      seen.add(normalizedUrl);
      candidates.push({ url, normalizedUrl, referencedBy: page.finalUrl });
    }
  }
  return candidates;
}

async function probeOne(
  candidate: MediaCandidate,
  options: ProbeMediaOptions,
): Promise<ResourceSnapshot> {
  const release = await options.acquire(candidate.url.hostname);
  try {
    const head = await attempt(options.head, candidate.url.href);
    if (head.kind === 'response' && usableStatus(head.status)) {
      return snapshotOf(candidate, 'HEAD', head);
    }
    // Some servers answer HEAD with 405 or 501 and serve the same resource
    // perfectly well on GET; a bounded read settles it without pulling the file.
    if (options.shouldStop()) return unverified(candidate, 'Stopped');
    const get = await attempt(options.get, candidate.url.href);
    if (get.kind === 'response') {
      return snapshotOf(candidate, 'GET', get);
    }
    return {
      ...unverified(candidate, 'RequestFailed'),
      fetchError: get.error,
      ...(head.kind === 'response' ? { status: head.status } : {}),
    };
  } finally {
    release();
  }
}

type ProbeAttempt =
  | {
      readonly kind: 'response';
      readonly status: number;
      readonly finalUrl: string;
      readonly contentType: string | null;
      readonly timingMs: number;
    }
  | { readonly kind: 'failed'; readonly error: string };

async function attempt(fetcher: CrawlFetcher, url: string): Promise<ProbeAttempt> {
  try {
    const response = await fetcher(url);
    return {
      kind: 'response',
      status: response.status,
      finalUrl: response.finalUrl,
      contentType: response.headers['content-type'] ?? null,
      timingMs: response.timingMs,
    };
  } catch (error) {
    return {
      kind: 'failed',
      error:
        error instanceof SafeFetchError
          ? `${error.name}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }
}

/** A status that answers the question; 405/501 on HEAD does not. */
function usableStatus(status: number): boolean {
  return status > 0 && status !== 405 && status !== 501;
}

function snapshotOf(
  candidate: MediaCandidate,
  method: 'HEAD' | 'GET',
  attempted: Extract<ProbeAttempt, { kind: 'response' }>,
): ResourceSnapshot {
  return {
    requestedUrl: candidate.url.href,
    normalizedUrl: candidate.normalizedUrl,
    finalUrl: attempted.finalUrl,
    status: attempted.status,
    contentType: attempted.contentType,
    method,
    timingMs: attempted.timingMs,
    referencedBy: candidate.referencedBy,
  };
}

function unverified(candidate: MediaCandidate, reason: ResourceUnverifiedReason): ResourceSnapshot {
  return {
    requestedUrl: candidate.url.href,
    normalizedUrl: candidate.normalizedUrl,
    finalUrl: candidate.url.href,
    status: 0,
    contentType: null,
    timingMs: 0,
    unverifiedReason: reason,
    referencedBy: candidate.referencedBy,
  };
}

function resolveHttpUrl(rawSrc: string, baseUrl: string): URL | null {
  if (rawSrc === '') return null;
  let resolved: URL;
  try {
    resolved = new URL(rawSrc, baseUrl);
  } catch {
    return null;
  }
  return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved : null;
}
