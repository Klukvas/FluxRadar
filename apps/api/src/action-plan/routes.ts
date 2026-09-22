// Action Plan HTTP API (D-232).
//
// POST starts a generation and answers 202 before the provider is asked; the
// report then polls GET, which is deliberately not rate limited. The refusals
// come in a fixed order, cheapest and most fundamental first, so the owner is
// told the real reason: whose scan it is, whether the purchase still buys work,
// the plan, readiness, the Plan Window, whether anything is left to plan, then
// the provider and the spend limits, and finally the atomic claim.

import { Router } from 'express';
import type { AiProvider } from '@fluxradar/ai';
import {
  ACTION_PLAN_NOTICE_VERSION,
  actionPlanLanguageInputSchema,
  type ActionPlanLanguage,
} from '@fluxradar/contracts';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import {
  ACTION_PLAN_START_IP_LIMIT,
  ACTION_PLAN_START_LIMIT,
  ACTION_PLAN_START_WINDOW_MS,
  RequestRateLimiter,
  accountAndIpRules,
  type RateLimitRule,
} from '../auth/rate-limit.ts';
import { assertPaidWorkAllowed } from '../billing/report-access.ts';
import { sendOk } from '../http/envelope.ts';
import { ApiError, conflict, forbidden } from '../http/errors.ts';
import type { ApiLogger } from '../http/logger.ts';
import { requiredParam } from '../http/params.ts';
import { parseInput } from '../http/validate.ts';
import { findOwnReportScan, type OwnScan } from '../scans/routes.ts';
import { launchActionPlanGeneration } from './generate.ts';
import { ACTION_PLAN_WINDOW_DAYS } from './policy.ts';
import {
  claimActionPlanRun,
  type ActionPlanClaim,
  type ClaimRefusal,
  type ClaimRequest,
} from './run-state.ts';
import { isWindowOpen, readActionPlanState, readPlanFacts } from './view.ts';

export interface ActionPlanRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly logger: ApiLogger;
  readonly requestRateLimiter?: RequestRateLimiter;
  /** Null when no provider is configured; generating then answers 503. */
  readonly createActionPlanProvider: () => AiProvider | null;
}

/**
 * The notice version the button showed, as the checkout sends the version of
 * its own notice: a page from before a notice change must not record consent
 * to a notice it never displayed.
 */
const generateBodySchema = actionPlanLanguageInputSchema.extend({
  noticeVersion: z.string().max(64),
});

const aiUnavailable = (code: string): ApiError =>
  new ApiError(503, code, 'AI is temporarily unavailable');

const CLAIM_REFUSALS: Readonly<Record<ClaimRefusal, () => ApiError>> = {
  in_progress: () =>
    conflict('ACTION_PLAN_IN_PROGRESS', 'a plan for this report is already being written'),
  limit_reached: () =>
    new ApiError(
      429,
      'ACTION_PLAN_LIMIT',
      'this report has used all of its Action Plan generations',
    ),
  not_ready: () =>
    conflict('ACTION_PLAN_NOT_READY', 'the plan can be written once the scan has finished'),
  busy: () => aiUnavailable('ACTION_PLAN_BUSY'),
};

function parseGenerateBody(body: unknown): { readonly language: ActionPlanLanguage } {
  const input = parseInput(generateBodySchema, body);
  if (input.noticeVersion !== ACTION_PLAN_NOTICE_VERSION) {
    throw conflict(
      'ACTION_PLAN_NOTICE_OUTDATED',
      'this page is out of date; reload the report and try again',
    );
  }
  return { language: input.language };
}

function assertCompleteScan(scan: OwnScan): void {
  if (scan.plan !== 'Complete') {
    throw forbidden(
      'ACTION_PLAN_COMPLETE_ONLY',
      'the AI Action Plan is available on Complete scans only',
    );
  }
}

async function assertPlannable(prisma: PrismaClient, scan: OwnScan, now: Date): Promise<void> {
  const facts = await readPlanFacts(prisma, scan);
  if (!facts.ready) throw CLAIM_REFUSALS.not_ready();
  if (!isWindowOpen(facts, now)) {
    throw conflict(
      'ACTION_PLAN_WINDOW_CLOSED',
      `a plan can be generated within ${ACTION_PLAN_WINDOW_DAYS} days after the scan finished`,
    );
  }
  if (facts.plannableOpenIssues === 0) {
    throw conflict('ACTION_PLAN_NOTHING_TO_PLAN', 'this report has no open issue to plan');
  }
}

/** Every refusal that does not depend on the limits, in order; the provider to use. */
async function assertStartable(
  deps: ActionPlanRouterDeps,
  scan: OwnScan,
  now: Date,
): Promise<AiProvider> {
  // Writing a plan is new work bought with the purchase, like a retry.
  assertPaidWorkAllowed(scan, now);
  assertCompleteScan(scan);
  await assertPlannable(deps.prisma, scan, now);
  const provider = deps.createActionPlanProvider();
  if (provider === null) throw aiUnavailable('ACTION_PLAN_AI_UNAVAILABLE');
  return provider;
}

function startRules(accountId: string, ip: string | undefined): readonly RateLimitRule[] {
  return accountAndIpRules('action-plan', accountId, ip ?? 'unknown', {
    account: ACTION_PLAN_START_LIMIT,
    ip: ACTION_PLAN_START_IP_LIMIT,
    windowMs: ACTION_PLAN_START_WINDOW_MS,
  });
}

/** The daily cap and the claim, which run together (run-state.ts). */
async function claimOrRefuse(
  prisma: PrismaClient,
  request: ClaimRequest,
): Promise<ActionPlanClaim> {
  const claimed = await claimActionPlanRun(prisma, request);
  if (claimed.kind !== 'claimed') throw CLAIM_REFUSALS[claimed.kind]();
  return claimed.claim;
}

export function actionPlanRouter(deps: ActionPlanRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);
  const requestRateLimiter = deps.requestRateLimiter ?? new RequestRateLimiter();

  router.post('/scans/:scanId/action-plan', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const now = deps.now();
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const scan = await findOwnReportScan(deps.prisma, accountId, scanId);
    const { language } = parseGenerateBody(req.body);
    const provider = await assertStartable(deps, scan, now);
    requestRateLimiter.assertAllowedAll(startRules(accountId, req.ip));
    const claim = await claimOrRefuse(deps.prisma, { scanId, accountId, language, now });
    launchActionPlanGeneration(
      { prisma: deps.prisma, provider, logger: deps.logger, now: deps.now },
      claim,
    );
    sendOk(res, { scanId, language, startedAt: claim.startedAt.toISOString() }, { status: 202 });
  });

  // No rate limit: the report polls this while a plan is being written.
  router.get('/scans/:scanId/action-plan', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const scan = await findOwnReportScan(deps.prisma, accountIdFrom(res), scanId);
    const query = parseInput(actionPlanLanguageInputSchema, req.query);
    assertCompleteScan(scan);
    sendOk(
      res,
      await readActionPlanState(deps.prisma, scan, query.language, deps.now(), deps.logger),
    );
  });

  return router;
}
