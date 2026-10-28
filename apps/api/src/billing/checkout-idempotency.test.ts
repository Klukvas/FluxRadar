// The wire pieces of the checkout idempotency contract, without a database.
//
// The replay semantics themselves are pinned against the disposable database in
// billing/creem/creem-010-checkout-idempotency.test.ts; these pin the header
// parsing, the payload hash and the stored-view rebuild that both sides of
// that contract share.

import { describe, expect, it } from 'vitest';

import { checkoutSessionViewFromRow } from './creem/checkout-session.ts';
import { checkoutRequestHash, readIdempotencyKey } from './checkout-idempotency.ts';

describe('readIdempotencyKey', () => {
  it('reads an absent or empty header as no key', () => {
    expect(readIdempotencyKey(undefined)).toBeNull();
    expect(readIdempotencyKey('')).toBeNull();
    expect(readIdempotencyKey('   ')).toBeNull();
  });

  it('accepts the client-minted 32-hex key and normalizes case', () => {
    expect(readIdempotencyKey('a'.repeat(32))).toBe('a'.repeat(32));
    expect(readIdempotencyKey('ABCDEF0123456789ABCDEF0123456789')).toBe(
      'abcdef0123456789abcdef0123456789',
    );
    expect(readIdempotencyKey(`  ${'b'.repeat(16)}  `)).toBe('b'.repeat(16));
    expect(readIdempotencyKey('c'.repeat(64))).toBe('c'.repeat(64));
  });

  it.each([
    'short',
    'x'.repeat(15),
    'g'.repeat(32), // 'g' is not hex
    `${'a'.repeat(31)}-`, // separators are not hex
    'a'.repeat(65),
  ])('refuses the malformed key %j as a 400 VALIDATION', (raw) => {
    const caught = ((): unknown => {
      try {
        return readIdempotencyKey(raw);
      } catch (error) {
        return error;
      }
    })();
    expect(caught).toMatchObject({ status: 400, code: 'VALIDATION' });
  });
});

describe('checkoutRequestHash', () => {
  const payload = {
    siteProfileId: 'profile-1',
    plan: 'Basic',
    scope: { includeSubdomains: false, maxPages: 25, maxDepth: 3 },
    aiConsent: { providers: ['anthropic'], noticeVersion: 'v1' },
    expectedProfileConfigVersion: 2,
  };

  it('is stable across key order of the same draft', () => {
    const reordered = {
      expectedProfileConfigVersion: 2,
      aiConsent: { noticeVersion: 'v1', providers: ['anthropic'] },
      plan: 'Basic',
      siteProfileId: 'profile-1',
      scope: { maxDepth: 3, maxPages: 25, includeSubdomains: false },
    };
    expect(checkoutRequestHash(reordered)).toBe(checkoutRequestHash(payload));
    // Nested arrays keep their order on purpose: order inside a list is data.
    const reorderedArray = {
      ...payload,
      aiConsent: { noticeVersion: 'v1', providers: ['openai', 'anthropic'] },
    };
    expect(checkoutRequestHash(reorderedArray)).not.toBe(checkoutRequestHash(payload));
  });

  it('differs when any field of the draft changes', () => {
    expect(
      checkoutRequestHash({ ...payload, plan: 'Complete' }) !== checkoutRequestHash(payload),
    ).toBe(true);
    expect(
      checkoutRequestHash({
        ...payload,
        scope: { ...payload.scope, maxPages: 26 },
      }) !== checkoutRequestHash(payload),
    ).toBe(true);
    expect(
      checkoutRequestHash({ ...payload, expectedProfileConfigVersion: 3 }) !==
        checkoutRequestHash(payload),
    ).toBe(true);
    expect(checkoutRequestHash({ ...payload, aiConsent: undefined }) !== checkoutRequestHash(payload)).toBe(
      true,
    );
  });

  it('is a 64-character hex digest', () => {
    expect(checkoutRequestHash(payload)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('checkoutSessionViewFromRow', () => {
  const row = {
    reference: 'frcs_view',
    providerSessionId: 'ch_view',
    checkoutUrl: 'https://www.creem.io/test/checkout/prod_basic/ch_view',
    plan: 'Basic',
    expectedAmountUsd: 39,
    expiresAt: new Date('2026-11-04T12:00:00Z'),
    liveMode: true,
  };

  it('rebuilds the stored view, taking the mode from the row itself', () => {
    const view = checkoutSessionViewFromRow(row);
    expect(view).toEqual({
      reference: 'frcs_view',
      sessionId: 'ch_view',
      checkoutUrl: 'https://www.creem.io/test/checkout/prod_basic/ch_view',
      plan: 'Basic',
      amount: 39,
      currency: 'USD',
      mode: 'live',
      expiresAt: '2026-11-04T12:00:00.000Z',
    });
    // A row opened in test mode stays a test-mode view even if the deployment
    // serving the replay has flipped to live since.
    expect(checkoutSessionViewFromRow({ ...row, liveMode: false }).mode).toBe('test');
  });

  it('refuses to invent a view for a row missing its provider fields', () => {
    expect(() => checkoutSessionViewFromRow({ ...row, providerSessionId: null })).toThrow(
      'missing its stored provider view',
    );
    expect(() => checkoutSessionViewFromRow({ ...row, checkoutUrl: null })).toThrow(
      'missing its stored provider view',
    );
  });
});
