// One Action Plan generation, run after the POST has answered 202 (D-232).
//
// Everything here happens off the request: the input is read from the scan,
// the provider is asked once, and the outcome is written by the run-state
// helpers, which refuse to write for a run that lost its token.

import {
  runActionPlan,
  type ActionPlanFailed,
  type ActionPlanSucceeded,
  type AiProvider,
} from '@fluxradar/ai';
import { ACTION_PLAN_NOTICE_VERSION } from '@fluxradar/contracts';
import type { PrismaClient } from '@prisma/client';

import type { ApiLogger } from '../http/logger.ts';
import { buildActionPlanInput } from './input.ts';
import {
  RUN_FAILURE_CODES,
  recordActionPlanFailure,
  recordActionPlanSuccess,
  type ActionPlanClaim,
} from './run-state.ts';

export interface GenerationDeps {
  readonly prisma: PrismaClient;
  readonly provider: AiProvider;
  readonly logger: ApiLogger;
  readonly now: () => Date;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function recordFailedGeneration(
  deps: GenerationDeps,
  claim: ActionPlanClaim,
  result: ActionPlanFailed,
): Promise<void> {
  // The detail is our own description; the module never quotes the answer.
  deps.logger.warn('action plan attempt failed', {
    scanId: claim.scanId,
    language: claim.language,
    failureCode: result.failureCode,
    detail: result.detail,
  });
  const usage =
    result.response === null
      ? null
      : { usage: result.response.usage, usageSource: result.response.usageSource };
  await recordActionPlanFailure(deps.prisma, claim, result.failureCode, usage, deps.now());
}

async function recordWrittenPlan(
  deps: GenerationDeps,
  claim: ActionPlanClaim,
  result: ActionPlanSucceeded,
): Promise<void> {
  const context = { scanId: claim.scanId, language: claim.language };
  if (result.ignoredRuleIds.length > 0) {
    deps.logger.info('action plan named rules outside the scan', {
      ...context,
      ignoredRuleIds: result.ignoredRuleIds,
    });
  }
  const written = await recordActionPlanSuccess(
    deps.prisma,
    claim,
    {
      contentJson: JSON.stringify(result.content),
      promptText: result.promptText,
      promptVersion: result.promptVersion,
      modelId: result.response.modelId,
      requestId: result.response.requestId,
      usage: { usage: result.response.usage, usageSource: result.response.usageSource },
      noticeVersion: ACTION_PLAN_NOTICE_VERSION,
    },
    deps.now(),
  );
  if (!written) {
    deps.logger.info('action plan discarded: the run lost its claim before it finished', context);
  }
}

async function generateActionPlan(deps: GenerationDeps, claim: ActionPlanClaim): Promise<void> {
  const scan = await deps.prisma.scan.findUniqueOrThrow({
    where: { id: claim.scanId },
    select: { id: true, domain: true, modules: true },
  });
  const input = await buildActionPlanInput(deps.prisma, scan, claim.language);
  const result = await runActionPlan(input, { provider: deps.provider });
  await (result.status === 'failed'
    ? recordFailedGeneration(deps, claim, result)
    : recordWrittenPlan(deps, claim, result));
}

/**
 * Starts a generation without waiting for it. Every rejection ends in the
 * catch below — logged, and recorded as a failed attempt when possible — so a
 * failing generation can never become an unhandled rejection that stops the
 * process.
 */
export function launchActionPlanGeneration(deps: GenerationDeps, claim: ActionPlanClaim): void {
  void generateActionPlan(deps, claim).catch(async (error: unknown) => {
    deps.logger.error('action plan generation crashed', {
      scanId: claim.scanId,
      language: claim.language,
      error: describeError(error),
    });
    try {
      await recordActionPlanFailure(
        deps.prisma,
        claim,
        RUN_FAILURE_CODES.internalError,
        null,
        deps.now(),
      );
    } catch (recordError) {
      // The run then goes stale and the next request takes it over.
      deps.logger.error('action plan failure could not be recorded', {
        scanId: claim.scanId,
        error: describeError(recordError),
      });
    }
  });
}
