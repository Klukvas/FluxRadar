import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutSession, Prisma } from '@prisma/client';

import { createTestDb, seedAccountWithProfile, type TestDb } from '../../test-utils/test-db.ts';
import type { SeededAccount } from '../../test-utils/test-db.ts';
import { FASTSPRING_PROVIDER } from './config.ts';
import { WEBHOOK_OUTCOMES } from './outcomes.ts';
import { reconcilePendingRefunds } from './pending-refund-reconciliation.ts';
import {
  TEST_FASTSPRING_SECRET,
  chargebackCreatedData,
  orderCompletedData,
  returnCreatedData,
  signedDelivery,
} from './test-payloads.ts';
import { handleFastSpringWebhook } from './webhook-handler.ts';

// FASTSPRING-015: a pending refund that the grant transaction could not see.
//
// The replay in `pending-refunds.ts` runs inside the order.completed transaction,
// which only reaches rows that were already committed when it read them. A
// `return.created` whose own transaction started before the purchase existed and
// committed after that read is invisible to both sides: it found no purchase to
// lock and stayed `unlinked`, the grant found no pending row and released the
// scan. Same end state as a row written by a release that had no replay at all.
//
// Everything below starts from that end state — a granted, unsuspended purchase
// with an `unlinked` refund still sitting against its order id — and asserts that
// the two mechanisms that exist to notice it do: a later redelivery of the order,
// and the reconciliation sweep.

const BASIC_PRODUCT = 'fluxradar-basic-scan';
const BASIC_PRICE = 55;
const HALF_PRICE = 27.5;

describe('FASTSPRING-015 pending refund reconciliation', () => {
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

  /** Pays for a Basic scan, so the order exists and its entitlement is live. */
  async function payFor(orderId: string): Promise<void> {
    const session = await seedCheckoutSession();
    const paid = paidOrder(session.reference, orderId, `evt_order_${orderId}`);
    const result = await deliver(paid.rawBody, paid.signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.createdScanIds).toHaveLength(1);
  }

  /**
   * The row the lost race leaves behind: the return's own signed payload, stored
   * as `unlinked` against an order that (by the time it committed) already had a
   * purchase. Writing it directly is the only way to reproduce an interleaving
   * two transactions cannot be forced into from the outside.
   */
  async function storePendingEvent(
    eventId: string,
    eventType: string,
    orderId: string,
    data: Record<string, unknown>,
    processedAt?: Date,
  ): Promise<void> {
    const { rawBody, signature } = signedDelivery([{ id: eventId, type: eventType, data }]);
    await db.prisma.webhookEvent.create({
      data: {
        provider: FASTSPRING_PROVIDER,
        providerEventId: eventId,
        providerTransactionId: orderId,
        eventType,
        outcome: WEBHOOK_OUTCOMES.unlinked,
        outcomeReason: 'no purchase for this order yet',
        rawBody,
        signature,
        ...(processedAt === undefined ? {} : { processedAt }),
      },
    });
  }

  it('applies a refund the grant transaction could not see', async () => {
    await payFor('ord_raced');
    await storePendingEvent(
      'evt_raced_return',
      'return.created',
      'ord_raced',
      returnCreatedData('ord_raced', BASIC_PRICE),
    );
    // Nothing in the delivery path will look at that row again.
    const before = await db.prisma.purchase.findFirstOrThrow({ include: { entitlement: true } });
    expect(before.status).toBe('paid');
    expect(before.entitlement?.suspended).toBe(false);

    const swept = await reconcilePendingRefunds(db.prisma, new Date());

    expect(swept).toEqual({
      pendingRowCount: 1,
      matchedOrderCount: 1,
      appliedEventCount: 1,
      failedOrderCount: 0,
      batchLimitReached: false,
    });
    const purchase = await db.prisma.purchase.findFirstOrThrow({
      include: { entitlement: true, refund: true },
    });
    expect(purchase.status).toBe('Refunded');
    expect(purchase.entitlement?.suspended).toBe(true);
    expect(purchase.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
    const stored = await db.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_raced_return' },
    });
    expect(stored.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(stored.outcomeReason).toMatch(/pending-refund sweep/);
    expect(stored.accountId).toBe(account.accountId);
  });

  it('applies a chargeback the grant transaction could not see', async () => {
    await payFor('ord_raced_cb');
    await storePendingEvent(
      'evt_raced_cb',
      'chargeback.created',
      'ord_raced_cb',
      chargebackCreatedData('ord_raced_cb', BASIC_PRICE),
    );

    const swept = await reconcilePendingRefunds(db.prisma, new Date());

    expect(swept.appliedEventCount).toBe(1);
    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { entitlement: true } });
    expect(purchase.status).toBe('Disputed');
    expect(purchase.entitlement?.suspended).toBe(true);
  });

  it('counts a swept refund once however often the sweep runs', async () => {
    await payFor('ord_swept_twice');
    await storePendingEvent(
      'evt_swept_twice',
      'return.created',
      'ord_swept_twice',
      returnCreatedData('ord_swept_twice', BASIC_PRICE),
    );

    const first = await reconcilePendingRefunds(db.prisma, new Date());
    const second = await reconcilePendingRefunds(db.prisma, new Date());

    expect(first.appliedEventCount).toBe(1);
    // The row is no longer pending, so the second pass has nothing to look at.
    expect(second).toEqual({
      pendingRowCount: 0,
      matchedOrderCount: 0,
      appliedEventCount: 0,
      failedOrderCount: 0,
      batchLimitReached: false,
    });
    expect(await db.prisma.providerRefund.count()).toBe(1);
    expect(await db.prisma.refundRecord.count()).toBe(1);
    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { refund: true } });
    expect(purchase.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
  });

  // The sweep decides on everything returned so far, exactly as the delivery path
  // does: half the charge back is still half the charge back.
  it('leaves access in place for a swept partial return', async () => {
    await payFor('ord_swept_partial');
    await storePendingEvent(
      'evt_swept_partial',
      'return.created',
      'ord_swept_partial',
      returnCreatedData('ord_swept_partial', HALF_PRICE),
    );

    await reconcilePendingRefunds(db.prisma, new Date());

    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { entitlement: true } });
    expect(purchase.status).toBe('paid');
    expect(purchase.entitlement?.suspended).toBe(false);
    const line = await db.prisma.providerRefund.findFirstOrThrow();
    expect(line.amountCharged).toBeCloseTo(HALF_PRICE, 2);
  });

  it('leaves a pending refund whose order still has no purchase alone', async () => {
    await storePendingEvent(
      'evt_still_orphan',
      'return.created',
      'ord_never_paid',
      returnCreatedData('ord_never_paid', BASIC_PRICE),
    );

    const swept = await reconcilePendingRefunds(db.prisma, new Date());

    expect(swept).toEqual({
      pendingRowCount: 1,
      matchedOrderCount: 0,
      appliedEventCount: 0,
      failedOrderCount: 0,
      batchLimitReached: false,
    });
    const stored = await db.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_still_orphan' },
    });
    expect(stored.outcome).toBe(WEBHOOK_OUTCOMES.unlinked);
  });

  // An order id is only an order id together with its provider, so a legacy
  // transaction id that happens to match must not be taken for the purchase.
  it('does not match a pending FastSpring refund to another provider purchase', async () => {
    await db.prisma.purchase.create({
      data: {
        accountId: account.accountId,
        siteProfileId: account.siteProfileId,
        plan: 'Basic',
        provider: 'paddle',
        providerTransactionId: 'ord_shared_id',
        amountUsd: BASIC_PRICE,
        currency: 'USD',
      },
    });
    await storePendingEvent(
      'evt_foreign_provider',
      'return.created',
      'ord_shared_id',
      returnCreatedData('ord_shared_id', BASIC_PRICE),
    );

    const swept = await reconcilePendingRefunds(db.prisma, new Date());

    expect(swept.matchedOrderCount).toBe(0);
    expect(await db.prisma.providerRefund.count()).toBe(0);
    const purchase = await db.prisma.purchase.findFirstOrThrow();
    expect(purchase.status).toBe('paid');
  });

  // A row this release cannot re-read must not take the rest of the batch with it.
  it('keeps sweeping past a stored payload it cannot replay', async () => {
    await payFor('ord_unreadable');
    await payFor('ord_readable');
    await db.prisma.webhookEvent.create({
      data: {
        provider: FASTSPRING_PROVIDER,
        providerEventId: 'evt_unreadable',
        providerTransactionId: 'ord_unreadable',
        eventType: 'return.created',
        outcome: WEBHOOK_OUTCOMES.unlinked,
        rawBody: 'not json at all',
        signature: 'irrelevant',
      },
    });
    await storePendingEvent(
      'evt_readable_return',
      'return.created',
      'ord_readable',
      returnCreatedData('ord_readable', BASIC_PRICE),
    );

    const swept = await reconcilePendingRefunds(db.prisma, new Date());

    expect(swept.appliedEventCount).toBe(1);
    expect(swept.failedOrderCount).toBe(0);
    const readable = await db.prisma.purchase.findFirstOrThrow({
      where: { providerTransactionId: 'ord_readable' },
      include: { entitlement: true },
    });
    expect(readable.entitlement?.suspended).toBe(true);
    // The unreadable one stays pending and visible instead of being marked done.
    const stuck = await db.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_unreadable' },
    });
    expect(stuck.outcome).toBe(WEBHOOK_OUTCOMES.unlinked);
    const untouched = await db.prisma.purchase.findFirstOrThrow({
      where: { providerTransactionId: 'ord_unreadable' },
      include: { entitlement: true },
    });
    expect(untouched.entitlement?.suspended).toBe(false);
  });

  // The sweep is the backstop; a redelivery of the order is the fast path, and
  // FastSpring redelivers far sooner than the sweep interval.
  it('applies a pending refund when the order itself is redelivered', async () => {
    const session = await seedCheckoutSession();
    const paid = paidOrder(session.reference, 'ord_redelivered', 'evt_order_first');
    await deliver(paid.rawBody, paid.signature);
    await storePendingEvent(
      'evt_redelivered_return',
      'return.created',
      'ord_redelivered',
      returnCreatedData('ord_redelivered', BASIC_PRICE),
    );

    const again = paidOrder(session.reference, 'ord_redelivered', 'evt_order_again');
    const result = await deliver(again.rawBody, again.signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.deduplicated);
    expect(result.results[0]?.reason).toMatch(/pending return\.created for it was applied/);
    // Access is gone, so the redelivery names no scan it makes available.
    expect(result.results[0]?.scanId).toBeNull();
    expect(result.createdScanIds).toHaveLength(0);
    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { entitlement: true } });
    expect(purchase.status).toBe('Refunded');
    expect(purchase.entitlement?.suspended).toBe(true);
    const stored = await db.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_redelivered_return' },
    });
    expect(stored.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(stored.outcomeReason).toMatch(/redelivered/);
    // And the sweep afterwards finds nothing left to do.
    expect((await reconcilePendingRefunds(db.prisma, new Date())).pendingRowCount).toBe(0);
  });

  it('leaves an ordinary redelivery with nothing pending exactly as it was', async () => {
    const session = await seedCheckoutSession();
    const paid = paidOrder(session.reference, 'ord_plain', 'evt_plain_first');
    const first = await deliver(paid.rawBody, paid.signature);
    const again = paidOrder(session.reference, 'ord_plain', 'evt_plain_again');

    const result = await deliver(again.rawBody, again.signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.deduplicated);
    expect(result.results[0]?.reason).toBe('order already granted');
    expect(result.results[0]?.scanId).toBe(first.createdScanIds[0]);
    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { entitlement: true } });
    expect(purchase.status).toBe('paid');
    expect(purchase.entitlement?.suspended).toBe(false);
  });

  // THE REGRESSION THIS SECTION EXISTS FOR. Pending rows whose order never
  // arrives are the OLDEST pending rows there are — they sit for the whole
  // 30-day retention window — so a sweep that takes the oldest N rows first and
  // only then asks which have a purchase spends every pass on them and never
  // reaches the refund it could apply. The batch is taken after the match, so a
  // pile of orphans older than the applicable row costs one index probe each.
  it('applies a matching refund that a pile of older orphans sits in front of', async () => {
    await payFor('ord_behind_orphans');
    for (const index of [1, 2, 3]) {
      await storePendingEvent(
        `evt_orphan_${index}`,
        'return.created',
        `ord_orphan_${index}`,
        returnCreatedData(`ord_orphan_${index}`, BASIC_PRICE),
        // Older than the applicable row, so delivery order puts them first.
        new Date(Date.now() - (10 - index) * 60_000),
      );
    }
    await storePendingEvent(
      'evt_behind_orphans',
      'return.created',
      'ord_behind_orphans',
      returnCreatedData('ord_behind_orphans', BASIC_PRICE),
      new Date(),
    );

    // A batch of one: under the old select-then-filter order this pass would
    // have taken the oldest orphan and applied nothing at all.
    const swept = await reconcilePendingRefunds(db.prisma, new Date(), { batchLimit: 1 });

    expect(swept.matchedOrderCount).toBe(1);
    expect(swept.appliedEventCount).toBe(1);
    // The backlog is still reported, so an operator can see the orphans exist.
    expect(swept.pendingRowCount).toBe(4);
    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { entitlement: true } });
    expect(purchase.status).toBe('Refunded');
    expect(purchase.entitlement?.suspended).toBe(true);
    // And the orphans are left exactly as they were, for their own order to land.
    const orphans = await db.prisma.webhookEvent.findMany({
      where: { providerEventId: { startsWith: 'evt_orphan_' } },
    });
    expect(orphans).toHaveLength(3);
    expect(orphans.every(({ outcome }) => outcome === WEBHOOK_OUTCOMES.unlinked)).toBe(true);
  });

  it('examines no more pending orders than the batch limit allows', async () => {
    await payFor('ord_batch_one');
    await payFor('ord_batch_two');
    await storePendingEvent(
      'evt_batch_one',
      'return.created',
      'ord_batch_one',
      returnCreatedData('ord_batch_one', BASIC_PRICE),
    );
    await storePendingEvent(
      'evt_batch_two',
      'return.created',
      'ord_batch_two',
      returnCreatedData('ord_batch_two', BASIC_PRICE),
    );

    const first = await reconcilePendingRefunds(db.prisma, new Date(), { batchLimit: 1 });
    const second = await reconcilePendingRefunds(db.prisma, new Date(), { batchLimit: 1 });

    expect(first.pendingRowCount).toBe(2);
    expect(first.matchedOrderCount).toBe(1);
    expect(first.appliedEventCount).toBe(1);
    expect(first.batchLimitReached).toBe(true);
    // What one pass leaves behind is simply taken by the next.
    expect(second.appliedEventCount).toBe(1);
    const suspended = await db.prisma.entitlement.count({ where: { suspended: true } });
    expect(suspended).toBe(2);
  });
});
