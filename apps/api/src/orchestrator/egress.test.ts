import { describe, expect, it } from 'vitest';

import { resolveEgressProxy } from './egress.ts';

const CONFIGURED = { host: '203.0.113.10', port: 13128, credentials: null } as const;
const OVERRIDE = { host: '198.51.100.7', port: 3128, credentials: null } as const;

describe('resolveEgressProxy', () => {
  it('uses the configured proxy for an ordinary attempt', () => {
    expect(resolveEgressProxy(undefined, CONFIGURED)).toEqual(CONFIGURED);
  });

  it('crawls directly when nothing is configured', () => {
    expect(resolveEgressProxy(undefined, null)).toBeNull();
  });

  it('keeps a loopback fixture crawl direct, whatever the environment configures', () => {
    expect(resolveEgressProxy({ dangerouslyAllowLoopback: true }, CONFIGURED)).toBeNull();
  });

  it('lets an explicit override win over the loopback rule', () => {
    expect(
      resolveEgressProxy({ dangerouslyAllowLoopback: true, egressProxy: OVERRIDE }, CONFIGURED),
    ).toEqual(OVERRIDE);
  });

  it('lets an explicit null override the environment', () => {
    expect(resolveEgressProxy({ egressProxy: null }, CONFIGURED)).toBeNull();
  });
});
