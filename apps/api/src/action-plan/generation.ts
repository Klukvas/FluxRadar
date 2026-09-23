// One generation, start to finish.
//
// It runs detached from the request that asked for it, so every exit path has
// to release the claimed run: a plan the owner can read, or a failure code and
// the slot back. Nothing here throws without first recording what happened —
// a crashed attempt that kept its claim would block the scan for five minutes.

import { AI_PROVIDER_NAMES, runActionPlan } from '@fluxradar/ai';
import type { AiConsent, AiProvider, AiProviderName, AiRequestOutcome } from '@fluxradar/ai';
import type { PrismaClient } from '@prisma/client';

import type { ApiLogger } from '../http/logger.ts';
import { buildActionPlanScanInput } from './input-builder.ts';
import { completePlanRun, failPlanRun, refusalBeforeProvider } from './service.ts';
import type { ClaimedRun } from './service.ts';

export interface PlanGenerationDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly logger: ApiLogger;
  readonly createProvider: () => AiProvider;
}

/**
 * Runs the plan the claim paid for.
 *
 * `signal` is the API's: when the process stops, the provider call stops with
 * it and the attempt is recorded as cancelled rather than left running against
 * a database that is about to close.
 */
export async function generateActionPlan(
  deps: PlanGenerationDeps,
  scanId: string,
  run: ClaimedRun,
  signal: AbortSignal,
): Promise<void> {
  const { language } = run;
  try {
    const scan = await deps.prisma.scan.findUnique({
      where: { id: scanId },
      select: { domain: true, aiConsent: { select: { providersJson: true, noticeVersion: true } } },
    });
    if (scan === null) {
      // Retention deleted the scan while this run was queued. Not a fault: the
      // attempt row outlived it (`data-retention.ts` detaches the spend log),
      // so the refusal is still recorded against the account that claimed it.
      await failPlanRun(deps.prisma, scanId, run, { code: 'Superseded' }, deps.now());
      return;
    }
    const input = await buildActionPlanScanInput(deps.prisma, scanId, language);
    if (input.rules.length === 0) {
      // Everything was triaged between the click and the build: there is no
      // plan to write, and the attempt is recorded rather than charged for.
      await failPlanRun(deps.prisma, scanId, run, { code: 'NothingToPlan' }, deps.now());
      return;
    }
    // The last thing before the money: the route's checks are as old as the
    // queue wait, and a refund, a re-run or a takeover in that gap must stop the
    // call rather than be discovered once the answer has been paid for.
    const refusal = await refusalBeforeProvider(deps.prisma, scanId, run, deps.now());
    if (refusal !== null) {
      await failPlanRun(deps.prisma, scanId, run, { code: refusal }, deps.now());
      return;
    }
    const result = await runActionPlan(
      {
        scanId,
        domain: scan.domain,
        language,
        modules: input.modules,
        rules: input.rules,
        consent: consentFor(scanId, scan.aiConsent),
      },
      { provider: deps.createProvider(), signal },
    );
    if (result.status === 'Failed') {
      await failPlanRun(
        deps.prisma,
        scanId,
        run,
        { code: result.failureCode, ...usageOf(result.outcome) },
        deps.now(),
      );
      return;
    }
    const stored = await completePlanRun(
      deps.prisma,
      scanId,
      run,
      {
        contentJson: JSON.stringify(result.content),
        promptText: result.outcome.promptText,
        promptVersion: result.request.promptVersion,
        modelId: result.outcome.response.modelId,
        requestId: result.outcome.response.requestId,
        usageJson: JSON.stringify(result.outcome.response.usage),
        // The notice the owner accepted when they clicked, carried from the
        // claim so the plan reports the disclosure they actually read (D-232).
        noticeVersion: run.noticeVersion,
      },
      deps.now(),
    );
    if (stored.kind === 'discarded') {
      deps.logger.info('action plan discarded after it was written', {
        scanId,
        language,
        reason: stored.reason,
      });
    }
  } catch (error) {
    if (signal.aborted) {
      // A shutdown, not a fault: record it and let the process finish closing.
      await failPlanRun(deps.prisma, scanId, run, { code: 'Cancelled' }, deps.now());
      return;
    }
    // The claim must not be left held by a crashed attempt.
    await failPlanRun(deps.prisma, scanId, run, { code: 'InternalError' }, deps.now());
    throw error;
  }
}

/** What the attempt cost, when it reached the provider at all. */
function usageOf(outcome: AiRequestOutcome | null): { readonly usageJson?: string } {
  return outcome !== null && outcome.kind === 'response'
    ? { usageJson: JSON.stringify(outcome.response.usage) }
    : {};
}

/**
 * The scan's stored processing record, as the AI layer reads it. A record that
 * does not parse is no record at all (fail-closed §5).
 */
function consentFor(
  scanId: string,
  record: { readonly providersJson: string; readonly noticeVersion: string } | null,
): AiConsent | null {
  if (record === null) return null;
  let providers: unknown;
  try {
    providers = JSON.parse(record.providersJson);
  } catch {
    return null;
  }
  if (!Array.isArray(providers)) return null;
  // The plan is an Anthropic request; a record that covers the paid AI
  // processing covers it, and one that does not blocks it in `runAiRequest`.
  // A name this build does not know is dropped rather than carried: consent is
  // a list of companies, and an unknown entry authorises nobody.
  return {
    scanId,
    providers: providers.filter(isKnownProvider),
    noticeVersion: record.noticeVersion,
  };
}

function isKnownProvider(value: unknown): value is AiProviderName {
  return typeof value === 'string' && (AI_PROVIDER_NAMES as readonly string[]).includes(value);
}
