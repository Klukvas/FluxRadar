import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { simulatePaidCheckout } from './dev-checkout.ts';
import {
  TEST_WEBHOOK_SECRET,
  createTestDb,
  seedAccountWithProfile,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';

// BILLING-002: a redelivered provider event id is a no-op — one Purchase /
// Entitlement / Scan / Job regardless of how many times (or how concurrently)
// the same event arrives (§18 idempotency contract).
describe('BILLING-002 webhook event deduplication', () => {
  let db: TestDb;
  let account: SeededAccount;

  beforeAll(async () => {
    db = await createTestDb();
    account = await seedAccountWithProfile(db.prisma);
  });

  afterAll(async () => {
    await db.cleanup();
  });

  it('processes the same eventId twice with a single set of side effects', async () => {
    const checkout = {
      prisma: db.prisma,
      accountId: account.accountId,
      siteProfileId: account.siteProfileId,
      plan: 'Basic' as const,
      eventId: 'evt_dup_1',
      transactionId: 'txn_dup_1',
      secret: TEST_WEBHOOK_SECRET,
    };
    const first = await simulatePaidCheckout(checkout);
    const second = await simulatePaidCheckout(checkout);

    expect(first.result.deduplicated).toBe(false);
    expect(second.result.deduplicated).toBe(true);
    expect(second.result.purchaseId).toBe(first.result.purchaseId);
    expect(second.result.scanId).toBe(first.result.scanId);
    expect(second.result.entitlementId).toBe(first.result.entitlementId);

    expect(await db.prisma.webhookEvent.count({ where: { providerEventId: 'evt_dup_1' } })).toBe(1);
    expect(await db.prisma.purchase.count()).toBe(1);
    expect(await db.prisma.entitlement.count()).toBe(1);
    expect(await db.prisma.scan.count()).toBe(1);
    expect(await db.prisma.job.count()).toBe(1);
  });

  it('keeps one purchase under concurrent delivery of five identical events', async () => {
    const checkout = {
      prisma: db.prisma,
      accountId: account.accountId,
      siteProfileId: account.siteProfileId,
      plan: 'Complete' as const,
      eventId: 'evt_dup_parallel',
      transactionId: 'txn_dup_parallel',
      secret: TEST_WEBHOOK_SECRET,
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => simulatePaidCheckout(checkout)),
    );

    const created = results.filter(({ result }) => !result.deduplicated);
    expect(created).toHaveLength(1);
    const purchaseIds = new Set(results.map(({ result }) => result.purchaseId));
    expect(purchaseIds.size).toBe(1);

    expect(
      await db.prisma.webhookEvent.count({ where: { providerEventId: 'evt_dup_parallel' } }),
    ).toBe(1);
    expect(
      await db.prisma.purchase.count({
        where: { provider: 'paddle', providerTransactionId: 'txn_dup_parallel' },
      }),
    ).toBe(1);
    expect(await db.prisma.entitlement.count()).toBe(2); // one per test in this file
    expect(await db.prisma.scan.count()).toBe(2);
    expect(await db.prisma.job.count()).toBe(2);
  });
});
