import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutSession, Prisma } from '@prisma/client';

import { createTestDb, seedAccountWithProfile, type TestDb } from '../../test-utils/test-db.ts';
import type { SeededAccount } from '../../test-utils/test-db.ts';
import { FASTSPRING_PROVIDER, type FastSpringCurrencyPolicy } from './config.ts';
import { normalizeEvent } from './events.ts';
import { resolveOrderAmount } from './order-amount.ts';
import {
  TEST_FASTSPRING_SECRET,
  orderCompletedData,
  returnCreatedData,
  signedDelivery,
  type OrderOptions,
} from './test-payloads.ts';
import { handleFastSpringWebhook, WEBHOOK_OUTCOMES } from './webhook-handler.ts';

// FASTSPRING-012: a discounted order may not buy a full plan.
//
// FastSpring reports `subtotal` as "Subtotal before discounts and tax", so it is
// the LIST price and not what anyone paid. A 50%-off coupon leaves it at $55
// while the card is charged $27.50, and any check that reads it — or that
// reconstructs the charge as max(subtotal, total) — hands over a $55 plan for
// $27.50 and records a $55 purchase, so the buyer's later full refund of $27.50
// looks partial and never suspends the entitlement.
//
// The deduction is `discount`, reported at order and at item level, and the
// order's own identity is total = subtotal - discount + tax on both pricing
// bases. Every case below is an order FastSpring has already charged, so the
// question is only which of them are worth the plan.
//
// Sources: developer.fastspring.com — "Successful Orders" (order.completed
// pricing fields: subtotal, discount, tax, total, and the same four per item)
// and "Gross and net pricing modes".

const BASIC_PRODUCT = 'fluxradar-basic-scan';
const BASIC_PRICE = 55;

describe('FASTSPRING-012 discounted orders', () => {
  let db: TestDb;
  let account: SeededAccount;

  beforeEach(async () => {
    db = await createTestDb();
    account = await seedAccountWithProfile(db.prisma);
  });

  afterEach(async () => {
    await db.cleanup();
  });

  async function seedCheckoutSession(
    overrides: Partial<Prisma.CheckoutSessionUncheckedCreateInput> = {},
  ): Promise<CheckoutSession> {
    return db.prisma.checkoutSession.create({
      data: {
        provider: FASTSPRING_PROVIDER,
        reference: `frcs_${Math.random().toString(36).slice(2)}`,
        accountId: account.accountId,
        siteProfileId: account.siteProfileId,
        plan: 'Basic',
        productPath: BASIC_PRODUCT,
        expectedAmountUsd: BASIC_PRICE,
        quotedAmount: BASIC_PRICE,
        quotedCurrency: 'USD',
        liveMode: false,
        scopeJson: JSON.stringify({ includeSubdomains: false }),
        ...overrides,
      },
    });
  }

  const deliver = (
    rawBody: string,
    signature: string,
    currencyPolicy: FastSpringCurrencyPolicy = 'strict',
  ) =>
    handleFastSpringWebhook(db.prisma, rawBody, signature, {
      secret: TEST_FASTSPRING_SECRET,
      expectLive: false,
      currencyPolicy,
    });

  function paidOrder(reference: string, options: Partial<OrderOptions> = {}) {
    return signedDelivery([
      {
        id: `evt_${Math.random().toString(36).slice(2)}`,
        type: 'order.completed',
        data: orderCompletedData({
          orderId: `ord_${Math.random().toString(36).slice(2)}`,
          reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
          ...options,
        }),
      },
    ]);
  }

  it('refuses a half-price coupon order that lists the full plan price', async () => {
    const session = await seedCheckoutSession();
    // subtotal 55 (the list price), discount 27.50, total 27.50 charged.
    const { rawBody, signature } = paidOrder(session.reference, { discount: 27.5 });

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toMatch(/below the 55 USD Basic plan price/);
    expect(result.results[0]?.reason).toMatch(/27\.5 USD discount/);
    expect(await db.prisma.purchase.count()).toBe(0);
    expect(await db.prisma.scan.count()).toBe(0);
    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.status).toBe('rejected');
  });

  // A 100% coupon is the same failure with nothing left to hide behind: the card
  // is charged zero and the list price is still $55.
  it('refuses a fully discounted order that charged nothing', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, { discount: BASIC_PRICE });

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toMatch(/0 USD after a 55 USD discount/);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  // The one case the charged figure gets wrong on its own: in a net-priced store
  // the tax is added AFTER the deduction, so a large enough VAT lifts a
  // discounted order back over the tariff while the seller was paid $45.
  it('refuses a discounted order whose tax alone lifts the charge over the tariff', async () => {
    const session = await seedCheckoutSession();
    // subtotal 55, discount 10, tax 11.25 on the remaining 45 -> total 56.25.
    const { rawBody, signature } = paidOrder(session.reference, { discount: 10, tax: 11.25 });

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toMatch(/45 USD after a 10 USD discount/);
    expect(result.results[0]?.reason).toMatch(/below the 55 USD Basic plan price/);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  // A discount is not automatically a shortfall. A catalogue entry above the
  // tariff, discounted down to something still worth the plan, is a paid order.
  it('grants a discounted order that still covers the plan price, and records it', async () => {
    const session = await seedCheckoutSession({ quotedAmount: 80 });
    const { rawBody, signature } = paidOrder(session.reference, { amount: 80, discount: 20 });

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.results[0]?.reason).toMatch(/still covers the 55 USD Basic plan price/);
    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { scan: true } });
    // What the buyer actually paid, never the list price the discount came off.
    expect(purchase.amountUsd).toBeCloseTo(60, 2);
    expect(purchase.scan).not.toBeNull();
  });

  // Localised and discounted: the remainder has to be expressible in USD before
  // it can be compared with anything. "Unverified" is a grant, and granting a
  // discounted order nobody can measure is exactly where a shortfall hides.
  it('refuses a discounted order that carries no USD payout figure', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, {
      currency: 'JPY',
      amount: 8200,
      discount: 4100,
    });

    const result = await deliver(rawBody, signature, 'localized');

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toMatch(/no USD payout figure/);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  it('refuses a localised discounted order whose USD remainder is below the plan price', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, {
      currency: 'EUR',
      amount: 50,
      discount: 25,
      payoutCurrency: 'USD',
      subtotalInPayoutCurrency: 54,
      discountInPayoutCurrency: 27,
      amountInPayoutCurrency: 27,
    });

    const result = await deliver(rawBody, signature, 'localized');

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toMatch(/27 USD after a 25 EUR discount/);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  it('grants a localised discounted order whose USD remainder still covers the plan', async () => {
    const session = await seedCheckoutSession({ quotedAmount: 90, quotedCurrency: 'EUR' });
    const { rawBody, signature } = paidOrder(session.reference, {
      currency: 'EUR',
      amount: 90,
      discount: 20,
      payoutCurrency: 'USD',
      subtotalInPayoutCurrency: 97,
      discountInPayoutCurrency: 21.5,
      amountInPayoutCurrency: 75.5,
    });

    const result = await deliver(rawBody, signature, 'localized');

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    const purchase = await db.prisma.purchase.findFirstOrThrow();
    expect(purchase.amountUsd).toBeCloseTo(75.5, 2);
    expect(purchase.settledAmount).toBeCloseTo(70, 2);
    expect(purchase.settledCurrency).toBe('EUR');
  });

  // Honest orders in both pricing modes still go through untouched — the point
  // of reading `discount` rather than widening a tolerance.
  it('still grants an undiscounted tax-inclusive order', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, { tax: 5.3, taxIncluded: true });

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.results[0]?.reason).toBeNull();
    const purchase = await db.prisma.purchase.findFirstOrThrow();
    expect(purchase.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
  });

  it('still grants an undiscounted tax-exclusive order', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, { tax: 5.5 });

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.results[0]?.reason).toBeNull();
    const purchase = await db.prisma.purchase.findFirstOrThrow();
    expect(purchase.amountUsd).toBeCloseTo(60.5, 2);
  });

  it('refuses an order charged for an amount the quote cannot explain', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, { amount: 40 });

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toMatch(/does not match the quoted 55/);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  // The purchase records what was charged, so a return is measured against the
  // same figure. A net-priced store's tax refund is a fraction of the charge and
  // must not read as a full refund.
  it('treats a tax-only return on a tax-exclusive order as partial', async () => {
    const session = await seedCheckoutSession();
    const paid = paidOrder(session.reference, { tax: 5.5 });
    await deliver(paid.rawBody, paid.signature);
    const purchase = await db.prisma.purchase.findFirstOrThrow();

    const refund = signedDelivery([
      {
        id: 'evt_return_tax_only',
        type: 'return.created',
        data: returnCreatedData(purchase.providerTransactionId, 5.5),
      },
    ]);
    const result = await deliver(refund.rawBody, refund.signature);

    expect(result.results[0]?.reason).toMatch(/partial return recorded/);
    const after = await db.prisma.purchase.findUniqueOrThrow({
      where: { id: purchase.id },
      include: { entitlement: true },
    });
    expect(after.status).toBe('paid');
    expect(after.entitlement?.suspended).toBe(false);
  });

  it('suspends the entitlement when the whole tax-inclusive charge comes back', async () => {
    const session = await seedCheckoutSession();
    const paid = paidOrder(session.reference, { tax: 5.5 });
    await deliver(paid.rawBody, paid.signature);
    const purchase = await db.prisma.purchase.findFirstOrThrow();

    const refund = signedDelivery([
      {
        id: 'evt_return_full_with_tax',
        type: 'return.created',
        data: returnCreatedData(purchase.providerTransactionId, 60.5),
      },
    ]);
    await deliver(refund.rawBody, refund.signature);

    const after = await db.prisma.purchase.findUniqueOrThrow({
      where: { id: purchase.id },
      include: { entitlement: true },
    });
    expect(after.status).toBe('Refunded');
    expect(after.entitlement?.suspended).toBe(true);
  });

  // Which side of the payload states the deduction is a store setting, so no
  // single field may be the only thing standing between a coupon and a plan.
  describe('wherever the payload states the deduction', () => {
    let session: CheckoutSession;

    beforeEach(async () => {
      session = await seedCheckoutSession();
    });

    function verdictFor(options: Partial<OrderOptions>) {
      const raw = {
        id: 'evt_discount_shape',
        type: 'order.completed',
        data: orderCompletedData({
          orderId: 'ord_discount_shape',
          reference: session.reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
          discount: 27.5,
          ...options,
        }),
      };
      const normalized = normalizeEvent(raw);
      if (!normalized.ok) {
        throw new Error(`fixture did not normalise: ${normalized.reason}`);
      }
      const event = normalized.event;
      if (event.kind !== 'order.completed') {
        throw new Error('fixture is not an order.completed event');
      }
      const item = event.items[0];
      if (item === undefined) {
        throw new Error('fixture has no order item');
      }
      return resolveOrderAmount(session, event, item, 'strict', 'Basic');
    }

    it('refuses it when only the order states it', () => {
      expect(verdictFor({ discountReporting: 'order' })).toMatchObject({ kind: 'rejected' });
    });

    it('refuses it when only the item states it', () => {
      expect(verdictFor({ discountReporting: 'item' })).toMatchObject({ kind: 'rejected' });
    });

    // A store that reports no discount field at all still cannot hide it: the
    // order's own total = subtotal - discount + tax is short by the deduction.
    it('refuses it when no field states it and only the arithmetic does', () => {
      expect(verdictFor({ discountReporting: 'none' })).toMatchObject({ kind: 'rejected' });
    });

    // With no order-level subtotal there is no arithmetic to derive from, so the
    // item's own discount is the only thing left to read.
    it('refuses it when the item alone carries both the list price and the discount', () => {
      expect(verdictFor({ discountReporting: 'item', omitOrderSubtotal: true })).toMatchObject({
        kind: 'rejected',
      });
    });
  });
});
