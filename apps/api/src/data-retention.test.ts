import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  UNBOUND_WEBHOOK_EVENT_RETENTION_DAYS,
  deleteAccountData,
  purgeUnboundWebhookEvents,
  runRetentionSweep,
  sweepRetention,
} from './data-retention.ts';
import { WEBHOOK_OUTCOMES } from './billing/fastspring/outcomes.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  type SeededAccount,
  type TestDb,
} from './test-utils/test-db.ts';

// Storage limitation for webhook payloads.
//
// A FastSpring delivery is stored with its raw body, which carries the buyer's
// name, email and billing address. A delivery that is rejected, ignored or
// arrives unlinked is reachable by no account deletion, so it would be retained
// forever; these rows are purged by age instead. What makes a row reachable is
// what `deleteAccountData` matches on — an accountId, or an order id that names
// a real purchase — and NOT the mere presence of an order id, which a rejected
// or unlinked delivery routinely records for an order we never granted.

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-06T12:00:00.000Z');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

describe('unbound webhook event retention', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  async function seedEvent(params: {
    readonly outcome: string;
    readonly processedAt: Date;
    readonly accountId?: string;
    readonly providerTransactionId?: string;
    readonly provider?: string;
  }): Promise<string> {
    const event = await db.prisma.webhookEvent.create({
      data: {
        provider: params.provider ?? 'fastspring',
        providerEventId: `evt_${randomUUID()}`,
        eventType: 'order.completed',
        outcome: params.outcome,
        rawBody: JSON.stringify({ buyer: { email: 'buyer@example.com' } }),
        signature: 'sig',
        processedAt: params.processedAt,
        ...(params.accountId !== undefined ? { accountId: params.accountId } : {}),
        ...(params.providerTransactionId !== undefined
          ? { providerTransactionId: params.providerTransactionId }
          : {}),
      },
    });
    return event.id;
  }

  async function seedPurchase(account: SeededAccount) {
    return db.prisma.purchase.create({
      data: {
        accountId: account.accountId,
        siteProfileId: account.siteProfileId,
        plan: 'Basic',
        provider: 'fastspring',
        providerTransactionId: `ord_${randomUUID()}`,
        amountUsd: 55,
        currency: 'USD',
      },
    });
  }

  it('deletes a rejected delivery once its retention window has passed', async () => {
    const expired = await seedEvent({
      outcome: WEBHOOK_OUTCOMES.rejected,
      processedAt: daysAgo(UNBOUND_WEBHOOK_EVENT_RETENTION_DAYS + 1),
    });

    expect(await purgeUnboundWebhookEvents(db.prisma, NOW)).toBe(1);
    expect(await db.prisma.webhookEvent.count({ where: { id: expired } })).toBe(0);
  });

  it('keeps a delivery that is still inside the retention window', async () => {
    const recent = await seedEvent({
      outcome: WEBHOOK_OUTCOMES.rejected,
      processedAt: daysAgo(UNBOUND_WEBHOOK_EVENT_RETENTION_DAYS - 1),
    });

    expect(await purgeUnboundWebhookEvents(db.prisma, NOW)).toBe(0);
    expect(await db.prisma.webhookEvent.count({ where: { id: recent } })).toBe(1);
  });

  it('purges every unbound outcome that granted nothing', async () => {
    for (const outcome of [
      WEBHOOK_OUTCOMES.rejected,
      WEBHOOK_OUTCOMES.ignored,
      WEBHOOK_OUTCOMES.unlinked,
      WEBHOOK_OUTCOMES.deduplicated,
    ]) {
      await seedEvent({ outcome, processedAt: daysAgo(365) });
    }

    expect(await purgeUnboundWebhookEvents(db.prisma, NOW)).toBe(4);
    expect(await db.prisma.webhookEvent.count()).toBe(0);
  });

  // Age alone must never be enough: anything the billing audit trail or the
  // refund path can still reach is kept until its account is deleted.
  it('never purges a delivery that is bound to an account or to a real purchase', async () => {
    const account = await seedAccountWithProfile(db.prisma);
    const purchase = await seedPurchase(account);
    const bound = await seedEvent({
      outcome: WEBHOOK_OUTCOMES.processed,
      processedAt: daysAgo(365),
      accountId: account.accountId,
      providerTransactionId: purchase.providerTransactionId,
    });
    const boundByAccountOnly = await seedEvent({
      outcome: WEBHOOK_OUTCOMES.rejected,
      processedAt: daysAgo(365),
      accountId: account.accountId,
    });
    // No accountId, but the order id names a purchase that still exists, so
    // deleting that account will remove this row too.
    const boundByPurchaseOnly = await seedEvent({
      outcome: WEBHOOK_OUTCOMES.unlinked,
      processedAt: daysAgo(365),
      providerTransactionId: purchase.providerTransactionId,
    });
    // A processed event should always carry an account; if one ever does not, it
    // is still part of the record of a granted purchase and is not aged out.
    const processedWithoutBinding = await seedEvent({
      outcome: WEBHOOK_OUTCOMES.processed,
      processedAt: daysAgo(365),
    });

    expect(await purgeUnboundWebhookEvents(db.prisma, NOW)).toBe(0);
    for (const id of [bound, boundByAccountOnly, boundByPurchaseOnly, processedWithoutBinding]) {
      expect(await db.prisma.webhookEvent.count({ where: { id } })).toBe(1);
    }
  });

  // The bug this pins down: the purge required providerTransactionId to be null,
  // so a rejected/ignored/unlinked delivery that recorded the order id it quoted
  // — a foreign order, a refund with no purchase, an order whose amount failed
  // validation — was kept with its buyer payload forever.
  it('purges an unprocessed delivery whose order id names no purchase', async () => {
    const account = await seedAccountWithProfile(db.prisma);
    const kept = await seedPurchase(account);
    const foreignOrder = await seedEvent({
      outcome: WEBHOOK_OUTCOMES.rejected,
      processedAt: daysAgo(365),
      providerTransactionId: `ord_${randomUUID()}`,
    });
    const unlinkedRefund = await seedEvent({
      outcome: WEBHOOK_OUTCOMES.unlinked,
      processedAt: daysAgo(365),
      providerTransactionId: `ord_${randomUUID()}`,
    });
    const noOrderId = await seedEvent({
      outcome: WEBHOOK_OUTCOMES.ignored,
      processedAt: daysAgo(365),
    });
    const boundByPurchase = await seedEvent({
      outcome: WEBHOOK_OUTCOMES.unlinked,
      processedAt: daysAgo(365),
      providerTransactionId: kept.providerTransactionId,
    });

    expect(await purgeUnboundWebhookEvents(db.prisma, NOW)).toBe(3);
    for (const id of [foreignOrder, unlinkedRefund, noOrderId]) {
      expect(await db.prisma.webhookEvent.count({ where: { id } })).toBe(0);
    }
    expect(await db.prisma.webhookEvent.count({ where: { id: boundByPurchase } })).toBe(1);
  });

  // Uniqueness is on the (provider, providerTransactionId) PAIR, so the same id
  // can name a FastSpring order and an unrelated legacy MockPaddle transaction.
  // Matching the purge on the id alone let a foreign provider's purchase stand in
  // as a binding, and the buyer payload behind it was kept forever.
  it("purges a delivery whose order id only matches another provider's purchase", async () => {
    const account = await seedAccountWithProfile(db.prisma);
    const sharedOrderId = `ord_${randomUUID()}`;
    const legacyPurchase = await db.prisma.purchase.create({
      data: {
        accountId: account.accountId,
        siteProfileId: account.siteProfileId,
        plan: 'Basic',
        provider: 'paddle',
        providerTransactionId: sharedOrderId,
        amountUsd: 55,
        currency: 'USD',
      },
    });
    const foreignDelivery = await seedEvent({
      provider: 'fastspring',
      outcome: WEBHOOK_OUTCOMES.rejected,
      processedAt: daysAgo(365),
      providerTransactionId: sharedOrderId,
    });

    expect(await purgeUnboundWebhookEvents(db.prisma, NOW)).toBe(1);
    expect(await db.prisma.webhookEvent.count({ where: { id: foreignDelivery } })).toBe(0);
    // The purchase it collided with is untouched, and so is its own audit trail.
    expect(await db.prisma.purchase.count({ where: { id: legacyPurchase.id } })).toBe(1);
  });

  // Same row, both halves of the criterion: an order id alone does not save it,
  // but the account binding does.
  it('keeps an aged delivery that carries an order id and an account', async () => {
    const account = await seedAccountWithProfile(db.prisma);
    const withAccount = await seedEvent({
      outcome: WEBHOOK_OUTCOMES.rejected,
      processedAt: daysAgo(365),
      accountId: account.accountId,
      providerTransactionId: `ord_${randomUUID()}`,
    });

    expect(await purgeUnboundWebhookEvents(db.prisma, NOW)).toBe(0);
    expect(await db.prisma.webhookEvent.count({ where: { id: withAccount } })).toBe(1);
  });

  it('runs the webhook purge as part of the scheduled retention sweep', async () => {
    await seedEvent({
      outcome: WEBHOOK_OUTCOMES.rejected,
      processedAt: daysAgo(UNBOUND_WEBHOOK_EVENT_RETENTION_DAYS + 1),
    });

    const result = await runRetentionSweep(db.prisma, NOW);

    expect(result.deletedWebhookEventCount).toBe(1);
    expect(await db.prisma.webhookEvent.count()).toBe(0);
  });

  // The candidate query scans everything past the retention window, so it is
  // bounded by what one pass may examine rather than by the size of a backlog.
  // Nothing is lost: the rows left behind are taken by the next sweep.
  it('purges in bounded passes and finishes the backlog on the next one', async () => {
    const aged = daysAgo(UNBOUND_WEBHOOK_EVENT_RETENTION_DAYS + 1);
    for (let index = 0; index < 3; index += 1) {
      await seedEvent({ outcome: WEBHOOK_OUTCOMES.rejected, processedAt: aged });
    }

    expect(await purgeUnboundWebhookEvents(db.prisma, NOW, { batchLimit: 2 })).toBe(2);
    expect(await db.prisma.webhookEvent.count()).toBe(1);

    expect(await purgeUnboundWebhookEvents(db.prisma, NOW, { batchLimit: 2 })).toBe(1);
    expect(await db.prisma.webhookEvent.count()).toBe(0);
  });

  // A sweep deletes buyer payloads on a timer. Until it reported what it did,
  // "removed nothing" and "removed three hundred rows" looked the same
  // afterwards — and a sweep that never fired looked like both.
  it('reports every sweep, so an automatic deletion leaves a record', async () => {
    await seedEvent({
      outcome: WEBHOOK_OUTCOMES.rejected,
      processedAt: daysAgo(UNBOUND_WEBHOOK_EVENT_RETENTION_DAYS + 1),
    });
    const lines: { message: string; context: Readonly<Record<string, unknown>> }[] = [];
    const logger = {
      info: (message: string, context?: Readonly<Record<string, unknown>>) =>
        lines.push({ message, context: context ?? {} }),
      warn: () => undefined,
      error: (message: string, context?: Readonly<Record<string, unknown>>) =>
        lines.push({ message, context: context ?? {} }),
    };

    await sweepRetention(db.prisma, NOW, logger);

    const completed = lines.find((line) => line.message === 'retention sweep completed');
    expect(completed?.context.deletedWebhookEventCount).toBe(1);
    expect(completed?.context.deletedScanCount).toBe(0);
    expect(completed?.context.expiredCheckoutSessionCount).toBe(0);
  });

  // Housekeeping must never take down the boot path or the timer that calls it.
  it('reports a failed sweep instead of rejecting', async () => {
    const failures: string[] = [];
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: (message: string) => failures.push(message),
    };
    const broken = {
      scan: {
        findMany: () => Promise.reject(new Error('database is gone')),
      },
    } as unknown as Parameters<typeof sweepRetention>[0];

    await expect(sweepRetention(broken, NOW, logger)).resolves.toBeUndefined();
    expect(failures).toContain('retention sweep failed');
  });

  // The purge must not become the only thing that removes buyer data: deleting
  // an account still takes its own webhook events with it, immediately.
  it('leaves account deletion removing bound events regardless of their age', async () => {
    const account = await seedAccountWithProfile(db.prisma);
    const purchase = await db.prisma.purchase.create({
      data: {
        accountId: account.accountId,
        siteProfileId: account.siteProfileId,
        plan: 'Basic',
        provider: 'fastspring',
        providerTransactionId: `ord_${randomUUID()}`,
        amountUsd: 55,
        currency: 'USD',
      },
    });
    await seedEvent({
      outcome: WEBHOOK_OUTCOMES.processed,
      processedAt: NOW,
      accountId: account.accountId,
    });
    await seedEvent({
      outcome: WEBHOOK_OUTCOMES.processed,
      processedAt: NOW,
      providerTransactionId: purchase.providerTransactionId,
    });

    await deleteAccountData(db.prisma, account.accountId, null);

    expect(await db.prisma.webhookEvent.count()).toBe(0);
    expect(await db.prisma.account.count({ where: { id: account.accountId } })).toBe(0);
  });

  // A ProviderRefund line names the amount and currency FastSpring returned to a
  // named buyer, so it is that buyer's data and an erasure request has to take
  // it. It has no accountId of its own — it hangs off the purchase — so it is
  // deleted explicitly, before the purchase it points at. The foreign key is
  // ON DELETE CASCADE (for the rollback case, where the previous release deletes
  // purchases without knowing this table), and that cascade must stay a safety
  // net rather than become the mechanism: a deletion that relied on it would go
  // silently wrong the moment the constraint was tightened.
  it('removes the refund lines of a deleted account, and only those', async () => {
    const account = await seedAccountWithProfile(db.prisma);
    const other = await seedAccountWithProfile(db.prisma);
    const purchaseFor = (owner: SeededAccount) =>
      db.prisma.purchase.create({
        data: {
          accountId: owner.accountId,
          siteProfileId: owner.siteProfileId,
          plan: 'Basic',
          provider: 'fastspring',
          providerTransactionId: `ord_${randomUUID()}`,
          amountUsd: 55,
          currency: 'USD',
        },
      });
    const purchase = await purchaseFor(account);
    const otherPurchase = await purchaseFor(other);
    // Two lines, because a partial refund is exactly the case that produces more
    // than one and the case a single-row assumption would silently leave behind.
    await db.prisma.providerRefund.createMany({
      data: [
        {
          purchaseId: purchase.id,
          provider: 'fastspring',
          providerRefundId: 'ret_erased_one',
          eventType: 'return.created',
          amountCharged: 27.5,
          amountUsd: 27.5,
          currency: 'USD',
        },
        {
          purchaseId: purchase.id,
          provider: 'fastspring',
          providerRefundId: 'ret_erased_two',
          eventType: 'return.created',
          amountCharged: 27.5,
          amountUsd: 27.5,
          currency: 'USD',
        },
        {
          purchaseId: otherPurchase.id,
          provider: 'fastspring',
          providerRefundId: 'ret_kept',
          eventType: 'return.created',
          amountCharged: 55,
          amountUsd: 55,
          currency: 'USD',
        },
      ],
    });

    await deleteAccountData(db.prisma, account.accountId, null);

    expect(await db.prisma.providerRefund.count({ where: { purchaseId: purchase.id } })).toBe(0);
    expect(await db.prisma.purchase.count({ where: { id: purchase.id } })).toBe(0);
    // The other account's refund history is untouched.
    const kept = await db.prisma.providerRefund.findMany();
    expect(kept).toHaveLength(1);
    expect(kept[0]?.providerRefundId).toBe('ret_kept');
  });

  // Deleting one account must not delete another provider's delivery that merely
  // quotes the same order id — the id is unique only together with its provider,
  // and that row is somebody else's billing audit trail.
  it("keeps another provider's delivery when an account is deleted", async () => {
    const account = await seedAccountWithProfile(db.prisma);
    const sharedOrderId = `ord_${randomUUID()}`;
    await db.prisma.purchase.create({
      data: {
        accountId: account.accountId,
        siteProfileId: account.siteProfileId,
        plan: 'Basic',
        provider: 'paddle',
        providerTransactionId: sharedOrderId,
        amountUsd: 55,
        currency: 'USD',
      },
    });
    const ownDelivery = await seedEvent({
      provider: 'paddle',
      outcome: WEBHOOK_OUTCOMES.processed,
      processedAt: NOW,
      providerTransactionId: sharedOrderId,
    });
    const otherProviderDelivery = await seedEvent({
      provider: 'fastspring',
      outcome: WEBHOOK_OUTCOMES.processed,
      processedAt: NOW,
      providerTransactionId: sharedOrderId,
    });

    await deleteAccountData(db.prisma, account.accountId, null);

    expect(await db.prisma.webhookEvent.count({ where: { id: ownDelivery } })).toBe(0);
    expect(await db.prisma.webhookEvent.count({ where: { id: otherProviderDelivery } })).toBe(1);
  });
});
