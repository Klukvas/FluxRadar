import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ACTION_PLAN_LIMITS, TARIFFS } from '@fluxradar/contracts';

import {
  CHECKOUT_STATUS_REASONS,
  abandonedCheckoutSessionWhere,
} from './billing/checkout-lifecycle.ts';
import { CHECKOUT_SESSION_STATUSES } from './billing/constants.ts';
import { WEBHOOK_OUTCOMES } from './billing/fastspring/outcomes.ts';
import type { ApiLogger } from './http/logger.ts';
import { sweepExpiredCheckpoints } from './orchestrator/checkpoint.ts';
import { sweepExpiredCrawlEvidence } from './orchestrator/crawl-store.ts';
import { createConfiguredObjectStore, type PrivateObjectStore } from './integrations/s3.ts';
import { lockScanRow, lockScanRows } from './scans/scan-row-lock.ts';

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

/**
 * How long a spend-log row that outlived its scan is kept.
 *
 * Exactly as long as it can still refuse a generation, and not a day longer:
 * the widest window any Action Plan cap counts over is the product-wide daily
 * one, so a detached attempt older than that influences nothing and is deleted
 * by the sweep. Keeping it would be retaining an account's activity record past
 * the purpose that justified it.
 */
export const DETACHED_ACTION_PLAN_ATTEMPT_RETENTION_MS =
  ACTION_PLAN_LIMITS.productGenerationWindowMs;

/**
 * Deletes a scan snapshot and every dependent result row.
 *
 * `ExportArtifact` is one of those rows and its foreign key to Scan is
 * ON DELETE RESTRICT, so leaving it out did not orphan a report — it made the
 * delete of any scan that had ever been exported fail outright, which stopped
 * the whole sweep (see `sweepRetention`). Its object lives outside the database,
 * so the keys are returned rather than deleted here: storage is touched only
 * after the transaction commits, or a rolled-back deletion would take the report
 * of a scan that still exists.
 */
export async function deleteScanResult(
  prisma: PrismaClient,
  scanId: string,
): Promise<readonly string[]> {
  return prisma.$transaction(async (tx) => {
    // The scan row FIRST, before any child row is touched: a finishing Action
    // Plan generation holds this same lock and then writes a plan row, so the
    // opposite order here is a deadlock cycle rather than a race
    // (scans/scan-row-lock.ts).
    if (!(await lockScanRow(tx, scanId))) {
      return [];
    }
    const scan = await tx.scan.findUnique({ where: { id: scanId }, select: { accountId: true } });
    if (scan === null) {
      return [];
    }
    await tx.deletedScan.upsert({
      where: { scanId },
      create: { scanId, accountIdHash: accountDeletionHash(scan.accountId), reason: 'retention' },
      update: { accountIdHash: accountDeletionHash(scan.accountId), reason: 'retention' },
    });
    const artifacts = await tx.exportArtifact.findMany({
      where: { scanId },
      select: { objectKey: true },
    });
    await tx.exportArtifact.deleteMany({ where: { scanId } });
    await tx.scanCheckpoint.deleteMany({ where: { scanId } });
    await tx.scanCrawlPage.deleteMany({ where: { scanId } });
    await tx.scanCrawlResourceSet.deleteMany({ where: { scanId } });
    await tx.job.deleteMany({ where: { scanId } });
    await tx.issue.deleteMany({ where: { scanId } });
    await tx.ruleCoverageProof.deleteMany({ where: { scanId } });
    await tx.scanModule.deleteMany({ where: { scanId } });
    await tx.aiResponseRecord.deleteMany({ where: { scanId } });
    await tx.aiConsent.deleteMany({ where: { scanId } });
    // The Action Plan is not a canonical record and has no retention life of
    // its own: it goes with the scan it was written from (D-232). Its spend log
    // does not — see `detachActionPlanAttempts`.
    await tx.actionPlan.deleteMany({ where: { scanId } });
    await detachActionPlanAttempts(tx, [scanId]);
    await tx.scan.delete({ where: { id: scanId } });
    return artifacts.map(({ objectKey }) => objectKey);
  });
}

export interface ScanPurgeResult {
  readonly deletedScanCount: number;
  /** Reports whose row is gone but whose object storage delete failed. */
  readonly orphanedArtifactCount: number;
}

/**
 * Removes terminal snapshots whose plan-specific retention window expired, and
 * the stored reports that belong to them.
 *
 * The retention window is a promise about the report as much as about the row,
 * so the object is removed too. It is best effort and counted, never retried
 * into a failure: a bucket that refuses a delete must not stop the sweep from
 * removing the data it can, because stopping keeps MORE data past its window.
 */
export async function purgeExpiredScans(
  prisma: PrismaClient,
  now: Date,
  objectStore: PrivateObjectStore | null = createConfiguredObjectStore(),
): Promise<ScanPurgeResult> {
  const candidates = await prisma.scan.findMany({
    where: { status: { in: TERMINAL_SCAN_STATUSES } },
    select: { id: true, plan: true, createdAt: true },
  });
  let deletedScanCount = 0;
  const objectKeys: string[] = [];
  for (const scan of candidates) {
    const retentionDays = TARIFFS[scan.plan as keyof typeof TARIFFS]?.retentionDays;
    if (retentionDays === undefined) {
      continue;
    }
    const expiresAt = scan.createdAt.getTime() + retentionDays * DAY_MS;
    if (expiresAt <= now.getTime()) {
      objectKeys.push(...(await deleteScanResult(prisma, scan.id)));
      deletedScanCount += 1;
    }
  }
  return {
    deletedScanCount,
    orphanedArtifactCount: await removeStoredObjects(objectStore, objectKeys),
  };
}

/**
 * Deletes report objects whose rows are already gone, and counts what stayed.
 *
 * S3 DELETE is idempotent, so a retried key is harmless; the count is what an
 * operator needs, and the keys themselves are private and never reported.
 */
export async function removeStoredObjects(
  objectStore: PrivateObjectStore | null,
  objectKeys: readonly string[],
): Promise<number> {
  if (objectStore === null || objectKeys.length === 0) {
    return 0;
  }
  const cleanup = await Promise.allSettled(
    objectKeys.map((objectKey) => objectStore.deleteObject(objectKey)),
  );
  return cleanup.filter((result) => result.status === 'rejected').length;
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
  readonly orphanedArtifactCount: number;
  readonly deletedWebhookEventCount: number;
  readonly expiredCheckoutSessionCount: number;
  readonly expiredCheckpointCount: number;
  readonly expiredCrawlPageCount: number;
  /** Spend-log rows that outlived their scan and stopped counting. */
  readonly deletedActionPlanAttemptCount: number;
}

/**
 * One pass of every age-based retention rule, so a caller cannot schedule half
 * of them. Sequential on purpose: a failure is logged and the next sweep retries.
 */
export async function runRetentionSweep(
  prisma: PrismaClient,
  now: Date,
  objectStore: PrivateObjectStore | null = createConfiguredObjectStore(),
): Promise<RetentionSweepResult> {
  const scans = await purgeExpiredScans(prisma, now, objectStore);
  const deletedWebhookEventCount = await purgeUnboundWebhookEvents(prisma, now);
  const expiredCheckoutSessionCount = await expireAbandonedCheckoutSessions(prisma, now);
  // A checkpoint outlives its usefulness the moment nobody resumes the scan it
  // belongs to, and it is the only row here that a *live* scan can leave behind.
  const expiredCheckpointCount = await sweepExpiredCheckpoints(prisma, now);
  // The pages and media probes behind those checkpoints are swept on their own
  // TTL, so evidence left by a crashed process is released even if its
  // checkpoint never existed.
  const expiredCrawlPageCount = await sweepExpiredCrawlEvidence(prisma, now);
  const deletedActionPlanAttemptCount = await purgeDetachedActionPlanAttempts(prisma, now);
  return {
    deletedScanCount: scans.deletedScanCount,
    orphanedArtifactCount: scans.orphanedArtifactCount,
    deletedWebhookEventCount,
    expiredCheckoutSessionCount,
    expiredCheckpointCount,
    expiredCrawlPageCount,
    deletedActionPlanAttemptCount,
  };
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
 * A non-zero `orphanedArtifactCount` is the one line that needs a human: the
 * database rows are gone and the report objects behind them are not, so they are
 * now unreferenced and only a bucket listing can find them.
 *
 * It never rejects: a sweep is background housekeeping and the next pass
 * retries, so a failure here must not take down the boot path or the timer that
 * calls it.
 */
export async function sweepRetention(
  prisma: PrismaClient,
  now: Date,
  logger: ApiLogger,
  objectStore: PrivateObjectStore | null = createConfiguredObjectStore(),
): Promise<void> {
  try {
    const result = await runRetentionSweep(prisma, now, objectStore);
    logger.info('retention sweep completed', { ...result });
  } catch (error) {
    logger.error('retention sweep failed', {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

/** Webhook deliveries that belong to these purchases, provider by provider. */
export function purchaseDeliveryFilters(
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

/** What the DeletedScan fact left behind for each removed scan records. */
export interface ScanDeletion {
  readonly accountIdHash: string;
  readonly reason: string;
}

/**
 * Removes scans and every row that hangs off them, leaving a DeletedScan fact
 * for each.
 *
 * Account and profile deletion share it so the ON DELETE RESTRICT order lives in
 * one place. Object storage is not touched: the caller reads the export keys
 * first and removes those objects only after its transaction commits.
 */
export async function deleteScanRows(
  tx: Prisma.TransactionClient,
  scanIds: readonly string[],
  deletion: ScanDeletion,
): Promise<void> {
  if (scanIds.length === 0) return;
  const ids = [...scanIds];
  // The scan rows FIRST, in id order, for the reason `deleteScanResult`
  // documents: a finishing generation takes the same lock and then writes a
  // plan row, so touching a child row before the scan row is a deadlock cycle.
  await lockScanRows(tx, ids);
  await tx.deletedScan.createMany({
    data: ids.map((scanId) => ({ scanId, ...deletion })),
    skipDuplicates: true,
  });
  await tx.exportArtifact.deleteMany({ where: { scanId: { in: ids } } });
  await tx.scanCheckpoint.deleteMany({ where: { scanId: { in: ids } } });
  await tx.scanCrawlPage.deleteMany({ where: { scanId: { in: ids } } });
  await tx.scanCrawlResourceSet.deleteMany({ where: { scanId: { in: ids } } });
  await tx.job.deleteMany({ where: { scanId: { in: ids } } });
  await tx.issue.deleteMany({ where: { scanId: { in: ids } } });
  await tx.ruleCoverageProof.deleteMany({ where: { scanId: { in: ids } } });
  await tx.scanModule.deleteMany({ where: { scanId: { in: ids } } });
  await tx.aiResponseRecord.deleteMany({ where: { scanId: { in: ids } } });
  await tx.aiConsent.deleteMany({ where: { scanId: { in: ids } } });
  await tx.actionPlan.deleteMany({ where: { scanId: { in: ids } } });
  await detachActionPlanAttempts(tx, ids);
  await tx.scan.deleteMany({ where: { id: { in: ids } } });
}

/**
 * Unhooks the Action Plan spend log from scans that are about to be deleted,
 * instead of deleting it with them.
 *
 * The rows are what the hourly and daily caps count. Deleting a scan is
 * something a customer can do at any time — `DELETE /profiles/:id` takes every
 * scan of that profile with it — so removing the log alongside it would make
 * "delete the profile" a way to clear the account's hourly counter and the
 * product's daily one. The provider was paid whatever the report now says, and
 * a cap that a customer can reset is not a cap.
 *
 * What stays is deliberately thin: the account, the language, the status, the
 * token usage and the timestamps — never the plan, the prompt or anything the
 * scan described. `purgeDetachedActionPlanAttempts` then removes each row as
 * soon as it can no longer refuse a generation.
 */
async function detachActionPlanAttempts(
  tx: Prisma.TransactionClient,
  scanIds: readonly string[],
): Promise<void> {
  await tx.actionPlanAttempt.updateMany({
    where: { scanId: { in: [...scanIds] } },
    data: { scanId: null },
  });
}

/**
 * Deletes spend-log rows that outlived their scan and can no longer refuse a
 * generation.
 *
 * The counting windows are the whole justification for keeping a detached row,
 * so once the widest of them has passed the row is retained for nothing. Rows
 * that still belong to a scan are not touched here: they go when it does.
 */
export async function purgeDetachedActionPlanAttempts(
  prisma: PrismaClient,
  now: Date,
): Promise<number> {
  const { count } = await prisma.actionPlanAttempt.deleteMany({
    where: {
      scanId: null,
      createdAt: { lt: new Date(now.getTime() - DETACHED_ACTION_PLAN_ATTEMPT_RETENTION_MS) },
    },
  });
  return count;
}

/**
 * Removes purchases with their refund lines, refund record and entitlement.
 * Scans point at their purchase, so they must already be gone.
 */
export async function deletePurchaseRows(
  tx: Prisma.TransactionClient,
  purchaseIds: readonly string[],
): Promise<void> {
  if (purchaseIds.length === 0) return;
  const ids = [...purchaseIds];
  await tx.providerRefund.deleteMany({ where: { purchaseId: { in: ids } } });
  await tx.refundRecord.deleteMany({ where: { purchaseId: { in: ids } } });
  await tx.entitlement.deleteMany({ where: { purchaseId: { in: ids } } });
  await tx.purchase.deleteMany({ where: { id: { in: ids } } });
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
      await tx.exportArtifact.deleteMany({ where: { accountId } });
      await deleteScanRows(
        tx,
        scans.map(({ id }) => id),
        { accountIdHash: accountDeletionHash(accountId), reason: 'account-deletion' },
      );
      // Erasure outranks the spend log. `deleteScanRows` keeps the log alive on
      // purpose — a customer must not be able to clear a cap by deleting a
      // profile — but an erased account has no caps left to enforce and no
      // activity record anyone may keep, so its rows go here rather than
      // waiting for the sweep. Nothing is bought by this: a generation still
      // costs a paid Complete scan, and this deletion destroys those too.
      await tx.actionPlanAttempt.deleteMany({ where: { accountId } });
      // Checkout sessions reference the account, the profile and the purchase,
      // so they must go before any of the three.
      await tx.checkoutSession.deleteMany({ where: { accountId } });
      await deletePurchaseRows(tx, purchaseIds);
      await tx.siteGoogleBinding.deleteMany({ where: { accountId } });
      // All of these are keyed by accountId as well as by the row they hang off,
      // so an account's checkpoints, ownership proofs and provider bindings go
      // with it even if a scan or a profile was already removed by an earlier
      // pass.
      await tx.scanCheckpoint.deleteMany({ where: { accountId } });
      await tx.scanCrawlPage.deleteMany({ where: { accountId } });
      await tx.scanCrawlResourceSet.deleteMany({ where: { accountId } });
      await tx.domainVerification.deleteMany({ where: { accountId } });
      await tx.siteBingBinding.deleteMany({ where: { accountId } });
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

  if (!deleted) {
    return { orphanedArtifactCount: 0 };
  }
  return {
    orphanedArtifactCount: await removeStoredObjects(
      objectStore,
      artifacts.map(({ objectKey }) => objectKey),
    ),
  };
}
