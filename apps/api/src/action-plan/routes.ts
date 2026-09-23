// The Action Plan HTTP surface: ask for one, and read what there is.
//
// POST answers 202 and hands the generation to the background registry — a
// provider turn takes a minute or two, the browser polls GET for the result,
// and the process can still cancel the call on its way down. GET is what the
// browser polls, so it carries no rate limiter.

import { ACTION_PLAN_LANGUAGES, ACTION_PLAN_LIMITS } from '@fluxradar/contracts';
import { ACCEPTED_ACTION_PLAN_NOTICE_VERSIONS } from '@fluxradar/ai';
import { Router } from 'express';
import type { AiProvider } from '@fluxradar/ai';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import {
  ACTION_PLAN_START_IP_LIMIT,
  ACTION_PLAN_START_LIMIT,
  ACTION_PLAN_START_WINDOW_MS,
  accountAndIpRules,
  RequestRateLimiter,
} from '../auth/rate-limit.ts';
import type { RateLimitRule } from '../auth/rate-limit.ts';
import { assertPaidWorkAllowed } from '../billing/report-access.ts';
import { BackgroundRuns } from '../http/background-runs.ts';
import { ApiError } from '../http/errors.ts';
import { sendOk } from '../http/envelope.ts';
import type { ApiLogger } from '../http/logger.ts';
import { requiredParam } from '../http/params.ts';
import { enumValues, parseInput } from '../http/validate.ts';
import { findOwnReportScan } from '../scans/routes.ts';
import { generateActionPlan } from './generation.ts';
import { projectActionPlan } from './projection.ts';
import { createDefaultActionPlanProvider, isActionPlanProviderConfigured } from './provider.ts';
import {
  assertPlanGenerationAllowed,
  claimPlanRun,
  isRunInFlight,
  planWindowEndsAt,
} from './service.ts';
import type { ClaimResult } from './service.ts';

export interface ActionPlanRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly logger: ApiLogger;
  readonly requestRateLimiter?: RequestRateLimiter;
  /** Test seam; production builds the Anthropic adapter for the plan model. */
  readonly createActionPlanProvider?: () => AiProvider;
  /**
   * Where detached generations live. Production passes the one the API stops on
   * shutdown; a test passes its own and awaits it instead of sleeping.
   */
  readonly backgroundRuns?: BackgroundRuns;
}

/**
 * The notice the click accepts. It is sent by the browser and checked against
 * the allowlist here: the server decides what a valid acceptance is, and a
 * request naming a notice this release does not publish is refused rather than
 * stored — a stored record has to name a disclosure that actually existed.
 */
const generateSchema = z.object({
  language: z.enum(ACTION_PLAN_LANGUAGES),
  noticeVersion: z.enum(enumValues(ACCEPTED_ACTION_PLAN_NOTICE_VERSIONS, 'action plan notice')),
});

const languageQuerySchema = z.object({ language: z.enum(ACTION_PLAN_LANGUAGES).optional() });

/**
 * The HTTP guard on starting a plan: this account, and this address.
 *
 * It is not the spend cap — that one is counted in the database, because it has
 * to hold across processes and restarts (service.ts). This is the abuse control
 * in front of it, so a flood never reaches the database at all. One address may
 * hold a team, so its ceiling sits well above a single account's.
 */
function startRules(accountId: string, ip: string | undefined): readonly RateLimitRule[] {
  return accountAndIpRules('action-plan', accountId, ip ?? 'unknown', {
    account: ACTION_PLAN_START_LIMIT,
    ip: ACTION_PLAN_START_IP_LIMIT,
    windowMs: ACTION_PLAN_START_WINDOW_MS,
  });
}

/** How a refused claim is reported. A cap and a race are not the same answer. */
const CLAIM_REFUSALS: Record<
  Exclude<ClaimResult['kind'], 'claimed'>,
  { readonly status: number; readonly code: string; readonly message: string }
> = {
  in_progress: {
    status: 409,
    code: 'ACTION_PLAN_IN_PROGRESS',
    message: 'an Action Plan is already being written for this scan',
  },
  limit_reached: {
    status: 429,
    code: 'ACTION_PLAN_LIMIT',
    message: 'this scan has used all of its Action Plan generations',
  },
  account_rate_limited: {
    status: 429,
    code: 'ACTION_PLAN_RATE_LIMITED',
    message: 'too many Action Plans started from this account in the last hour',
  },
  // Deliberately not "you are rate limited": the product-wide cap is our
  // budget, not something the owner did.
  product_busy: {
    status: 503,
    code: 'ACTION_PLAN_BUSY',
    message: 'AI is temporarily unavailable',
  },
  gone: {
    status: 404,
    code: 'NOT_FOUND',
    message: 'resource not found',
  },
};

export function actionPlanRouter(deps: ActionPlanRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);
  const requestRateLimiter = deps.requestRateLimiter ?? new RequestRateLimiter();
  const createProvider = deps.createActionPlanProvider ?? createDefaultActionPlanProvider;
  const backgroundRuns = deps.backgroundRuns ?? new BackgroundRuns();

  router.post('/scans/:scanId/action-plan', auth, async (req, res) => {
    const { language, noticeVersion } = parseInput(generateSchema, req.body);
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const accountId = accountIdFrom(res);
    const now = deps.now();
    const scan = await findOwnReportScan(deps.prisma, accountId, scanId);
    // Generating a plan is new paid work, not reading what the purchase already
    // produced (D-194), so the stricter guard applies.
    assertPaidWorkAllowed(scan, now);
    await assertPlanGenerationAllowed(deps.prisma, scan, now);
    if (!isActionPlanProviderConfigured()) {
      throw new ApiError(503, 'ACTION_PLAN_UNAVAILABLE', 'AI is temporarily unavailable');
    }
    // This account and this address, before anything touches the database. The
    // spend caps themselves stay in the database below: an in-memory counter
    // cannot hold across processes and restarts, and a DB cap is not an abuse
    // control — so both run, in that order.
    requestRateLimiter.assertAllowedAll(startRules(accountId, req.ip));

    // Both spend caps and the scan's own slot are settled inside this one call,
    // in the database: an in-memory limiter cannot see the other process.
    const claim = await claimPlanRun(deps.prisma, {
      scanId,
      accountId,
      language,
      noticeVersion,
      now,
    });
    if (claim.kind !== 'claimed') {
      const refusal = CLAIM_REFUSALS[claim.kind];
      throw new ApiError(refusal.status, refusal.code, refusal.message);
    }

    backgroundRuns.start(
      (signal) =>
        generateActionPlan(
          { prisma: deps.prisma, now: deps.now, logger: deps.logger, createProvider },
          scanId,
          claim.run,
          signal,
        ),
      (error: unknown) => {
        deps.logger.error('action plan generation failed', {
          scanId,
          language,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
      },
    );
    sendOk(res, { scanId, language, status: 'Running' }, { status: 202 });
  });

  // No rate limiter: this is what the report polls every few seconds while a
  // plan is being written.
  router.get('/scans/:scanId/action-plan', auth, async (req, res) => {
    const query = parseInput(languageQuerySchema, req.query);
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const now = deps.now();
    const scan = await findOwnReportScan(deps.prisma, accountIdFrom(res), scanId);

    const [plans, lastAttempt] = await Promise.all([
      deps.prisma.actionPlan.findMany({
        where: { scanId },
        orderBy: [{ generatedAt: 'desc' }, { language: 'asc' }],
        select: { language: true },
      }),
      deps.prisma.actionPlanAttempt.findFirst({
        // Attempts from a superseded snapshot are kept as a spend record, but
        // they describe a report that no longer exists and must not surface as
        // this report's last failure.
        where: { scanId, status: 'Failed', clearedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { failureCode: true, language: true },
      }),
    ]);
    const plan =
      query.language === undefined
        ? null
        : await projectActionPlan(deps.prisma, scanId, query.language);

    sendOk(res, {
      scanId,
      languages: plans.map((stored) => stored.language),
      running: isRunInFlight(scan, now)
        ? {
            language: scan.actionPlanRunLanguage,
            startedAt: scan.actionPlanRunStartedAt?.toISOString() ?? null,
          }
        : null,
      lastFailure:
        lastAttempt === null
          ? null
          : { code: lastAttempt.failureCode, language: lastAttempt.language },
      remaining: {
        successes: Math.max(0, ACTION_PLAN_LIMITS.maxSuccessesPerScan - scan.actionPlanSuccesses),
        attempts: Math.max(0, ACTION_PLAN_LIMITS.maxAttemptsPerScan - scan.actionPlanAttempts),
      },
      windowEndsAt: planWindowEndsAt(scan)?.toISOString() ?? null,
      plan,
    });
  });

  return router;
}
