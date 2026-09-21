import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deleteAccountData, deleteScanResult } from '../data-retention.ts';
import { silentLogger } from '../http/logger.ts';
import type { PerformanceSnapshot } from '../integrations/performance.ts';
import { createDefaultAiProvider } from '../orchestrator/geo.ts';
import { processScan } from '../orchestrator/worker.ts';
import {
  planAnswer,
  planApp,
  planProvider,
  plannableScan,
  postPlan,
  settledRun,
} from '../test-utils/action-plan-fixtures.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';

// A plan belongs to one snapshot of a scan (D-232): a re-run replaces the
// issues it was written from, so the plans go and the budget starts over, and
// deleting a scan, by retention or with its account, takes its plans and its
// attempts with it.

const ANSWER = planAnswer([
  { ruleIds: ['SEC-PASSIVE-003'] },
  { ruleIds: ['SEO-TECH-004', 'SEO-ONPAGE-002'] },
]);

const PAGE =
  '<!doctype html><html lang="en"><head><title>Plan fixture site</title></head>' +
  '<body><main><h1>Plan fixture site</h1><p>A page to read.</p></main></body></html>';

/** A small public site: every page answers with the same document, robots.txt with 404. */
function siteFetcher() {
  return async (url: string) => {
    const robots = new URL(url).pathname === '/robots.txt';
    return {
      finalUrl: url,
      status: robots ? 404 : 200,
      headers: { 'content-type': robots ? 'text/plain' : 'text/html; charset=utf-8' },
      body: robots ? 'not found' : PAGE,
      redirectChain: [],
      timingMs: 5,
      truncated: false,
    };
  };
}

function measuredPerformance(): PerformanceSnapshot {
  return {
    source: 'pagespeed',
    origin: 'https://example.com',
    strategy: 'desktop',
    performanceScore: 91,
    metrics: { largestContentfulPaintMs: 1800 },
    fetchedAt: '2026-09-21T00:00:00.000Z',
  };
}

describe('Action Plans and the life of their scan', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  async function scanWithPlan(email: string, status = 'Completed') {
    const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
    const planned = await plannableScan(db.prisma, app, email, {
      status,
      modules:
        status === 'Partial'
          ? [
              { module: 'SEO', runtimeStatus: 'Completed', score: 80, coverage: 1 },
              { module: 'Security', runtimeStatus: 'Partial', score: null, coverage: 0.5 },
            ]
          : undefined,
    });
    expect((await postPlan(planned.owner, planned.scanId, 'en')).status).toBe(202);
    await settledRun(db.prisma, planned.scanId);
    expect(await db.prisma.actionPlan.count({ where: { scanId: planned.scanId } })).toBe(1);
    return planned;
  }

  it('deletes the plans and resets the budget when a module retry re-runs the scan', async () => {
    const { owner, scanId } = await scanWithPlan('rerun@example.com', 'Partial');
    await db.prisma.scan.update({
      where: { id: scanId },
      data: { actionPlanAttempts: 4, actionPlanSuccesses: 2 },
    });

    const retry = await owner.agent
      .post(`/scans/${scanId}/retry`)
      .set('Cookie', owner.cookie)
      .send({ module: 'Security' });
    expect(retry.status).toBe(202);
    await processScan(
      {
        prisma: db.prisma,
        logger: silentLogger,
        createAiProvider: (scan, siteProfile) =>
          createDefaultAiProvider(siteProfile.name, new URL(scan.domain).hostname),
        createPerformanceRunner: () => async () => measuredPerformance(),
        crawl: { dangerouslyAllowLoopback: true, fetcher: siteFetcher() },
      },
      scanId,
    );

    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(0);
    expect(await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } })).toMatchObject({
      moduleRetryCount: 1,
      actionPlanAttempts: 0,
      actionPlanSuccesses: 0,
      actionPlanRunStartedAt: null,
      actionPlanRunLanguage: null,
    });
    // The spend log outlives the snapshot: the daily cap still counts it.
    expect(await db.prisma.actionPlanAttempt.count({ where: { scanId } })).toBe(1);
  });

  it('removes plans and attempts with a scan whose retention ran out', async () => {
    const { scanId } = await scanWithPlan('retention@example.com');

    await deleteScanResult(db.prisma, scanId);

    expect(await db.prisma.scan.count({ where: { id: scanId } })).toBe(0);
    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(0);
    expect(await db.prisma.actionPlanAttempt.count({ where: { scanId } })).toBe(0);
  });

  it('removes plans and attempts with the account that owned them', async () => {
    const { scanId } = await scanWithPlan('erase@example.com');
    const scan = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });

    await deleteAccountData(db.prisma, scan.accountId, null);

    expect(await db.prisma.account.count({ where: { id: scan.accountId } })).toBe(0);
    expect(await db.prisma.actionPlan.count()).toBe(0);
    expect(await db.prisma.actionPlanAttempt.count()).toBe(0);
  });
});
