// The one route that asks a model for search-query ideas.
//
// It is a POST because it costs money and sends data: a GET that spends on the
// provider every time a report is opened, or every time a crawler follows a
// link, is not a read. The browser asks for it explicitly, once, per report.
//
// The context it sends is the account's own Search Console rows, read back from
// the scan the account owns. Nothing new is stored, and the response is a closed
// set of states — the caller is never handed a provider message.

import { Router } from 'express';
import type { PrismaClient, ScanModule } from '@prisma/client';
import { z } from 'zod';
import { parseInput } from '../../http/validate.ts';

import { accountIdFrom, requireAuth } from '../../auth/middleware.ts';
import { RequestRateLimiter, aiIdeaRules } from '../../auth/rate-limit.ts';
import { sendOk } from '../../http/envelope.ts';
import type { ApiLogger } from '../../http/logger.ts';
import { requiredParam } from '../../http/params.ts';
import { storedExecutionConfig } from '../../profiles/execution-config.ts';
import { findOwnReportScan, readableModules } from '../../scans/routes.ts';
import {
  createQueryIdeasProvider,
  generateQueryIdeas,
  hasQueryIdeasContext,
  type QueryIdeasResult,
} from './query-ideas.ts';
import type { GoogleDataSnapshot, SearchConsoleSummary } from './types.ts';

export interface QueryIdeasRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly logger: ApiLogger;
  readonly requestRateLimiter?: RequestRateLimiter;
  /**
   * Test seam. Production resolves the provider per request from the
   * environment, so a deployment that gains a key does not need a restart to
   * start answering `generated` instead of `not_configured`.
   */
  readonly createProvider?: () => ReturnType<typeof createQueryIdeasProvider>;
}

/** The Search Console half of the snapshot the Analytics module stored, if any. */
function searchConsoleOf(modules: readonly ScanModule[]): SearchConsoleSummary | null {
  const analytics = modules.find((module) => module.module === 'Analytics');
  if (analytics === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(analytics.metadataJson) as unknown;
  } catch {
    return null;
  }
  const snapshot = parsed as Partial<GoogleDataSnapshot> | null;
  if (snapshot === null || snapshot.source !== 'google') return null;
  return snapshot.searchConsole?.data ?? null;
}

export function queryIdeasRouter(deps: QueryIdeasRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);
  const requestRateLimiter = deps.requestRateLimiter ?? new RequestRateLimiter();
  const createProvider = deps.createProvider ?? (() => createQueryIdeasProvider());

  router.post('/scans/:scanId/search-console/query-ideas', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const accountId = accountIdFrom(res);
    // Ownership first, then the limit: an account may not spend another
    // account's budget by asking about a scan it cannot read.
    const scan = await findOwnReportScan(deps.prisma, accountId, scanId);
    parseInput(z.object({ noticeVersion: z.literal('query-ideas-v2') }), req.body);
    requestRateLimiter.assertAllowedAll(aiIdeaRules(accountId, req.ip ?? 'unknown'));

    const profile = storedExecutionConfig(scan.executionConfigJson)?.profile;
    const searchConsole = searchConsoleOf(readableModules(scan));
    const profileContext = {
      industry: profile?.industry ?? null,
      region: profile?.region ?? null,
      language: profile?.language ?? null,
      businessDescription: profile?.businessDescription ?? null,
      offerings: profile?.offerings ?? null,
      targetLanguages: profile?.targetLanguages ?? null,
      targetAudience: profile?.targetAudience ?? null,
    } as const;
    if (
      (searchConsole === null || searchConsole.topQueries.length === 0) &&
      !hasQueryIdeasContext(profileContext)
    ) {
      sendOk<QueryIdeasResult>(res, { state: 'unavailable' });
      return;
    }
    const result = await generateQueryIdeas(
      {
        scanId: scan.id,
        siteUrl: searchConsole?.siteUrl ?? scan.domain,
        brand: profile?.name ?? new URL(scan.domain).hostname,
        measuredQueries: searchConsole?.topQueries ?? [],
        measuredPages: searchConsole?.topPages ?? [],
        profileContext,
      },
      { provider: createProvider(), now: deps.now },
    );
    // Logged by state only. The prompt carries the account's Search Console
    // rows and the answer is the model's; neither belongs in a log line.
    deps.logger.info('query ideas generated', { scanId: scan.id, state: result.state });
    sendOk<QueryIdeasResult>(res, result);
  });

  return router;
}
