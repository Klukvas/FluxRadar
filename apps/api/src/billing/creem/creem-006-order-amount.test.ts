import { describe, expect, it } from 'vitest';
import type { CheckoutSession } from '@prisma/client';

import { CREEM_PROVIDER } from './config.ts';
import {
  CREEM_EVENT_TYPES,
  normalizeCreemEvent,
  type CreemCheckoutCompletedEvent,
} from './events.ts';
import { resolveCreemOrderAmount } from './order-amount.ts';
import { checkoutCompletedObject, type CheckoutCompletedOptions } from './test-payloads.ts';

// CREEM-006: what a completed Creem order is allowed to have charged.
//
// Access is granted against the USD tariff this repository owns, never against
// the figure the provider sent back. Creem states every amount in cents and the
// product's tax mode decides whether the tariff is compared before or after tax:
// exclusive tax charges tariff PLUS tax, inclusive tax charges exactly the tariff
// with the tax inside. A discount lowers `sub_total` while `amount` stays the
// list price, and a discounted order that only reaches the tariff once tax is
// counted is not worth the plan.

const BASIC_PRODUCT = 'prod_basic';
const BASIC_PRICE = 55;
const BASIC_CENTS = 5500;

function session(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'cs_1',
    provider: CREEM_PROVIDER,
    reference: 'frcs_amount',
    accountId: 'acct_1',
    siteProfileId: 'site_1',
    plan: 'Basic',
    productPath: BASIC_PRODUCT,
    expectedAmountUsd: BASIC_PRICE,
    quotedAmount: null,
    quotedCurrency: null,
    liveMode: false,
    providerSessionId: 'ch_1',
    status: 'created',
    statusReason: null,
    settledAmount: null,
    settledCurrency: null,
    scopeJson: JSON.stringify({ includeSubdomains: false }),
    profileConfigVersion: 1,
    executionConfigJson: null,
    aiConsentJson: null,
    purchaseId: null,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function orderOf(options: Partial<CheckoutCompletedOptions> = {}): CreemCheckoutCompletedEvent {
  const normalized = normalizeCreemEvent({
    id: 'evt_amount',
    eventType: CREEM_EVENT_TYPES.checkoutCompleted,
    object: checkoutCompletedObject({
      checkoutId: 'ch_amount',
      orderId: 'ord_amount',
      reference: 'frcs_amount',
      productId: BASIC_PRODUCT,
      amountCents: BASIC_CENTS,
      ...options,
    }),
  });
  if (!normalized.ok || normalized.event.kind !== CREEM_EVENT_TYPES.checkoutCompleted) {
    throw new Error('fixture did not normalise to a checkout.completed event');
  }
  return normalized.event;
}

/** A checkout.completed whose order carries exactly these money fields. */
function orderWith(order: Record<string, unknown>): CreemCheckoutCompletedEvent {
  const normalized = normalizeCreemEvent({
    id: 'evt_hand',
    eventType: CREEM_EVENT_TYPES.checkoutCompleted,
    object: {
      id: 'ch_hand',
      request_id: 'frcs_amount',
      order: { id: 'ord_hand', product: BASIC_PRODUCT, currency: 'USD', ...order },
    },
  });
  if (!normalized.ok || normalized.event.kind !== CREEM_EVENT_TYPES.checkoutCompleted) {
    throw new Error('fixture did not normalise to a checkout.completed event');
  }
  return normalized.event;
}

describe('CREEM-006 order amount', () => {
  it('accepts the exact USD full price as a plain match', () => {
    expect(resolveCreemOrderAmount(session(), orderOf(), 'Basic')).toEqual({
      kind: 'accepted',
      amountUsd: BASIC_PRICE,
      settledAmount: BASIC_PRICE,
      settledCurrency: 'USD',
      unverifiedReason: null,
    });
  });

  // Exclusive tax charges $60.50 for the $55 plan. The extra is tax, not a
  // catalogue that disagrees with the tariff, so nothing is flagged.
  it('accepts an exclusive-tax order charged above the tariff, recording what was charged', () => {
    const verdict = resolveCreemOrderAmount(
      session(),
      orderOf({ taxCents: 550, taxMode: 'exclusive' }),
      'Basic',
    );
    expect(verdict).toEqual({
      kind: 'accepted',
      amountUsd: 60.5,
      settledAmount: 60.5,
      settledCurrency: 'USD',
      unverifiedReason: null,
    });
  });

  // Inclusive tax charges exactly $55 and reports $49.70 of it as the price.
  // Reading that figure as "what was paid" would refuse a buyer who paid in full.
  it('accepts an inclusive-tax order whose price before tax is below the tariff', () => {
    const verdict = resolveCreemOrderAmount(
      session(),
      orderOf({ taxCents: 530, taxMode: 'inclusive' }),
      'Basic',
    );
    expect(verdict).toEqual({
      kind: 'accepted',
      amountUsd: BASIC_PRICE,
      settledAmount: BASIC_PRICE,
      settledCurrency: 'USD',
      unverifiedReason: null,
    });
  });

  it('rejects a discounted exclusive-tax order even when tax lifts the charge over the tariff', () => {
    // $55 list, $27.50 off, $30 tax on top: $57.50 charged, $27.50 worth.
    const verdict = resolveCreemOrderAmount(
      session(),
      orderOf({ discountCents: 2750, taxCents: 3000, taxMode: 'exclusive' }),
      'Basic',
    );
    expect(verdict.kind).toBe('rejected');
    if (verdict.kind !== 'rejected') return;
    expect(verdict.reason).toContain('27.5 USD before tax');
    expect(verdict.reason).toContain('57.5 USD charged');
    expect(verdict.reason).toContain('after a discount');
    expect(verdict.reason).toContain(`below the ${BASIC_PRICE} USD Basic plan price`);
  });

  it('rejects a discounted inclusive-tax order', () => {
    const verdict = resolveCreemOrderAmount(
      session(),
      orderOf({ discountCents: 2750, taxCents: 530, taxMode: 'inclusive' }),
      'Basic',
    );
    expect(verdict.kind).toBe('rejected');
    if (verdict.kind !== 'rejected') return;
    expect(verdict.reason).toContain('after a discount');
  });

  // A sub-total below the list price is a deduction whether or not the payload
  // names a discount object.
  it('derives a discount from a sub-total below the list price', () => {
    const verdict = resolveCreemOrderAmount(
      session(),
      orderWith({ amount: 5500, sub_total: 2750, tax_amount: 2750, amount_paid: 5500 }),
      'Basic',
    );
    expect(verdict.kind).toBe('rejected');
    if (verdict.kind !== 'rejected') return;
    expect(verdict.reason).toContain('after a discount');
  });

  // Creem's own checkout.completed example nests an order with nothing but
  // `amount`, and a buyer can type a coupon on the hosted page. The list price
  // is what was paid only when nothing says otherwise.
  describe('the documented minimal order shape', () => {
    it('accepts an undiscounted minimal order at the list price', () => {
      const verdict = resolveCreemOrderAmount(session(), orderOf({ minimalOrder: true }), 'Basic');
      expect(verdict).toEqual({
        kind: 'accepted',
        amountUsd: BASIC_PRICE,
        settledAmount: BASIC_PRICE,
        settledCurrency: 'USD',
        unverifiedReason: null,
      });
    });

    it('rejects a minimal order that carries a discount object, whatever the list price says', () => {
      const verdict = resolveCreemOrderAmount(
        session(),
        orderOf({ minimalOrder: true, discountCents: 2750 }),
        'Basic',
      );
      expect(verdict.kind).toBe('rejected');
      if (verdict.kind !== 'rejected') return;
      expect(verdict.reason).toContain('carries a discount and states no post-discount charge');
    });

    it('rejects an order whose only discount figure is discount_amount and that states no charge', () => {
      const verdict = resolveCreemOrderAmount(
        session(),
        orderWith({ amount: 5500, discount_amount: 2750 }),
        'Basic',
      );
      expect(verdict.kind).toBe('rejected');
      if (verdict.kind !== 'rejected') return;
      expect(verdict.reason).toContain('carries a discount and states no post-discount charge');
      // The same with a sub-total but no amount_paid / amount_due.
      expect(
        resolveCreemOrderAmount(
          session(),
          orderOf({ discountCents: 2750, omitPaidFields: true }),
          'Basic',
        ).kind,
      ).toBe('rejected');
    });

    it('reads discount_amount as the discount and says so when the remainder still covers the plan', () => {
      const verdict = resolveCreemOrderAmount(
        session(),
        orderWith({ amount: 6000, discount_amount: 500, sub_total: 5500, amount_paid: 5500 }),
        'Basic',
      );
      expect(verdict).toMatchObject({ kind: 'accepted', amountUsd: BASIC_PRICE });
      if (verdict.kind !== 'accepted') return;
      expect(verdict.unverifiedReason).toContain('carries a 5 USD discount');
      expect(verdict.unverifiedReason).toContain('still covers the 55 USD Basic plan price');
    });
  });

  it('grants a catalogue entry priced above the tariff and reports the mismatch', () => {
    const verdict = resolveCreemOrderAmount(session(), orderOf({ amountCents: 6000 }), 'Basic');
    expect(verdict.kind).toBe('accepted');
    if (verdict.kind !== 'accepted') return;
    expect(verdict.amountUsd).toBe(60);
    expect(verdict.settledAmount).toBe(60);
    expect(verdict.unverifiedReason).toContain('60 USD before tax');
    expect(verdict.unverifiedReason).toContain('the Creem product price does not match the tariff');
  });

  it('rejects an order below the tariff, by a cent or by a lot', () => {
    const byACent = resolveCreemOrderAmount(session(), orderOf({ amountCents: 5498 }), 'Basic');
    expect(byACent.kind).toBe('rejected');
    const byALot = resolveCreemOrderAmount(session(), orderOf({ amountCents: 100 }), 'Basic');
    expect(byALot.kind).toBe('rejected');
    if (byALot.kind !== 'rejected') return;
    expect(byALot.reason).toBe(
      `order is worth 1 USD before tax (1 USD charged), below the ${BASIC_PRICE} USD Basic plan price`,
    );
  });

  it('rejects an order that states no amount at all', () => {
    expect(resolveCreemOrderAmount(session(), orderOf({ omitAmounts: true }), 'Basic')).toEqual({
      kind: 'rejected',
      reason: 'checkout.completed payload states no order amount',
    });
  });

  it('reads the charge from amount_paid, then amount_due, then sub_total, then amount', () => {
    expect(
      resolveCreemOrderAmount(session(), orderWith({ amount: 100, amount_paid: 5500 }), 'Basic')
        .kind,
    ).toBe('accepted');
    expect(
      resolveCreemOrderAmount(session(), orderWith({ amount: 100, amount_due: 5500 }), 'Basic')
        .kind,
    ).toBe('accepted');
    expect(
      resolveCreemOrderAmount(session(), orderWith({ amount: 5500, sub_total: 5500 }), 'Basic')
        .kind,
    ).toBe('accepted');
    expect(resolveCreemOrderAmount(session(), orderWith({ amount: 5500 }), 'Basic').kind).toBe(
      'accepted',
    );
    // The list price alone never stands in for a stated charge.
    expect(
      resolveCreemOrderAmount(session(), orderWith({ amount: 5500, amount_paid: 100 }), 'Basic')
        .kind,
    ).toBe('rejected');
  });

  // Nothing here can convert a foreign currency, and the card is already
  // charged: an undiscounted order is granted and flagged for an operator.
  it('accepts an undiscounted order in another currency as unverified, at the tariff', () => {
    const verdict = resolveCreemOrderAmount(
      session(),
      orderOf({ currency: 'EUR', amountCents: 4900 }),
      'Basic',
    );
    expect(verdict.kind).toBe('accepted');
    if (verdict.kind !== 'accepted') return;
    expect(verdict.amountUsd).toBe(BASIC_PRICE);
    expect(verdict.settledAmount).toBe(49);
    expect(verdict.settledCurrency).toBe('EUR');
    expect(verdict.unverifiedReason).toContain('charged in EUR');
    expect(verdict.unverifiedReason).toContain('not verified');
  });

  it('rejects a discounted order in another currency', () => {
    const verdict = resolveCreemOrderAmount(
      session(),
      orderOf({ currency: 'EUR', discountCents: 500 }),
      'Basic',
    );
    expect(verdict.kind).toBe('rejected');
    if (verdict.kind !== 'rejected') return;
    expect(verdict.reason).toContain('charged in EUR and carries a discount');
  });

  it('reads a lower-case currency as its upper-case code', () => {
    const verdict = resolveCreemOrderAmount(session(), orderOf({ currency: 'usd' }), 'Basic');
    expect(verdict).toMatchObject({
      kind: 'accepted',
      settledCurrency: 'USD',
      unverifiedReason: null,
    });
  });

  // The buyer paid what they were quoted: a price rise between checkout and
  // payment must not refuse them, and a stored expectation that is not a usable
  // price must not lower the floor either.
  describe('the expected amount stored on the session', () => {
    it('is the floor when it is below the tariff', () => {
      const verdict = resolveCreemOrderAmount(
        session({ expectedAmountUsd: 50 }),
        orderOf({ amountCents: 5000 }),
        'Basic',
      );
      expect(verdict.kind).toBe('accepted');
      if (verdict.kind !== 'accepted') return;
      expect(verdict.amountUsd).toBe(50);
      expect(verdict.unverifiedReason).toBeNull();
      expect(
        resolveCreemOrderAmount(
          session({ expectedAmountUsd: 50 }),
          orderOf({ amountCents: 4998 }),
          'Basic',
        ).kind,
      ).toBe('rejected');
    });

    it('never raises the floor above the tariff', () => {
      const verdict = resolveCreemOrderAmount(
        session({ expectedAmountUsd: 70 }),
        orderOf(),
        'Basic',
      );
      expect(verdict).toMatchObject({ kind: 'accepted', amountUsd: BASIC_PRICE });
    });

    it('falls back to the tariff when it is zero, negative or not a number', () => {
      for (const expectedAmountUsd of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
        const verdict = resolveCreemOrderAmount(
          session({ expectedAmountUsd }),
          orderOf({ amountCents: 5000 }),
          'Basic',
        );
        expect(verdict.kind, String(expectedAmountUsd)).toBe('rejected');
      }
    });
  });
});
