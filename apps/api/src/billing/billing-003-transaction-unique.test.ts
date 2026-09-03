import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cancelScan } from './cancel-scan.ts';
import { simulatePaidCheckout } from './dev-checkout.ts';
import { signPaddleWebhook } from './paddle-signature.ts';
import { handlePaddleWebhook } from './webhook-handler.ts';
import { PADDLE_PRICE_IDS } from './webhook-schema.ts';
import {
  TEST_WEBHOOK_SECRET,
  createTestDb,
  seedAccountWithProfile,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';

// BILLING-003: unique paddleTransactionId admits exactly one purchase_id —
// two *different* events for the same transaction must not create a second
// Purchase/Entitlement/Scan (§18 idempotency contract, monotonic rules).
describe('BILLING-003 one purchase per paddleTransactionId', () => {
  let db: TestDb;
  let account: SeededAccount;

  beforeAll(async () => {
    db = await createTestDb();
    account = await seedAccountWithProfile(db.prisma);
  });

  afterAll(async () => {
    await db.cleanup();
  });

  it('records both events but keeps a single purchase', async () => {
    const base = {
      prisma: db.prisma,
      accountId: account.accountId,
      siteProfileId: account.siteProfileId,
      plan: 'Basic' as const,
      transactionId: 'txn_shared_1',
      secret: TEST_WEBHOOK_SECRET,
    };
    const first = await simulatePaidCheckout({ ...base, eventId: 'evt_shared_a' });
    const second = await simulatePaidCheckout({ ...base, eventId: 'evt_shared_b' });

    expect(first.result.deduplicated).toBe(false);
    expect(second.result.deduplicated).toBe(true);
    expect(second.result.purchaseId).toBe(first.result.purchaseId);

    // Both events land in the dedup table; side effects stay singular.
    expect(await db.prisma.webhookEvent.count()).toBe(2);
    expect(await db.prisma.purchase.count()).toBe(1);
    expect(await db.prisma.entitlement.count()).toBe(1);
    expect(await db.prisma.scan.count()).toBe(1);
    expect(await db.prisma.job.count()).toBe(1);
  });

  it('keeps a single purchase under concurrent different-event delivery', async () => {
    const base = {
      prisma: db.prisma,
      accountId: account.accountId,
      siteProfileId: account.siteProfileId,
      plan: 'Complete' as const,
      transactionId: 'txn_shared_2',
      secret: TEST_WEBHOOK_SECRET,
    };
    const results = await Promise.all([
      simulatePaidCheckout({ ...base, eventId: 'evt_shared_c' }),
      simulatePaidCheckout({ ...base, eventId: 'evt_shared_d' }),
      simulatePaidCheckout({ ...base, eventId: 'evt_shared_e' }),
    ]);

    expect(results.filter(({ result }) => !result.deduplicated)).toHaveLength(1);
    expect(await db.prisma.purchase.count({ where: { paddleTransactionId: 'txn_shared_2' } })).toBe(
      1,
    );
    expect(await db.prisma.purchase.count()).toBe(2); // one per transactionId in this file
    expect(await db.prisma.entitlement.count()).toBe(2);
    expect(await db.prisma.scan.count()).toBe(2);
  });
});

// BILLING-003 (§18 monotonic state rules, D-134): transaction.refunded is a
// billing overlay on the purchase — an old or repeated event never rolls the
// state back, never spawns a second entitlement/scan/refund, and out-of-order
// refunded-before-paid stores the event without side effects.
describe('BILLING-003 monotonic refunded event ordering', () => {
  let db: TestDb;
  let account: SeededAccount;

  beforeAll(async () => {
    db = await createTestDb();
    account = await seedAccountWithProfile(db.prisma);
  });

  afterAll(async () => {
    await db.cleanup();
  });

  const deliver = (event: Record<string, unknown>): ReturnType<typeof handlePaddleWebhook> => {
    const rawBody = JSON.stringify(event);
    const signature = signPaddleWebhook(rawBody, TEST_WEBHOOK_SECRET);
    return handlePaddleWebhook(db.prisma, rawBody, signature, { secret: TEST_WEBHOOK_SECRET });
  };

  // D-134: amount/currency/priceId are validated for transaction.paid only —
  // a refunded amount may include tax, so 59.13 must be accepted as-is.
  const refundedEvent = (
    eventId: string,
    transactionId: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    eventId,
    eventType: 'transaction.refunded',
    transactionId,
    accountId: account.accountId,
    siteProfileId: account.siteProfileId,
    plan: 'Basic',
    amountUsd: 59.13,
    currency: 'USD',
    priceId: PADDLE_PRICE_IDS.Basic,
    ...overrides,
  });

  const checkout = (eventId: string, transactionId: string) =>
    simulatePaidCheckout({
      prisma: db.prisma,
      accountId: account.accountId,
      siteProfileId: account.siteProfileId,
      plan: 'Basic',
      eventId,
      transactionId,
      secret: TEST_WEBHOOK_SECRET,
    });

  it('flips the purchase to Refunded without touching the scan state', async () => {
    const paid = await checkout('evt_mono_paid_1', 'txn_mono_1');

    const result = await deliver(refundedEvent('evt_mono_ref_1', 'txn_mono_1'));
    expect(result.purchaseId).toBe(paid.result.purchaseId);

    const purchase = await db.prisma.purchase.findUniqueOrThrow({
      where: { id: paid.result.purchaseId ?? '' },
      include: { scan: true, entitlement: true },
    });
    expect(purchase.status).toBe('Refunded');
    // Refunded is a billing state, not a scan state (§18): the scan stays Pending.
    expect(purchase.scan?.status).toBe('Pending');
    expect(purchase.entitlement).not.toBeNull();
  });

  it('does not roll a Refunded purchase back on a stale or duplicate paid event', async () => {
    // Redelivery of the original paid event (same eventId).
    const redelivered = await checkout('evt_mono_paid_1', 'txn_mono_1');
    expect(redelivered.result.deduplicated).toBe(true);

    // A brand-new paid event for the same transaction (new eventId).
    const stale = await checkout('evt_mono_paid_1b', 'txn_mono_1');
    expect(stale.result.deduplicated).toBe(true);

    const purchase = await db.prisma.purchase.findUniqueOrThrow({
      where: { paddleTransactionId: 'txn_mono_1' },
    });
    expect(purchase.status).toBe('Refunded');
    expect(await db.prisma.purchase.count({ where: { paddleTransactionId: 'txn_mono_1' } })).toBe(
      1,
    );
    expect(await db.prisma.entitlement.count()).toBe(1);
    expect(await db.prisma.scan.count()).toBe(1);
  });

  it('treats a redelivered refunded event as a no-op', async () => {
    const result = await deliver(refundedEvent('evt_mono_ref_1', 'txn_mono_1'));
    expect(result.deduplicated).toBe(true);

    expect(await db.prisma.webhookEvent.count({ where: { paddleEventId: 'evt_mono_ref_1' } })).toBe(
      1,
    );
    const purchase = await db.prisma.purchase.findUniqueOrThrow({
      where: { paddleTransactionId: 'txn_mono_1' },
    });
    expect(purchase.status).toBe('Refunded');
  });

  it('moves a requested refund record to paid exactly once', async () => {
    const paid = await checkout('evt_mono_paid_2', 'txn_mono_2');
    const cancelled = await cancelScan(db.prisma, paid.result.scanId ?? '');
    expect(cancelled.refund?.status).toBe('requested');

    await deliver(refundedEvent('evt_mono_ref_2', 'txn_mono_2'));
    const afterFirst = await db.prisma.refundRecord.findUniqueOrThrow({
      where: { purchaseId: paid.result.purchaseId ?? '' },
    });
    expect(afterFirst.status).toBe('paid');
    expect(afterFirst.reasonCode).toBe('PRE_QUEUE_CANCEL');

    // A second refunded event (new eventId) changes nothing: still one record, still paid.
    await deliver(refundedEvent('evt_mono_ref_2b', 'txn_mono_2'));
    const afterSecond = await db.prisma.refundRecord.findMany({
      where: { purchaseId: paid.result.purchaseId ?? '' },
    });
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]?.status).toBe('paid');
  });

  it('stores an out-of-order refunded-before-paid event without side effects', async () => {
    const result = await deliver(refundedEvent('evt_mono_ref_3', 'txn_mono_3'));
    expect(result.purchaseId).toBeNull();

    expect(await db.prisma.webhookEvent.count({ where: { paddleEventId: 'evt_mono_ref_3' } })).toBe(
      1,
    );
    expect(await db.prisma.purchase.count({ where: { paddleTransactionId: 'txn_mono_3' } })).toBe(
      0,
    );

    // D-134: the stored early refund is not replayed — a later paid event
    // creates the purchase in its normal paid state.
    const paid = await checkout('evt_mono_paid_3', 'txn_mono_3');
    expect(paid.result.deduplicated).toBe(false);
    const purchase = await db.prisma.purchase.findUniqueOrThrow({
      where: { paddleTransactionId: 'txn_mono_3' },
    });
    expect(purchase.status).toBe('paid');
  });

  it('suspends entitlement on a dispute and keeps the scan state separate', async () => {
    const paid = await checkout('evt_mono_paid_dispute', 'txn_mono_dispute');
    const result = await deliver({
      ...refundedEvent('evt_mono_dispute', 'txn_mono_dispute'),
      eventType: 'transaction.disputed',
    });
    expect(result.purchaseId).toBe(paid.result.purchaseId);
    const purchase = await db.prisma.purchase.findUniqueOrThrow({
      where: { id: paid.result.purchaseId ?? '' },
      include: { entitlement: true, scan: true },
    });
    expect(purchase.status).toBe('Disputed');
    expect(purchase.entitlement?.suspended).toBe(true);
    expect(purchase.scan?.status).toBe('Pending');
  });
});
