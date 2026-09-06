import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutSession, Prisma } from '@prisma/client';

import { createTestDb, seedAccountWithProfile, type TestDb } from '../../test-utils/test-db.ts';
import type { SeededAccount } from '../../test-utils/test-db.ts';
import { FASTSPRING_PROVIDER } from './config.ts';
import {
  CONVERTIBLE_PAYOUT_CURRENCY,
  FULL_REFUND_RATIO,
  cumulativeRefund,
  resolveReturnLine,
} from './refund-amounts.ts';
import { FASTSPRING_EVENT_TYPES } from './events.ts';
import {
  TEST_FASTSPRING_SECRET,
  orderCompletedData,
  returnCreatedData,
  signedDelivery,
} from './test-payloads.ts';
import { handleFastSpringWebhook, WEBHOOK_OUTCOMES } from './webhook-handler.ts';

// FASTSPRING-016: a return.created that cannot be measured.
//
// Every branch below is a payload the refund arithmetic cannot read as a figure
// on the purchase's charged basis. The two failure directions are not comparable:
// counting too much suspends a report an operator can restore, counting too
// little leaves a buyer reading a report whose money is already back. So an
// unmeasurable return is counted as the WHOLE charge, and the line records why.
//
// These are the branches nothing else exercises — the suite's other refund files
// all state a well-formed amount and currency — and they are the ones a future
// change is most likely to "simplify" into a silent zero.

const BASIC_PRODUCT = 'fluxradar-basic-scan';
const BASIC_PRICE = 55;

/** The same payload minus one field, as a store that does not send it would. */
function without(data: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([name]) => name !== key));
}

describe('FASTSPRING-016 unmeasurable returns fail closed', () => {
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

  const deliver = (rawBody: string, signature: string) =>
    handleFastSpringWebhook(db.prisma, rawBody, signature, {
      secret: TEST_FASTSPRING_SECRET,
      expectLive: false,
      currencyPolicy: 'localized',
    });

  /** Pays for a Basic scan and answers with the order id the return refers to. */
  async function payFor(
    orderId: string,
    options: Partial<Parameters<typeof orderCompletedData>[0]> = {},
  ): Promise<void> {
    const session = await seedCheckoutSession(
      options.currency === undefined || options.currency === 'USD'
        ? {}
        : { quotedCurrency: options.currency, quotedAmount: options.amount ?? BASIC_PRICE },
    );
    const paid = signedDelivery([
      {
        id: `evt_order_${orderId}`,
        type: 'order.completed',
        data: orderCompletedData({
          orderId,
          reference: session.reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
          ...options,
        }),
      },
    ]);
    const result = await deliver(paid.rawBody, paid.signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
  }

  function returnDelivery(eventId: string, data: Record<string, unknown>) {
    return signedDelivery([{ id: eventId, type: 'return.created', data }]);
  }

  // Branch 1: `totalReturn === null`. FastSpring states the amount on every real
  // return, so a payload without one is a shape we do not understand — and a
  // return we cannot size is not a return we may treat as small.
  it('counts a return that states no amount as the whole charge', async () => {
    await payFor('ord_no_amount');
    const { rawBody, signature } = returnDelivery(
      'evt_no_amount',
      without(returnCreatedData('ord_no_amount', BASIC_PRICE), 'totalReturn'),
    );

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    const purchase = await db.prisma.purchase.findFirstOrThrow({
      include: { entitlement: true, refund: true },
    });
    expect(purchase.status).toBe('Refunded');
    expect(purchase.entitlement?.suspended).toBe(true);
    expect(purchase.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
    const line = await db.prisma.providerRefund.findFirstOrThrow();
    expect(line.amountCharged).toBeCloseTo(BASIC_PRICE, 2);
    expect(line.reason).toMatch(/states no amount, so it returns the whole charge/);
  });

  // Branch 2: `currency === null`. The amount is readable, so the return is NOT
  // counted as the whole charge — it is read on the only basis it can plausibly
  // be quoted in, the currency the buyer was actually charged, and the line says
  // that is an assumption. Reading it as USD instead would size a €24.75 return
  // against a €49.50 charge as a 45% one against the $55 USD figure.
  it('reads a return that states no currency as the charged currency', async () => {
    await payFor('ord_no_currency', {
      currency: 'EUR',
      amount: 49.5,
      payoutCurrency: 'EUR',
      amountInPayoutCurrency: 49.5,
    });
    const { rawBody, signature } = returnDelivery(
      'evt_no_currency',
      without(returnCreatedData('ord_no_currency', 24.75, 'EUR'), 'currency'),
    );

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.results[0]?.reason).toMatch(/partial return recorded/);
    const line = await db.prisma.providerRefund.findFirstOrThrow();
    expect(line.currency).toBe('EUR');
    expect(line.amountCharged).toBeCloseTo(24.75, 2);
    expect(line.reason).toMatch(/states no currency; read as EUR, the charged currency/);
    // Half the charge is back, so the report the other half paid for stays.
    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { entitlement: true } });
    expect(purchase.status).toBe('paid');
    expect(purchase.entitlement?.suspended).toBe(false);
  });

  // ...and the same assumption still suspends when what it reads covers the
  // whole charge, so "no currency" is never a way to keep a fully refunded report.
  it('suspends when a return with no stated currency covers the charge', async () => {
    await payFor('ord_no_currency_full', {
      currency: 'EUR',
      amount: 49.5,
      payoutCurrency: 'EUR',
      amountInPayoutCurrency: 49.5,
    });
    const { rawBody, signature } = returnDelivery(
      'evt_no_currency_full',
      without(returnCreatedData('ord_no_currency_full', 49.5, 'EUR'), 'currency'),
    );

    await deliver(rawBody, signature);

    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { entitlement: true } });
    expect(purchase.status).toBe('Refunded');
    expect(purchase.entitlement?.suspended).toBe(true);
  });

  // Branch 3: a currency the purchase was not charged in, with no USD figure to
  // convert it through. There is no rate anywhere in the payload, so the figure
  // cannot be placed on the charged basis at all.
  it('counts a return in a foreign currency it cannot convert as the whole charge', async () => {
    await payFor('ord_foreign_currency', {
      currency: 'EUR',
      amount: 49.5,
      payoutCurrency: 'USD',
      amountInPayoutCurrency: 53.2,
    });
    const { rawBody, signature } = returnDelivery(
      'evt_foreign_currency',
      // A GBP return against a EUR charge, quoting no payout figure at all.
      returnCreatedData('ord_foreign_currency', 10, 'GBP'),
    );

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    const line = await db.prisma.providerRefund.findFirstOrThrow();
    expect(line.currency).toBe('EUR');
    expect(line.amountCharged).toBeCloseTo(49.5, 2);
    expect(line.amountUsd).toBeCloseTo(53.2, 2);
    expect(line.reason).toMatch(
      /return quoted in GBP against a charge in EUR and the payload carries no USD figure/,
    );
    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { entitlement: true } });
    expect(purchase.status).toBe('Refunded');
    expect(purchase.entitlement?.suspended).toBe(true);
  });

  // The counterpart the three above are the fail-closed side of: a foreign
  // currency the payload DOES carry a USD figure for is converted and measured,
  // not written off as a full refund.
  it('still converts a foreign-currency return that states a USD figure', async () => {
    await payFor('ord_convertible', {
      currency: 'EUR',
      amount: 49.5,
      payoutCurrency: 'USD',
      amountInPayoutCurrency: 55,
    });
    const { rawBody, signature } = returnDelivery('evt_convertible', {
      ...returnCreatedData('ord_convertible', 11, 'GBP'),
      payoutCurrency: 'USD',
      totalReturnInPayoutCurrency: 13.75,
    });

    await deliver(rawBody, signature);

    const line = await db.prisma.providerRefund.findFirstOrThrow();
    // 13.75 of the order's 55 USD is a quarter, so a quarter of the EUR charge.
    expect(line.amountUsd).toBeCloseTo(13.75, 2);
    expect(line.amountCharged).toBeCloseTo(12.38, 2);
    expect(line.reason).toMatch(/converted through the order's 55 USD payout figure/);
    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { entitlement: true } });
    expect(purchase.entitlement?.suspended).toBe(false);
  });

  // The policy the branch above implements, stated as its own case: the payout
  // figure is only a rate when the store is paid out in USD. FluxRadar's tariff
  // and Purchase.amountUsd are USD, so a store paid out in EUR reports
  // `totalReturnInPayoutCurrency` in EUR — reading it as USD would be a silent
  // double-digit error in the share that decides whether a report stays readable,
  // and there is no other rate anywhere in the payload. Nothing here fetches one.
  it('refuses a payout figure that is not in the payout currency it can convert', async () => {
    expect(CONVERTIBLE_PAYOUT_CURRENCY).toBe('USD');
    await payFor('ord_eur_payout', {
      currency: 'EUR',
      amount: 49.5,
      payoutCurrency: 'EUR',
      amountInPayoutCurrency: 49.5,
    });
    const { rawBody, signature } = returnDelivery('evt_eur_payout', {
      // A small GBP return, quoted against a store that settles in EUR.
      ...returnCreatedData('ord_eur_payout', 5, 'GBP'),
      payoutCurrency: 'EUR',
      totalReturnInPayoutCurrency: 4.3,
    });

    await deliver(rawBody, signature);

    const line = await db.prisma.providerRefund.findFirstOrThrow();
    // Not 4.30 read as USD, and not 4.30 read as EUR either: unmeasurable.
    expect(line.amountCharged).toBeCloseTo(49.5, 2);
    expect(line.reason).toMatch(
      /return quoted in GBP against a charge in EUR and the payload carries no USD figure/,
    );
    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { entitlement: true } });
    expect(purchase.entitlement?.suspended).toBe(true);
  });

  // The full-refund threshold is a policy constant, not a tuning knob: it exists
  // because FastSpring's localised rounding and this arithmetic's own cent
  // rounding can leave a genuinely full refund a few cents short, and 1% of the
  // smallest plan is 55c — above any rounding, below any real partial refund.
  it('treats the documented full-refund ratio as the boundary it is', () => {
    const basis = { total: 55, currency: 'USD', totalUsd: 55 };
    const share = (amountCharged: number) =>
      cumulativeRefund({ amountCharged, amountUsd: amountCharged }, basis);

    expect(FULL_REFUND_RATIO).toBe(0.99);
    // A cent below the ratio is still a partial refund: access stays.
    expect(share(54.44).isFull).toBe(false);
    // Exactly the ratio, and anything above it, is the whole charge.
    expect(share(54.45).isFull).toBe(true);
    expect(share(55).isFull).toBe(true);
    // And a sum that overshoots — an over-counted fail-closed line — is capped.
    expect(share(200).share).toBe(1);
  });

  // Branch 4, which no delivery can reach because a zero-priced order is refused
  // long before a return could arrive for it: a purchase whose charged basis is
  // unusable leaves nothing to measure a share against, so any return against it
  // is the whole of it.
  it('counts any return against an unusable charged basis as the whole charge', () => {
    const line = resolveReturnLine(
      {
        kind: FASTSPRING_EVENT_TYPES.returnCreated,
        returnId: 'ret_zero',
        originalOrderId: 'ord_zero',
        currency: 'USD',
        totalReturn: 5,
        payoutCurrency: null,
        totalReturnInPayoutCurrency: null,
        reason: null,
      },
      { total: 0, currency: 'USD', totalUsd: 0 },
    );

    expect(line.amountCharged).toBe(0);
    expect(line.reason).toMatch(/records no usable charged amount to measure the return against/);
  });
});
