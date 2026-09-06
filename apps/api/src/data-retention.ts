import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { TARIFFS } from '@fluxradar/contracts';

import {
  CHECKOUT_STATUS_REASONS,
  abandonedCheckoutSessionWhere,
} from './billing/checkout-lifecycle.ts';
import { CHECKOUT_SESSION_STATUSES } from './billing/constants.ts';
import { WEBHOOK_OUTCOMES } from './billing/fastspring/outcomes.ts';
import type { ApiLogger } from './http/logger.ts';
import { createConfiguredObjectStore, type PrivateObjectStore } from './integrations/s3.ts';

const TERMINAL_SCAN_STATUSES = ['Partial', 'Completed', 'Failed', 'Cancelled'];

/**
 * How long a webhook delivery that never became billing state is kept.
 *
 * A rejected, ignored or unlinked provider event is stored with its raw body,
 * which carries buyer details (name, email, billing address) supplied by the
 * payment provider. Unlike a processed event it granted nothing and belongs to
 * no account, and the order id it may quote names no purchase of ours, so
 * account deletion cannot reach it and it would otherwise be retained forever —
 * exactly the kind of orphaned personal data GDPR storage limitation forbids.
 *
 * 30 days is the conservative end of the range these rows are useful for: the
 * provider stops redelivering a webhook within hours (days at the very most), so
 * long before the window closes no redelivery can arrive that still needs this
 * row to be deduplicated, and a re-sent payload would in any case be re-rejected
 * to the same effect. It still leaves a full month to investigate a delivery
 * problem from the stored payload.
 */
export const UNBOUND_WEBHOOK_EVENT_RETENTION_DAYS = 30;

/**
 * How many aged deliveries one sweep may examine.
 *
 * The candidate query is a full scan of everything past the retention window, so
 * an unbounded one grows with the backlog rather than with what the sweep has to
 * do. The sweep runs on boot and on a timer, and the rows it leaves behind are
 * simply taken by the next pass — a bound costs a little latency in a backlog
 * and removes the case where a long-idle deployment loads its entire history
 * into one query.
 */
export const WEBHOOK_EVENT_PURGE_BATCH_LIMIT = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deletes a scan snapshot and every dependent result row. */
export async function deleteScanResult(prisma: PrismaClient, scanId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const scan = await tx.scan.findUnique({ where: { id: scanId }, select: { accountId: true } });
    if (scan === null) {
      return;
    }
    await tx.deletedScan.upsert({
      where: { scanId },
      create: { scanId, accountIdHash: accountDeletionHash(scan.accountId), reason: 'retention' },
      update: { accountIdHash: accountDeletionHash(scan.accountId), reason: 'retention' },
    });
    await tx.job.deleteMany({ where: { scanId } });
    await tx.issue.deleteMany({ where: { scanId } });
    await tx.scanModule.deleteMany({ where: { scanId } });
    await tx.aiResponseRecord.deleteMany({ where: { scanId } });
    await tx.aiConsent.deleteMany({ where: { scanId } });
    await tx.scan.delete({ where: { id: scanId } });
  });
}

/** Removes terminal snapshots whose plan-specific retention window expired. */
export async function purgeExpiredScans(prisma: PrismaClient, now: Date): Promise<number> {
  const candidates = await prisma.scan.findMany({
    where: { status: { in: TERMINAL_SCAN_STATUSES } },
    select: { id: true, plan: true, createdAt: true },
  });
  let deleted = 0;
  for (const scan of candidates) {
    const retentionDays = TARIFFS[scan.plan as keyof typeof TARIFFS]?.retentionDays;
    if (retentionDays === undefined) {
      continue;
    }
    const expiresAt = scan.createdAt.getTime() + retentionDays * DAY_MS;
    if (expiresAt <= now.getTime()) {
      await deleteScanResult(prisma, scan.id);
      deleted += 1;
    }
  }
  return deleted;
}

/**
 * Deletes aged webhook deliveries that no account deletion can ever reach.
 *
 * "Unbound" is defined as the exact complement of what `deleteAccountData`
 * removes, because anything it can reach must be kept until its account is
 * erased. A delivery is therefore KEPT when it carries an `accountId`, when it
 * was `processed`, or when its `providerTransactionId` names a purchase that
 * still exists — account deletion takes those with the account.
 *
 * An order id alone is NOT a binding. A rejected, ignored or unlinked delivery
 * routinely records the order id it quoted (a foreign order, a refund that
 * arrived before its purchase, an order whose amount failed validation), and no
 * account deletion will ever match it. Keying the purge on a null
 * `providerTransactionId` therefore retained exactly those payloads forever.
 */
export async function purgeUnboundWebhookEvents(
  prisma: PrismaClient,
  now: Date,
  options: WebhookEventPurgeOptions = {},
): Promise<number> {
  const retentionDays = options.retentionDays ?? UNBOUND_WEBHOOK_EVENT_RETENTION_DAYS;
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const agedUnprocessed = {
    accountId: null,
    outcome: { not: WEBHOOK_OUTCOMES.processed },
    processedAt: { lt: cutoff },
  };
  const candidates = await prisma.webhookEvent.findMany({
    where: agedUnprocessed,
    select: { id: true, provider: true, providerTransactionId: true },
    orderBy: { processedAt: 'asc' },
    take: options.batchLimit ?? WEBHOOK_EVENT_PURGE_BATCH_LIMIT,
  });
  const purgeable = await withoutPurchaseBinding(prisma, candidates);
  if (purgeable.length === 0) {
    return 0;
  }
  // The age/outcome predicate is repeated here so a row that gained an account
  // between the two queries is left alone.
  const { count } = await prisma.webhookEvent.deleteMany({
    where: { id: { in: purgeable }, ...agedUnprocessed },
  });
  return count;
}

export interface WebhookEventPurgeOptions {
  readonly retentionDays?: number;
  /** Candidates examined by this pass; the rest wait for the next sweep. */
  readonly batchLimit?: number;
}

interface WebhookEventBinding {
  readonly id: string;
  readonly provider: string;
  readonly providerTransactionId: string | null;
}

/**
 * An order id identifies a purchase only together with its provider: uniqueness
 * is on the pair (see `@@unique([provider, providerTransactionId])`), so a
 * FastSpring order id may equal a legacy MockPaddle transaction id and mean
 * something entirely different. Matching on the id alone made a foreign
 * provider's purchase look like a binding and kept the buyer payload forever —
 * which is the one thing this purge exists to prevent.
 */
function bindingKey(provider: string, providerTransactionId: string): string {
  return `${provider}\u0000${providerTransactionId}`;
}

/** Candidate ids whose order id names no purchase (or that carry none at all). */
async function withoutPurchaseBinding(
  prisma: PrismaClient,
  candidates: readonly WebhookEventBinding[],
): Promise<string[]> {
  const orderIds = [
    ...new Set(
      candidates.flatMap(({ providerTransactionId }) =>
        providerTransactionId === null ? [] : [providerTransactionId],
      ),
    ),
  ];
  const purchases =
    orderIds.length === 0
      ? []
      : await prisma.purchase.findMany({
          where: { providerTransactionId: { in: orderIds } },
          select: { provider: true, providerTransactionId: true },
        });
  const bound = new Set(
    purchases.map(({ provider, providerTransactionId }) =>
      bindingKey(provider, providerTransactionId),
    ),
  );
  return candidates
    .filter(
      ({ provider, providerTransactionId }) =>
        providerTransactionId === null || !bound.has(bindingKey(provider, providerTransactionId)),
    )
    .map(({ id }) => id);
}

/**
 * Closes checkout sessions that were opened but never paid.
 *
 * The row is written before the provider is called, so an abandoned tab leaves a
 * `created` session behind. It stops blocking its profile the moment its
 * deadline passes (see `openCheckoutSessionWhere`); this sweep makes the stored
 * status say so once the deadline is well past. It is deliberately a relabel and
 * not a delete: the binding stays available to a late order, which
 * `claimableCheckoutSessionWhere` still accepts, so no payment can be lost to
 * housekeeping. Sessions that already produced a purchase are never touched.
 */
export async function expireAbandonedCheckoutSessions(
  prisma: PrismaClient,
  now: Date,
): Promise<number> {
  const { count } = await prisma.checkoutSession.updateMany({
    where: abandonedCheckoutSessionWhere(now),
    data: {
      status: CHECKOUT_SESSION_STATUSES.rejected,
      statusReason: CHECKOUT_STATUS_REASONS.abandoned,
    },
  });
  return count;
}

export interface RetentionSweepResult {
  readonly deletedScanCount: number;
  readonly deletedWebhookEventCount: number;
  readonly expiredCheckoutSessionCount: number;
}

/**
 * One pass of every age-based retention rule, so a caller cannot schedule half
 * of them. Sequential on purpose: a failure is logged and the next sweep retries.
 */
export async function runRetentionSweep(
  prisma: PrismaClient,
  now: Date,
): Promise<RetentionSweepResult> {
  const deletedScanCount = await purgeExpiredScans(prisma, now);
  const deletedWebhookEventCount = await purgeUnboundWebhookEvents(prisma, now);
  const expiredCheckoutSessionCount = await expireAbandonedCheckoutSessions(prisma, now);
  return { deletedScanCount, deletedWebhookEventCount, expiredCheckoutSessionCount };
}

/**
 * Runs the sweep and reports what it did.
 *
 * Retention deletes data, so "it ran and removed nothing" and "it ran and
 * removed three hundred buyer payloads" must not look the same afterwards —
 * and until now only a failure was logged, which made a silent purge
 * indistinguishable from a sweep that never fired. The counts are the whole
 * record of an automatic deletion, so they are logged on every pass.
 *
 * It never rejects: a sweep is background housekeeping and the next pass
 * retries, so a failure here must not take down the boot path or the timer that
 * calls it.
 */
export async function sweepRetention(
  prisma: PrismaClient,
  now: Date,
  logger: ApiLogger,
): Promise<void> {
  try {
    const result = await runRetentionSweep(prisma, now);
    logger.info('retention sweep completed', { ...result });
  } catch (error) {
    logger.error('retention sweep failed', {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

/** Webhook deliveries that belong to this account's purchases, provider by provider. */
function purchaseDeliveryFilters(
  purchases: readonly { readonly provider: string; readonly providerTransactionId: string }[],
): Prisma.WebhookEventWhereInput[] {
  const byProvider = new Map<string, string[]>();
  for (const { provider, providerTransactionId } of purchases) {
    byProvider.set(provider, [...(byProvider.get(provider) ?? []), providerTransactionId]);
  }
  return [...byProvider].map(([provider, ids]) => ({
    provider,
    providerTransactionId: { in: ids },
  }));
}

/** Stable, content-free audit identifier retained after account deletion. */
export function accountDeletionHash(accountId: string): string {
  return createHash('sha256').update(`fluxradar-account:${accountId}`).digest('hex');
}

export interface AccountDeletionResult {
  /** Objects that could not be deleted after their DB rows were removed. */
  readonly orphanedArtifactCount: number;
}

/**
 * Deletes user-owned data while retaining a minimal deletion fact.
 *
 * Database rows are removed in one transaction. Object storage is cleaned up
 * only after that transaction commits, so a failed DB deletion cannot remove a
 * report belonging to an account that still exists. S3 DELETE is idempotent;
 * callers receive the count of cleanup failures so production can emit an
 * operational signal without exposing private object keys to the client.
 */
export async function deleteAccountData(
  prisma: PrismaClient,
  accountId: string,
  objectStore: PrivateObjectStore | null = createConfiguredObjectStore(),
): Promise<AccountDeletionResult> {
  const artifacts = await prisma.exportArtifact.findMany({
    where: { accountId },
    select: { objectKey: true },
  });
  const deleted = await prisma.$transaction(
    async (tx) => {
      const account = await tx.account.findUnique({
        where: { id: accountId },
        select: { id: true },
      });
      if (account === null) return false;

      await tx.accountDeletionAudit.upsert({
        where: { accountIdHash: accountDeletionHash(accountId) },
        update: {
          accountIdHash: accountDeletionHash(accountId),
          status: 'completed',
          completedAt: new Date(),
        },
        create: {
          accountIdHash: accountDeletionHash(accountId),
          status: 'completed',
          completedAt: new Date(),
        },
      });
      const purchases = await tx.purchase.findMany({
        where: { accountId },
        select: { id: true, provider: true, providerTransactionId: true },
      });
      const purchaseIds = purchases.map(({ id }) => id);
      const scans = await tx.scan.findMany({ where: { accountId }, select: { id: true } });
      const scanIds = scans.map(({ id }) => id);
      if (scanIds.length > 0) {
        await tx.deletedScan.createMany({
          data: scanIds.map((scanId) => ({
            scanId,
            accountIdHash: accountDeletionHash(accountId),
            reason: 'account-deletion',
          })),
          skipDuplicates: true,
        });
      }
      await tx.exportArtifact.deleteMany({ where: { accountId } });
      await tx.job.deleteMany({ where: { scanId: { in: scanIds } } });
      await tx.issue.deleteMany({ where: { scanId: { in: scanIds } } });
      await tx.scanModule.deleteMany({ where: { scanId: { in: scanIds } } });
      await tx.aiResponseRecord.deleteMany({ where: { scanId: { in: scanIds } } });
      await tx.aiConsent.deleteMany({ where: { scanId: { in: scanIds } } });
      await tx.scan.deleteMany({ where: { id: { in: scanIds } } });
      // Checkout sessions reference the account, the profile and the purchase,
      // so they must go before any of the three.
      await tx.checkoutSession.deleteMany({ where: { accountId } });
      await tx.providerRefund.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
      await tx.refundRecord.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
      await tx.entitlement.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
      await tx.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
      await tx.siteGoogleBinding.deleteMany({ where: { accountId } });
      await tx.siteProfile.deleteMany({ where: { accountId } });
      await tx.session.deleteMany({ where: { accountId } });
      await tx.aiConsent.deleteMany({ where: { accountId } });
      await tx.integrationOAuthState.deleteMany({ where: { accountId } });
      await tx.integrationConnection.deleteMany({ where: { accountId } });
      await tx.emailToken.deleteMany({ where: { accountId } });
      await tx.emailNotification.deleteMany({ where: { accountId } });
      // Matched per provider, never on the order id alone: uniqueness is on the
      // pair, so an id equal to this account's order can belong to a different
      // provider's delivery — deleting that one would erase another buyer's
      // audit trail on this account's behalf.
      await tx.webhookEvent.deleteMany({
        where: { OR: [{ accountId }, ...purchaseDeliveryFilters(purchases)] },
      });
      await tx.account.deleteMany({ where: { id: accountId } });
      return true;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );

  if (!deleted || objectStore === null || artifacts.length === 0) {
    return { orphanedArtifactCount: 0 };
  }
  const cleanup = await Promise.allSettled(
    artifacts.map(({ objectKey }) => objectStore.deleteObject(objectKey)),
  );
  return {
    orphanedArtifactCount: cleanup.filter((result) => result.status === 'rejected').length,
  };
}
