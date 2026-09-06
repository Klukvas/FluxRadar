import { describe, expect, it } from 'vitest';

import { createFastSpringSession, type FetchLike } from './client.ts';
import type { FastSpringConfig } from './config.ts';

// FASTSPRING-010: the two Sessions APIs, against what FastSpring documents.
//
// Both are server-to-server calls whose URL and body we have to get exactly
// right — a wrong path is a 404 at the buyer's first click, and a quote read off
// the wrong field silently poisons the amount check later. Sources:
// developer.fastspring.com — "Sessions v1" (create session, `expiration`,
// `/session/{id}` checkout URL) and "Sessions" (checkout path
// `{storeId}/{checkoutId}`, CartResponse tax fields).

const BASE_CONFIG: FastSpringConfig = {
  mode: 'test',
  liveMode: false,
  apiBaseUrl: 'https://api.fastspring.com',
  apiUsername: 'api-user',
  apiPassword: 'api-password',
  webhookSecret: 'webhook-secret',
  sessionApi: 'v1',
  currencyPolicy: 'strict',
  storefrontUrl: 'https://fluxradar.test.onfastspring.com',
  checkoutPath: null,
  popupStorefront: null,
  productPaths: { Basic: 'fluxradar-basic-scan', Complete: 'fluxradar-complete-scan' },
  sessionExpirationDays: 3,
};

interface RecordedCall {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

function stubProvider(payload: unknown, calls: RecordedCall[]): FetchLike {
  return (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };
}

const PARAMS = {
  productPath: 'fluxradar-basic-scan',
  tags: { fluxradarCheckoutRef: 'frcs_abc' },
  attributes: { fluxradarCheckoutRef: 'frcs_abc' },
};

describe('FASTSPRING-010 Sessions API requests', () => {
  it('keeps the store/checkout separator of a v2 checkout path a real path separator', async () => {
    const calls: RecordedCall[] = [];
    const config: FastSpringConfig = {
      ...BASE_CONFIG,
      sessionApi: 'v2',
      checkoutPath: 'examplestore/popup-checkout',
    };

    await createFastSpringSession(
      {
        config,
        fetchImpl: stubProvider(
          {
            id: 'sess_v2',
            currency: 'USD',
            checkoutUrls: { webcheckoutUrl: 'https://example.onfastspring.com/checkout/session/x' },
          },
          calls,
        ),
      },
      PARAMS,
    );

    // Percent-encoding the whole path (…/checkouts/examplestore%2Fpopup-checkout/…)
    // asks FastSpring for a checkout that does not exist.
    expect(calls[0]?.url).toBe(
      'https://api.fastspring.com/v2/checkouts/examplestore/popup-checkout/sessions',
    );
    expect(calls[0]?.url).not.toContain('%2F');
  });

  it('still encodes what is inside a single checkout path segment', async () => {
    const calls: RecordedCall[] = [];
    const config: FastSpringConfig = {
      ...BASE_CONFIG,
      sessionApi: 'v2',
      checkoutPath: 'example store/web checkout',
    };

    await createFastSpringSession(
      {
        config,
        fetchImpl: stubProvider(
          {
            id: 'sess_v2',
            checkoutUrls: { webcheckoutUrl: 'https://example.onfastspring.com/checkout/session/x' },
          },
          calls,
        ),
      },
      PARAMS,
    );

    expect(calls[0]?.url).toBe(
      'https://api.fastspring.com/v2/checkouts/example%20store/web%20checkout/sessions',
    );
  });

  // `netTotal` carries the tax or not depending on the store's pricing mode;
  // `withoutTaxNetTotal` is defined either way, so the stored quote is a figure
  // the order-amount check can reason about.
  it('quotes a v2 session from the tax-free cart total when FastSpring reports one', async () => {
    const calls: RecordedCall[] = [];
    const config: FastSpringConfig = {
      ...BASE_CONFIG,
      sessionApi: 'v2',
      checkoutPath: 'examplestore/web-checkout',
    };

    const session = await createFastSpringSession(
      {
        config,
        fetchImpl: stubProvider(
          {
            id: 'sess_tax',
            currency: 'EUR',
            expires: '2026-03-21T10:49:51.000Z',
            cart: { netTotal: 55, withoutTaxNetTotal: 46.22, taxIncluded: 'INCLUSIVE' },
            checkoutUrls: { webcheckoutUrl: 'https://example.onfastspring.com/checkout/session/y' },
          },
          calls,
        ),
      },
      PARAMS,
    );

    expect(session.quotedAmount).toBeCloseTo(46.22, 2);
    expect(session.quotedCurrency).toBe('EUR');
    expect(session.expiresAt?.toISOString()).toBe('2026-03-21T10:49:51.000Z');
    expect(calls[0]?.body['live']).toBe(false);
  });

  it('falls back to the cart net total when no tax-free figure is reported', async () => {
    const calls: RecordedCall[] = [];
    const config: FastSpringConfig = {
      ...BASE_CONFIG,
      sessionApi: 'v2',
      checkoutPath: 'examplestore/web-checkout',
    };

    const session = await createFastSpringSession(
      {
        config,
        fetchImpl: stubProvider(
          {
            id: 'sess_plain',
            currency: 'USD',
            cart: { netTotal: 55 },
            checkoutUrls: { webcheckoutUrl: 'https://example.onfastspring.com/checkout/session/z' },
          },
          calls,
        ),
      },
      PARAMS,
    );

    expect(session.quotedAmount).toBe(55);
  });

  // `expiration` is the documented v1 way to widen the default 24-hour window,
  // in days, up to 7 — and the buyer URL is the storefront `/session/{id}`.
  it('sends the documented v1 session expiration and builds the storefront URL', async () => {
    const calls: RecordedCall[] = [];

    const session = await createFastSpringSession(
      {
        config: BASE_CONFIG,
        fetchImpl: stubProvider(
          { id: 'sess_v1', currency: 'USD', subtotal: 55, expires: 1767225600000 },
          calls,
        ),
      },
      PARAMS,
    );

    expect(calls[0]?.url).toBe('https://api.fastspring.com/sessions');
    expect(calls[0]?.body['expiration']).toBe(3);
    expect(session.checkoutUrl).toBe('https://fluxradar.test.onfastspring.com/session/sess_v1');
    expect(session.expiresAt?.getTime()).toBe(1767225600000);
    expect(session.quotedAmount).toBe(55);
  });
});
