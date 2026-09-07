// Login brute force, in the two shapes a single composite key never sees.
//
// The limiter used to hold exactly one bucket per (email, IP) pair. That bounds
// the one attack nobody runs — the same address guessing the same account over
// and over — and neither of the two that are actually run:
//
//   password spraying: one likely password against thousands of accounts from
//   one address. No pair is ever tried twice, so no bucket ever filled.
//
//   distributed brute force: one account, one address per attempt. Every attempt
//   opened a fresh bucket, so the account ceiling was five guesses per address
//   and therefore no ceiling at all.
//
// rate-limit.ts already said, in its own header, that a composite key "looks
// stricter and is bypassed by exactly that". These tests hold login to it.

import { describe, expect, it } from 'vitest';

import { ApiError } from '../http/errors.ts';
import {
  LOGIN_ATTEMPT_LIMIT,
  LOGIN_EMAIL_LIMIT,
  LOGIN_IP_LIMIT,
  LoginRateLimiter,
} from './rate-limit.ts';

function attempt(limiter: LoginRateLimiter, email: string, ip: string): void {
  limiter.assertAllowed(email, ip);
}

describe('login rate limits', () => {
  it('holds one account to its ceiling however many addresses try it', () => {
    const limiter = new LoginRateLimiter({ now: () => 1_000 });
    const victim = 'victim@example.com';

    for (let index = 0; index < LOGIN_EMAIL_LIMIT; index += 1) {
      attempt(limiter, victim, `10.0.0.${index}`);
    }

    expect(() => attempt(limiter, victim, '10.0.0.250')).toThrow(ApiError);
    // Another account from that same fresh address is unaffected.
    expect(() => attempt(limiter, 'someone@example.com', '10.0.0.250')).not.toThrow();
  });

  it('holds one address to its ceiling however many accounts it names', () => {
    const limiter = new LoginRateLimiter({ now: () => 1_000 });

    for (let index = 0; index < LOGIN_IP_LIMIT; index += 1) {
      attempt(limiter, `user-${index}@example.com`, '10.0.0.1');
    }

    expect(() => attempt(limiter, 'user-fresh@example.com', '10.0.0.1')).toThrow(ApiError);
    // The same untried account from a different address still gets in.
    expect(() => attempt(limiter, 'user-fresh@example.com', '10.0.0.2')).not.toThrow();
  });

  it('still refuses the repeated pair first, at the tightest ceiling', () => {
    const limiter = new LoginRateLimiter({ now: () => 1_000 });

    for (let index = 0; index < LOGIN_ATTEMPT_LIMIT; index += 1) {
      attempt(limiter, 'user@example.com', '10.0.0.1');
    }

    expect(() => attempt(limiter, 'user@example.com', '10.0.0.1')).toThrow(ApiError);
    // Below the account ceiling, so the same account from elsewhere still works.
    expect(() => attempt(limiter, 'user@example.com', '10.0.0.2')).not.toThrow();
  });

  it('refuses with a retry hint rather than a bare 429', () => {
    let now = 1_000;
    const limiter = new LoginRateLimiter({ limit: 1, windowMs: 30_000, now: () => now });
    attempt(limiter, 'user@example.com', '10.0.0.1');
    now += 10_000;

    try {
      attempt(limiter, 'user@example.com', '10.0.0.1');
      expect.unreachable('expected the limiter to refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(429);
      expect((error as ApiError).retryAfterSeconds).toBe(20);
      expect((error as ApiError).message).toContain('login');
    }
  });

  it('lets the window reopen the account ceiling', () => {
    let now = 1_000;
    const limiter = new LoginRateLimiter({ windowMs: 30_000, now: () => now });

    for (let index = 0; index < LOGIN_EMAIL_LIMIT; index += 1) {
      attempt(limiter, 'user@example.com', `10.0.0.${index}`);
    }
    expect(() => attempt(limiter, 'user@example.com', '10.0.0.250')).toThrow(ApiError);

    now += 30_001;
    expect(() => attempt(limiter, 'user@example.com', '10.0.0.250')).not.toThrow();
  });

  // A rule that refuses must not have charged the rules checked before it, or
  // the pair bucket fills faster than its own limit says.
  it('charges nothing when one of the three rules refuses', () => {
    const limiter = new LoginRateLimiter({ ipLimit: 1, now: () => 1_000 });

    attempt(limiter, 'first@example.com', '10.0.0.1');
    expect(() => attempt(limiter, 'second@example.com', '10.0.0.1')).toThrow(ApiError);

    // The refused attempt must not have spent second@'s own account ceiling.
    for (let index = 0; index < LOGIN_EMAIL_LIMIT; index += 1) {
      expect(() => attempt(limiter, 'second@example.com', `10.0.1.${index}`)).not.toThrow();
    }
  });
});

describe('a successful login', () => {
  it('clears the ceilings that belong to the account', () => {
    const limiter = new LoginRateLimiter({ now: () => 1_000 });
    const email = 'user@example.com';

    for (let index = 0; index < LOGIN_EMAIL_LIMIT; index += 1) {
      attempt(limiter, email, `10.0.0.${index}`);
    }
    limiter.reset(email, '10.0.0.0');

    expect(() => attempt(limiter, email, '10.0.0.250')).not.toThrow();
  });

  // Owning one account proves nothing about the other accounts being sprayed
  // from the same address, so the address ceiling has to survive a valid login —
  // otherwise an attacker with a single account of their own resets it at will.
  it('leaves the address ceiling standing', () => {
    const limiter = new LoginRateLimiter({ ipLimit: 3, now: () => 1_000 });

    attempt(limiter, 'mine@example.com', '10.0.0.1');
    attempt(limiter, 'target-a@example.com', '10.0.0.1');
    attempt(limiter, 'target-b@example.com', '10.0.0.1');
    limiter.reset('mine@example.com', '10.0.0.1');

    expect(() => attempt(limiter, 'target-c@example.com', '10.0.0.1')).toThrow(ApiError);
  });
});
