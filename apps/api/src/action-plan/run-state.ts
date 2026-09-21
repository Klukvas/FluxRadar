// The life of one Action Plan generation in the database (D-232).
//
// A run is claimed with ONE conditional update on the scan — the same pattern
// as `moduleRetryCount` — so two requests for the same scan, in the same
// language or not, can never both reach the provider. The claim's start time is
// the run's token: a run may write its result only while the scan still holds
// that token. A run taken over after going stale, or a scan re-run meanwhile
// (which clears the token and deletes the plans), therefore cannot write a plan
// from issues that are no longer the scan's.

import type { NormalizedAiUsage } from '@fluxradar/ai';
import type { ActionPlanLanguage, UsageSource } from '@fluxradar/contracts';
import type { PrismaClient } from '@prisma/client';

import {
  ACTION_PLAN_ATTEMPT_STATUSES,
  ACTION_PLAN_MAX_ATTEMPTS,
  ACTION_PLAN_MAX_SUCCESSES,
  ACTION_PLAN_RUN_STALE_MS,
  isRunInFlight,
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

export interface ActionPlanClaim {
  readonly scanId: string;
  readonly accountId: string;
  readonly language: ActionPlanLanguage;
  /** The run's token: the value `actionPlanRunStartedAt` must still hold at the end. */
  readonly startedAt: Date;
  readonly attemptId: string;
}

export type ClaimResult =
  | { readonly kind: 'claimed'; readonly claim: ActionPlanClaim }
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'limit_reached' };

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

function usageJson(usage: ActionPlanUsage | null): string | null {
  return usage === null ? null : JSON.stringify({ ...usage.usage, usageSource: usage.usageSource });
}

const RELEASED_RUN = { actionPlanRunStartedAt: null, actionPlanRunLanguage: null } as const;

export async function claimActionPlanRun(
  prisma: PrismaClient,
  params: {
    readonly scanId: string;
    readonly accountId: string;
    readonly language: ActionPlanLanguage;
    readonly now: Date;
  },
): Promise<ClaimResult> {
  const { scanId, accountId, language, now } = params;
  const staleSince = new Date(now.getTime() - ACTION_PLAN_RUN_STALE_MS);
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.scan.updateMany({
      where: {
        id: scanId,
        actionPlanAttempts: { lt: ACTION_PLAN_MAX_ATTEMPTS },
        actionPlanSuccesses: { lt: ACTION_PLAN_MAX_SUCCESSES },
        OR: [{ actionPlanRunStartedAt: null }, { actionPlanRunStartedAt: { lte: staleSince } }],
      },
      data: {
        actionPlanRunStartedAt: now,
        actionPlanRunLanguage: language,
        actionPlanAttempts: { increment: 1 },
      },
    });
    if (count === 0) {
      const scan = await tx.scan.findUniqueOrThrow({
        where: { id: scanId },
        select: { actionPlanRunStartedAt: true },
      });
      return isRunInFlight(scan.actionPlanRunStartedAt, now)
        ? { kind: 'in_progress' }
        : { kind: 'limit_reached' };
    }
    // A run presumed dead left its attempt Running; whatever it was doing, it failed.
    await tx.actionPlanAttempt.updateMany({
      where: { scanId, status: ACTION_PLAN_ATTEMPT_STATUSES.running },
      data: {
        status: ACTION_PLAN_ATTEMPT_STATUSES.failed,
        failureCode: RUN_FAILURE_CODES.abandoned,
        finishedAt: now,
      },
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
        data: {
          status: ACTION_PLAN_ATTEMPT_STATUSES.failed,
          failureCode: RUN_FAILURE_CODES.superseded,
          usageJson: usageJson(plan.usage),
          finishedAt: now,
        },
      });
      return false;
    }
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
  failureCode: string,
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
      data: {
        status: ACTION_PLAN_ATTEMPT_STATUSES.failed,
        failureCode,
        usageJson: usageJson(usage),
        finishedAt: now,
      },
    }),
  ]);
}
