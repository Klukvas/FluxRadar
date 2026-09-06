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

// FASTSPRING-014: a charge that comes back in instalments.
//
// FastSpring can return an order in several `return.created` events, and each one
// states only its own amount. Measuring the entitlement against the event in hand
// therefore never suspends anything: two $27.50 returns against a $55 order are
// each 50% of the charge, neither reaches the full-refund ratio, and the buyer
// keeps a report whose money is entirely back.
//
// So the decision is taken on everything returned so far. Every return is stored
// as its own line keyed on the FastSpring return id, which is also what keeps the
// sum idempotent: the same return redelivered under a new webhook event id is
// already there and adds nothing.

const BASIC_PRODUCT = 'fluxradar-basic-scan';
const BASIC_PRICE = 55;
const HALF_PRICE = 27.5;

describe('FASTSPRING-014 cumulative partial returns', () => {
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

  /** Pays for a Basic scan and returns the order id the returns refer to. */
  async function payFor(orderId: string, tax = 0): Promise<string> {
    const session = await seedCheckoutSession();
    const paid = signedDelivery([
      {
        id: `evt_order_${orderId}`,
        type: 'order.completed',
        data: orderCompletedData({
          orderId,
          reference: session.reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
          tax,
        }),
      },
    ]);
    const result = await deliver(paid.rawBody, paid.signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    return orderId;
  }

  /** Delivers one `return.created` for `orderId`, as FastSpring would post it. */
  function deliverReturn(eventId: string, orderId: string, amount: number, returnId: string) {
    const delivery = signedDelivery([
      {
        id: eventId,
        type: 'return.created',
        data: returnCreatedData(orderId, amount, 'USD', returnId),
      },
    ]);
    return deliver(delivery.rawBody, delivery.signature);
  }

  function purchaseAfter(orderId: string) {
    return db.prisma.purchase.findUniqueOrThrow({
      where: {
        provider_providerTransactionId: {
          provider: FASTSPRING_PROVIDER,
          providerTransactionId: orderId,
        },
      },
      include: { entitlement: true, refund: true, refundLines: true },
    });
  }

  it('suspends the entitlement once two partial returns add up to the whole charge', async () => {
    const orderId = await payFor('ord_two_halves');

    const first = await deliverReturn('evt_half_one', orderId, HALF_PRICE, 'ret_half_one');
    expect(first.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(first.results[0]?.reason).toMatch(/partial return recorded; 27.5 of 55 USD/);
    const afterFirst = await purchaseAfter(orderId);
    expect(afterFirst.status).toBe('paid');
    expect(afterFirst.entitlement?.suspended).toBe(false);
    expect(afterFirst.refund?.amountUsd).toBeCloseTo(HALF_PRICE, 2);

    const second = await deliverReturn('evt_half_two', orderId, HALF_PRICE, 'ret_half_two');
    expect(second.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);

    const afterSecond = await purchaseAfter(orderId);
    expect(afterSecond.status).toBe('Refunded');
    // The money is entirely back, so the report it paid for stops being readable.
    expect(afterSecond.entitlement?.suspended).toBe(true);
    // The aggregate states everything returned, not just the last instalment.
    expect(afterSecond.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
    expect(afterSecond.refundLines).toHaveLength(2);
  });

  it('counts the same return once when it is redelivered under a new event id', async () => {
    const orderId = await payFor('ord_replayed');
    const sameReturn = 'ret_replayed_once';

    await deliverReturn('evt_first', orderId, HALF_PRICE, sameReturn);
    const replay = await deliverReturn('evt_second', orderId, HALF_PRICE, sameReturn);

    expect(replay.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.deduplicated);
    expect(replay.results[0]?.reason).toMatch(/return ret_replayed_once was already counted/);
    const after = await purchaseAfter(orderId);
    // Half the charge came back once, so half is what is counted.
    expect(after.refundLines).toHaveLength(1);
    expect(after.refund?.amountUsd).toBeCloseTo(HALF_PRICE, 2);
    expect(after.status).toBe('paid');
    expect(after.entitlement?.suspended).toBe(false);
  });

  // A net-priced store charges $60.50 for a $55 plan. Returning the $5.50 tax and
  // half the price is $33 of $60.50 — not the charge, so the report stays.
  it('leaves access in place for a tax-only return plus one partial return', async () => {
    const orderId = await payFor('ord_tax_plus_partial', 5.5);

    await deliverReturn('evt_tax_only', orderId, 5.5, 'ret_tax_only');
    const partial = await deliverReturn('evt_partial', orderId, HALF_PRICE, 'ret_partial');

    expect(partial.results[0]?.reason).toMatch(/partial return recorded; 33 of 60.5 USD/);
    const after = await purchaseAfter(orderId);
    expect(after.status).toBe('paid');
    expect(after.entitlement?.suspended).toBe(false);
    expect(after.refund?.amountUsd).toBeCloseTo(33, 2);
    expect(after.refundLines).toHaveLength(2);
  });

  it('still suspends on a single full return', async () => {
    const orderId = await payFor('ord_single_full');

    const result = await deliverReturn('evt_full', orderId, BASIC_PRICE, 'ret_full');

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.results[0]?.reason).toBeNull();
    const after = await purchaseAfter(orderId);
    expect(after.status).toBe('Refunded');
    expect(after.entitlement?.suspended).toBe(true);
    expect(after.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
  });

  it('still suspends on a chargeback after a partial return', async () => {
    const orderId = await payFor('ord_partial_then_cb');
    await deliverReturn('evt_cb_partial', orderId, HALF_PRICE, 'ret_cb_partial');

    const chargeback = signedDelivery([
      { id: 'evt_cb', type: 'chargeback.created', data: chargebackCreatedData(orderId, 55) },
    ]);
    const result = await deliver(chargeback.rawBody, chargeback.signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    const after = await purchaseAfter(orderId);
    // A disputed charge is taken back in full whatever was already returned.
    expect(after.status).toBe('Disputed');
    expect(after.entitlement?.suspended).toBe(true);
  });

  // A chargeback is a bank-forced reversal: it carries a fee, it counts against
  // the merchant account, and it is what an operator has to be able to find
  // afterwards. A seller refunding the order to settle the dispute is the
  // ordinary next step, and it must not relabel the purchase `Refunded` and take
  // the chargeback off the record — while everything about the money still has to
  // be recorded, and access must stay gone.
  it('keeps a disputed purchase disputed when a full return follows the chargeback', async () => {
    const orderId = await payFor('ord_cb_then_return');
    const chargeback = signedDelivery([
      {
        id: 'evt_cb_first',
        type: 'chargeback.created',
        data: chargebackCreatedData(orderId, BASIC_PRICE),
      },
    ]);
    await deliver(chargeback.rawBody, chargeback.signature);
    expect((await purchaseAfter(orderId)).status).toBe('Disputed');

    const result = await deliverReturn('evt_return_after_cb', orderId, BASIC_PRICE, 'ret_after_cb');

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.results[0]?.reason).toMatch(/stays Disputed/);
    const after = await purchaseAfter(orderId);
    // The stronger fact survives...
    expect(after.status).toBe('Disputed');
    // ...access is still gone...
    expect(after.entitlement?.suspended).toBe(true);
    // ...and the money that came back is still fully recorded on both levels.
    expect(after.refundLines).toHaveLength(1);
    expect(after.refundLines[0]?.amountCharged).toBeCloseTo(BASIC_PRICE, 2);
    expect(after.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
    const stored = await db.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_return_after_cb' },
    });
    expect(stored.outcome).toBe(WEBHOOK_OUTCOMES.processed);
  });

  // The same rule from the other side: a partial return that only reaches the
  // full-refund ratio after the dispute was recorded still leaves the label alone.
  it('keeps a disputed purchase disputed when partial returns later add up', async () => {
    const orderId = await payFor('ord_cb_then_halves');
    await deliverReturn('evt_half_before_cb', orderId, HALF_PRICE, 'ret_half_before_cb');
    const chargeback = signedDelivery([
      {
        id: 'evt_cb_mid',
        type: 'chargeback.created',
        data: chargebackCreatedData(orderId, BASIC_PRICE),
      },
    ]);
    await deliver(chargeback.rawBody, chargeback.signature);

    await deliverReturn('evt_half_after_cb', orderId, HALF_PRICE, 'ret_half_after_cb');

    const after = await purchaseAfter(orderId);
    expect(after.status).toBe('Disputed');
    expect(after.entitlement?.suspended).toBe(true);
    expect(after.refundLines).toHaveLength(2);
    expect(after.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
  });

  // The pre-cumulative release stored one RefundRecord per purchase and
  // OVERWROTE it on every return, so a purchase refunded in instalments before
  // the deploy kept only the last one and the migration can backfill only that.
  // Nothing can reconstruct the rest — see the note on ProviderRefund in
  // schema.prisma — so what is guaranteed is the part that IS knowable: a return
  // delivered after the deploy adds to whatever was backfilled instead of
  // replacing it, and the entitlement is measured on the sum.
  it('adds a new return to a backfilled legacy refund line instead of replacing it', async () => {
    const orderId = await payFor('ord_legacy_backfill');
    const purchase = await purchaseAfter(orderId);
    // Exactly what migration 20260906200000 writes for a legacy refund: one line
    // carrying the single figure the old RefundRecord had kept.
    await db.prisma.providerRefund.create({
      data: {
        purchaseId: purchase.id,
        provider: FASTSPRING_PROVIDER,
        providerRefundId: 'refund-record:legacy',
        eventType: 'return.created',
        amountCharged: HALF_PRICE,
        amountUsd: HALF_PRICE,
        currency: 'USD',
        reason: 'backfilled from RefundRecord legacy by migration',
      },
    });

    const result = await deliverReturn('evt_after_backfill', orderId, HALF_PRICE, 'ret_new');

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    const after = await purchaseAfter(orderId);
    expect(after.refundLines).toHaveLength(2);
    // 27.50 backfilled + 27.50 new covers the charge, so access goes.
    expect(after.status).toBe('Refunded');
    expect(after.entitlement?.suspended).toBe(true);
    expect(after.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
  });

  // Both halves overtook the order they belong to. Each is stored as `unlinked`
  // and replayed when the order lands, so they have to add up there too.
  it('adds up two partial returns that arrived before their order', async () => {
    const session = await seedCheckoutSession();
    const orderId = 'ord_early_halves';
    for (const early of [
      { eventId: 'evt_early_one', returnId: 'ret_early_one' },
      { eventId: 'evt_early_two', returnId: 'ret_early_two' },
    ]) {
      const stored = await deliverReturn(early.eventId, orderId, HALF_PRICE, early.returnId);
      expect(stored.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.unlinked);
    }

    const paid = signedDelivery([
      {
        id: 'evt_early_order',
        type: 'order.completed',
        data: orderCompletedData({
          orderId,
          reference: session.reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
        }),
      },
    ]);
    const result = await deliver(paid.rawBody, paid.signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    // Access was suspended inside the transaction that granted it: nothing runs.
    expect(result.createdScanIds).toHaveLength(0);
    const after = await purchaseAfter(orderId);
    expect(after.status).toBe('Refunded');
    expect(after.entitlement?.suspended).toBe(true);
    expect(after.refundLines).toHaveLength(2);
    expect(after.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
  });

  // Two deliveries in flight together still have to add up. The race they could
  // lose — both reading the sum before the other's line is committed — is closed
  // by the `FOR UPDATE` on the purchase row, which this test does not reproduce
  // on its own: locally the two transactions serialise anyway.
  it('adds up two partial returns delivered concurrently', async () => {
    const orderId = await payFor('ord_concurrent');

    const [first, second] = await Promise.all([
      deliverReturn('evt_race_one', orderId, HALF_PRICE, 'ret_race_one'),
      deliverReturn('evt_race_two', orderId, HALF_PRICE, 'ret_race_two'),
    ]);

    expect(first.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(second.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    const after = await purchaseAfter(orderId);
    expect(after.refundLines).toHaveLength(2);
    expect(after.status).toBe('Refunded');
    expect(after.entitlement?.suspended).toBe(true);
    expect(after.refund?.amountUsd).toBeCloseTo(BASIC_PRICE, 2);
  });

  // Fail closed, and say so: a payload with no return id cannot be recognised on
  // redelivery, so it is counted per delivery and the line records why.
  it('keys a return that states no return id on its delivery and records the reason', async () => {
    const orderId = await payFor('ord_no_return_id');
    const anonymous = signedDelivery([
      {
        id: 'evt_anonymous_return',
        type: 'return.created',
        data: returnCreatedData(orderId, HALF_PRICE, 'USD', null),
      },
    ]);

    await deliver(anonymous.rawBody, anonymous.signature);

    const after = await purchaseAfter(orderId);
    expect(after.refundLines).toHaveLength(1);
    expect(after.refundLines[0]?.providerRefundId).toBe('evt_anonymous_return');
    expect(after.refundLines[0]?.reason).toMatch(/carries no return id; counted once per delivery/);
  });
});
