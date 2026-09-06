import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutSession, Prisma } from '@prisma/client';

import { createTestDb, seedAccountWithProfile, type TestDb } from '../../test-utils/test-db.ts';
import type { SeededAccount } from '../../test-utils/test-db.ts';
import { CHECKOUT_STATUS_REASONS } from '../checkout-lifecycle.ts';
import { CHECKOUT_REASON_CODES, checkoutReasonCode } from '../checkout-status-reason.ts';
import { CHECKOUT_SESSION_STATUSES } from '../constants.ts';
import { findCheckoutStatus } from './checkout-session.ts';
import { FASTSPRING_PROVIDER } from './config.ts';
import { TEST_FASTSPRING_SECRET, orderCompletedData, signedDelivery } from './test-payloads.ts';
import { handleFastSpringWebhook, WEBHOOK_OUTCOMES } from './webhook-handler.ts';

// FASTSPRING-008: the claim and the grant are one unit, and what the buyer is
// told about a checkout that granted nothing.
//
// Claiming the checkout session is a compare-and-set that marks it `completed`,
// and it has to happen before the purchase so two orders cannot buy two scans
// with one reference. That ordering makes the failure path the interesting one:
// if anything after the claim refuses the order, a transaction that still
// commits leaves a session saying `completed` with no purchase behind it — the
// reference is burnt, the buyer has been charged, and nothing exists to show for
// it. Either both happen or neither does.

const BASIC_PRODUCT = 'fluxradar-basic-scan';
const BASIC_PRICE = 55;

describe('FASTSPRING-008 claim atomicity and buyer-facing status', () => {
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
        reference: `frcs_${randomUUID()}`,
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

  function paidOrder(reference: string) {
    return signedDelivery([
      {
        id: `evt_${randomUUID()}`,
        type: 'order.completed',
        data: orderCompletedData({
          orderId: `ord_${randomUUID()}`,
          reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
        }),
      },
    ]);
  }

  const deliver = (rawBody: string, signature: string) =>
    handleFastSpringWebhook(db.prisma, rawBody, signature, {
      secret: TEST_FASTSPRING_SECRET,
      expectLive: false,
      currencyPolicy: 'strict',
    });

  // The grant itself fails: the session names a site profile that belongs to
  // someone else, which createPaidScan refuses. Before this was atomic, the
  // rejection was returned from inside the transaction that had already claimed
  // the session — so the claim committed and the row read `completed` with
  // purchaseId null.
  it('never leaves a session completed when the paid scan could not be created', async () => {
    const stranger = await seedAccountWithProfile(db.prisma);
    const session = await seedCheckoutSession({ siteProfileId: stranger.siteProfileId });
    const { rawBody, signature } = paidOrder(session.reference);

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toMatch(/site profile/);
    expect(await db.prisma.purchase.count()).toBe(0);
    expect(await db.prisma.scan.count()).toBe(0);
    expect(await db.prisma.entitlement.count()).toBe(0);

    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.status).toBe(CHECKOUT_SESSION_STATUSES.rejected);
    expect(stored.purchaseId).toBeNull();
    // The claim's own writes went with the rolled-back transaction.
    expect(stored.settledAmount).toBeNull();
    expect(stored.settledCurrency).toBeNull();
  });

  // The rolled-back transaction takes the dedup row with it, so the delivery has
  // to be recorded again afterwards — otherwise the same payload would be
  // reprocessed forever and the rejection would be invisible to support.
  it('still records the rejected delivery after the rollback', async () => {
    const stranger = await seedAccountWithProfile(db.prisma);
    const session = await seedCheckoutSession({ siteProfileId: stranger.siteProfileId });
    const { rawBody, signature } = paidOrder(session.reference);

    await deliver(rawBody, signature);

    const event = await db.prisma.webhookEvent.findFirstOrThrow();
    expect(event.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(event.outcomeReason).toMatch(/site profile/);
    expect(event.accountId).toBe(account.accountId);
    expect(event.providerTransactionId).not.toBeNull();

    // And a redelivery of the same event is deduplicated rather than retried.
    const again = await deliver(rawBody, signature);
    expect(again.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.deduplicated);
    expect(await db.prisma.webhookEvent.count()).toBe(1);
  });

  it('grants normally when nothing fails after the claim', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference);

    const result = await deliver(rawBody, signature);

    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.status).toBe(CHECKOUT_SESSION_STATUSES.completed);
    expect(stored.purchaseId).not.toBeNull();
    expect(await db.prisma.scan.count()).toBe(1);
  });

  describe('what the buyer is told', () => {
    // The stored reason is written for us: it quotes amounts, product paths and
    // the internal vocabulary of the webhook handler. The browser gets a code.
    it('answers a rejected checkout with a code, never the internal reason', async () => {
      const stranger = await seedAccountWithProfile(db.prisma);
      const session = await seedCheckoutSession({ siteProfileId: stranger.siteProfileId });
      const { rawBody, signature } = paidOrder(session.reference);
      await deliver(rawBody, signature);

      const view = await findCheckoutStatus(db.prisma, account.accountId, session.reference);

      expect(view.status).toBe(CHECKOUT_SESSION_STATUSES.rejected);
      expect(view.reasonCode).toBe(CHECKOUT_REASON_CODES.paymentNotVerified);
      expect(JSON.stringify(view)).not.toMatch(/site profile/);

      // Support still has the detail, in the database where it belongs.
      const stored = await db.prisma.checkoutSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(stored.statusReason).toMatch(/site profile/);
    });

    it('says nothing about a checkout that is still open or already paid', async () => {
      const session = await seedCheckoutSession();
      const open = await findCheckoutStatus(db.prisma, account.accountId, session.reference);
      expect(open.reasonCode).toBeNull();

      const { rawBody, signature } = paidOrder(session.reference);
      await deliver(rawBody, signature);
      const paid = await findCheckoutStatus(db.prisma, account.accountId, session.reference);
      expect(paid.status).toBe(CHECKOUT_SESSION_STATUSES.completed);
      expect(paid.reasonCode).toBeNull();
      expect(paid.scanId).not.toBeNull();
    });

    it('maps the housekeeping and provider reasons to their own codes', () => {
      const rejected = CHECKOUT_SESSION_STATUSES.rejected;
      expect(checkoutReasonCode(rejected, CHECKOUT_STATUS_REASONS.abandoned)).toBe(
        CHECKOUT_REASON_CODES.expired,
      );
      expect(checkoutReasonCode(rejected, CHECKOUT_STATUS_REASONS.providerUnavailable)).toBe(
        CHECKOUT_REASON_CODES.providerUnavailable,
      );
      // A reason added later must not reach the browser by being forgotten here.
      expect(checkoutReasonCode(rejected, 'order amount 1 does not match the quoted 120')).toBe(
        CHECKOUT_REASON_CODES.paymentNotVerified,
      );
      expect(checkoutReasonCode(rejected, null)).toBeNull();
    });
  });
});
