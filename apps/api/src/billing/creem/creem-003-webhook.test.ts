import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from '@fluxradar/ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutSession, Prisma } from '@prisma/client';

import { createTestDb, seedAccountWithProfile, type TestDb } from '../../test-utils/test-db.ts';
import type { SeededAccount } from '../../test-utils/test-db.ts';
import { InvalidSignatureError, WebhookValidationError } from '../errors.ts';
import { WEBHOOK_OUTCOMES } from '../webhook-outcomes.ts';
import { CREEM_PROVIDER } from './config.ts';
import { CREEM_EVENT_TYPES } from './events.ts';
import { signCreemWebhook } from './signature.ts';
import {
  TEST_CREEM_SECRET,
  checkoutCompletedObject,
  signedCreemDelivery,
  type CheckoutCompletedOptions,
} from './test-payloads.ts';
import { handleCreemWebhook } from './webhook-handler.ts';

// CREEM-003: the webhook is the only path that grants paid access.
//
// It verifies the raw-body HMAC, deduplicates by event id, and answers 2xx for
// everything it cannot act on so Creem never loops on a payload no retry could
// fix. Every payload here is a local fixture — the suite needs neither a Creem
// account nor network access.

const BASIC_PRODUCT = 'prod_basic';
const BASIC_PRICE = 55;
const BASIC_CENTS = 5500;

describe('CREEM-003 webhook', () => {
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
        scopeJson: JSON.stringify({ includeSubdomains: false, maxPages: 12 }),
        aiConsentJson: JSON.stringify({
          providers: ['anthropic', 'openai'],
          noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
        }),
        ...overrides,
      },
    });
  }

  const deliver = (rawBody: string, signature: string, expectLive = false) =>
    handleCreemWebhook(db.prisma, rawBody, signature, {
      secret: TEST_CREEM_SECRET,
      expectLive,
    });

  /** One signed checkout.completed for a Basic order at the list price. */
  function paidOrder(
    reference: string | null,
    orderId: string,
    eventId: string,
    options: Partial<CheckoutCompletedOptions> = {},
  ) {
    return signedCreemDelivery({
      id: eventId,
      eventType: CREEM_EVENT_TYPES.checkoutCompleted,
      object: checkoutCompletedObject({
        checkoutId: `ch_${orderId}`,
        orderId,
        reference,
        productId: BASIC_PRODUCT,
        amountCents: BASIC_CENTS,
        ...options,
      }),
    });
  }

  function purchaseOf(orderId: string) {
    return db.prisma.purchase.findUnique({
      where: {
        provider_providerTransactionId: {
          provider: CREEM_PROVIDER,
          providerTransactionId: orderId,
        },
      },
      include: { entitlement: true, scan: { include: { aiConsent: true, job: true } } },
    });
  }

  it('rejects an invalid signature and a body that is not a Creem event', async () => {
    const { rawBody, signature } = paidOrder('frcs_x', 'ord_sig', 'evt_sig');
    await expect(deliver(rawBody, 'not-a-signature')).rejects.toBeInstanceOf(InvalidSignatureError);
    await expect(deliver(`${rawBody} `, signature)).rejects.toBeInstanceOf(InvalidSignatureError);
    await expect(deliver(rawBody, '')).rejects.toBeInstanceOf(InvalidSignatureError);

    const notAnEvent = JSON.stringify({ hello: 'world' });
    await expect(
      deliver(notAnEvent, signCreemWebhook(notAnEvent, TEST_CREEM_SECRET)),
    ).rejects.toBeInstanceOf(WebhookValidationError);
    const notJson = '{not json';
    await expect(
      deliver(notJson, signCreemWebhook(notJson, TEST_CREEM_SECRET)),
    ).rejects.toBeInstanceOf(WebhookValidationError);
    expect(await db.prisma.purchase.count()).toBe(0);
    expect(await db.prisma.webhookEvent.count()).toBe(0);
  });

  it('grants exactly one scan for checkout.completed and applies the stored scope and consent', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, 'ord_paid_1', 'evt_paid_1');

    const result = await deliver(rawBody, signature);
    expect(result.received).toBe(1);
    expect(result.results[0]).toMatchObject({
      eventId: 'evt_paid_1',
      eventType: CREEM_EVENT_TYPES.checkoutCompleted,
      outcome: WEBHOOK_OUTCOMES.processed,
      reason: null,
    });
    expect(result.createdScanIds).toHaveLength(1);

    const purchase = await purchaseOf('ord_paid_1');
    expect(purchase).not.toBeNull();
    if (purchase === null) return;
    expect(result.results[0]?.purchaseId).toBe(purchase.id);
    expect(result.results[0]?.entitlementId).toBe(purchase.entitlement?.id);
    expect(result.results[0]?.scanId).toBe(purchase.scan?.id);
    // The account and profile come from our own row, never from the payload.
    expect(purchase.accountId).toBe(account.accountId);
    expect(purchase.siteProfileId).toBe(account.siteProfileId);
    expect(purchase.provider).toBe(CREEM_PROVIDER);
    expect(purchase.priceId).toBe(BASIC_PRODUCT);
    expect(purchase.amountUsd).toBe(BASIC_PRICE);
    expect(purchase.currency).toBe('USD');
    expect(purchase.status).toBe('paid');
    expect(purchase.entitlement?.suspended).toBe(false);
    expect(purchase.scan?.status).toBe('Pending');
    expect(purchase.scan?.plan).toBe('Basic');
    expect(purchase.scan?.scopeJson).toBe(session.scopeJson);
    expect(purchase.scan?.job?.status).toBe('Pending');
    expect(purchase.scan?.aiConsent?.noticeVersion).toBe(CURRENT_AI_PROCESSING_NOTICE_VERSION);
    expect(await db.prisma.purchase.count()).toBe(1);
    expect(await db.prisma.entitlement.count()).toBe(1);
    expect(await db.prisma.scan.count()).toBe(1);
    expect(await db.prisma.job.count()).toBe(1);

    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(stored.status).toBe('completed');
    expect(stored.statusReason).toBeNull();
    expect(stored.purchaseId).toBe(purchase.id);
    expect(stored.settledAmount).toBe(BASIC_PRICE);
    expect(stored.settledCurrency).toBe('USD');

    const event = await db.prisma.webhookEvent.findFirstOrThrow({
      where: { provider: CREEM_PROVIDER, providerEventId: 'evt_paid_1' },
    });
    expect(event.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(event.accountId).toBe(account.accountId);
    expect(event.providerTransactionId).toBe('ord_paid_1');
    expect(event.rawBody).toBe(rawBody);
    expect(event.signature).toBe(signature);
  });

  it('links the order when the reference only survives in the checkout metadata', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, 'ord_meta', 'evt_meta', {
      referenceInMetadataOnly: true,
    });
    const result = await deliver(rawBody, signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(await db.prisma.scan.count()).toBe(1);
  });

  it('is a no-op on redelivery of the same event id and of the same order', async () => {
    const session = await seedCheckoutSession();
    const paid = paidOrder(session.reference, 'ord_dup', 'evt_dup');

    const first = await deliver(paid.rawBody, paid.signature);
    const redelivered = await deliver(paid.rawBody, paid.signature);
    expect(first.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(redelivered.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.deduplicated);
    expect(redelivered.results[0]?.reason).toBe('event already processed');
    expect(redelivered.createdScanIds).toHaveLength(0);

    // A manual retry arrives with a NEW event id but the same order.
    const manualRetry = paidOrder(session.reference, 'ord_dup', 'evt_dup_manual');
    const retried = await deliver(manualRetry.rawBody, manualRetry.signature);
    expect(retried.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.deduplicated);
    expect(retried.results[0]?.reason).toBe('order already granted');
    // The scan it bought is still named, so a redelivery can tell the buyer.
    expect(retried.results[0]?.scanId).toBe(first.createdScanIds[0]);
    expect(retried.createdScanIds).toHaveLength(0);

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
        delivery: paidOrder(null, 'ord_no_ref', 'evt_no_ref'),
        reason: /no FluxRadar checkout reference/,
      },
      {
        name: 'unknown checkout reference',
        delivery: paidOrder('frcs_not_ours', 'ord_unknown_ref', 'evt_unknown_ref'),
        reason: /does not belong to this environment/,
      },
      {
        name: 'foreign product',
        delivery: paidOrder(session.reference, 'ord_bad_product', 'evt_bad_product', {
          productId: 'prod_someone_elses',
        }),
        reason: /product prod_someone_elses, not prod_basic/,
      },
      {
        name: 'tampered amount',
        delivery: paidOrder(session.reference, 'ord_bad_amount', 'evt_bad_amount', {
          amountCents: 100,
        }),
        reason: /below the 55 USD Basic plan price/,
      },
      {
        name: 'no amount at all',
        delivery: paidOrder(session.reference, 'ord_no_amount', 'evt_no_amount', {
          omitAmounts: true,
        }),
        reason: /states no order amount/,
      },
    ];

    for (const testCase of cases) {
      const result = await deliver(testCase.delivery.rawBody, testCase.delivery.signature);
      expect(result.results[0]?.outcome, testCase.name).toBe(WEBHOOK_OUTCOMES.rejected);
      expect(result.results[0]?.reason, testCase.name).toMatch(testCase.reason);
      expect(result.results[0]?.purchaseId, testCase.name).toBeNull();
    }

    expect(await db.prisma.purchase.count()).toBe(0);
    expect(await db.prisma.scan.count()).toBe(0);
    // Every rejected event is still stored, so the delivery is never retried.
    expect(await db.prisma.webhookEvent.count()).toBe(cases.length);
    const rejectedEvent = await db.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_bad_amount' },
    });
    expect(rejectedEvent.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(rejectedEvent.outcomeReason).toMatch(/below the 55 USD/);
    expect(rejectedEvent.accountId).toBe(account.accountId);
  });

  it('marks the session rejected when the order names another product than it was opened for', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, 'ord_wrong', 'evt_wrong', {
      productId: 'prod_complete',
    });
    const result = await deliver(rawBody, signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);

    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.status).toBe('rejected');
    expect(stored.statusReason).toBe('order is for product prod_complete, not prod_basic');
    expect(stored.purchaseId).toBeNull();
  });

  it('refuses an order that names no product rather than assuming it is ours', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = signedCreemDelivery({
      id: 'evt_no_product',
      eventType: CREEM_EVENT_TYPES.checkoutCompleted,
      object: {
        id: 'ch_no_product',
        request_id: session.reference,
        order: { id: 'ord_no_product', amount: BASIC_CENTS, currency: 'USD', mode: 'test' },
        mode: 'test',
      },
    });
    const result = await deliver(rawBody, signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toBe(
      'order names no product; the checkout was opened for prod_basic',
    );
    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.status).toBe('rejected');
  });

  it('marks the session rejected when the charge is below the tariff', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, 'ord_short', 'evt_short', {
      discountCents: 2750,
    });
    const result = await deliver(rawBody, signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toMatch(
      /after a discount, below the 55 USD Basic plan price/,
    );
    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.status).toBe('rejected');
    expect(stored.statusReason).toMatch(/after a discount/);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  // The shape Creem's own webhook example documents: an order with nothing but
  // its list price. With a coupon on the checkout, that list price is not what
  // was paid, and the order is refused rather than granted at full value.
  it('marks the session rejected when a discounted order states no post-discount charge', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, 'ord_minimal', 'evt_minimal', {
      minimalOrder: true,
      discountCents: 2750,
    });
    const result = await deliver(rawBody, signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toMatch(/states no post-discount charge/);
    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.status).toBe('rejected');
    expect(await db.prisma.purchase.count()).toBe(0);

    // The same minimal shape without a discount is the list price, and pays.
    const paid = await seedCheckoutSession();
    const plain = paidOrder(paid.reference, 'ord_minimal_ok', 'evt_minimal_ok', {
      minimalOrder: true,
    });
    const granted = await deliver(plain.rawBody, plain.signature);
    expect(granted.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(await db.prisma.purchase.count()).toBe(1);
  });

  it('never lets one checkout reference buy two scans', async () => {
    const session = await seedCheckoutSession();
    const first = paidOrder(session.reference, 'ord_ref_1', 'evt_ref_1');
    const second = paidOrder(session.reference, 'ord_ref_2', 'evt_ref_2');
    expect((await deliver(first.rawBody, first.signature)).results[0]?.outcome).toBe(
      WEBHOOK_OUTCOMES.processed,
    );
    const rejected = await deliver(second.rawBody, second.signature);
    expect(rejected.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(rejected.results[0]?.reason).toBe(
      'checkout reference was already used by another order',
    );
    expect(await db.prisma.scan.count()).toBe(1);
    // The completed session keeps its first order; it is not relabelled rejected.
    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.status).toBe('completed');
  });

  it('ignores a live-environment order on a test deployment, and the reverse', async () => {
    const session = await seedCheckoutSession();
    const live = paidOrder(session.reference, 'ord_live', 'evt_live', { mode: 'prod' });
    const result = await deliver(live.rawBody, live.signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.ignored);
    expect(result.results[0]?.reason).toMatch(/from the live Creem environment/);

    const liveSession = await seedCheckoutSession({ liveMode: true });
    const test = paidOrder(liveSession.reference, 'ord_test', 'evt_test', { mode: 'sandbox' });
    const onLive = await deliver(test.rawBody, test.signature, true);
    expect(onLive.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.ignored);
    expect(onLive.results[0]?.reason).toMatch(/from the test Creem environment/);

    expect(await db.prisma.purchase.count()).toBe(0);
    // Ignored, not rejected: the sessions stay open for the right environment.
    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.status).toBe('created');
  });

  // An event that states no mode is settled by the session it names, which
  // records the mode it was opened in — never assumed to be a test order.
  it('rejects an unmarked order whose session was opened in the other mode', async () => {
    const session = await seedCheckoutSession({ liveMode: true });
    const { rawBody, signature } = paidOrder(
      session.reference,
      'ord_other_mode',
      'evt_other_mode',
      {
        mode: null,
      },
    );
    const result = await deliver(rawBody, signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toBe('checkout session was opened in the other Creem mode');
    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.status).toBe('rejected');
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  it('grants an unmarked order whose session was opened in this mode', async () => {
    const session = await seedCheckoutSession();
    const { rawBody, signature } = paidOrder(session.reference, 'ord_unmarked', 'evt_unmarked', {
      mode: null,
    });
    const result = await deliver(rawBody, signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
    expect(result.createdScanIds).toHaveLength(1);
  });

  it('ignores an event type it does not act on, and still stores it', async () => {
    const { rawBody, signature } = signedCreemDelivery({
      id: 'evt_sub',
      eventType: 'subscription.active',
      object: { id: 'sub_1', mode: 'test' },
    });
    const result = await deliver(rawBody, signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.ignored);
    expect(result.results[0]?.reason).toBe('unsupported event type subscription.active');
    const stored = await db.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_sub' },
    });
    expect(stored.outcome).toBe(WEBHOOK_OUTCOMES.ignored);
    expect(stored.eventType).toBe('subscription.active');
  });

  // A reference is only a reference together with its provider: a Creem order
  // quoting a session another provider opened must not buy that session's scan.
  it('rejects a Creem order that names another provider’s checkout session', async () => {
    const session = await seedCheckoutSession({
      provider: 'other-provider',
      productPath: 'fluxradar-basic-scan',
    });
    const { rawBody, signature } = paidOrder(session.reference, 'ord_cross', 'evt_cross', {
      productId: 'fluxradar-basic-scan',
    });
    const result = await deliver(rawBody, signature);
    expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
    expect(result.results[0]?.reason).toBe(
      'checkout reference does not belong to this environment',
    );
    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    // Not ours to close: the other provider's order for it may still arrive.
    expect(stored.status).toBe('created');
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  it('processes every event of a hand-replayed batch independently', async () => {
    const session = await seedCheckoutSession();
    const events = [
      {
        id: 'evt_batch_paid',
        eventType: CREEM_EVENT_TYPES.checkoutCompleted,
        created_at: 1,
        object: checkoutCompletedObject({
          checkoutId: 'ch_batch',
          orderId: 'ord_batch',
          reference: session.reference,
          productId: BASIC_PRODUCT,
          amountCents: BASIC_CENTS,
        }),
      },
      { id: 'evt_batch_unknown', eventType: 'subscription.active', created_at: 2, object: {} },
      {
        id: 'evt_batch_foreign',
        eventType: CREEM_EVENT_TYPES.checkoutCompleted,
        created_at: 3,
        object: checkoutCompletedObject({
          checkoutId: 'ch_batch_foreign',
          orderId: 'ord_batch_foreign',
          reference: 'frcs_not_ours',
          productId: BASIC_PRODUCT,
          amountCents: BASIC_CENTS,
        }),
      },
    ];
    const rawBody = JSON.stringify(events);
    const result = await deliver(rawBody, signCreemWebhook(rawBody, TEST_CREEM_SECRET));
    expect(result.received).toBe(3);
    expect(result.results.map((entry) => entry.outcome)).toEqual([
      WEBHOOK_OUTCOMES.processed,
      WEBHOOK_OUTCOMES.ignored,
      WEBHOOK_OUTCOMES.rejected,
    ]);
    // A rejected sibling must not roll back the event that granted access.
    expect(await db.prisma.purchase.count()).toBe(1);
    expect(await db.prisma.webhookEvent.count()).toBe(3);
  });
});
