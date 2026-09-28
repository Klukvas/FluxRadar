// GET /scans/:scanId/comparison — this report against the previous scan of the
// same site, for the plans that carry finding history.
//
// The gate is the tariff capability, asked exactly the way the export route asks
// for its own (`planSupports(plan, 'issueHistory')`): comparing two scans is the
// same entitlement the Resolved/Reopened lifecycle is sold under, and Free and
// Basic have neither. The refusal is a 403 with a stable code, before any of the
// work below.
//
// The payload is validated against the contract on the way out. A comparison is
// a page of numbers a customer is invited to act on, so a field this server
// computed wrongly should fail here — loudly, for the operator — rather than be
// rendered as a delta nobody can reproduce.

import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { planSupports, scanComparisonSchema } from '@fluxradar/contracts';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import {
  COMPARISON_ACTION_IP_LIMIT,
  COMPARISON_ACTION_LIMIT,
  COMPARISON_ACTION_WINDOW_MS,
  RequestRateLimiter,
  accountAndIpRules,
} from '../auth/rate-limit.ts';
import { forbidden } from '../http/errors.ts';
import { sendOk } from '../http/envelope.ts';
import { silentLogger, type ApiLogger } from '../http/logger.ts';
import { requiredParam } from '../http/params.ts';
import { buildScanComparison } from './comparison/build.ts';
import { findOwnReportScan } from './routes.ts';

export interface ComparisonRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly logger?: ApiLogger;
  readonly requestRateLimiter?: RequestRateLimiter;
}

export function scanComparisonRouter(deps: ComparisonRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);
  const requestRateLimiter = deps.requestRateLimiter ?? new RequestRateLimiter();
  const logger = deps.logger ?? silentLogger;

  router.get('/scans/:scanId/comparison', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const scanId = requiredParam(req.params.scanId, 'scanId');
    requestRateLimiter.assertAllowedAll(
      accountAndIpRules('scan-comparison', accountId, req.ip ?? 'unknown', {
        account: COMPARISON_ACTION_LIMIT,
        ip: COMPARISON_ACTION_IP_LIMIT,
        windowMs: COMPARISON_ACTION_WINDOW_MS,
      }),
    );
    // Tenant and payment first, exactly as every other read of report data:
    // findOwnReportScan is what revokes a refunded report everywhere at once.
    const scan = await findOwnReportScan(deps.prisma, accountId, scanId);
    if (!planSupports(scan.plan, 'issueHistory')) {
      throw forbidden(
        'COMPARISON_NOT_IN_PLAN',
        'comparing a report with the previous scan is not included in this plan',
      );
    }
    const comparison = await buildScanComparison({ prisma: deps.prisma, logger }, scan);
    sendOk(res, scanComparisonSchema.parse(comparison));
  });

  return router;
}
