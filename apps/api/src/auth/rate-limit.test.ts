import { describe, expect, it } from 'vitest';

import { RATE_LIMIT_MAX_TRACKED_KEYS, RequestRateLimiter } from './rate-limit.ts';

describe('request rate limiter', () => {
  it('limits a key inside a window and permits it after the window', () => {
    let now = 1_000;
    const limiter = new RequestRateLimiter(() => now);
    limiter.assertAllowed('scan:account:ip', 2, 100);
    limiter.assertAllowed('scan:account:ip', 2, 100);
    expect(() => limiter.assertAllowed('scan:account:ip', 2, 100)).toThrow();
    now += 101;
    expect(() => limiter.assertAllowed('scan:account:ip', 2, 100)).not.toThrow();
  });

  it('evicts expired attacker-controlled keys before reaching the cap', () => {
    let now = 1_000;
    const limiter = new RequestRateLimiter(() => now);
    for (let index = 0; index < RATE_LIMIT_MAX_TRACKED_KEYS; index += 1) {
      limiter.assertAllowed(`key-${index}`, 1, 100);
    }
    now += 101;
    expect(() => limiter.assertAllowed('fresh-key', 1, 100)).not.toThrow();
  });
});
