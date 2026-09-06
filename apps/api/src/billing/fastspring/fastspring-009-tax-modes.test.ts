import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutSession, Prisma } from '@prisma/client';

import { createTestDb, seedAccountWithProfile, type TestDb } from '../../test-utils/test-db.ts';
import type { SeededAccount } from '../../test-utils/test-db.ts';
import { FASTSPRING_PROVIDER, type FastSpringCurrencyPolicy } from './config.ts';
import { TEST_FASTSPRING_SECRET, orderCompletedData, signedDelivery } from './test-payloads.ts';
import { handleFastSpringWebhook, WEBHOOK_OUTCOMES } from './webhook-handler.ts';

// FASTSPRING-009: a paid order must survive the store's tax mode.
//
// FastSpring reports `subtotal` before tax and `total` as what the buyer was
// charged, and which of the two the catalogue price is depends on a store-level
// setting we cannot read from a webhook: a gross-priced store folds the tax into
// the price ($55 charged = $49.70 + $5.30 tax), a net-priced one adds it on top
// ($55 + $5.50 = $60.50 charged). Comparing a quote against the wrong basis
// refuses a buyer who paid in full — the failure this file exists to prevent —
// while comparing nothing at all would let a discounted order through.
//
// Sources: developer.fastspring.com, "Successful Orders" (order.completed) and
// "Gross and net pricing modes".

const BASIC_PRODUCT = 'fluxradar-basic-scan';
const BASIC_PRICE = 55;

describe('FASTSPRING-009 tax-inclusive and tax-exclusive stores', () => {
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

  function paidOrder(
    reference: string,
    options: Partial<Parameters<typeof orderCompletedData>[0]> = {},
  ) {
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

  // A gross-priced store charges the quoted $55 and reports $49.70 before tax.
  // Reading that subtotal as "what was paid" refuses an order the buyer settled
  // in full, and leaves a real charge with no scan behind it.
  it('grants a tax-inclusive order whose subtotal is below the quote', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, {
      tax: 5.3,
      taxIncluded: true,
    });

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.results[0]?.reason).toBeNull();
    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { scan: true } });
    // The purchase records what the buyer was charged, tax included.
    expect(purchase.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
    expect(purchase.scan).not.toBeNull();
  });

  // A net-priced store charges $60.50 for the same $55 plan. The extra is tax,
  // not a catalogue that disagrees with the tariff, so it must not be reported
  // as a mismatch on every single order.
  it('grants a tax-exclusive order charged above the quote without flagging the catalogue', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, { tax: 5.5 });

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.results[0]?.reason).toBeNull();
    const purchase = await db.prisma.purchase.findFirstOrThrow();
    expect(purchase.amountUsd).toBeCloseTo(60.5, 2);
    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.status).toBe('completed');
    expect(stored.statusReason).toBeNull();
  });

  // Tax tolerance is not a hole: the band is the order's own
  // [before tax, charged] range, and a half-price order is outside it whichever
  // basis the store prices on.
  it('still refuses a discounted order in a tax-inclusive store', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, {
      amount: 27.5,
      tax: 2.65,
      taxIncluded: true,
    });

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toMatch(/does not match the quoted 55/);
    expect(await db.prisma.purchase.count()).toBe(0);
    expect(await db.prisma.scan.count()).toBe(0);
  });

  // A mispriced catalogue entry charged in full: the quote matches the order on
  // both tax bases, so only the tariff can refuse it — and it does, measured
  // against what the buyer was charged rather than the smaller pre-tax figure.
  it('refuses a tax-inclusive order that matches a quote below the plan price', async () => {
    const session = await seedCheckoutSession({ quotedAmount: 30 });
    const { rawBody, signature } = paidOrder(session.reference, {
      amount: 30,
      tax: 2.9,
      taxIncluded: true,
    });

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toMatch(/below the 55 USD Basic plan price/);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  // A localised gross-priced order: the buyer paid €55 with the VAT inside, and
  // FastSpring reports both figures converted into its USD payout.
  it('grants a localised tax-inclusive order using the charged payout figure', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, {
      currency: 'EUR',
      amount: 55,
      tax: 8.78,
      taxIncluded: true,
      payoutCurrency: 'USD',
      amountInPayoutCurrency: 59.4,
      subtotalInPayoutCurrency: 49.92,
    });

    const result = await deliver(rawBody, signature, 'localized');

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.results[0]?.reason).toBeNull();
    const purchase = await db.prisma.purchase.findFirstOrThrow();
    expect(purchase.amountUsd).toBeCloseTo(59.4, 2);
    // What the buyer was charged, tax included, in their own currency.
    expect(purchase.settledAmount).toBeCloseTo(55, 2);
    expect(purchase.settledCurrency).toBe('EUR');
  });

  // A catalogue entry priced above the tariff is still reported — measured
  // before tax, so a taxed order cannot be mistaken for one.
  it('reports a catalogue price above the tariff even in a taxed order', async () => {
    const session = await seedCheckoutSession({ quotedAmount: 75, expectedAmountUsd: BASIC_PRICE });
    const { rawBody, signature } = paidOrder(session.reference, { amount: 75, tax: 7.5 });

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.results[0]?.reason).toMatch(/above the 55 USD Basic plan price/);
  });
});
