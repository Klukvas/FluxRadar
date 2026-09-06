import { describe, expect, it } from 'vitest';

import { createFastSpringSession, FastSpringApiError, type FetchLike } from './client.ts';
import type { FastSpringConfig } from './config.ts';

// FASTSPRING-013: a Sessions v2 201 is not by itself a usable checkout.
//
// The v2 API answers 201 for a session it could not fill, for inputs it decided
// to ignore and for a checkout that is already concluded, and states that in the
// body rather than in the HTTP status:
//
//   status         OPEN | EXPIRED | CANCELLED | PENDING_ORDER | COMPLETED | FAILED
//   checkoutStatus [PRODUCTS_REQUIRED | READY_FOR_CHECKOUT | CONCLUDED]
//   warnings       "non-fatal errors or ignored input values"
//   cart.lineItems / orderTags — what FastSpring actually kept of the request
//
// Handing a buyer the URL out of such a response is the expensive failure: at
// best the checkout cannot take their money, at worst it takes it and the order
// arrives without the `fluxradarCheckoutRef` order tag the payment is matched
// by — a real charge this API then refuses. Every case below therefore has to
// fail before a CheckoutSession row is ever handed out.
//
// Source: developer.fastspring.com — Sessions, "Create session"
// (BaseSessionResponse, CartResponse, Warning).

const V2_CONFIG: FastSpringConfig = {
  mode: 'test',
  liveMode: false,
  apiBaseUrl: 'https://api.fastspring.com',
  apiUsername: 'api-user',
  apiPassword: 'api-password',
  webhookSecret: 'webhook-secret',
  sessionApi: 'v2',
  currencyPolicy: 'strict',
  storefrontUrl: null,
  checkoutPath: 'examplestore/web-checkout',
  popupStorefront: 'fluxradar.test.onfastspring.com/popup-checkout',
  productPaths: { Basic: 'fluxradar-basic-scan', Complete: 'fluxradar-complete-scan' },
  sessionExpirationDays: 1,
};

const PARAMS = {
  productPath: 'fluxradar-basic-scan',
  tags: { fluxradarCheckoutRef: 'frcs_abc' },
  attributes: { fluxradarCheckoutRef: 'frcs_abc' },
};

const CHECKOUT_URL = 'https://example.onfastspring.com/checkout/session/OS1';

/** A session FastSpring reports as fully usable, exactly as the schema shapes it. */
function readySession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'OS123456789012345ABC',
    created: '2026-03-20T10:49:51.000Z',
    expires: '2026-03-21T10:49:51.000Z',
    status: 'OPEN',
    currency: 'USD',
    live: false,
    orderTags: { ...PARAMS.tags },
    cart: {
      lineItems: [{ productPath: PARAMS.productPath, quantity: 1 }],
      netTotal: 55,
      withoutTaxNetTotal: 55,
    },
    checkoutUrls: { webcheckoutUrl: CHECKOUT_URL },
    warnings: [],
    checkoutStatus: ['READY_FOR_CHECKOUT'],
    ...overrides,
  };
}

function respondWith(payload: unknown): FetchLike {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
}

function openSession(payload: unknown): Promise<unknown> {
  return createFastSpringSession({ config: V2_CONFIG, fetchImpl: respondWith(payload) }, PARAMS);
}

/** Every refusal here is an operator problem, so the buyer sentence is generic. */
async function refusal(payload: unknown): Promise<FastSpringApiError> {
  const error = await openSession(payload).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(FastSpringApiError);
  const apiError = error as FastSpringApiError;
  expect(apiError.message).toBe('Paid checkout is temporarily unavailable');
  // The detail is for the log; nothing about it reaches the buyer.
  expect(apiError.detail).not.toBeNull();
  return apiError;
}

describe('FASTSPRING-013 Sessions v2 fail-closed', () => {
  it('accepts a session FastSpring reports as READY_FOR_CHECKOUT', async () => {
    const session = await createFastSpringSession(
      { config: V2_CONFIG, fetchImpl: respondWith(readySession()) },
      PARAMS,
    );

    expect(session).toMatchObject({
      sessionId: 'OS123456789012345ABC',
      checkoutUrl: CHECKOUT_URL,
      quotedAmount: 55,
      quotedCurrency: 'USD',
    });
  });

  // The cart could not be filled, so the URL leads to a checkout with nothing in
  // it — and the 201 says so only in this field.
  it('refuses a session whose checkout still requires products', async () => {
    const error = await refusal(
      readySession({ checkoutStatus: ['PRODUCTS_REQUIRED'], cart: { lineItems: [] } }),
    );

    expect(error.detail).toMatch(/PRODUCTS_REQUIRED/);
    expect(error.status).toBe(502);
  });

  it('refuses a session whose checkout is already concluded', async () => {
    const error = await refusal(readySession({ checkoutStatus: ['CONCLUDED'] }));

    expect(error.detail).toMatch(/CONCLUDED/);
  });

  it('refuses a checkout state FastSpring reports alongside READY_FOR_CHECKOUT', async () => {
    const error = await refusal(
      readySession({ checkoutStatus: ['READY_FOR_CHECKOUT', 'PRODUCTS_REQUIRED'] }),
    );

    expect(error.detail).toMatch(/READY_FOR_CHECKOUT, PRODUCTS_REQUIRED/);
  });

  it('refuses a session that is not in the OPEN lifecycle state', async () => {
    const error = await refusal(readySession({ status: 'FAILED' }));

    expect(error.detail).toMatch(/lifecycle state FAILED/);
  });

  // "A list detailing any non-fatal errors or ignored input values." Everything
  // this client sends is server-issued and required, so an ignored input is
  // never cosmetic — CHECKOUT_NOT_LIVE in particular means the buyer would be
  // paying in the wrong mode.
  it('refuses a session FastSpring attached a warning to', async () => {
    const error = await refusal(
      readySession({
        warnings: [
          { code: 'CHECKOUT_NOT_LIVE', field: 'live', message: 'This checkout is not live.' },
        ],
      }),
    );

    expect(error.detail).toMatch(/ignored part of the session request/);
    expect(error.detail).toMatch(/CHECKOUT_NOT_LIVE on live/);
    // FastSpring's free text can echo request content, so it stays out entirely.
    expect(error.detail).not.toMatch(/This checkout is not live/);
  });

  it('refuses a session whose cart does not hold the product we asked for', async () => {
    const error = await refusal(
      readySession({ cart: { lineItems: [{ productPath: 'some-other-product' }] } }),
    );

    expect(error.detail).toMatch(/fluxradar-basic-scan/);
  });

  // The checkout reference is the only thing that round-trips through FastSpring.
  // A session that dropped it would take the buyer's money and produce an order
  // this API cannot link to an account, a profile or a plan.
  it('refuses a session that dropped the checkout reference order tag', async () => {
    const error = await refusal(readySession({ orderTags: { campaign: 'Q1_Social' } }));

    expect(error.detail).toMatch(/fluxradarCheckoutRef/);
  });

  it('refuses a session whose order tag came back with a different value', async () => {
    const error = await refusal(
      readySession({ orderTags: { fluxradarCheckoutRef: 'frcs_other' } }),
    );

    expect(error.detail).toMatch(/fluxradarCheckoutRef/);
  });

  it('refuses a response with no checkout URL at all', async () => {
    const error = await openSession(readySession({ checkoutUrls: {} })).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(FastSpringApiError);
    expect((error as FastSpringApiError).message).toMatch(/did not contain a checkout URL/);
  });

  // Each check reads a field FastSpring stated. A session that states none of
  // them is still taken at the value of the URL it returned, so a response shape
  // that predates these fields does not turn every checkout into a 502.
  it('accepts a session that states nothing beyond its checkout URL', async () => {
    const session = await createFastSpringSession(
      {
        config: V2_CONFIG,
        fetchImpl: respondWith({
          id: 'OS_minimal',
          checkoutUrls: { webcheckoutUrl: CHECKOUT_URL },
        }),
      },
      PARAMS,
    );

    expect(session.checkoutUrl).toBe(CHECKOUT_URL);
  });
});
