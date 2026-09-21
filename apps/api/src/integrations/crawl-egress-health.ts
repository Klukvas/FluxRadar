// Is the crawl's egress proxy up, and are we actually leaving through it?
//
// Every paid crawl leaves through one VPS in Kyiv (D-220). Nothing watched it.
// If it went down, `safeFetch` failed on every request, every page became a
// fetch error, and the scan reported the customer's site as unreachable —
// blaming their site for our outage, and spending their one paid scan on it.
//
// Two things are checked, not one. That the proxy answers, and that the address
// the internet sees is the proxy's: a misconfigured CONNECT that quietly falls
// through to the host's own network would pass a liveness ping while putting us
// straight back into the Hetzner block the proxy exists to avoid.

import { safeFetch, type EgressProxy } from '@fluxradar/safe-fetch';
import { CRAWLER_USER_AGENT } from '@fluxradar/crawler';

import type { ApiLogger } from '../http/logger.ts';

/**
 * Where the check asks "what address am I coming from?".
 *
 * Cloudflare's trace endpoint, because it is operated at a scale that makes it
 * a poor single point of failure of its own, and because its answer contains
 * the egress address — which is the half of this check that a plain ping cannot
 * do. Overridable for an operator who would rather not depend on it.
 */
export const DEFAULT_EGRESS_PROBE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';

export const EGRESS_PROBE_URL_ENV_VAR = 'CRAWL_EGRESS_PROBE_URL';
export const EGRESS_EXPECTED_IP_ENV_VAR = 'CRAWL_EGRESS_EXPECTED_IP';

const PROBE_TIMEOUT_MS = 8_000;

export type EgressHealthState =
  /** The proxy answered, and from the address it should. */
  | 'healthy'
  /** The proxy answered, but the internet saw a different address. */
  | 'wrong-egress'
  /** The proxy did not answer. */
  | 'unreachable'
  /** No proxy is configured, so there is nothing to be unhealthy. */
  | 'not-configured';

export interface EgressHealth {
  readonly state: EgressHealthState;
  /** The address the probe endpoint reported, when it answered. */
  readonly observedIp: string | null;
  readonly expectedIp: string | null;
  readonly latencyMs: number | null;
  /** Operator-facing detail: the transport error, or what was mismatched. */
  readonly detail: string | null;
  readonly checkedAt: Date;
}

/** A healthy proxy, or no proxy at all — the two states a crawl may run in. */
export function isEgressUsable(health: EgressHealth): boolean {
  return health.state === 'healthy' || health.state === 'not-configured';
}

export interface EgressProbeOptions {
  readonly probeUrl?: string;
  /** The address the proxy should present; absent skips the egress comparison. */
  readonly expectedIp?: string | null;
  readonly now?: () => Date;
  /** Test seam; production uses `safeFetch`. */
  readonly fetchImpl?: typeof safeFetch;
}

export async function probeEgressProxy(
  proxy: EgressProxy | null,
  options: EgressProbeOptions = {},
): Promise<EgressHealth> {
  const now = options.now ?? ((): Date => new Date());
  const expectedIp = options.expectedIp ?? null;
  const base = { observedIp: null, expectedIp, latencyMs: null, detail: null, checkedAt: now() };
  if (proxy === null) {
    return { ...base, state: 'not-configured' };
  }

  const fetchImpl = options.fetchImpl ?? safeFetch;
  const probeUrl = options.probeUrl ?? DEFAULT_EGRESS_PROBE_URL;
  try {
    const response = await fetchImpl(probeUrl, {
      headers: { 'user-agent': CRAWLER_USER_AGENT },
      timeoutMs: PROBE_TIMEOUT_MS,
      proxy,
    });
    if (response.status < 200 || response.status >= 300) {
      return {
        ...base,
        state: 'unreachable',
        latencyMs: response.timingMs,
        detail: `probe endpoint answered HTTP ${response.status}`,
      };
    }
    const observedIp = traceIp(response.body);
    if (expectedIp === null || observedIp === null || observedIp === expectedIp) {
      // No expectation to check, or it holds. An endpoint that stopped
      // reporting an address is not evidence that egress moved, so it is not
      // treated as a failure — the proxy answered, which is what was asked.
      return {
        ...base,
        state: 'healthy',
        observedIp,
        latencyMs: response.timingMs,
        ...(observedIp === null ? { detail: 'probe endpoint reported no address' } : {}),
      };
    }
    return {
      ...base,
      state: 'wrong-egress',
      observedIp,
      latencyMs: response.timingMs,
      detail: `egress address is ${observedIp}, expected ${expectedIp}`,
    };
  } catch (error) {
    return {
      ...base,
      state: 'unreachable',
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

/** `ip=1.2.3.4` out of a `cdn-cgi/trace` body; null when it is not there. */
function traceIp(body: string): string | null {
  for (const line of body.split('\n')) {
    const [key, value] = line.split('=', 2);
    if (key?.trim() === 'ip' && value !== undefined && value.trim() !== '') {
      return value.trim();
    }
  }
  return null;
}

export function readEgressProbeOptions(
  env: NodeJS.ProcessEnv = process.env,
): Pick<EgressProbeOptions, 'probeUrl' | 'expectedIp'> {
  const probeUrl = env[EGRESS_PROBE_URL_ENV_VAR]?.trim();
  const expectedIp = env[EGRESS_EXPECTED_IP_ENV_VAR]?.trim();
  return {
    ...(probeUrl === undefined || probeUrl === '' ? {} : { probeUrl }),
    ...(expectedIp === undefined || expectedIp === '' ? {} : { expectedIp }),
  };
}

/**
 * One log line an operator can act on.
 *
 * `error` for a proxy that is down or in the wrong place, because every paid
 * scan is blocked until it is fixed; `info` for the two states that are fine.
 */
export function logEgressHealth(logger: ApiLogger, health: EgressHealth): void {
  const context = {
    state: health.state,
    observedIp: health.observedIp,
    expectedIp: health.expectedIp,
    latencyMs: health.latencyMs,
    detail: health.detail,
  };
  if (isEgressUsable(health)) {
    logger.info('crawl egress proxy checked', context);
    return;
  }
  logger.error(
    health.state === 'wrong-egress'
      ? 'crawl egress proxy is answering from the wrong address — paid scans are blocked'
      : 'crawl egress proxy is unreachable — paid scans are blocked',
    context,
  );
}
