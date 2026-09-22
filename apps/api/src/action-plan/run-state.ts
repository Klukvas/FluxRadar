// The life of one Action Plan generation in the database (D-232).
//
// A run is claimed with ONE conditional update on the scan — the same pattern
// as `moduleRetryCount` — so two requests for the same scan, in the same
// language or not, can never both reach the provider. The claim's start time is
// the run's token: a run may write its result only while the scan still holds
// that token. A run taken over after going stale, or a scan re-run meanwhile
// (which clears the token before it deletes the plans), therefore cannot write
// a plan from issues that are no longer the scan's.

import type { ActionPlanFailureCode, NormalizedAiUsage } from '@fluxradar/ai';
import type { ActionPlanLanguage, UsageSource } from '@fluxradar/contracts';
import type { Prisma, PrismaClient } from '@prisma/client';

import {
  ACTION_PLAN_ATTEMPT_STATUSES,
  ACTION_PLAN_DAILY_LIMIT,
  ACTION_PLAN_DAILY_WINDOW_MS,
  ACTION_PLAN_MAX_ATTEMPTS,
  ACTION_PLAN_MAX_SUCCESSES,
  ACTION_PLAN_READY_STATUSES,
  ACTION_PLAN_RUN_STALE_MS,
  isReadyStatus,
} from './policy.ts';

/** Failure codes the API adds to those of the AI module. */
export const RUN_FAILURE_CODES = {
  /** A run presumed dead was taken over by a later one. */
  abandoned: 'abandoned',
  /** The run finished after it lost its token: taken over, or the scan was re-run. */
  superseded: 'superseded',
  /** The generation threw; the logs carry the error. */
  internalError: 'internal_error',
} as const;

export type AttemptFailureCode =
  ActionPlanFailureCode | (typeof RUN_FAILURE_CODES)[keyof typeof RUN_FAILURE_CODES];

export interface ActionPlanClaim {
  readonly scanId: string;
  readonly accountId: string;
  readonly language: ActionPlanLanguage;
  /** The run's token: the value `actionPlanRunStartedAt` must still hold at the end. */
  readonly startedAt: Date;
  readonly attemptId: string;
}

export interface ClaimRequest {
  readonly scanId: string;
  readonly accountId: string;
  readonly language: ActionPlanLanguage;
  readonly now: Date;
}

export type ClaimRefusal = 'in_progress' | 'limit_reached' | 'not_ready' | 'busy';

export type ClaimResult =
  { readonly kind: 'claimed'; readonly claim: ActionPlanClaim } | { readonly kind: ClaimRefusal };

export interface ActionPlanUsage {
  readonly usage: NormalizedAiUsage;
  readonly usageSource: UsageSource;
}

export interface GeneratedPlan {
  readonly contentJson: string;
  readonly promptText: string;
  readonly promptVersion: string;
  readonly modelId: string;
  readonly requestId: string;
  readonly usage: ActionPlanUsage;
  readonly noticeVersion: string;
}

/**
 * Serializes claims across the product, so the daily count and the claim it
 * permits cannot interleave: two starts at the 99th attempt, counted outside
 * it, would both pass.
 */
const CLAIM_LOCK_KEY = 232_001;

const RELEASED_RUN = { actionPlanRunStartedAt: null, actionPlanRunLanguage: null } as const;

function usageJson(usage: ActionPlanUsage | null): string | null {
  return usage === null ? null : JSON.stringify({ ...usage.usage, usageSource: usage.usageSource });
}

function failedAttempt(
  failureCode: AttemptFailureCode,
  usage: ActionPlanUsage | null,
  now: Date,
): Prisma.ActionPlanAttemptUpdateManyMutationInput {
  return {
    status: ACTION_PLAN_ATTEMPT_STATUSES.failed,
    failureCode,
    usageJson: usageJson(usage),
    finishedAt: now,
  };
}

/** Why a claim that matched no row was refused, read from the state it failed on. */
export function refusedClaim(scan: {
  readonly status: string;
  readonly actionPlanAttempts: number;
  readonly actionPlanSuccesses: number;
}): Exclude<ClaimRefusal, 'busy'> {
  if (!isReadyStatus(scan.status)) return 'not_ready';
  if (
    scan.actionPlanAttempts >= ACTION_PLAN_MAX_ATTEMPTS ||
    scan.actionPlanSuccesses >= ACTION_PLAN_MAX_SUCCESSES
  ) {
    return 'limit_reached';
  }
  // The run that blocked the claim may have finished since; "try again" is
  // still the true answer, which a limit would not be.
  return 'in_progress';
}

async function dailyCapReached(tx: Prisma.TransactionClient, now: Date): Promise<boolean> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLAIM_LOCK_KEY}::bigint)`;
  const recent = await tx.actionPlanAttempt.count({
    where: { createdAt: { gt: new Date(now.getTime() - ACTION_PLAN_DAILY_WINDOW_MS) } },
  });
  return recent >= ACTION_PLAN_DAILY_LIMIT;
}

/**
 * Clears what an earlier snapshot of the scan left behind, before the claim
 * reads it. A release that resets the plans on a re-run leaves nothing; the
 * previous one, after a rollback, keeps the plans, the counters and a dead
 * run's token (see isOfCurrentSnapshot). With no attempt made since the latest
 * run finished, the counters are not this snapshot's.
 */
async function forgetEarlierSnapshot(tx: Prisma.TransactionClient, scanId: string): Promise<void> {
  const scan = await tx.scan.findUnique({ where: { id: scanId }, select: { completedAt: true } });
  if (scan === null || scan.completedAt === null) return;
  const since = scan.completedAt;
  await tx.actionPlan.deleteMany({ where: { scanId, generatedAt: { lt: since } } });
  await tx.scan.updateMany({
    where: { id: scanId, actionPlanRunStartedAt: { lt: since } },
    data: RELEASED_RUN,
  });
  const spentSince = await tx.actionPlanAttempt.count({
    where: { scanId, createdAt: { gte: since } },
  });
  if (spentSince > 0) return;
  await tx.scan.updateMany({
    where: {
      id: scanId,
      OR: [{ actionPlanAttempts: { gt: 0 } }, { actionPlanSuccesses: { gt: 0 } }],
    },
    data: { actionPlanAttempts: 0, actionPlanSuccesses: 0 },
  });
}

/** The one conditional update that takes the run: true when this request won it. */
async function takeRun(tx: Prisma.TransactionClient, request: ClaimRequest): Promise<boolean> {
  const staleSince = new Date(request.now.getTime() - ACTION_PLAN_RUN_STALE_MS);
  const { count } = await tx.scan.updateMany({
    where: {
      id: request.scanId,
      status: { in: [...ACTION_PLAN_READY_STATUSES] },
      actionPlanAttempts: { lt: ACTION_PLAN_MAX_ATTEMPTS },
      actionPlanSuccesses: { lt: ACTION_PLAN_MAX_SUCCESSES },
      OR: [{ actionPlanRunStartedAt: null }, { actionPlanRunStartedAt: { lte: staleSince } }],
    },
    data: {
      actionPlanRunStartedAt: request.now,
      actionPlanRunLanguage: request.language,
      actionPlanAttempts: { increment: 1 },
    },
  });
  return count === 1;
}

export async function claimActionPlanRun(
  prisma: PrismaClient,
  request: ClaimRequest,
): Promise<ClaimResult> {
  const { scanId, accountId, language, now } = request;
  return prisma.$transaction(async (tx) => {
    if (await dailyCapReached(tx, now)) return { kind: 'busy' };
    await forgetEarlierSnapshot(tx, scanId);
    if (!(await takeRun(tx, request))) {
      const scan = await tx.scan.findUniqueOrThrow({
        where: { id: scanId },
        select: { status: true, actionPlanAttempts: true, actionPlanSuccesses: true },
      });
      return { kind: refusedClaim(scan) };
    }
    // A run presumed dead left its attempt Running; whatever it was doing, it failed.
    await tx.actionPlanAttempt.updateMany({
      where: { scanId, status: ACTION_PLAN_ATTEMPT_STATUSES.running },
      data: failedAttempt(RUN_FAILURE_CODES.abandoned, null, now),
    });
    const attempt = await tx.actionPlanAttempt.create({
      data: {
        scanId,
        accountId,
        language,
        status: ACTION_PLAN_ATTEMPT_STATUSES.running,
        createdAt: now,
      },
    });
    return {
      kind: 'claimed',
      claim: { scanId, accountId, language, startedAt: now, attemptId: attempt.id },
    };
  });
}

async function storePlan(
  tx: Prisma.TransactionClient,
  claim: ActionPlanClaim,
  plan: GeneratedPlan,
  now: Date,
): Promise<void> {
  const stored = {
    contentJson: plan.contentJson,
    promptText: plan.promptText,
    promptVersion: plan.promptVersion,
    modelId: plan.modelId,
    requestId: plan.requestId,
    usageJson: usageJson(plan.usage) ?? '{}',
    noticeVersion: plan.noticeVersion,
    generatedAt: now,
  };
  // One plan per language: a new one replaces the old, and there is no history.
  await tx.actionPlan.upsert({
    where: { scanId_language: { scanId: claim.scanId, language: claim.language } },
    create: { scanId: claim.scanId, language: claim.language, ...stored },
    update: stored,
  });
}

/**
 * Stores the plan, counts the success and releases the run, in one
 * transaction. False when the run had lost its token: nothing is stored then.
 */
export async function recordActionPlanSuccess(
  prisma: PrismaClient,
  claim: ActionPlanClaim,
  plan: GeneratedPlan,
  now: Date,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.scan.updateMany({
      where: { id: claim.scanId, actionPlanRunStartedAt: claim.startedAt },
      data: { ...RELEASED_RUN, actionPlanSuccesses: { increment: 1 } },
    });
    if (count === 0) {
      await tx.actionPlanAttempt.updateMany({
        where: { id: claim.attemptId, status: ACTION_PLAN_ATTEMPT_STATUSES.running },
        data: failedAttempt(RUN_FAILURE_CODES.superseded, plan.usage, now),
      });
      return false;
    }
    await storePlan(tx, claim, plan, now);
    await tx.actionPlanAttempt.updateMany({
      where: { id: claim.attemptId },
      data: {
        status: ACTION_PLAN_ATTEMPT_STATUSES.succeeded,
        usageJson: usageJson(plan.usage),
        finishedAt: now,
      },
    });
    return true;
  });
}

/** Releases the run and records the failure by code; provider text is never stored. */
export async function recordActionPlanFailure(
  prisma: PrismaClient,
  claim: ActionPlanClaim,
  failureCode: AttemptFailureCode,
  usage: ActionPlanUsage | null,
  now: Date,
): Promise<void> {
  await prisma.$transaction([
    prisma.scan.updateMany({
      where: { id: claim.scanId, actionPlanRunStartedAt: claim.startedAt },
      data: RELEASED_RUN,
    }),
    prisma.actionPlanAttempt.updateMany({
      where: { id: claim.attemptId, status: ACTION_PLAN_ATTEMPT_STATUSES.running },
      data: failedAttempt(failureCode, usage, now),
    }),
  ]);
}

/**
 * Starts a scan's plan budget over with a new snapshot: the plans go, and so
 * do the counters and the run in flight. The token is cleared first, in the
 * same transaction: a run that finishes after it writes nothing, and one that
 * finished just before has its plan deleted by the next statement. The other
 * way round, a run could store its plan between the two and survive the re-run.
 */
export async function resetActionPlans(prisma: PrismaClient, scanId: string): Promise<void> {
  await prisma.$transaction([
    prisma.scan.update({
      where: { id: scanId },
      data: { ...RELEASED_RUN, actionPlanAttempts: 0, actionPlanSuccesses: 0 },
    }),
    prisma.actionPlan.deleteMany({ where: { scanId } }),
  ]);
}
