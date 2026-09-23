import type { SafeFetchResult } from '@fluxradar/safe-fetch';
import { describe, expect, it, vi } from 'vitest';

import { silentLogger } from '../http/logger.ts';
import {
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

  it('calls a proxy that does not answer unreachable', async () => {
    const health = await probeEgressProxy(PROXY as never, {
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    expect(health.state).toBe('unreachable');
    expect(health.detail).toContain('ECONNREFUSED');
    expect(isEgressUsable(health)).toBe(false);
  });

  it('calls a non-2xx answer unreachable rather than healthy', async () => {
    const health = await probeEgressProxy(PROXY as never, {
      fetchImpl: async () => response({ status: 502, body: '' }),
    });

    expect(health.state).toBe('unreachable');
  });

  it('catches a proxy that answers from the wrong address', async () => {
    // The failure a liveness ping cannot see: a CONNECT that quietly falls
    // through to the host's own network passes a ping while putting every crawl
    // back into the Hetzner block the proxy exists to avoid.
    const health = await probeEgressProxy(PROXY as never, {
      expectedIp: EXPECTED_IP,
      fetchImpl: async () => response({ body: trace('5.9.100.200') }),
    });

    expect(health.state).toBe('wrong-egress');
    expect(health.observedIp).toBe('5.9.100.200');
    expect(isEgressUsable(health)).toBe(false);
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
    const health = await probeEgressProxy(null, { fetchImpl: async () => response() });

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
});
