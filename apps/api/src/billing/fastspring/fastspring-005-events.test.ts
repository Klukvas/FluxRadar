import { describe, expect, it } from 'vitest';

import { createFastSpringSession } from './client.ts';
import { readFastSpringConfig } from './config.ts';
import {
  CHECKOUT_REFERENCE_KEY,
  readEventLiveFlag,
  normalizeEvent,
  parseEnvelope,
  readCheckoutReference,
} from './events.ts';

// FASTSPRING-005: payload normalisation and the v2 Sessions API.
//
// Webhook expansion replaces bare ids with full objects, so the reader must
// accept both forms; and a store may or may not echo order tags, so the checkout
// reference is looked for in tags AND in item attributes.

const V2_ENV = {
  FASTSPRING_MODE: 'live',
  // Live mode fails closed without the operator's store confirmation.
  FASTSPRING_STORE_VERIFIED: 'verified',
  FASTSPRING_API_USERNAME: 'api-user',
  FASTSPRING_API_PASSWORD: 'api-password-value',
  FASTSPRING_WEBHOOK_SECRET: 'secret',
  FASTSPRING_SESSION_API: 'v2',
  FASTSPRING_CHECKOUT_PATH: 'fluxradar-checkout',
  // v2 checks out in the popup, so the live storefront the Store Builder Library
  // loads is part of a complete v2 configuration.
  FASTSPRING_POPUP_STOREFRONT: 'fluxradar.onfastspring.com/popup-checkout',
  FASTSPRING_PRODUCT_PATH_BASIC: 'fluxradar-basic-scan',
  FASTSPRING_PRODUCT_PATH_COMPLETE: 'fluxradar-complete-scan',
} satisfies NodeJS.ProcessEnv;

describe('FASTSPRING-005 payload normalisation', () => {
  it('parses a multi-event envelope and a hand-replayed single event', () => {
    const batch = parseEnvelope({
      events: [
        { id: 'a', type: 'order.completed', live: true, data: {} },
        { id: 'b', type: 'return.created', live: true, data: {} },
      ],
    });
    expect(batch).toHaveLength(2);
    expect(parseEnvelope({ id: 'a', type: 'order.completed', data: {} })).toHaveLength(1);
    expect(parseEnvelope({ events: [] })).toBeNull();
    expect(parseEnvelope('nope')).toBeNull();
  });

  it('reads an expanded order.completed as well as the unexpanded form', () => {
    const expanded = normalizeEvent({
      id: 'evt_1',
      type: 'order.completed',
      live: true,
      data: {
        order: 'ord_1',
        currency: 'USD',
        total: 120,
        subtotal: 120,
        account: { id: 'acct_1', contact: { email: 'jane@example.com' } },
        tags: { [CHECKOUT_REFERENCE_KEY]: 'frcs_expanded' },
        items: [
          {
            product: { product: 'fluxradar-complete-scan', sku: 'SKU-1' },
            quantity: 1,
            subtotal: 120,
          },
        ],
      },
    });
    expect(expanded.ok).toBe(true);
    if (!expanded.ok || expanded.event.kind !== 'order.completed') return;
    expect(expanded.event.orderId).toBe('ord_1');
    expect(expanded.event.items[0]?.productPath).toBe('fluxradar-complete-scan');
    expect(readCheckoutReference(expanded.event)).toBe('frcs_expanded');
  });

  it('finds the original order of a return and the order of a chargeback', () => {
    const refund = normalizeEvent({
      id: 'evt_r',
      type: 'return.created',
      data: { return: 'ret_1', currency: 'USD', totalReturn: 55, original: { id: 'ord_9' } },
    });
    expect(
      refund.ok && refund.event.kind === 'return.created' && refund.event.originalOrderId,
    ).toBe('ord_9');
    const chargeback = normalizeEvent({
      id: 'evt_c',
      type: 'chargeback.created',
      data: { id: 'cb_1', order: 'ord_9', chargebackAmount: 55, currency: 'USD' },
    });
    expect(
      chargeback.ok && chargeback.event.kind === 'chargeback.created' && chargeback.event.orderId,
    ).toBe('ord_9');
  });

  it('refuses an actionable event whose required fields are missing', () => {
    expect(normalizeEvent({ id: 'e', type: 'order.completed', data: { currency: 'USD' } })).toEqual(
      {
        ok: false,
        reason: 'order.completed payload has no order id',
      },
    );
    expect(
      normalizeEvent({
        id: 'e',
        type: 'order.completed',
        data: { order: 'o', currency: 'USD', total: 1 },
      }),
    ).toEqual({ ok: false, reason: 'order.completed payload has no items' });
    expect(normalizeEvent({ id: 'e', type: 'subscription.charge.completed', data: {} }).ok).toBe(
      false,
    );
  });

  it('takes the live flag from the envelope and falls back to the data object', () => {
    expect(
      readEventLiveFlag({ id: 'e', type: 'order.completed', live: true, data: { live: false } }),
    ).toBe(true);
    expect(readEventLiveFlag({ id: 'e', type: 'order.completed', data: { live: true } })).toBe(
      true,
    );
    // No flag anywhere is "unknown", never "test mode": collapsing it to false
    // would make a live deployment silently ignore a paid order.
    expect(readEventLiveFlag({ id: 'e', type: 'order.completed', data: {} })).toBeNull();
  });

  it('calls the v2 Sessions endpoint and uses the checkout URL it returns', async () => {
    const config = readFastSpringConfig(V2_ENV);
    if (config.state !== 'configured') throw new Error('expected a configured environment');
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const session = await createFastSpringSession(
      {
        config: config.config,
        fetchImpl: (url, init) => {
          seen.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'sess_v2',
                currency: 'EUR',
                expires: '2026-09-07T00:00:00.000Z',
                cart: { netTotal: 51.2 },
                checkoutUrls: { webcheckoutUrl: 'https://store.onfastspring.com/checkout/sess_v2' },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
        },
      },
      {
        productPath: 'fluxradar-basic-scan',
        tags: { [CHECKOUT_REFERENCE_KEY]: 'frcs_v2' },
        attributes: { [CHECKOUT_REFERENCE_KEY]: 'frcs_v2' },
      },
    );

    expect(seen[0]?.url).toBe(
      'https://api.fastspring.com/v2/checkouts/fluxradar-checkout/sessions',
    );
    expect(seen[0]?.body['live']).toBe(true);
    expect(session.checkoutUrl).toBe('https://store.onfastspring.com/checkout/sess_v2');
    // The provider's own quote is what a later order is validated against.
    expect(session.quotedCurrency).toBe('EUR');
    expect(session.quotedAmount).toBe(51.2);
  });

  it('reports an unreachable provider without leaking the request', async () => {
    const config = readFastSpringConfig(V2_ENV);
    if (config.state !== 'configured') throw new Error('expected a configured environment');
    await expect(
      createFastSpringSession(
        { config: config.config, fetchImpl: () => Promise.reject(new Error('ECONNREFUSED')) },
        { productPath: 'p', tags: {}, attributes: {} },
      ),
    ).rejects.toMatchObject({ code: 'FASTSPRING_API', message: 'FastSpring could not be reached' });
  });
});
