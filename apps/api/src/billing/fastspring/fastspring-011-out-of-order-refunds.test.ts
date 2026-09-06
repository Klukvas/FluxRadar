import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutSession, Prisma } from '@prisma/client';

import { createTestDb, seedAccountWithProfile, type TestDb } from '../../test-utils/test-db.ts';
import type { SeededAccount } from '../../test-utils/test-db.ts';
import { FASTSPRING_PROVIDER } from './config.ts';
import {
  TEST_FASTSPRING_SECRET,
  chargebackCreatedData,
  orderCompletedData,
  returnCreatedData,
  signedDelivery,
} from './test-payloads.ts';
import { handleFastSpringWebhook, WEBHOOK_OUTCOMES } from './webhook-handler.ts';

// FASTSPRING-011: a refund that overtakes the order it belongs to.
//
// FastSpring guarantees no delivery order, and a redelivery after an outage can
// hand us a whole backlog reordered. A return or chargeback that arrives before
// its order.completed has nothing to act on yet — but if it is answered 2xx and
// then forgotten, the money went back and the report stays readable. It is
// therefore stored as `unlinked` and replayed from its own recorded payload the
// moment its order shows up.

const BASIC_PRODUCT = 'fluxradar-basic-scan';
const BASIC_PRICE = 55;

describe('FASTSPRING-011 refunds delivered before their order', () => {
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
      currencyPolicy: 'strict',
    });

  const paidOrder = (reference: string, orderId: string, eventId: string) =>
    signedDelivery([
      {
        id: eventId,
        type: 'order.completed',
        data: orderCompletedData({
          orderId,
          reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
        }),
      },
    ]);

  it('applies a return that arrived before its order as soon as the order lands', async () => {
    const session = await seedCheckoutSession();
    const early = signedDelivery([
      {
        id: 'evt_early_return',
        type: 'return.created',
        data: returnCreatedData('ord_late', BASIC_PRICE),
      },
    ]);

    const first = await deliver(early.rawBody, early.signature);
    expect(first.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.unlinked);
    expect(await db.prisma.purchase.count()).toBe(0);

    const paid = paidOrder(session.reference, 'ord_late', 'evt_late_order');
    const second = await deliver(paid.rawBody, paid.signature);

    expect(second.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(second.results[0]?.reason).toMatch(/return\.created for this order was delivered before/);
    // The scan exists as the record of the purchase, but nothing may run or
    // announce it: the money is already on its way back.
    expect(second.results[0]?.scanId).toBeNull();
    expect(second.createdScanIds).toHaveLength(0);

    const purchase = await db.prisma.purchase.findFirstOrThrow({
      include: { entitlement: true, refund: true, scan: true },
    });
    expect(purchase.status).toBe('Refunded');
    expect(purchase.entitlement?.suspended).toBe(true);
    expect(purchase.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
    expect(purchase.scan).not.toBeNull();

    // The stored event leaves the pending state exactly once.
    const stored = await db.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_early_return' },
    });
    expect(stored.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(stored.outcomeReason).toMatch(/applied when order ord_late arrived/);
  });

  it('applies a chargeback that arrived before its order and suspends access', async () => {
    const session = await seedCheckoutSession();
    const early = signedDelivery([
      {
        id: 'evt_early_cb',
        type: 'chargeback.created',
        data: chargebackCreatedData('ord_cb_late', BASIC_PRICE),
      },
    ]);
    expect((await deliver(early.rawBody, early.signature)).results[0]?.outcome).toBe(
      WEBHOOK_OUTCOMES.unlinked,
    );

    const paid = paidOrder(session.reference, 'ord_cb_late', 'evt_cb_late_order');
    const second = await deliver(paid.rawBody, paid.signature);

    expect(second.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(second.createdScanIds).toHaveLength(0);
    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { entitlement: true } });
    expect(purchase.status).toBe('Disputed');
    expect(purchase.entitlement?.suspended).toBe(true);
  });

  it('replays the pending refund once, whatever else is redelivered afterwards', async () => {
    const session = await seedCheckoutSession();
    const early = signedDelivery([
      {
        id: 'evt_once_return',
        type: 'return.created',
        data: returnCreatedData('ord_once', BASIC_PRICE),
      },
    ]);
    await deliver(early.rawBody, early.signature);

    const paid = paidOrder(session.reference, 'ord_once', 'evt_once_order');
    await deliver(paid.rawBody, paid.signature);
    // FastSpring redelivers the same order under a new event id, and the buyer's
    // return arrives again for good measure.
    const paidAgain = paidOrder(session.reference, 'ord_once', 'evt_once_order_again');
    const redelivered = await deliver(paidAgain.rawBody, paidAgain.signature);
    const returnAgain = signedDelivery([
      {
        id: 'evt_once_return_again',
        type: 'return.created',
        data: returnCreatedData('ord_once', BASIC_PRICE),
      },
    ]);
    await deliver(returnAgain.rawBody, returnAgain.signature);

    expect(redelivered.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.deduplicated);
    expect(await db.prisma.purchase.count()).toBe(1);
    expect(await db.prisma.refundRecord.count()).toBe(1);
    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { entitlement: true } });
    expect(purchase.status).toBe('Refunded');
    expect(purchase.entitlement?.suspended).toBe(true);
  });

  // A return whose order never appears stays visible instead of disappearing
  // into a 200: an operator has to be able to find it.
  it('leaves an unmatched return pending and reports it as pending over HTTP', async () => {
    const orphan = signedDelivery([
      {
        id: 'evt_orphan_return',
        type: 'return.created',
        data: returnCreatedData('ord_never', BASIC_PRICE),
      },
    ]);

    const result = await deliver(orphan.rawBody, orphan.signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.unlinked);
    const stored = await db.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_orphan_return' },
    });
    expect(stored.outcome).toBe(WEBHOOK_OUTCOMES.unlinked);
    expect(stored.providerTransactionId).toBe('ord_never');
  });

  // Ordinary order: nothing pending, so the scan is released as before.
  it('releases the scan when no refund was waiting for the order', async () => {
    const session = await seedCheckoutSession();
    const paid = paidOrder(session.reference, 'ord_clean', 'evt_clean_order');

    const result = await deliver(paid.rawBody, paid.signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.createdScanIds).toHaveLength(1);
    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { entitlement: true } });
    expect(purchase.status).toBe('paid');
    expect(purchase.entitlement?.suspended).toBe(false);
  });
});
