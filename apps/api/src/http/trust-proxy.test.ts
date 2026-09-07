import { describe, expect, it } from 'vitest';

import { resolveTrustProxy } from './trust-proxy.ts';

// Every IP-scoped rate limit is only as good as req.ip, and req.ip is whatever
// `trust proxy` says. Both directions are a real failure, so neither may be
// inferred from a variable that means something else.
describe('trust proxy resolution', () => {
  it('keeps the previous default when nothing is configured', () => {
    expect(resolveTrustProxy({ NODE_ENV: 'production' })).toBe(1);
    expect(resolveTrustProxy({ NODE_ENV: 'development' })).toBe(false);
    expect(resolveTrustProxy({})).toBe(false);
  });

  // A container that simply never got NODE_ENV=production used to trust nothing
  // behind Caddy, which put the whole internet in one rate-limit bucket.
  it('lets a deployment state its hop count regardless of NODE_ENV', () => {
    expect(resolveTrustProxy({ TRUST_PROXY: '1' })).toBe(1);
    expect(resolveTrustProxy({ TRUST_PROXY: '2', NODE_ENV: 'staging' })).toBe(2);
  });

  it('reads an explicit opt-out, including zero hops', () => {
    expect(resolveTrustProxy({ TRUST_PROXY: 'false', NODE_ENV: 'production' })).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: '0', NODE_ENV: 'production' })).toBe(false);
  });

  it('ignores surrounding whitespace and casing', () => {
    expect(resolveTrustProxy({ TRUST_PROXY: '  1 ' })).toBe(1);
    expect(resolveTrustProxy({ TRUST_PROXY: ' FALSE ' })).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: '   ', NODE_ENV: 'production' })).toBe(1);
  });

  // Express accepts `true` for "trust every hop", which lets any client forge
  // X-Forwarded-For and take a fresh bucket per request. It is not a hop count
  // and it is not accepted here.
  it.each(['true', 'yes-please', '-1', '1.5', 'loopback'])('refuses %s', (value) => {
    expect(() => resolveTrustProxy({ TRUST_PROXY: value })).toThrow(/TRUST_PROXY/u);
  });
});
