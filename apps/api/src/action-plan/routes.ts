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
import { ACTION_PLAN_NOTICE_VERSION, actionPlanLanguageInputSchema } from '@fluxradar/contracts';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import {
  ACTION_PLAN_START_IP_LIMIT,
  ACTION_PLAN_START_LIMIT,
  ACTION_PLAN_START_WINDOW_MS,
  RequestRateLimiter,
  accountAndIpRules,
} from '../auth/rate-limit.ts';
import { assertPaidWorkAllowed } from '../billing/report-access.ts';
import { sendOk } from '../http/envelope.ts';
import { ApiError, conflict, forbidden } from '../http/errors.ts';
import type { ApiLogger } from '../http/logger.ts';
import { requiredParam } from '../http/params.ts';
import { parseInput } from '../http/validate.ts';
import { findOwnReportScan, type OwnScan } from '../scans/routes.ts';
import { launchActionPlanGeneration } from './generate.ts';
import { ACTION_PLAN_DAILY_LIMIT, ACTION_PLAN_DAILY_WINDOW_MS } from './policy.ts';
import { claimActionPlanRun } from './run-state.ts';
import { isWindowOpen, readActionPlanView, readPlanFacts } from './view.ts';

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

const aiUnavailable = (): ApiError =>
  new ApiError(503, 'ACTION_PLAN_AI_UNAVAILABLE', 'AI is temporarily unavailable');

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
  if (!facts.ready) {
    throw conflict('ACTION_PLAN_NOT_READY', 'the plan can be written once the scan has finished');
  }
  if (!isWindowOpen(facts, now)) {
    throw conflict(
      'ACTION_PLAN_WINDOW_CLOSED',
      'a plan can be generated within 3 days after the scan finished',
    );
  }
  if (facts.plannableOpenIssues === 0) {
    throw conflict('ACTION_PLAN_NOTHING_TO_PLAN', 'this report has no open issue to plan');
  }
}

async function assertDailyCapLeft(prisma: PrismaClient, now: Date): Promise<void> {
  const recent = await prisma.actionPlanAttempt.count({
    where: { createdAt: { gt: new Date(now.getTime() - ACTION_PLAN_DAILY_WINDOW_MS) } },
  });
  if (recent >= ACTION_PLAN_DAILY_LIMIT) {
    throw new ApiError(503, 'ACTION_PLAN_BUSY', 'AI is temporarily unavailable');
  }
}

export function actionPlanRouter(deps: ActionPlanRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);
  const requestRateLimiter = deps.requestRateLimiter ?? new RequestRateLimiter();

  router.post('/scans/:scanId/action-plan', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const now = deps.now();
    const scan = await findOwnReportScan(deps.prisma, accountId, scanId);
    const input = parseInput(generateBodySchema, req.body);
    if (input.noticeVersion !== ACTION_PLAN_NOTICE_VERSION) {
      throw conflict(
        'ACTION_PLAN_NOTICE_OUTDATED',
        'this page is out of date; reload the report and try again',
      );
    }
    // Writing a plan is new work bought with the purchase, like a retry.
    assertPaidWorkAllowed(scan, now);
    assertCompleteScan(scan);
    await assertPlannable(deps.prisma, scan, now);
    const provider = deps.createActionPlanProvider();
    if (provider === null) throw aiUnavailable();
    requestRateLimiter.assertAllowedAll(
      accountAndIpRules('action-plan', accountId, req.ip ?? 'unknown', {
        account: ACTION_PLAN_START_LIMIT,
        ip: ACTION_PLAN_START_IP_LIMIT,
        windowMs: ACTION_PLAN_START_WINDOW_MS,
      }),
    );
    await assertDailyCapLeft(deps.prisma, now);
    const claimed = await claimActionPlanRun(deps.prisma, {
      scanId: scan.id,
      accountId,
      language: input.language,
      now,
    });
    if (claimed.kind === 'in_progress') {
      throw conflict('ACTION_PLAN_IN_PROGRESS', 'a plan for this report is already being written');
    }
    if (claimed.kind === 'limit_reached') {
      throw new ApiError(
        429,
        'ACTION_PLAN_LIMIT',
        'this report has used all of its Action Plan generations',
      );
    }
    launchActionPlanGeneration(
      { prisma: deps.prisma, provider, logger: deps.logger, now: deps.now },
      claimed.claim,
    );
    sendOk(
      res,
      {
        scanId: scan.id,
        language: input.language,
        startedAt: claimed.claim.startedAt.toISOString(),
      },
      { status: 202 },
    );
  });

  // No rate limit: the report polls this while a plan is being written.
  router.get('/scans/:scanId/action-plan', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const scan = await findOwnReportScan(deps.prisma, accountIdFrom(res), scanId);
    const query = parseInput(actionPlanLanguageInputSchema, req.query);
    assertCompleteScan(scan);
    sendOk(
      res,
      await readActionPlanView(deps.prisma, scan, query.language, deps.now(), deps.logger),
    );
  });

  return router;
}
