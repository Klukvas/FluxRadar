import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutSession, Prisma } from '@prisma/client';

import { createTestDb, seedAccountWithProfile, type TestDb } from '../../test-utils/test-db.ts';
import type { SeededAccount } from '../../test-utils/test-db.ts';
import { FASTSPRING_PROVIDER, type FastSpringCurrencyPolicy } from './config.ts';
import {
  TEST_FASTSPRING_SECRET,
  orderCompletedData,
  returnCreatedData,
  signedDelivery,
} from './test-payloads.ts';
import { handleFastSpringWebhook, WEBHOOK_OUTCOMES } from './webhook-handler.ts';

// FASTSPRING-006: what happens to a buyer who has already been charged.
//
// Every case here starts from a real payment. The question is never "should this
// order exist" — FastSpring already took the money — but "does FluxRadar hand
// over what was paid for, or leave the buyer with a charge and nothing to show
// for it". Rejecting a paid order is reserved for the cases where granting would
// be worse: a foreign order, the wrong product, or an amount that proves the
// catalogue is misconfigured.

const BASIC_PRODUCT = 'fluxradar-basic-scan';
const BASIC_PRICE = 55;

describe('FASTSPRING-006 localised currency, mode and refunds', () => {
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
    currencyPolicy: FastSpringCurrencyPolicy = 'localized',
  ) =>
    handleFastSpringWebhook(db.prisma, rawBody, signature, {
      secret: TEST_FASTSPRING_SECRET,
      expectLive: false,
      currencyPolicy,
    });

  function paidOrder(
    reference: string,
    options: Partial<Parameters<typeof orderCompletedData>[0]> = {},
    eventOverrides: { readonly id?: string; readonly omitLive?: boolean } = {},
  ) {
    return signedDelivery([
      {
        id: eventOverrides.id ?? `evt_${Math.random().toString(36).slice(2)}`,
        type: 'order.completed',
        ...(eventOverrides.omitLive === true ? { omitLive: true } : {}),
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

  it('grants the scan for a localised charge and records what the buyer paid', async () => {
    const session = await seedCheckoutSession();
    // FastSpring quoted USD when the session was created, then charged the buyer
    // in EUR after they picked their country on the checkout page.
    const { rawBody, signature } = paidOrder(session.reference, {
      currency: 'EUR',
      amount: 49.5,
      payoutCurrency: 'USD',
      amountInPayoutCurrency: 53.2,
    });

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { scan: true } });
    expect(purchase.scan).not.toBeNull();
    // The USD figure the refund policy works in comes from FastSpring's payout,
    // and what the buyer actually paid is kept beside it.
    expect(purchase.amountUsd).toBeCloseTo(53.2, 2);
    expect(purchase.currency).toBe('USD');
    expect(purchase.settledAmount).toBeCloseTo(49.5, 2);
    expect(purchase.settledCurrency).toBe('EUR');
  });

  it('still grants the scan when the localised order carries no USD figure, and says so', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, {
      currency: 'JPY',
      amount: 8200,
    });

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.results[0]?.reason).toMatch(/not verified against the 55 USD Basic plan price/);
    const purchase = await db.prisma.purchase.findFirstOrThrow();
    expect(purchase.amountUsd).toBe(BASIC_PRICE);
    expect(purchase.settledCurrency).toBe('JPY');
    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(stored.status).toBe('completed');
    expect(stored.statusReason).toMatch(/not verified against the 55 USD Basic plan price/);
  });

  it('refuses a localised order that is worth far less than the plan price', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, {
      currency: 'EUR',
      amount: 4,
      payoutCurrency: 'USD',
      amountInPayoutCurrency: 4.3,
    });

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toMatch(/below the 55 USD Basic plan price/);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  it('keeps a single-currency store strict: a foreign currency is refused', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, {
      currency: 'EUR',
      amount: 49.5,
    });

    const result = await deliver(rawBody, signature, 'strict');

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toMatch(/single-currency/);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  it('still checks the amount exactly when the currency does match the quote', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, { amount: 5 });

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toMatch(/does not match the quoted/);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  // The quote comes out of the FastSpring catalogue, so it cannot be the price:
  // a product entry mispriced at $5 produces a $5 quote, a $5 charge, and a
  // quote-versus-charge comparison that matches perfectly. The plan price this
  // repository owns is what decides.
  it('refuses an order that matches a catalogue quote below the plan price', async () => {
    const session = await seedCheckoutSession({ quotedAmount: 5 });
    const { rawBody, signature } = paidOrder(session.reference, { amount: 5 });

    const result = await deliver(rawBody, signature, 'strict');

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toMatch(/below the 55 USD Basic plan price/);
    expect(await db.prisma.purchase.count()).toBe(0);
    expect(await db.prisma.scan.count()).toBe(0);
    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.status).toBe('rejected');
    expect(stored.purchaseId).toBeNull();
  });

  // The other direction is not a security problem but a bookkeeping one: the
  // buyer paid more than the tariff, keeps what they paid for, and an operator
  // has to learn that the catalogue and the tariff disagree.
  it('grants an order priced above the plan price and records the mismatch', async () => {
    const session = await seedCheckoutSession({ quotedAmount: 75 });
    const { rawBody, signature } = paidOrder(session.reference, { amount: 75 });

    const result = await deliver(rawBody, signature, 'strict');

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.results[0]?.reason).toMatch(/above the 55 USD Basic plan price/);
    const purchase = await db.prisma.purchase.findFirstOrThrow();
    expect(purchase.amountUsd).toBeCloseTo(75, 2);
  });

  // A single-currency store that does not price in USD: the charge matches the
  // quote exactly, and nothing in the payload expresses it in USD. It is granted
  // — the buyer paid — but never silently: the reason is stored on the event and
  // on the session for reconciliation.
  it('flags a same-currency order it cannot express in USD', async () => {
    const session = await seedCheckoutSession({ quotedCurrency: 'EUR', quotedAmount: 49 });
    const { rawBody, signature } = paidOrder(session.reference, { currency: 'EUR', amount: 49 });

    const result = await deliver(rawBody, signature, 'strict');

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.results[0]?.reason).toMatch(/not verified against the 55 USD Basic plan price/);
    const purchase = await db.prisma.purchase.findFirstOrThrow();
    expect(purchase.amountUsd).toBe(BASIC_PRICE);
    expect(purchase.settledAmount).toBeCloseTo(49, 2);
    expect(purchase.settledCurrency).toBe('EUR');
    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.statusReason).toMatch(/not verified against/);
  });

  it('grants an order that states no mode, using the mode the session was opened in', async () => {
    const session = await seedCheckoutSession({ liveMode: false });
    const { rawBody, signature } = paidOrder(
      session.reference,
      { omitLive: true },
      { omitLive: true },
    );

    const result = await deliver(rawBody, signature);

    // Treating a missing flag as "test mode" would drop this paid order silently.
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(await db.prisma.purchase.count()).toBe(1);
  });

  it('refuses an order with no mode whose session belongs to the other mode', async () => {
    const session = await seedCheckoutSession({ liveMode: true });
    const { rawBody, signature } = paidOrder(
      session.reference,
      { omitLive: true },
      { omitLive: true },
    );

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toMatch(/other FastSpring mode/);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  it('suspends the entitlement when a full return arrives', async () => {
    const session = await seedCheckoutSession();
    const paid = paidOrder(session.reference);
    await deliver(paid.rawBody, paid.signature);
    const purchase = await db.prisma.purchase.findFirstOrThrow();

    const refund = signedDelivery([
      {
        id: 'evt_return_full',
        type: 'return.created',
        data: returnCreatedData(purchase.providerTransactionId, BASIC_PRICE),
      },
    ]);
    const result = await deliver(refund.rawBody, refund.signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    const after = await db.prisma.purchase.findUniqueOrThrow({
      where: { id: purchase.id },
      include: { entitlement: true, refund: true },
    });
    expect(after.status).toBe('Refunded');
    // Money returned means access returned: the report must stop being readable.
    expect(after.entitlement?.suspended).toBe(true);
    expect(after.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
  });

  it('records a partial return without revoking the access that was paid for', async () => {
    const session = await seedCheckoutSession();
    const paid = paidOrder(session.reference);
    await deliver(paid.rawBody, paid.signature);
    const purchase = await db.prisma.purchase.findFirstOrThrow();

    const refund = signedDelivery([
      {
        id: 'evt_return_partial',
        type: 'return.created',
        data: returnCreatedData(purchase.providerTransactionId, BASIC_PRICE / 2),
      },
    ]);
    const result = await deliver(refund.rawBody, refund.signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    const after = await db.prisma.purchase.findUniqueOrThrow({
      where: { id: purchase.id },
      include: { entitlement: true, refund: true },
    });
    expect(after.status).toBe('paid');
    expect(after.entitlement?.suspended).toBe(false);
    expect(after.refund?.amountUsd).toBeCloseTo(BASIC_PRICE / 2, 2);
  });

  it('converts a return quoted in the buyer currency into the USD refund figure', async () => {
    const session = await seedCheckoutSession();
    const paid = paidOrder(session.reference, {
      currency: 'EUR',
      amount: 49.5,
      payoutCurrency: 'USD',
      amountInPayoutCurrency: 53.2,
    });
    await deliver(paid.rawBody, paid.signature);
    const purchase = await db.prisma.purchase.findFirstOrThrow();

    const refund = signedDelivery([
      {
        id: 'evt_return_eur',
        type: 'return.created',
        data: returnCreatedData(purchase.providerTransactionId, 49.5, 'EUR'),
      },
    ]);
    await deliver(refund.rawBody, refund.signature);

    const record = await db.prisma.refundRecord.findFirstOrThrow();
    // The EUR return covers the whole EUR charge, so the USD refund is the whole
    // USD purchase — never the raw 49.5 read as if it were dollars.
    expect(record.amountUsd).toBeCloseTo(53.2, 2);
    expect(record.currency).toBe('USD');
  });
});
