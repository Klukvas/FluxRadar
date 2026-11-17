// Is a crawl egress proxy up, and are we actually leaving through it?
//
// Every paid crawl leaves through a proxy VPS (D-220) — one per egress location
// the owner can choose (D-228). Nothing used to watch it.
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

const PROBE_TIMEOUT_MS = 8_000;

/**
 * The pause before the one retry of a probe that got no answer, or a non-2xx one.
 *
 * A single missed probe is far more often a blip on the path than a proxy that
 * is down: the Canadian proxy once timed out on one periodic check in about two
 * thousand and answered the next one. Treated as an outage, that blip hid the
 * location from the launch screen and refused launches until the next
 * five-minute check; the same blip on a scan attempt's own probe would spend
 * that scan's one platform retry. A short pause lets a dropped connection clear
 * without making a real outage wait for the next timer to be noticed.
 */
export const EGRESS_PROBE_RETRY_DELAY_MS = 1_000;

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
  /**
   * Operator-facing detail: the transport error, or what was mismatched. A
   * result from a retry that got an answer also notes why the first attempt
   * failed; when the retry failed too, only its own failure is given.
   */
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
  /** Test seam for the pause before a retry; production waits on a real timer. */
  readonly wait?: (ms: number) => Promise<void>;
}

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

export async function probeEgressProxy(
  proxy: EgressProxy | null,
  options: EgressProbeOptions = {},
): Promise<EgressHealth> {
  if (proxy === null) {
    const now = options.now ?? ((): Date => new Date());
    return {
      state: 'not-configured',
      observedIp: null,
      expectedIp: options.expectedIp ?? null,
      latencyMs: null,
      detail: null,
      checkedAt: now(),
    };
  }

  const first = await probeOnce(proxy, options);
  // Only an unreachable result is retried — no answer, or a non-2xx one. A
  // wrong address is a finding about how the proxy is set up, and asking again
  // would only delay reporting it. A proxy that is really down still fails in
  // the same check, just later: at worst two timeouts plus the pause, about
  // 17 s, rather than the next five-minute tick.
  if (first.state !== 'unreachable') return first;
  await (options.wait ?? pause)(EGRESS_PROBE_RETRY_DELAY_MS);
  const second = await probeOnce(proxy, options);
  return second.state === 'unreachable' ? second : withRecoveredBlip(second, first);
}

/**
 * A retry that got an answer, marked so the blip stays visible.
 *
 * It is logged at info with the healthy answer, not as an error: the location
 * was usable all along, so nothing should page anyone. But a proxy that needs
 * its second try more and more often is on its way down, and an operator
 * grepping for "answered on retry" should be able to see that coming. When the
 * retry answers from the wrong address the note rides along on that finding,
 * which is still logged as an error: the location is not usable.
 */
function withRecoveredBlip(health: EgressHealth, failed: EgressHealth): EgressHealth {
  const blip = `answered on retry; first attempt failed: ${failed.detail ?? 'no detail'}`;
  return { ...health, detail: health.detail === null ? blip : `${health.detail}; ${blip}` };
}

/** One probe through the proxy, with no retry. */
async function probeOnce(proxy: EgressProxy, options: EgressProbeOptions): Promise<EgressHealth> {
  const now = options.now ?? ((): Date => new Date());
  const expectedIp = options.expectedIp ?? null;
  const base = { observedIp: null, expectedIp, latencyMs: null, detail: null, checkedAt: now() };
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

/**
 * The probe endpoint override, shared by every location. The address each
 * proxy should present is per location, and travels with it
 * (`ConfiguredEgressLocation.expectedIp`).
 */
export function readEgressProbeOptions(
  env: NodeJS.ProcessEnv = process.env,
): Pick<EgressProbeOptions, 'probeUrl'> {
  const probeUrl = env[EGRESS_PROBE_URL_ENV_VAR]?.trim();
  return probeUrl === undefined || probeUrl === '' ? {} : { probeUrl };
}

/**
 * One log line an operator can act on.
 *
 * `error` for a proxy that is down or in the wrong place, because every scan
 * from that location is blocked until it is fixed; `info` for the two states
 * that are fine — including a proxy that answered only on its retry, whose
 * `detail` says so. `location` is the registry id, or null for a direct crawl.
 */
export function logEgressHealth(
  logger: ApiLogger,
  health: EgressHealth,
  location: string | null,
): void {
  const context = {
    location,
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
      ? 'crawl egress proxy is answering from the wrong address — scans from this location are blocked'
      : 'crawl egress proxy is unreachable — scans from this location are blocked',
    context,
  );
}
