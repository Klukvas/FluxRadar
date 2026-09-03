import { ENTITLEMENT_DAYS, TARIFFS } from '@fluxradar/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { simulatePaidCheckout } from './dev-checkout.ts';
import { InvalidSignatureError, WebhookValidationError } from './errors.ts';
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

// BILLING-001: signature verification (D-029) and amount/currency/priceId
// validation against TARIFFS (§18) gate every webhook side effect.
describe('BILLING-001 webhook signature and price validation', () => {
  let db: TestDb;
  let account: SeededAccount;

  beforeAll(async () => {
    db = await createTestDb();
    account = await seedAccountWithProfile(db.prisma);
  });

  afterAll(async () => {
    await db.cleanup();
  });

  const validRawBody = (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({
      eventId: 'evt_sig_1',
      eventType: 'transaction.paid',
      transactionId: 'txn_sig_1',
      accountId: account.accountId,
      siteProfileId: account.siteProfileId,
      plan: 'Basic',
      amountUsd: TARIFFS.Basic.priceUsd,
      currency: 'USD',
      priceId: PADDLE_PRICE_IDS.Basic,
      ...overrides,
    });

  it('rejects an invalid signature without creating a WebhookEvent', async () => {
    const rawBody = validRawBody();
    await expect(
      handlePaddleWebhook(db.prisma, rawBody, 'deadbeef', { secret: TEST_WEBHOOK_SECRET }),
    ).rejects.toBeInstanceOf(InvalidSignatureError);

    expect(await db.prisma.webhookEvent.count()).toBe(0);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  it('rejects a tampered body signed for different content', async () => {
    const signature = signPaddleWebhook(validRawBody(), TEST_WEBHOOK_SECRET);
    const tampered = validRawBody({ amountUsd: 1 });
    await expect(
      handlePaddleWebhook(db.prisma, tampered, signature, { secret: TEST_WEBHOOK_SECRET }),
    ).rejects.toBeInstanceOf(InvalidSignatureError);
    expect(await db.prisma.webhookEvent.count()).toBe(0);
  });

  it('rejects a validly signed event with a wrong amount', async () => {
    const rawBody = validRawBody({ amountUsd: 1 });
    const signature = signPaddleWebhook(rawBody, TEST_WEBHOOK_SECRET);
    await expect(
      handlePaddleWebhook(db.prisma, rawBody, signature, { secret: TEST_WEBHOOK_SECRET }),
    ).rejects.toBeInstanceOf(WebhookValidationError);
    expect(await db.prisma.purchase.count()).toBe(0);
    expect(await db.prisma.webhookEvent.count()).toBe(0);
  });

  it('rejects a wrong priceId and a wrong currency', async () => {
    for (const overrides of [{ priceId: 'pri_evil' }, { currency: 'EUR' }]) {
      const rawBody = validRawBody(overrides);
      const signature = signPaddleWebhook(rawBody, TEST_WEBHOOK_SECRET);
      await expect(
        handlePaddleWebhook(db.prisma, rawBody, signature, { secret: TEST_WEBHOOK_SECRET }),
      ).rejects.toBeInstanceOf(WebhookValidationError);
    }
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  it('creates Purchase + Entitlement (30 days) + Scan(Pending) + Job on a valid event', async () => {
    const before = Date.now();
    const { result } = await simulatePaidCheckout({
      prisma: db.prisma,
      accountId: account.accountId,
      siteProfileId: account.siteProfileId,
      plan: 'Basic',
      secret: TEST_WEBHOOK_SECRET,
    });

    expect(result.deduplicated).toBe(false);
    expect(result.purchaseId).not.toBeNull();

    const purchase = await db.prisma.purchase.findUniqueOrThrow({
      where: { id: result.purchaseId ?? '' },
      include: { entitlement: true, scan: { include: { job: true } } },
    });
    expect(purchase.plan).toBe('Basic');
    expect(purchase.amountUsd).toBe(TARIFFS.Basic.priceUsd);
    expect(purchase.status).toBe('paid');

    expect(purchase.entitlement).not.toBeNull();
    expect(purchase.entitlement?.suspended).toBe(false);
    const expectedExpiry = before + ENTITLEMENT_DAYS * 24 * 60 * 60 * 1000;
    expect(purchase.entitlement?.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpiry - 5000);
    expect(purchase.entitlement?.expiresAt.getTime()).toBeLessThanOrEqual(expectedExpiry + 60_000);

    expect(purchase.scan?.status).toBe('Pending');
    expect(purchase.scan?.domain).toBe(account.domain);
    expect(purchase.scan?.job?.status).toBe('Pending');
    expect(await db.prisma.webhookEvent.count()).toBe(1);
  });
});
