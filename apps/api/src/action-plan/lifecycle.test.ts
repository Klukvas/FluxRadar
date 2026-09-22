import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteAccountData, deleteScanResult } from '../data-retention.ts';
import { silentLogger } from '../http/logger.ts';
import type { PerformanceSnapshot } from '../integrations/performance.ts';
import type { WorkerDeps } from '../orchestrator/deps.ts';
import { createDefaultAiProvider } from '../orchestrator/geo.ts';
import { runScanAttempt } from '../orchestrator/run-attempt.ts';
import { processScan } from '../orchestrator/worker.ts';
import { deleteSiteProfileData } from '../profiles/profile-deletion.ts';
import {
  PLAN_NOW,
  gatedProvider,
  planAnswer,
  planApp,
  planProvider,
  plannableScan,
  postPlan,
  settledRun,
  type Owner,
  type SeedModule,
} from '../test-utils/action-plan-fixtures.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';

// A plan belongs to one snapshot of a scan (D-232): a re-run replaces the
// issues it was written from, so the plans go and the budget starts over, and
// deleting a scan, by retention, with its site or with its account, takes its
// plans and its attempts with it.

const ANSWER = planAnswer([
  { ruleIds: ['SEC-PASSIVE-003'] },
  { ruleIds: ['SEO-TECH-004', 'SEO-ONPAGE-002'] },
]);

const PAGE =
  '<!doctype html><html lang="en"><head><title>Plan fixture site</title></head>' +
  '<body><main><h1>Plan fixture site</h1><p>A page to read.</p></main></body></html>';

/** A scan whose Security section can be retried. */
const PARTIAL_MODULES: readonly SeedModule[] = [
  { module: 'SEO', runtimeStatus: 'Completed', score: 80, coverage: 1 },
  { module: 'Security', runtimeStatus: 'Partial', score: null, coverage: 0.5 },
];

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

/** The worker, crawling the in-process site above and nothing else. */
function workerDeps(prisma: PrismaClient): WorkerDeps {
  return {
    prisma,
    logger: silentLogger,
    createAiProvider: (scan, siteProfile) =>
      createDefaultAiProvider(siteProfile.name, new URL(scan.domain).hostname),
    createPerformanceRunner: () => async () => measuredPerformance(),
    crawl: { dangerouslyAllowLoopback: true, fetcher: siteFetcher() },
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
      modules: status === 'Partial' ? PARTIAL_MODULES : undefined,
    });
    expect((await postPlan(planned.owner, planned.scanId, 'en')).status).toBe(202);
    await settledRun(db.prisma, planned.scanId);
    expect(await db.prisma.actionPlan.count({ where: { scanId: planned.scanId } })).toBe(1);
    return planned;
  }

  async function retrySecurity(owner: Owner, scanId: string): Promise<void> {
    const retry = await owner.agent
      .post(`/scans/${scanId}/retry`)
      .set('Cookie', owner.cookie)
      .send({ module: 'Security' });
    expect(retry.status).toBe(202);
    await processScan(workerDeps(db.prisma), scanId);
  }

  async function planBudget(scanId: string) {
    return db.prisma.scan.findUniqueOrThrow({
      where: { id: scanId },
      select: {
        actionPlanAttempts: true,
        actionPlanSuccesses: true,
        actionPlanRunStartedAt: true,
        actionPlanRunLanguage: true,
      },
    });
  }

  const FRESH_BUDGET = {
    actionPlanAttempts: 0,
    actionPlanSuccesses: 0,
    actionPlanRunStartedAt: null,
    actionPlanRunLanguage: null,
  };

  it('deletes the plans and resets the budget when a module retry re-runs the scan', async () => {
    const { owner, scanId } = await scanWithPlan('rerun@example.com', 'Partial');
    await db.prisma.scan.update({
      where: { id: scanId },
      data: { actionPlanAttempts: 4, actionPlanSuccesses: 2 },
    });

    await retrySecurity(owner, scanId);

    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(0);
    expect(await planBudget(scanId)).toEqual(FRESH_BUDGET);
    expect(await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } })).toMatchObject({
      moduleRetryCount: 1,
    });
    // The spend log outlives the snapshot: the daily cap still counts it.
    expect(await db.prisma.actionPlanAttempt.count({ where: { scanId } })).toBe(1);
  });

  it('deletes the plans and resets the budget when a full attempt replaces the snapshot', async () => {
    const { scanId } = await scanWithPlan('full-rerun@example.com');
    await db.prisma.scan.update({
      where: { id: scanId },
      data: { actionPlanAttempts: 4, actionPlanSuccesses: 2 },
    });

    await runScanAttempt(workerDeps(db.prisma), scanId);

    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(0);
    expect(await planBudget(scanId)).toEqual(FRESH_BUDGET);
  });

  it('lets a generation still in flight when the scan is re-run write nothing', async () => {
    const gated = gatedProvider(planProvider(ANSWER));
    const app = planApp(db.prisma, { provider: gated.provider });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'superseded@example.com', {
      status: 'Partial',
      modules: PARTIAL_MODULES,
    });
    expect((await postPlan(owner, scanId, 'en')).status).toBe(202);
    await vi.waitFor(() => expect(gated.calls()).toBe(1));

    await retrySecurity(owner, scanId);
    gated.release();
    await vi.waitFor(
      async () =>
        expect(
          await db.prisma.actionPlanAttempt.count({ where: { scanId, status: 'Running' } }),
        ).toBe(0),
      { timeout: 5_000, interval: 20 },
    );

    // Its answer was written from issues the retry replaced.
    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(0);
    expect(await db.prisma.actionPlanAttempt.findFirstOrThrow({ where: { scanId } })).toMatchObject(
      { status: 'Failed', failureCode: 'superseded' },
    );
    expect(await planBudget(scanId)).toEqual(FRESH_BUDGET);
  });

  it('removes plans and attempts with a scan whose retention ran out', async () => {
    const { scanId } = await scanWithPlan('retention@example.com');

    await deleteScanResult(db.prisma, scanId);

    expect(await db.prisma.scan.count({ where: { id: scanId } })).toBe(0);
    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(0);
    expect(await db.prisma.actionPlanAttempt.count({ where: { scanId } })).toBe(0);
  });

  it('removes plans and attempts with the site profile they were written for', async () => {
    const { owner, scanId } = await scanWithPlan('profile@example.com');
    const scan = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });

    const deletion = await deleteSiteProfileData(
      db.prisma,
      { accountId: scan.accountId, profileId: owner.profileId, now: PLAN_NOW },
      null,
    );

    expect(deletion.kind).toBe('deleted');
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
