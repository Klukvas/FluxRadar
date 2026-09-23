// Running the API endpoints an owner listed for the Reliability module.
//
// The §9 contract is enforced here rather than trusted from the request: only
// GET and HEAD, only the site being scanned, no request headers at all and no
// body — so there is nothing a configured check could carry that would make it
// anything other than an anonymous public read. Rate limiting is the crawl's
// own per-host limiter, so twenty endpoints cannot out-shout the page budget.

import { API_CHECK_LIMITS, type ApiCheckInput, type ScanScopeInput } from '@fluxradar/contracts';
import type { ApiCheck } from '@fluxradar/rules';
import { HostLimiter, SafeFetchError, safeFetch } from '@fluxradar/safe-fetch';

// One definition of "this address belongs to the scanned site", shared with the
// validation that refuses an off-site endpoint when the scan is configured. The
// two must never drift: the earlier check is what an owner sees, this one is
// what actually keeps the requests on their own site.
import { isWithinSite } from '../scans/scope-targets.ts';

/** What one configured endpoint did, for the module's own evidence. */
export interface ApiCheckResult {
  readonly method: 'GET' | 'HEAD';
  readonly url: string;
  readonly expectedStatus: readonly number[];
  readonly status: number | null;
  readonly timingMs: number | null;
  /**
   * Whether this endpoint was one of the module's targets at all.
   *
   * Stored next to the status because the report has to tell the two silences
   * apart: an endpoint on somebody else's site is *not applicable*, while one
   * that timed out was checked and has no answer. Reading that off the reason
   * string in every consumer would be the same rule written twice.
   */
  readonly applicable: boolean;
  /** Why no request was made, or why the one made produced nothing. */
  readonly skippedReason?: string;
  /** Present when in-scope redirects moved the answer to another address. */
  readonly finalUrl?: string;
}

/**
 * Why an endpoint has no status, and whether it still counts as checked.
 *
 * The distinction is the whole point: an endpoint on somebody else's site was
 * never part of this audit, while one that timed out *was* and simply could not
 * be established. Dropping the second from the denominator would report full
 * coverage and "no API problems" for a module that never reached the endpoint.
 */
const NOT_PART_OF_THIS_AUDIT = 'OutsideScannedSite';

export interface ApiCheckRun {
  /** Input for the REL-API rules; a check without a snapshot was not executed. */
  readonly checks: readonly ApiCheck[];
  readonly results: readonly ApiCheckResult[];
}

export interface RunApiChecksOptions {
  readonly limiter?: HostLimiter;
  readonly dangerouslyAllowLoopback?: boolean;
  readonly userAgent: string;
  readonly shouldStop?: () => boolean;
}

export async function runApiChecks(
  configured: readonly ApiCheckInput[],
  siteOrigin: string,
  scope: ScanScopeInput,
  options: RunApiChecksOptions,
): Promise<ApiCheckRun> {
  const limiter = options.limiter ?? new HostLimiter();
  const checks: ApiCheck[] = [];
  const results: ApiCheckResult[] = [];
  for (const configuredCheck of configured.slice(0, API_CHECK_LIMITS.maxChecks)) {
    const base = {
      method: configuredCheck.method,
      url: configuredCheck.url,
      ...(configuredCheck.expectedStatus !== undefined
        ? { expectedStatus: configuredCheck.expectedStatus }
        : {}),
    } satisfies ApiCheck;
    const expectedStatus = configuredCheck.expectedStatus ?? [];
    const record = (reason: string): void => {
      const applicable = reason !== NOT_PART_OF_THIS_AUDIT;
      checks.push({ ...base, unavailable: { reason, applicable } });
      results.push({
        ...base,
        expectedStatus,
        status: null,
        timingMs: null,
        applicable,
        skippedReason: reason,
      });
    };
    if (!isWithinSite(configuredCheck.url, siteOrigin, scope.includeSubdomains)) {
      record(NOT_PART_OF_THIS_AUDIT);
      continue;
    }
    if (options.shouldStop?.() === true) {
      record('ScanStopped');
      continue;
    }
    const outcome = await executeCheck(configuredCheck, siteOrigin, scope, limiter, options);
    if (outcome.snapshot === null) {
      record(outcome.skippedReason ?? 'RequestFailed');
      continue;
    }
    checks.push({ ...base, snapshot: outcome.snapshot });
    results.push({
      ...base,
      expectedStatus,
      status: outcome.snapshot.status,
      timingMs: outcome.snapshot.timingMs,
      applicable: true,
      ...(outcome.finalUrl !== undefined ? { finalUrl: outcome.finalUrl } : {}),
    });
  }
  return { checks, results };
}

interface CheckOutcome {
  readonly snapshot: { readonly status: number; readonly timingMs: number } | null;
  readonly skippedReason?: string;
  readonly finalUrl?: string;
}

/**
 * Performs one check, keeping every redirect hop on the scanned site.
 *
 * safe-fetch would resolve the chain itself, re-running the SSRF guard but not
 * this module's own rule — so a configured endpoint answering `302 Location:
 * https://somebody-else/` would produce a request to that third party and
 * report *their* status as the endpoint's. The hops are therefore followed
 * here, each one vetted exactly like the configured URL, and an off-site hop is
 * refused by name instead of being answered.
 */
async function executeCheck(
  check: ApiCheckInput,
  siteOrigin: string,
  scope: ScanScopeInput,
  limiter: HostLimiter,
  options: RunApiChecksOptions,
): Promise<CheckOutcome> {
  // One deadline for the whole chain: following hops must not multiply the
  // time an endpoint is allowed to take by the number of redirects it sends.
  const deadline = Date.now() + API_CHECK_LIMITS.timeoutMs;
  const startedAt = Date.now();
  let current = check.url;
  for (let hop = 0; hop <= API_CHECK_LIMITS.maxRedirects; hop += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return { snapshot: null, skippedReason: 'TimeoutError' };
    const release = await limiter.acquire(new URL(current).hostname);
    let response;
    try {
      response = await safeFetch(current, {
        method: check.method,
        // Built here, from nothing the owner supplied: a check carries no
        // credentials because there is no way to give it any.
        headers: { 'user-agent': options.userAgent },
        timeoutMs: remainingMs,
        redirectPolicy: 'manual',
        ...(options.dangerouslyAllowLoopback === true ? { dangerouslyAllowLoopback: true } : {}),
      });
    } catch (error) {
      return {
        snapshot: null,
        skippedReason: error instanceof SafeFetchError ? error.name : 'RequestFailed',
      };
    } finally {
      release();
    }
    const location = redirectTarget(response.status, response.headers);
    if (location === null) {
      return {
        snapshot: { status: response.status, timingMs: Date.now() - startedAt },
        ...(current === check.url ? {} : { finalUrl: current }),
      };
    }
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return { snapshot: null, skippedReason: 'RedirectUnresolvable' };
    }
    if (!isWithinSite(next.href, siteOrigin, scope.includeSubdomains)) {
      return { snapshot: null, skippedReason: 'RedirectedOffSite' };
    }
    current = next.href;
  }
  return { snapshot: null, skippedReason: 'TooManyRedirects' };
}

/** The `Location` of a redirect response, or null when it is not one. */
function redirectTarget(status: number, headers: Readonly<Record<string, string>>): string | null {
  if (status < 300 || status >= 400) return null;
  const location = headers.location;
  return location === undefined || location === '' ? null : location;
}
