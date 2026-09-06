import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutSession, Prisma } from '@prisma/client';

import { createTestDb, seedAccountWithProfile, type TestDb } from '../../test-utils/test-db.ts';
import type { SeededAccount } from '../../test-utils/test-db.ts';
import { InvalidSignatureError, WebhookValidationError } from '../errors.ts';
import { FASTSPRING_PROVIDER } from './config.ts';
import { signFastSpringWebhook } from './signature.ts';
import { handleFastSpringWebhook, WEBHOOK_OUTCOMES } from './webhook-handler.ts';
import {
  TEST_FASTSPRING_SECRET,
  chargebackCreatedData,
  orderCompletedData,
  returnCreatedData,
  signedDelivery,
} from './test-payloads.ts';

// FASTSPRING-003: the webhook is the only path that grants paid access.
//
// It verifies the raw-body HMAC, deduplicates by event id, and answers 2xx for
// everything it cannot act on so FastSpring never loops on a payload no retry
// could fix. Every payload here is a local fixture — the suite needs neither a
// FastSpring account nor network access.

const BASIC_PRODUCT = 'fluxradar-basic-scan';
const BASIC_PRICE = 55;

describe('FASTSPRING-003 webhook', () => {
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
        scopeJson: JSON.stringify({ includeSubdomains: false, maxPages: 12 }),
        aiConsentJson: JSON.stringify({ providers: ['anthropic'], noticeVersion: 'v1' }),
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

  it('rejects an invalid signature and a body that is not a FastSpring envelope', async () => {
    const { rawBody, signature } = signedDelivery([
      {
        id: 'evt_sig',
        type: 'order.completed',
        data: orderCompletedData({
          orderId: 'ord_sig',
          reference: 'frcs_x',
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
        }),
      },
    ]);
    await expect(deliver(rawBody, 'not-a-signature')).rejects.toBeInstanceOf(InvalidSignatureError);
    await expect(deliver(`${rawBody} `, signature)).rejects.toBeInstanceOf(InvalidSignatureError);

    const notAnEnvelope = JSON.stringify({ hello: 'world' });
    await expect(
      deliver(notAnEnvelope, signFastSpringWebhook(notAnEnvelope, TEST_FASTSPRING_SECRET)),
    ).rejects.toBeInstanceOf(WebhookValidationError);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  it('grants exactly one scan for order.completed and applies the stored scope and consent', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = signedDelivery([
      {
        id: 'evt_paid_1',
        type: 'order.completed',
        data: orderCompletedData({
          orderId: 'ord_paid_1',
          reference: session.reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
        }),
      },
    ]);

    const result = await deliver(rawBody, signature);
    expect(result.received).toBe(1);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.createdScanIds).toHaveLength(1);

    const purchase = await db.prisma.purchase.findUniqueOrThrow({
      where: {
        provider_providerTransactionId: {
          provider: FASTSPRING_PROVIDER,
          providerTransactionId: 'ord_paid_1',
        },
      },
      include: { entitlement: true, scan: { include: { aiConsent: true, job: true } } },
    });
    // The account and profile come from our own row, never from the payload.
    expect(purchase.accountId).toBe(account.accountId);
    expect(purchase.siteProfileId).toBe(account.siteProfileId);
    expect(purchase.priceId).toBe(BASIC_PRODUCT);
    expect(purchase.entitlement).not.toBeNull();
    expect(purchase.scan?.status).toBe('Pending');
    expect(purchase.scan?.scopeJson).toBe(session.scopeJson);
    expect(purchase.scan?.job?.status).toBe('Pending');
    expect(purchase.scan?.aiConsent?.noticeVersion).toBe('v1');

    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(stored.status).toBe('completed');
    expect(stored.purchaseId).toBe(purchase.id);
  });

  it('links the order when the reference only survives as an item attribute', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = signedDelivery([
      {
        id: 'evt_attr',
        type: 'order.completed',
        data: orderCompletedData({
          orderId: 'ord_attr',
          reference: session.reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
          referenceInAttributesOnly: true,
        }),
      },
    ]);
    const result = await deliver(rawBody, signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
  });

  it('processes every event of a multi-event delivery independently', async () => {
    const paidSession = await seedCheckoutSession();
    const { rawBody, signature } = signedDelivery([
      {
        id: 'evt_batch_paid',
        type: 'order.completed',
        data: orderCompletedData({
          orderId: 'ord_batch',
          reference: paidSession.reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
        }),
      },
      { id: 'evt_batch_unknown', type: 'subscription.activated', data: { id: 'sub_1' } },
      {
        id: 'evt_batch_orphan_refund',
        type: 'return.created',
        data: returnCreatedData('ord_never_seen', BASIC_PRICE),
      },
    ]);

    const result = await deliver(rawBody, signature);
    expect(result.received).toBe(3);
    expect(result.results.map((entry) => entry.outcome)).toEqual([
      WEBHOOK_OUTCOMES.processed,
      WEBHOOK_OUTCOMES.ignored,
      WEBHOOK_OUTCOMES.unlinked,
    ]);
    // A rejected sibling must not roll back the event that granted access.
    expect(await db.prisma.purchase.count()).toBe(1);
    expect(await db.prisma.webhookEvent.count()).toBe(3);
  });

  it('is a no-op on redelivery of the same event id and of the same order', async () => {
    const session = await seedCheckoutSession();
    const paid = signedDelivery([
      {
        id: 'evt_dup',
        type: 'order.completed',
        data: orderCompletedData({
          orderId: 'ord_dup',
          reference: session.reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
        }),
      },
    ]);

    const first = await deliver(paid.rawBody, paid.signature);
    const redelivered = await deliver(paid.rawBody, paid.signature);
    expect(first.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(redelivered.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.deduplicated);

    // A manual retry arrives with a NEW event id but the same order.
    const manualRetry = signedDelivery([
      {
        id: 'evt_dup_manual',
        type: 'order.completed',
        data: orderCompletedData({
          orderId: 'ord_dup',
          reference: session.reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
        }),
      },
    ]);
    const retried = await deliver(manualRetry.rawBody, manualRetry.signature);
    expect(retried.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.deduplicated);

    expect(await db.prisma.purchase.count()).toBe(1);
    expect(await db.prisma.scan.count()).toBe(1);
    expect(await db.prisma.entitlement.count()).toBe(1);
    expect(await db.prisma.webhookEvent.count()).toBe(2);
  });

  it('rejects a tampered or foreign order without creating anything, and still answers', async () => {
    const session = await seedCheckoutSession();
    const cases = [
      {
        name: 'no checkout reference',
        id: 'evt_no_ref',
        data: orderCompletedData({
          orderId: 'ord_no_ref',
          reference: null,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
        }),
      },
      {
        name: 'unknown checkout reference',
        id: 'evt_unknown_ref',
        data: orderCompletedData({
          orderId: 'ord_unknown_ref',
          reference: 'frcs_not_ours',
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
        }),
      },
      {
        name: 'foreign product',
        id: 'evt_bad_product',
        data: orderCompletedData({
          orderId: 'ord_bad_product',
          reference: session.reference,
          productPath: 'someone-elses-product',
          amount: BASIC_PRICE,
        }),
      },
      {
        name: 'tampered amount',
        id: 'evt_bad_amount',
        data: orderCompletedData({
          orderId: 'ord_bad_amount',
          reference: session.reference,
          productPath: BASIC_PRODUCT,
          amount: 1,
        }),
      },
      {
        name: 'unexpected currency',
        id: 'evt_bad_currency',
        data: orderCompletedData({
          orderId: 'ord_bad_currency',
          reference: session.reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
          currency: 'EUR',
        }),
      },
    ];

    for (const testCase of cases) {
      const { rawBody, signature } = signedDelivery([
        { id: testCase.id, type: 'order.completed', data: testCase.data },
      ]);
      const result = await deliver(rawBody, signature);
      expect(result.results[0]?.outcome, testCase.name).toBe(WEBHOOK_OUTCOMES.rejected);
      expect(result.results[0]?.reason, testCase.name).not.toBeNull();
    }

    expect(await db.prisma.purchase.count()).toBe(0);
    expect(await db.prisma.scan.count()).toBe(0);
    // Every rejected event is still stored, so the delivery is never retried.
    expect(await db.prisma.webhookEvent.count()).toBe(cases.length);
    const rejectedEvent = await db.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_bad_amount' },
    });
    expect(rejectedEvent.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(rejectedEvent.outcomeReason).toMatch(/amount/);
  });

  it('never lets one checkout reference buy two scans', async () => {
    const session = await seedCheckoutSession();
    const first = signedDelivery([
      {
        id: 'evt_ref_1',
        type: 'order.completed',
        data: orderCompletedData({
          orderId: 'ord_ref_1',
          reference: session.reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
        }),
      },
    ]);
    const second = signedDelivery([
      {
        id: 'evt_ref_2',
        type: 'order.completed',
        data: orderCompletedData({
          orderId: 'ord_ref_2',
          reference: session.reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
        }),
      },
    ]);
    expect((await deliver(first.rawBody, first.signature)).results[0]?.outcome).toBe(
      WEBHOOK_OUTCOMES.processed,
    );
    expect((await deliver(second.rawBody, second.signature)).results[0]?.outcome).toBe(
      WEBHOOK_OUTCOMES.rejected,
    );
    expect(await db.prisma.scan.count()).toBe(1);
  });

  it('ignores a test-mode order on a live deployment', async () => {
    const session = await seedCheckoutSession({ liveMode: true });
    const { rawBody, signature } = signedDelivery([
      {
        id: 'evt_test_mode',
        type: 'order.completed',
        live: false,
        data: orderCompletedData({
          orderId: 'ord_test_mode',
          reference: session.reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
          live: false,
        }),
      },
    ]);
    const result = await handleFastSpringWebhook(db.prisma, rawBody, signature, {
      secret: TEST_FASTSPRING_SECRET,
      expectLive: true,
      currencyPolicy: 'strict',
    });
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.ignored);
    expect(result.results[0]?.reason).toMatch(/live=false/);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  it('records a refund for return.created and suspends nothing before the order exists', async () => {
    const session = await seedCheckoutSession();
    const paid = signedDelivery([
      {
        id: 'evt_refund_paid',
        type: 'order.completed',
        data: orderCompletedData({
          orderId: 'ord_refund',
          reference: session.reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
        }),
      },
    ]);
    await deliver(paid.rawBody, paid.signature);

    const refund = signedDelivery([
      {
        id: 'evt_refund',
        type: 'return.created',
        data: returnCreatedData('ord_refund', BASIC_PRICE),
      },
    ]);
    const result = await deliver(refund.rawBody, refund.signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);

    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { refund: true } });
    expect(purchase.status).toBe('Refunded');
    expect(purchase.refund?.status).toBe('paid');
    expect(purchase.refund?.amountUsd).toBe(BASIC_PRICE);
    expect(purchase.refund?.provider).toBe(FASTSPRING_PROVIDER);
    expect(purchase.refund?.providerTransactionId).toBe('ord_refund');

    // Redelivering the refund with a new event id must not create a second record.
    const again = signedDelivery([
      {
        id: 'evt_refund_2',
        type: 'return.created',
        data: returnCreatedData('ord_refund', BASIC_PRICE),
      },
    ]);
    await deliver(again.rawBody, again.signature);
    expect(await db.prisma.refundRecord.count()).toBe(1);
  });

  it('suspends the entitlement on chargeback.created and stores an orphan chargeback', async () => {
    const session = await seedCheckoutSession();
    const paid = signedDelivery([
      {
        id: 'evt_cb_paid',
        type: 'order.completed',
        data: orderCompletedData({
          orderId: 'ord_cb',
          reference: session.reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
        }),
      },
    ]);
    await deliver(paid.rawBody, paid.signature);

    const chargeback = signedDelivery([
      {
        id: 'evt_cb',
        type: 'chargeback.created',
        data: chargebackCreatedData('ord_cb', BASIC_PRICE),
      },
    ]);
    expect((await deliver(chargeback.rawBody, chargeback.signature)).results[0]?.outcome).toBe(
      WEBHOOK_OUTCOMES.processed,
    );
    const purchase = await db.prisma.purchase.findFirstOrThrow({ include: { entitlement: true } });
    expect(purchase.status).toBe('Disputed');
    expect(purchase.entitlement?.suspended).toBe(true);

    const orphan = signedDelivery([
      {
        id: 'evt_cb_orphan',
        type: 'chargeback.created',
        data: chargebackCreatedData('ord_never_paid', BASIC_PRICE),
      },
    ]);
    expect((await deliver(orphan.rawBody, orphan.signature)).results[0]?.outcome).toBe(
      WEBHOOK_OUTCOMES.unlinked,
    );
  });

  it('keeps a refunded purchase refunded when a later chargeback arrives', async () => {
    const session = await seedCheckoutSession();
    const paid = signedDelivery([
      {
        id: 'evt_mono_paid',
        type: 'order.completed',
        data: orderCompletedData({
          orderId: 'ord_mono',
          reference: session.reference,
          productPath: BASIC_PRODUCT,
          amount: BASIC_PRICE,
        }),
      },
    ]);
    await deliver(paid.rawBody, paid.signature);
    const refund = signedDelivery([
      {
        id: 'evt_mono_refund',
        type: 'return.created',
        data: returnCreatedData('ord_mono', BASIC_PRICE),
      },
    ]);
    await deliver(refund.rawBody, refund.signature);
    const chargeback = signedDelivery([
      {
        id: 'evt_mono_cb',
        type: 'chargeback.created',
        data: chargebackCreatedData('ord_mono', BASIC_PRICE),
      },
    ]);
    await deliver(chargeback.rawBody, chargeback.signature);

    const purchase = await db.prisma.purchase.findFirstOrThrow();
    expect(purchase.status).toBe('Refunded');
  });
});
