// The per-draft idempotency key the paid checkout launch sends.
//
// `crypto.randomUUID()` is deliberately not used: it is undefined on insecure
// origins, and the checkout must keep its retry protection on
// http://192.168.x.x dev machines too.

import { describe, expect, it } from 'vitest';

import { mintIdempotencyKey } from './api';

describe('mintIdempotencyKey', () => {
  it('mints 32 lowercase hex characters', () => {
    expect(mintIdempotencyKey()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('mints a fresh key on every call', () => {
    const seen = new Set(Array.from({ length: 32 }, () => mintIdempotencyKey()));
    expect(seen.size).toBe(32);
  });
});
