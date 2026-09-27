import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutSession, Prisma } from '@prisma/client';

import { createTestDb, seedAccountWithProfile, type TestDb } from '../../test-utils/test-db.ts';
import type { SeededAccount } from '../../test-utils/test-db.ts';
import { WEBHOOK_OUTCOMES } from '../fastspring/outcomes.ts';
import { CREEM_PROVIDER } from './config.ts';
import { CREEM_EVENT_TYPES } from './events.ts';
import { reconcileCreemPendingRefunds } from './pending-refund-reconciliation.ts';
import {
  TEST_CREEM_SECRET,
  checkoutCompletedObject,
  disputeCreatedObject,
  refundCreatedObject,
  signedCreemDelivery,
} from './test-payloads.ts';
import { handleCreemWebhook } from './webhook-handler.ts';

// CREEM-007: what a Creem refund or dispute does to a purchase we granted.
//
// Refunds accumulate — each refund.created states only its own amount and is
// stored as its own line keyed on the Creem refund id, so the same refund
// redelivered under a new event id adds nothing and two halves add up. A refund
// that overtakes its order is stored `unlinked` and replayed from its own
// recorded payload the moment the order lands, or by the reconciliation sweep
// when the grant transaction could not see it. Disputed and Refunded are both
// terminal: whichever is written first stays.

const BASIC_PRODUCT = 'prod_basic';
const BASIC_PRICE = 55;
const BASIC_CENTS = 5500;
const HALF_PRICE = 27.5;
const HALF_CENTS = 2750;

describe('CREEM-007 refunds and disputes', () => {
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
        provider: CREEM_PROVIDER,
        reference: `frcs_${Math.random().toString(36).slice(2)}`,
        accountId: account.accountId,
        siteProfileId: account.siteProfileId,
        plan: 'Basic',
        productPath: BASIC_PRODUCT,
        expectedAmountUsd: BASIC_PRICE,
        liveMode: false,
        scopeJson: JSON.stringify({ includeSubdomains: false }),
        ...overrides,
      },
    });
  }

  const deliver = (rawBody: string, signature: string) =>
    handleCreemWebhook(db.prisma, rawBody, signature, {
      secret: TEST_CREEM_SECRET,
      expectLive: false,
    });

  const paidOrder = (reference: string, orderId: string, eventId: string) =>
    signedCreemDelivery({
      id: eventId,
      eventType: CREEM_EVENT_TYPES.checkoutCompleted,
      object: checkoutCompletedObject({
        checkoutId: `ch_${orderId}`,
        orderId,
        reference,
        productId: BASIC_PRODUCT,
        amountCents: BASIC_CENTS,
      }),
    });

  /** Pays for a Basic scan and returns the order id the refunds refer to. */
  async function payFor(orderId: string): Promise<string> {
    const session = await seedCheckoutSession();
    const paid = paidOrder(session.reference, orderId, `evt_order_${orderId}`);
    const result = await deliver(paid.rawBody, paid.signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.createdScanIds).toHaveLength(1);
    return orderId;
  }

  /** Delivers one `refund.created` for `orderId`, as Creem would post it. */
  function deliverRefund(
    eventId: string,
    orderId: string,
    amountCents: number,
    refundId: string | null = `ref_${orderId}`,
    currency = 'USD',
    status = 'succeeded',
  ) {
    const delivery = signedCreemDelivery({
      id: eventId,
      eventType: CREEM_EVENT_TYPES.refundCreated,
      object: refundCreatedObject(orderId, amountCents, currency, refundId, status),
    });
    return deliver(delivery.rawBody, delivery.signature);
  }

  function deliverDispute(eventId: string, orderId: string) {
    const delivery = signedCreemDelivery({
      id: eventId,
      eventType: CREEM_EVENT_TYPES.disputeCreated,
      object: disputeCreatedObject(orderId, BASIC_CENTS),
    });
    return deliver(delivery.rawBody, delivery.signature);
  }

  function purchaseAfter(orderId: string) {
    return db.prisma.purchase.findUniqueOrThrow({
      where: {
        provider_providerTransactionId: {
          provider: CREEM_PROVIDER,
          providerTransactionId: orderId,
        },
      },
      include: { entitlement: true, refund: true, refundLines: true, scan: true },
    });
  }

  /**
   * The row a lost race leaves behind: the refund's own signed payload, stored
   * as `unlinked` against an order that already has a purchase. Writing it
   * directly is the only way to reproduce an interleaving two transactions
   * cannot be forced into from the outside (see FASTSPRING-015).
   */
  async function storePendingRefund(eventId: string, orderId: string): Promise<void> {
    const { rawBody, signature } = signedCreemDelivery({
      id: eventId,
      eventType: CREEM_EVENT_TYPES.refundCreated,
      object: refundCreatedObject(orderId, BASIC_CENTS),
    });
    await db.prisma.webhookEvent.create({
      data: {
        provider: CREEM_PROVIDER,
        providerEventId: eventId,
        providerTransactionId: orderId,
        eventType: CREEM_EVENT_TYPES.refundCreated,
        outcome: WEBHOOK_OUTCOMES.unlinked,
        outcomeReason: 'no purchase for this order yet',
        rawBody,
        signature,
      },
    });
  }

  it('suspends access on a full refund and records it on both levels', async () => {
    const orderId = await payFor('ord_full');

    const result = await deliverRefund('evt_full', orderId, BASIC_CENTS);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.results[0]?.reason).toBeNull();
    const after = await purchaseAfter(orderId);
    expect(result.results[0]?.purchaseId).toBe(after.id);
    expect(result.results[0]?.scanId).toBe(after.scan?.id);
    expect(after.status).toBe('Refunded');
    expect(after.entitlement?.suspended).toBe(true);
    expect(after.refund?.status).toBe('paid');
    expect(after.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
    expect(after.refund?.currency).toBe('USD');
    expect(after.refund?.provider).toBe(CREEM_PROVIDER);
    expect(after.refund?.providerTransactionId).toBe(orderId);
    expect(after.refund?.providerEventId).toBe(`ref_${orderId}`);
    expect(after.refund?.refundReasonCode).toBe('LEGAL_SUPPORT');
    expect(after.refundLines).toHaveLength(1);
    expect(after.refundLines[0]).toMatchObject({
      provider: CREEM_PROVIDER,
      providerRefundId: `ref_${orderId}`,
      eventType: CREEM_EVENT_TYPES.refundCreated,
      amountCharged: BASIC_PRICE,
      amountUsd: BASIC_PRICE,
      currency: 'USD',
      reason: null,
    });
  });

  it('counts the same refund once when it is redelivered under a new event id', async () => {
    const orderId = await payFor('ord_replayed');

    await deliverRefund('evt_first', orderId, BASIC_CENTS, 'ref_once');
    const replay = await deliverRefund('evt_second', orderId, BASIC_CENTS, 'ref_once');

    expect(replay.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.deduplicated);
    expect(replay.results[0]?.reason).toMatch(/refund ref_once was already counted; 55 of 55 USD/);
    const after = await purchaseAfter(orderId);
    expect(after.refundLines).toHaveLength(1);
    expect(await db.prisma.refundRecord.count()).toBe(1);
    expect(after.status).toBe('Refunded');
    expect(await db.prisma.webhookEvent.count({ where: { eventType: 'refund.created' } })).toBe(2);
  });

  it('suspends the entitlement once two partial refunds add up to the whole charge', async () => {
    const orderId = await payFor('ord_two_halves');

    const first = await deliverRefund('evt_half_one', orderId, HALF_CENTS, 'ref_half_one');
    expect(first.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(first.results[0]?.reason).toMatch(/partial refund recorded; 27.5 of 55 USD/);
    const afterFirst = await purchaseAfter(orderId);
    expect(afterFirst.status).toBe('paid');
    expect(afterFirst.entitlement?.suspended).toBe(false);
    expect(afterFirst.refund?.amountUsd).toBeCloseTo(HALF_PRICE, 2);

    const second = await deliverRefund('evt_half_two', orderId, HALF_CENTS, 'ref_half_two');
    expect(second.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);

    const afterSecond = await purchaseAfter(orderId);
    expect(afterSecond.status).toBe('Refunded');
    expect(afterSecond.entitlement?.suspended).toBe(true);
    // The aggregate states everything refunded, not just the last instalment.
    expect(afterSecond.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
    expect(afterSecond.refundLines).toHaveLength(2);
    expect(await db.prisma.refundRecord.count()).toBe(1);
  });

  it('applies a refund that arrived before its order as soon as the order lands', async () => {
    const session = await seedCheckoutSession();
    const early = await deliverRefund('evt_early_refund', 'ord_late', BASIC_CENTS);
    expect(early.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.unlinked);
    expect(early.results[0]?.reason).toBe('no purchase for this order yet');
    expect(await db.prisma.purchase.count()).toBe(0);
    expect(await db.prisma.providerRefund.count()).toBe(0);

    const paid = paidOrder(session.reference, 'ord_late', 'evt_late_order');
    const second = await deliver(paid.rawBody, paid.signature);

    expect(second.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(second.results[0]?.reason).toMatch(
      /refund\.created for this order was delivered before/,
    );
    // The scan exists as the record of the purchase, but nothing may run or
    // announce it: the money is already on its way back.
    expect(second.results[0]?.scanId).toBeNull();
    expect(second.createdScanIds).toHaveLength(0);

    const after = await purchaseAfter('ord_late');
    expect(after.status).toBe('Refunded');
    expect(after.entitlement?.suspended).toBe(true);
    expect(after.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
    expect(after.scan).not.toBeNull();
    expect(after.refundLines).toHaveLength(1);

    // The stored event leaves the pending state exactly once.
    const stored = await db.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_early_refund' },
    });
    expect(stored.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(stored.outcomeReason).toMatch(/applied when order ord_late arrived/);
    expect(stored.accountId).toBe(account.accountId);
  });

  it('suspends the entitlement on dispute.created and stores an orphan dispute', async () => {
    const orderId = await payFor('ord_disputed');

    const result = await deliverDispute('evt_dispute', orderId);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    const after = await purchaseAfter(orderId);
    expect(after.status).toBe('Disputed');
    expect(after.entitlement?.suspended).toBe(true);
    // A dispute is not a refund: nothing is recorded as money back.
    expect(after.refund).toBeNull();
    expect(after.refundLines).toHaveLength(0);

    const orphan = await deliverDispute('evt_dispute_orphan', 'ord_never_paid');
    expect(orphan.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.unlinked);
  });

  // A dispute is a bank-forced reversal an operator has to be able to find
  // afterwards; the seller refunding to settle it must not erase that.
  it('keeps a disputed purchase disputed when a full refund follows the dispute', async () => {
    const orderId = await payFor('ord_dispute_then_refund');
    await deliverDispute('evt_dispute_first', orderId);
    expect((await purchaseAfter(orderId)).status).toBe('Disputed');

    const result = await deliverRefund('evt_refund_after_dispute', orderId, BASIC_CENTS);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.results[0]?.reason).toMatch(/stays Disputed/);
    const after = await purchaseAfter(orderId);
    expect(after.status).toBe('Disputed');
    expect(after.entitlement?.suspended).toBe(true);
    // ...and the money that came back is still fully recorded on both levels.
    expect(after.refundLines).toHaveLength(1);
    expect(after.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
  });

  it('keeps a refunded purchase refunded when a later dispute arrives', async () => {
    const orderId = await payFor('ord_refund_then_dispute');
    await deliverRefund('evt_refund_first', orderId, BASIC_CENTS);

    const result = await deliverDispute('evt_dispute_after_refund', orderId);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    const after = await purchaseAfter(orderId);
    expect(after.status).toBe('Refunded');
    expect(after.entitlement?.suspended).toBe(true);
  });

  it('applies a stranded refund against an already-granted order by the sweep', async () => {
    await payFor('ord_raced');
    await storePendingRefund('evt_raced_refund', 'ord_raced');
    // Nothing in the delivery path will look at that row again.
    const before = await purchaseAfter('ord_raced');
    expect(before.status).toBe('paid');
    expect(before.entitlement?.suspended).toBe(false);

    const swept = await reconcileCreemPendingRefunds(db.prisma, new Date());

    expect(swept).toEqual({
      pendingRowCount: 1,
      matchedOrderCount: 1,
      appliedEventCount: 1,
      failedOrderCount: 0,
      batchLimitReached: false,
    });
    const after = await purchaseAfter('ord_raced');
    expect(after.status).toBe('Refunded');
    expect(after.entitlement?.suspended).toBe(true);
    expect(after.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
    const stored = await db.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_raced_refund' },
    });
    expect(stored.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(stored.outcomeReason).toMatch(/pending-refund sweep/);
    expect(stored.accountId).toBe(account.accountId);
    // The row is no longer pending, so a second pass has nothing to look at.
    expect((await reconcileCreemPendingRefunds(db.prisma, new Date())).pendingRowCount).toBe(0);
  });

  it('leaves a pending refund whose order still has no purchase to the sweep, untouched', async () => {
    await storePendingRefund('evt_still_orphan', 'ord_never_paid');

    const swept = await reconcileCreemPendingRefunds(db.prisma, new Date());

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

  // The sweep is the backstop; a redelivery of the order is the fast path.
  it('applies a stranded refund when the order itself is redelivered', async () => {
    const session = await seedCheckoutSession();
    const paid = paidOrder(session.reference, 'ord_redelivered', 'evt_order_first');
    await deliver(paid.rawBody, paid.signature);
    await storePendingRefund('evt_redelivered_refund', 'ord_redelivered');

    const again = paidOrder(session.reference, 'ord_redelivered', 'evt_order_again');
    const result = await deliver(again.rawBody, again.signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.deduplicated);
    expect(result.results[0]?.reason).toMatch(/pending refund\.created for it was applied/);
    expect(result.results[0]?.scanId).toBeNull();
    expect(result.createdScanIds).toHaveLength(0);
    const after = await purchaseAfter('ord_redelivered');
    expect(after.status).toBe('Refunded');
    expect(after.entitlement?.suspended).toBe(true);
    const stored = await db.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_redelivered_refund' },
    });
    expect(stored.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(stored.outcomeReason).toMatch(/redelivered/);
  });

  // Nothing here converts a currency: a refund quoted in one the purchase was
  // not charged in cannot be measured, and an unmeasurable refund fails closed
  // as the whole charge.
  it('counts a refund in another currency than the charge as the whole charge', async () => {
    const orderId = await payFor('ord_foreign_refund');

    const result = await deliverRefund('evt_eur_refund', orderId, 1000, 'ref_eur', 'EUR');

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    const after = await purchaseAfter(orderId);
    expect(after.status).toBe('Refunded');
    expect(after.entitlement?.suspended).toBe(true);
    expect(after.refundLines).toHaveLength(1);
    expect(after.refundLines[0]?.amountCharged).toBeCloseTo(BASIC_PRICE, 2);
    expect(after.refundLines[0]?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
    expect(after.refundLines[0]?.currency).toBe('USD');
    expect(after.refundLines[0]?.reason).toMatch(
      /refund quoted in EUR against a charge in USD.*counted as the whole charge/,
    );
    expect(after.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
  });

  // Fail closed, and say so: a payload with no refund id cannot be recognised on
  // redelivery, so it is counted per delivery and the line records why.
  it('keys a refund that states no refund id on its delivery and records the reason', async () => {
    const orderId = await payFor('ord_no_refund_id');

    await deliverRefund('evt_anonymous_refund', orderId, HALF_CENTS, null);

    const after = await purchaseAfter(orderId);
    expect(after.refundLines).toHaveLength(1);
    expect(after.refundLines[0]?.providerRefundId).toBe('evt_anonymous_refund');
    expect(after.refundLines[0]?.reason).toMatch(/carries no refund id; counted once per delivery/);
    expect(after.status).toBe('paid');
  });

  it('counts a refund Creem reports as pending as money back, and says so', async () => {
    const orderId = await payFor('ord_pending_refund');

    const result = await deliverRefund(
      'evt_pending_refund',
      orderId,
      BASIC_CENTS,
      'ref_pending',
      'USD',
      'pending',
    );

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.results[0]?.reason).toMatch(/Creem reports the refund as pending/);
    const after = await purchaseAfter(orderId);
    expect(after.status).toBe('Refunded');
    expect(after.entitlement?.suspended).toBe(true);
    expect(after.refundLines[0]?.reason).toMatch(/reports status pending; counted as money back/);
  });

  it('ignores a refund that names no order at all', async () => {
    const { rawBody, signature } = signedCreemDelivery({
      id: 'evt_refund_no_order',
      eventType: CREEM_EVENT_TYPES.refundCreated,
      object: { id: 'ref_no_order', refund_amount: BASIC_CENTS, refund_currency: 'USD' },
    });
    const result = await deliver(rawBody, signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.ignored);
    expect(result.results[0]?.reason).toBe('refund.created payload has no order id');
  });
});
