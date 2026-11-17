import { TimeoutError, type SafeFetchResult } from '@fluxradar/safe-fetch';
import { describe, expect, it, vi } from 'vitest';

import { silentLogger } from '../http/logger.ts';
import {
  EGRESS_PROBE_RETRY_DELAY_MS,
  isEgressUsable,
  logEgressHealth,
  probeEgressProxy,
  readEgressProbeOptions,
} from './crawl-egress-health.ts';

// The crawl leaves through one VPS in Kyiv, and nothing watched it. When it
// went down every fetch failed, every page became a fetch error, and the scan
// reported the customer's site as unreachable — our outage, described to them
// as their problem, at the cost of the scan they had paid for.

const PROXY = { url: 'http://proxy.test:13128', host: 'proxy.test', port: 13128 } as const;
const EXPECTED_IP = '173.242.53.147';

function trace(ip: string): string {
  return `fl=1f2\nh=www.cloudflare.com\nip=${ip}\nts=1758000000.0\nvisit_scheme=https\n`;
}

/** A retry pause that does not sleep, so the suite never waits a real second. */
const noWait = async (): Promise<void> => undefined;

/** A fetch that gives each call the next answer in turn, throwing the errors. */
function answers(...results: readonly (SafeFetchResult | Error)[]) {
  let call = 0;
  return vi.fn(async (): Promise<SafeFetchResult> => {
    const next = results[Math.min(call, results.length - 1)];
    call += 1;
    if (next === undefined) throw new Error('answers: no results given');
    if (next instanceof Error) throw next;
    return next;
  });
}

function response(overrides: Partial<SafeFetchResult> = {}): SafeFetchResult {
  return {
    finalUrl: 'https://www.cloudflare.com/cdn-cgi/trace',
    status: 200,
    headers: { 'content-type': 'text/plain' },
    body: trace(EXPECTED_IP),
    redirectChain: [],
    timingMs: 42,
    truncated: false,
    ...overrides,
  };
}

describe('probeEgressProxy', () => {
  it('calls a proxy that answers from the right address healthy', async () => {
    const health = await probeEgressProxy(PROXY as never, {
      expectedIp: EXPECTED_IP,
      fetchImpl: async () => response(),
    });

    expect(health.state).toBe('healthy');
    expect(health.observedIp).toBe(EXPECTED_IP);
    expect(health.latencyMs).toBe(42);
    expect(isEgressUsable(health)).toBe(true);
  });

  it('sends the probe through the proxy, not around it', async () => {
    const seen: unknown[] = [];
    await probeEgressProxy(PROXY as never, {
      fetchImpl: async (url, options) => {
        seen.push({ url, proxy: options?.proxy });
        return response();
      },
    });

    // A probe that did not use the proxy would report the API host's own health.
    expect(seen).toEqual([{ url: 'https://www.cloudflare.com/cdn-cgi/trace', proxy: PROXY }]);
  });

  it('calls a proxy that does not answer on either attempt unreachable', async () => {
    const fetchImpl = answers(new Error('ECONNREFUSED'), new Error('ETIMEDOUT'));
    const health = await probeEgressProxy(PROXY as never, { fetchImpl, wait: noWait });

    // A real outage still surfaces in the same check, with what the last try saw.
    expect(health.state).toBe('unreachable');
    expect(health.detail).toContain('ETIMEDOUT');
    expect(health.detail).not.toContain('answered on retry');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(isEgressUsable(health)).toBe(false);
  });

  it('calls a non-2xx answer on both attempts unreachable rather than healthy', async () => {
    const fetchImpl = answers(response({ status: 502, body: '' }));
    const health = await probeEgressProxy(PROXY as never, { fetchImpl, wait: noWait });

    expect(health.state).toBe('unreachable');
    expect(health.detail).toContain('HTTP 502');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries a probe that timed out once, and calls the proxy healthy when it answers', async () => {
    // One periodic check timed out in about two thousand and the next answered,
    // yet the location was hidden and launches refused until that next check;
    // on a scan attempt's own probe the same blip would spend its platform retry.
    const fetchImpl = answers(new TimeoutError(8_000), response({ timingMs: 77 }));
    const wait = vi.fn(noWait);
    const health = await probeEgressProxy(PROXY as never, {
      expectedIp: EXPECTED_IP,
      fetchImpl,
      wait,
    });

    expect(health.state).toBe('healthy');
    expect(health.observedIp).toBe(EXPECTED_IP);
    expect(health.latencyMs).toBe(77);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(EGRESS_PROBE_RETRY_DELAY_MS);
    // The pause sits between the two attempts, not after the second.
    const [firstFetch, secondFetch] = fetchImpl.mock.invocationCallOrder;
    const [pausedAt] = wait.mock.invocationCallOrder;
    expect(pausedAt).toBeGreaterThan(firstFetch ?? Infinity);
    expect(pausedAt).toBeLessThan(secondFetch ?? -Infinity);
    // The blip is not invisible: the healthy answer says what the first try hit.
    expect(health.detail).toContain('answered on retry');
    expect(health.detail).toContain('TimeoutError: safe-fetch: request timed out after 8000 ms');
  });

  it('retries a non-2xx answer once, and calls the proxy healthy when it answers', async () => {
    const fetchImpl = answers(response({ status: 503, body: '' }), response());
    const health = await probeEgressProxy(PROXY as never, {
      expectedIp: EXPECTED_IP,
      fetchImpl,
      wait: noWait,
    });

    expect(health.state).toBe('healthy');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(health.detail).toContain('answered on retry');
    expect(health.detail).toContain('HTTP 503');
  });

  it('times the answer it returns, not the attempt that failed', async () => {
    const times = [new Date('2026-11-16T19:15:00Z'), new Date('2026-11-16T19:15:09Z')];
    let tick = 0;
    const now = (): Date => times[Math.min(tick++, times.length - 1)] ?? new Date(0);
    const health = await probeEgressProxy(PROXY as never, {
      fetchImpl: answers(new Error('ETIMEDOUT'), response({ timingMs: 55 })),
      wait: noWait,
      now,
    });

    expect(health.checkedAt).toEqual(times[1]);
    expect(health.latencyMs).toBe(55);
  });

  it('does not retry a healthy answer', async () => {
    const fetchImpl = answers(response());
    const wait = vi.fn(noWait);
    const health = await probeEgressProxy(PROXY as never, {
      expectedIp: EXPECTED_IP,
      fetchImpl,
      wait,
    });

    expect(health.state).toBe('healthy');
    expect(health.detail).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('catches a proxy that answers from the wrong address', async () => {
    // The failure a liveness ping cannot see: a CONNECT that quietly falls
    // through to the host's own network passes a ping while putting every crawl
    // back into the Hetzner block the proxy exists to avoid.
    const fetchImpl = answers(response({ body: trace('5.9.100.200') }));
    const wait = vi.fn(noWait);
    const health = await probeEgressProxy(PROXY as never, {
      expectedIp: EXPECTED_IP,
      fetchImpl,
      wait,
    });

    expect(health.state).toBe('wrong-egress');
    expect(health.observedIp).toBe('5.9.100.200');
    expect(isEgressUsable(health)).toBe(false);
    // A wrong address is a finding about the setup, not a blip: asking again
    // would only delay it.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('does not invent a mismatch when no address is expected', async () => {
    const health = await probeEgressProxy(PROXY as never, {
      fetchImpl: async () => response({ body: trace('5.9.100.200') }),
    });

    expect(health.state).toBe('healthy');
  });

  it('does not fail a proxy because the probe endpoint stopped reporting an address', async () => {
    const health = await probeEgressProxy(PROXY as never, {
      expectedIp: EXPECTED_IP,
      fetchImpl: async () => response({ body: 'fl=1f2\\nh=www.cloudflare.com\\n' }),
    });

    expect(health.state).toBe('healthy');
    expect(health.detail).toContain('no address');
  });

  it('has nothing to check when no proxy is configured', async () => {
    const fetchImpl = answers(response());
    const wait = vi.fn(noWait);
    const health = await probeEgressProxy(null, { fetchImpl, wait });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
    // A deployment that crawls directly is a valid one; it is silently falling
    // back to direct *while a proxy is configured* that is forbidden.
    expect(health.state).toBe('not-configured');
    expect(isEgressUsable(health)).toBe(true);
  });
});

describe('readEgressProbeOptions', () => {
  it('reads the shared probe endpoint, and treats blank as absent', () => {
    expect(readEgressProbeOptions({ CRAWL_EGRESS_PROBE_URL: 'https://probe.test/trace' })).toEqual({
      probeUrl: 'https://probe.test/trace',
    });
    expect(readEgressProbeOptions({ CRAWL_EGRESS_PROBE_URL: '  ' })).toEqual({});
  });

  it('leaves the expected address to each location', () => {
    // It is per proxy now (crawl-egress-config.ts); one shared value would
    // call every other location's healthy proxy "wrong egress".
    expect(readEgressProbeOptions({ CRAWL_EGRESS_EXPECTED_IP: EXPECTED_IP })).toEqual({});
  });
});

describe('logEgressHealth', () => {
  it('logs an unusable proxy as an error naming the location whose scans are blocked', () => {
    const error = vi.fn();
    logEgressHealth(
      { ...silentLogger, error } as never,
      {
        state: 'unreachable',
        observedIp: null,
        expectedIp: null,
        latencyMs: null,
        detail: 'ECONNREFUSED',
        checkedAt: new Date(),
      },
      'ua',
    );

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('scans from this location are blocked'),
      expect.objectContaining({ state: 'unreachable', location: 'ua' }),
    );
  });

  it('logs a healthy proxy without raising an error', () => {
    const error = vi.fn();
    const info = vi.fn();
    logEgressHealth(
      { ...silentLogger, error, info } as never,
      {
        state: 'healthy',
        observedIp: EXPECTED_IP,
        expectedIp: EXPECTED_IP,
        latencyMs: 30,
        detail: null,
        checkedAt: new Date(),
      },
      'ua',
    );

    expect(error).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
  });

  it('keeps a wrong address found on the retry an error, with the first failure noted', async () => {
    const fetchImpl = answers(new Error('ECONNRESET'), response({ body: trace('5.9.100.200') }));
    const health = await probeEgressProxy(PROXY as never, {
      expectedIp: EXPECTED_IP,
      fetchImpl,
      wait: noWait,
    });
    const error = vi.fn();
    const info = vi.fn();
    logEgressHealth({ ...silentLogger, error, info } as never, health, 'ca');

    expect(health.state).toBe('wrong-egress');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(health.detail).toContain('egress address is 5.9.100.200');
    expect(health.detail).toContain('first attempt failed: Error: ECONNRESET');
    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('wrong address'),
      expect.objectContaining({ state: 'wrong-egress', location: 'ca' }),
    );
  });

  it('logs a proxy that answered only on its retry at info, with the blip in the line', async () => {
    // Usable all along, so no error and no Sentry event — but greppable.
    const health = await probeEgressProxy(PROXY as never, {
      expectedIp: EXPECTED_IP,
      fetchImpl: answers(new Error('ETIMEDOUT'), response()),
      wait: noWait,
    });
    const error = vi.fn();
    const info = vi.fn();
    logEgressHealth({ ...silentLogger, error, info } as never, health, 'ca');

    expect(error).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      'crawl egress proxy checked',
      expect.objectContaining({
        location: 'ca',
        state: 'healthy',
        detail: expect.stringContaining('answered on retry'),
      }),
    );
  });
});
