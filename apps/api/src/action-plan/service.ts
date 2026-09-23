// Eligibility, the atomic claim, and what happens when an attempt finishes.
//
// The spend rules of D-232 are enforced in the database, not in memory. Every
// claim runs in one transaction that first takes a product-wide advisory lock,
// so the two caps that count rows — 100 generations a day across the product,
// 10 starts an hour for one account — cannot be passed by two requests reading
// the same count at the same moment. Inside that transaction the scan's own
// slot is taken with one conditional update, and the attempt row is written
// beside it: the spend log and the counter it feeds commit together or not at
// all.
//
// A finished attempt writes only while it still owns the run it claimed, and
// only while the snapshot, the job and the payment it was authorised by are
// still the ones it started from.

import { randomUUID } from 'node:crypto';

import { ACTION_PLAN_LIMITS } from '@fluxradar/contracts';
import type { Prisma, PrismaClient, Scan } from '@prisma/client';

import { PAID_ACCESS_INCLUDE, paidAccessDenial } from '../billing/report-access.ts';
import type { PaidAccessScan } from '../billing/report-access.ts';
import { conflict, forbidden } from '../http/errors.ts';
import { OPEN_ISSUE_STATUSES } from '../issues/summary.ts';
import { lockScanRow } from '../scans/scan-row-lock.ts';
import { ACTION_PLAN_EXCLUDED_MODULE } from '@fluxradar/ai';

/** Scan runtime statuses whose snapshot is finished enough to plan from. */
const PLANNABLE_SCAN_STATUSES = new Set(['Completed', 'Partial', 'Failed', 'Cancelled']);

/**
 * The lock every claim takes, as two int4 keys (`pg_advisory_xact_lock` also has
 * a bigint form; the pair avoids depending on how the driver types a large
 * number). The first is FluxRadar's namespace, the second this feature.
 *
 * It serialises claims product-wide, which is affordable precisely because the
 * thing being counted is capped at 100 a day: the critical section is two counts,
 * one conditional update and one insert, with no provider call inside it.
 */
const ADVISORY_LOCK_NAMESPACE = 1849;
const ADVISORY_LOCK_ACTION_PLAN_SPEND = 232;

/**
 * Long enough for a queue of parallel claims to take the lock one after another
 * on a busy pool, short enough that a stuck transaction fails instead of pinning
 * a connection.
 */
const CLAIM_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const;

/** The scan columns the Action Plan reads; a Prisma `Scan` satisfies it. */
export interface ActionPlanScanState {
  readonly actionPlanAttempts: number;
  readonly actionPlanSuccesses: number;
  readonly actionPlanRunStartedAt: Date | null;
  readonly actionPlanRunLanguage: string | null;
}

/**
 * When the Plan Window closes: three days after the scan's latest run finished.
 * Null while the scan has no finished run, which is the "not ready" case rather
 * than an open window without an end.
 */
export function planWindowEndsAt(scan: Pick<Scan, 'completedAt'>): Date | null {
  return scan.completedAt === null
    ? null
    : new Date(scan.completedAt.getTime() + ACTION_PLAN_LIMITS.windowMs);
}

export function isRunInFlight(
  scan: Pick<ActionPlanScanState, 'actionPlanRunStartedAt'>,
  now: Date,
): boolean {
  return (
    scan.actionPlanRunStartedAt !== null &&
    now.getTime() - scan.actionPlanRunStartedAt.getTime() < ACTION_PLAN_LIMITS.staleRunMs
  );
}

/**
 * Everything that must hold before a generation is even attempted, in the order
 * the customer should hear about it: what they bought, then whether the scan can
 * be planned from, then whether they may still ask.
 */
export async function assertPlanGenerationAllowed(
  prisma: PrismaClient,
  scan: Scan & ActionPlanScanState,
  now: Date,
): Promise<void> {
  if (scan.plan !== 'Complete') {
    throw forbidden(
      'ACTION_PLAN_COMPLETE_ONLY',
      'the AI Action Plan is written from a Complete scan',
    );
  }
  const job = await prisma.job.findUnique({ where: { scanId: scan.id }, select: { status: true } });
  // The worker writes the Analytics module after the scan outcome is resolved,
  // so a terminal status alone does not mean the snapshot is finished.
  if (!isPlannableSnapshot(scan, job)) {
    throw conflict('ACTION_PLAN_NOT_READY', 'this scan has not finished running yet');
  }
  const windowEndsAt = planWindowEndsAt(scan);
  if (windowEndsAt === null || now.getTime() > windowEndsAt.getTime()) {
    throw conflict(
      'ACTION_PLAN_WINDOW_CLOSED',
      'the three-day window for asking for an Action Plan has closed',
    );
  }
  const plannable = await prisma.issue.findFirst({
    where: {
      scanId: scan.id,
      status: { in: [...OPEN_ISSUE_STATUSES] },
      module: { not: ACTION_PLAN_EXCLUDED_MODULE },
    },
    select: { id: true },
  });
  if (plannable === null) {
    throw conflict('ACTION_PLAN_NOTHING_TO_PLAN', 'this scan has no open issue left to plan');
  }
}

function isPlannableSnapshot(
  scan: { readonly plan: string; readonly status: string },
  job: { readonly status: string } | null,
): boolean {
  return (
    scan.plan === 'Complete' &&
    PLANNABLE_SCAN_STATUSES.has(scan.status) &&
    job !== null &&
    job.status === 'Done'
  );
}

/**
 * How many generations the product started in the last 24 hours.
 *
 * Counted across every attempt row, including the ones whose scan has since
 * been deleted: what the provider was paid for does not become unspent because
 * the report it was written from is gone (`data-retention.ts`).
 */
export async function generationsToday(
  prisma: Prisma.TransactionClient,
  now: Date,
): Promise<number> {
  return prisma.actionPlanAttempt.count({
    where: {
      createdAt: { gte: new Date(now.getTime() - ACTION_PLAN_LIMITS.productGenerationWindowMs) },
    },
  });
}

/** How many generations this account started in the last hour, same rule. */
export async function generationsThisHour(
  prisma: Prisma.TransactionClient,
  accountId: string,
  now: Date,
): Promise<number> {
  return prisma.actionPlanAttempt.count({
    where: {
      accountId,
      createdAt: { gte: new Date(now.getTime() - ACTION_PLAN_LIMITS.accountStartWindowMs) },
    },
  });
}

export interface ClaimedRun {
  readonly attemptId: string;
  readonly claimedAt: Date;
  readonly language: string;
  /** The Action Plan notice this click accepted; stored with the plan it writes. */
  readonly noticeVersion: string;
  /** The scan's `completedAt` when the run was claimed: the snapshot identity. */
  readonly snapshotAt: Date | null;
}

export interface PlanClaim {
  readonly scanId: string;
  readonly accountId: string;
  readonly language: string;
  /** The Action Plan notice the click accepted; stored with the attempt. */
  readonly noticeVersion: string;
  readonly now: Date;
}

export type ClaimResult =
  | { readonly kind: 'claimed'; readonly run: ClaimedRun }
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'limit_reached'; readonly successes: number; readonly attempts: number }
  | { readonly kind: 'account_rate_limited' }
  | { readonly kind: 'product_busy' }
  | { readonly kind: 'gone' };

/**
 * Takes the scan's single generation slot, or explains why it could not.
 *
 * The caps are checked and the slot is taken under one lock, so the answer a
 * caller gets is the answer the database still holds when it commits: no two
 * requests can both read "99 today", and no two can both take the same scan's
 * slot. Two concurrent POSTs — in the same language or not — therefore produce
 * exactly one provider call.
 */
export async function claimPlanRun(prisma: PrismaClient, claim: PlanClaim): Promise<ClaimResult> {
  const staleBefore = new Date(claim.now.getTime() - ACTION_PLAN_LIMITS.staleRunMs);
  const attemptId = randomUUID();
  return prisma.$transaction(async (tx) => {
    await lockActionPlanSpend(tx);
    if (
      (await generationsToday(tx, claim.now)) >= ACTION_PLAN_LIMITS.maxGenerationsPerProductPerDay
    )
      return { kind: 'product_busy' };
    if (
      (await generationsThisHour(tx, claim.accountId, claim.now)) >=
      ACTION_PLAN_LIMITS.maxStartsPerAccountPerHour
    )
      return { kind: 'account_rate_limited' };

    const { count } = await tx.scan.updateMany({
      where: {
        id: claim.scanId,
        accountId: claim.accountId,
        OR: [{ actionPlanRunStartedAt: null }, { actionPlanRunStartedAt: { lt: staleBefore } }],
        actionPlanAttempts: { lt: ACTION_PLAN_LIMITS.maxAttemptsPerScan },
        actionPlanSuccesses: { lt: ACTION_PLAN_LIMITS.maxSuccessesPerScan },
      },
      data: {
        actionPlanRunStartedAt: claim.now,
        actionPlanRunAttemptId: attemptId,
        actionPlanRunLanguage: claim.language,
        actionPlanAttempts: { increment: 1 },
      },
    });
    const current = await tx.scan.findUnique({
      where: { id: claim.scanId, accountId: claim.accountId },
      select: {
        completedAt: true,
        actionPlanAttempts: true,
        actionPlanSuccesses: true,
        actionPlanRunStartedAt: true,
        actionPlanRunLanguage: true,
      },
    });
    if (current === null) return { kind: 'gone' };
    if (count === 0) {
      if (isRunInFlight(current, claim.now)) return { kind: 'in_progress' };
      return {
        kind: 'limit_reached',
        successes: current.actionPlanSuccesses,
        attempts: current.actionPlanAttempts,
      };
    }
    await tx.actionPlanAttempt.create({
      data: {
        id: attemptId,
        scanId: claim.scanId,
        accountId: claim.accountId,
        language: claim.language,
        noticeVersion: claim.noticeVersion,
        status: 'Running',
        createdAt: claim.now,
      },
    });
    return {
      kind: 'claimed',
      run: {
        attemptId,
        claimedAt: claim.now,
        language: claim.language,
        noticeVersion: claim.noticeVersion,
        snapshotAt: current.completedAt,
      },
    };
  }, CLAIM_TRANSACTION_OPTIONS);
}

/**
 * Takes the spend lock for the rest of the transaction; PostgreSQL releases it
 * on commit or rollback, so no path can leak it.
 *
 * The `::text` is not decoration: `pg_advisory_xact_lock` returns `void`, and
 * the Prisma driver cannot deserialize a void column ("Failed to deserialize
 * column of type 'void'"). Casting gives it an empty string to carry back.
 */
async function lockActionPlanSpend(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_NAMESPACE}::int4, ${ADVISORY_LOCK_ACTION_PLAN_SPEND}::int4)::text AS locked`;
}

/**
 * Everything a completion or a pre-provider re-check reads about the scan, in
 * one place: the two questions are the same question asked at two moments, and
 * a select that drifted between them would be a fence with a hole in it.
 */
const AUTHORIZATION_SELECT = {
  plan: true,
  status: true,
  completedAt: true,
  purchaseId: true,
  actionPlanRunAttemptId: true,
  job: { select: { status: true } },
  ...PAID_ACCESS_INCLUDE,
} as const;

export interface FinishedPlan {
  readonly contentJson: string;
  readonly promptText: string;
  readonly promptVersion: string;
  readonly modelId: string;
  readonly requestId: string;
  readonly usageJson: string;
  readonly noticeVersion: string;
}

/** Why a finished attempt was thrown away instead of stored. */
export type DiscardReason = 'Superseded' | 'SnapshotChanged' | 'AccessRevoked';

export type CompleteResult =
  { readonly kind: 'stored' } | { readonly kind: 'discarded'; readonly reason: DiscardReason };

/**
 * Stores a successful attempt, but only while everything it was authorised by
 * still holds.
 *
 * The fence is the attempt id written into the scan when the run was claimed: a
 * re-scan clears it and a stale takeover overwrites it, so a late answer from a
 * superseded run finds no matching row. On top of that the snapshot must be the
 * one the plan was written from and the payment must still be good — a plan
 * describing issues that no longer exist, or one written for a report that was
 * refunded while the model was thinking, is not a plan anybody should read.
 *
 * The scan row is LOCKED before any of that is read. Without the lock the check
 * and the write are two decisions taken on two snapshots: a re-run committing
 * between them leaves the conditional update matching nothing while the upsert
 * still writes the plan the re-run had just deleted — a plan for a snapshot
 * that no longer exists, resurrected by the run that was already superseded.
 */
export async function completePlanRun(
  prisma: PrismaClient,
  scanId: string,
  run: ClaimedRun,
  plan: FinishedPlan,
  now: Date,
): Promise<CompleteResult> {
  return prisma.$transaction(async (tx) => {
    if (!(await lockScanRow(tx, scanId))) {
      return discardFinishedAttempt(tx, run, 'Superseded', plan.usageJson, now);
    }
    const scan = await tx.scan.findUnique({ where: { id: scanId }, select: AUTHORIZATION_SELECT });
    const discard = discardReasonFor(scan, run);
    if (discard !== null) {
      return discardFinishedAttempt(tx, run, discard, plan.usageJson, now);
    }
    const { count } = await tx.scan.updateMany({
      where: { id: scanId, actionPlanRunAttemptId: run.attemptId },
      data: {
        actionPlanRunStartedAt: null,
        actionPlanRunAttemptId: null,
        actionPlanRunLanguage: null,
        actionPlanSuccesses: { increment: 1 },
      },
    });
    // Under the row lock this cannot be 0 — which is exactly why it is checked
    // rather than assumed: if the fence ever stops holding, the failure mode is
    // a stored plan nobody is entitled to, so the count decides the write.
    if (count === 0) {
      return discardFinishedAttempt(tx, run, 'Superseded', plan.usageJson, now);
    }
    await tx.actionPlan.upsert({
      where: { scanId_language: { scanId, language: run.language } },
      create: { scanId, language: run.language, ...plan, generatedAt: now },
      update: { ...plan, generatedAt: now },
    });
    await tx.actionPlanAttempt.updateMany({
      where: { id: run.attemptId },
      data: { status: 'Succeeded', usageJson: plan.usageJson, finishedAt: now },
    });
    return { kind: 'stored' };
  });
}

/**
 * Records what a thrown-away answer cost and says why it was thrown away.
 *
 * The attempt row survives its scan (it is detached, not deleted, by
 * retention — `data-retention.ts`), so this records the spend even when the
 * report it was written for is gone. `updateMany` matching nothing is still a
 * normal outcome: a second completion for the same attempt finds it no longer
 * Running.
 */
async function discardFinishedAttempt(
  tx: Prisma.TransactionClient,
  run: ClaimedRun,
  reason: DiscardReason,
  usageJson: string,
  now: Date,
): Promise<CompleteResult> {
  await tx.actionPlanAttempt.updateMany({
    where: { id: run.attemptId, status: 'Running' },
    data: { status: 'Failed', failureCode: reason, usageJson, finishedAt: now },
  });
  return { kind: 'discarded', reason };
}

interface CompletionState extends PaidAccessScan {
  readonly plan: string;
  readonly status: string;
  readonly completedAt: Date | null;
  readonly actionPlanRunAttemptId: string | null;
  readonly job: { readonly status: string } | null;
}

/**
 * Entitlement EXPIRY is deliberately not a reason: expiry bounds what may still
 * be bought, and this generation was bought when it was claimed. A refund or a
 * suspension is different — it revokes the report itself, and the plan is part
 * of the report.
 */
function discardReasonFor(scan: CompletionState | null, run: ClaimedRun): DiscardReason | null {
  if (scan === null) return 'Superseded';
  if (scan.actionPlanRunAttemptId !== run.attemptId) return 'Superseded';
  if (!isPlannableSnapshot(scan, scan.job)) return 'SnapshotChanged';
  if (scan.completedAt?.getTime() !== run.snapshotAt?.getTime()) return 'SnapshotChanged';
  if (paidAccessDenial(scan) !== null) return 'AccessRevoked';
  return null;
}

/**
 * Why a claimed run must not be spent, or null when it still may be.
 *
 * `WindowClosed` exists only here: closing the Plan Window stops a generation
 * from STARTING, and a plan that was already written is read afterwards, so it
 * can never be a reason to throw an answer away.
 */
export type SpendRefusal = DiscardReason | 'WindowClosed';

/**
 * The last check before the money is spent.
 *
 * The route checks all of this too, but between the click and the provider call
 * lie the queue and the model's thinking time — and in that gap a refund can
 * land, the scan can be re-run, a retry can take the run over, or the worker can
 * still be writing Analytics. Claiming the slot proves nobody else holds it; it
 * does not prove the report is still one this account paid for.
 *
 * Deliberately NOT under the scan's row lock: a lock held across a provider call
 * would block every re-run and every retention delete for as long as a model
 * takes to answer. The authority stays where the write happens — `completePlanRun`
 * fences under the lock — and this is the cheap read that stops the spend before
 * it happens.
 */
export async function refusalBeforeProvider(
  prisma: PrismaClient,
  scanId: string,
  run: ClaimedRun,
  now: Date,
): Promise<SpendRefusal | null> {
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    select: AUTHORIZATION_SELECT,
  });
  const discard = discardReasonFor(scan, run);
  if (discard !== null) return discard;
  // Generating is new paid work (D-194), so an entitlement that expired since
  // the claim refuses here — while `completePlanRun`, which only stores what was
  // already bought, deliberately lets expiry through.
  if (scan === null || paidAccessDenial(scan, { now }) !== null) return 'AccessRevoked';
  const windowEndsAt = planWindowEndsAt(scan);
  if (windowEndsAt === null || now.getTime() > windowEndsAt.getTime()) return 'WindowClosed';
  return null;
}

export interface FailedAttempt {
  /** A short code; provider text never reaches storage or the customer. */
  readonly code: string;
  /** Present when the attempt reached the provider: a failure can still cost. */
  readonly usageJson?: string;
}

/**
 * Releases the run after a failed attempt and records the failure CODE and what
 * it cost. The plan already written in this language is left exactly as it was.
 */
export async function failPlanRun(
  prisma: PrismaClient,
  scanId: string,
  run: ClaimedRun,
  failure: FailedAttempt,
  now: Date,
): Promise<void> {
  await prisma.$transaction([
    prisma.scan.updateMany({
      where: { id: scanId, actionPlanRunAttemptId: run.attemptId },
      data: {
        actionPlanRunStartedAt: null,
        actionPlanRunAttemptId: null,
        actionPlanRunLanguage: null,
      },
    }),
    prisma.actionPlanAttempt.updateMany({
      where: { id: run.attemptId, status: 'Running' },
      data: {
        status: 'Failed',
        failureCode: failure.code,
        ...(failure.usageJson === undefined ? {} : { usageJson: failure.usageJson }),
        finishedAt: now,
      },
    }),
  ]);
}

/**
 * Re-running the scan discards its plans: the snapshot they describe is gone.
 *
 * The attempt rows are kept and marked cleared instead of deleted. They are the
 * spend log: the provider was paid for them whatever the report now shows, so
 * they must keep counting against the daily and hourly caps — deleting them
 * would turn "re-run the scan" into a way to buy unlimited generations, exactly
 * as deleting the scan would if retention did not detach them instead
 * (`data-retention.ts`). The scan row is updated first so a claim mid-flight on
 * the same scan serialises behind it rather than resurrecting a counter.
 */
export async function clearActionPlansForScan(
  prisma: PrismaClient,
  scanId: string,
  now: Date,
): Promise<void> {
  await prisma.$transaction((tx) => clearActionPlansInTransaction(tx, scanId, now));
}

/**
 * The same clear, inside a transaction the caller owns. Production has no such
 * caller; a test does, because "a re-run commits while a generation finishes"
 * is only a test if the test decides when each of the two commits.
 */
export async function clearActionPlansInTransaction(
  tx: Prisma.TransactionClient,
  scanId: string,
  now: Date,
): Promise<void> {
  await lockScanRow(tx, scanId);
  await tx.scan.updateMany({
    where: { id: scanId },
    data: {
      actionPlanAttempts: 0,
      actionPlanSuccesses: 0,
      actionPlanRunStartedAt: null,
      actionPlanRunAttemptId: null,
      actionPlanRunLanguage: null,
    },
  });
  await tx.actionPlan.deleteMany({ where: { scanId } });
  await tx.actionPlanAttempt.updateMany({
    where: { scanId, status: 'Running' },
    data: { status: 'Failed', failureCode: 'Superseded', finishedAt: now },
  });
  await tx.actionPlanAttempt.updateMany({
    where: { scanId, clearedAt: null },
    data: { clearedAt: now },
  });
}
