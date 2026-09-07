import { describe, expect, it } from 'vitest';

import { ApiError } from '../http/errors.ts';
import {
  LoginRateLimiter,
  RATE_LIMIT_MAX_TRACKED_KEYS,
  RequestRateLimiter,
  scanActionRules,
} from './rate-limit.ts';

function refusalFrom(run: () => void): ApiError {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  return expect.unreachable('expected the limiter to refuse');
}

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

describe('rate limit refusals', () => {
  it('says how long to wait, counted from the attempt that will expire first', () => {
    let now = 1_000;
    const limiter = new RequestRateLimiter(() => now);
    limiter.assertAllowed('key', 1, 60_000);
    now += 20_000;

    const refusal = refusalFrom(() => limiter.assertAllowed('key', 1, 60_000));

    expect(refusal.status).toBe(429);
    expect(refusal.code).toBe('RATE_LIMITED');
    // The single attempt was at 1_000 and the window is 60s, so 40s remain.
    expect(refusal.retryAfterSeconds).toBe(40);
  });

  it('never tells a client to retry immediately', () => {
    let now = 1_000;
    const limiter = new RequestRateLimiter(() => now);
    limiter.assertAllowed('key', 1, 1_000);
    now += 999;

    expect(refusalFrom(() => limiter.assertAllowed('key', 1, 1_000)).retryAfterSeconds).toBe(1);
  });

  it('carries a retry hint on a refused login too', () => {
    const now = 1_000;
    const limiter = new LoginRateLimiter({ limit: 1, windowMs: 30_000, now: () => now });
    limiter.assertAllowed('user@example.com', '10.0.0.1');

    const refusal = refusalFrom(() => limiter.assertAllowed('user@example.com', '10.0.0.1'));

    expect(refusal.status).toBe(429);
    expect(refusal.retryAfterSeconds).toBe(30);
  });
});

describe('multi-key rules', () => {
  // A rule that refuses must not have charged the rules checked before it,
  // otherwise the first bucket fills faster than its own limit says.
  it('records an attempt only when every rule allows it', () => {
    const limiter = new RequestRateLimiter(() => 1_000);
    const rules = [
      { key: 'account', limit: 5, windowMs: 1_000 },
      { key: 'ip', limit: 1, windowMs: 1_000 },
    ];

    limiter.assertAllowedAll(rules);
    expect(() => limiter.assertAllowedAll(rules)).toThrow(ApiError);
    expect(() => limiter.assertAllowedAll(rules)).toThrow(ApiError);

    // The IP rule refused twice; the account rule must still hold four attempts.
    limiter.reset('ip');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      limiter.assertAllowedAll([{ key: 'account', limit: 5, windowMs: 1_000 }]);
    }
    expect(() => limiter.assertAllowedAll([{ key: 'account', limit: 5, windowMs: 1_000 }])).toThrow(
      ApiError,
    );
  });

  // The bug this pins: with one composite `account:ip` key, changing address
  // hands the same account a brand-new counter, so the account limit is not a
  // limit at all.
  it('keeps an account ceiling that a new address does not reset', () => {
    const limiter = new RequestRateLimiter(() => 1_000);
    const account = 'acct_1';

    for (let attempt = 0; attempt < 10; attempt += 1) {
      limiter.assertAllowedAll(scanActionRules('scan-create', account, `10.0.0.${attempt}`));
    }

    expect(() =>
      limiter.assertAllowedAll(scanActionRules('scan-create', account, '10.0.0.99')),
    ).toThrow(ApiError);
    // A different account from a fresh address is unaffected.
    expect(() =>
      limiter.assertAllowedAll(scanActionRules('scan-create', 'acct_2', '10.0.0.99')),
    ).not.toThrow();
  });

  it('keeps one address from spending every account ceiling in the building', () => {
    const limiter = new RequestRateLimiter(() => 1_000);

    for (let attempt = 0; attempt < 40; attempt += 1) {
      limiter.assertAllowedAll(scanActionRules('scan-create', `acct_${attempt}`, '10.0.0.1'));
    }

    expect(() =>
      limiter.assertAllowedAll(scanActionRules('scan-create', 'acct_fresh', '10.0.0.1')),
    ).toThrow(ApiError);
    expect(() =>
      limiter.assertAllowedAll(scanActionRules('scan-create', 'acct_fresh', '10.0.0.2')),
    ).not.toThrow();
  });
});
