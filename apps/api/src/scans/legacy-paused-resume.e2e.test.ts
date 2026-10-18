import { RULESET_VERSION, scanScopeSchema, type ScanScopeInput } from '@fluxradar/contracts';
import type { CrawlFetchInit } from '@fluxradar/crawler';
import { startFixtureSite, type FixtureSite } from '@fluxradar/crawler';
import { HostLimiter, safeFetch } from '@fluxradar/safe-fetch';
import type { Scan } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { silentLogger } from '../http/logger.ts';
import { EMPTY_CRAWL_COVERAGE, saveScanCheckpoint } from '../orchestrator/checkpoint.ts';
import type { WorkerDeps } from '../orchestrator/deps.ts';
import { createDefaultAiProvider } from '../orchestrator/geo.ts';
import { resumeLegacyPausedScans } from '../orchestrator/legacy-paused-scans.ts';
import { runScanAttempt } from '../orchestrator/run-attempt.ts';
import { JOB_STATUSES, STATUS_REASONS } from '../billing/constants.ts';
import { processScan } from '../orchestrator/worker.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedScan,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';

// Scans paused before the pause feature was removed, driven through the
// sweep and the real worker against the local fixture site: they come back to
// the state they were paused from, continue from their checkpoint when it is
// still usable, and complete on the job and purchase they already had.

let db: TestDb;
let account: SeededAccount;
let fixture: FixtureSite;

beforeAll(async () => {
  fixture = await startFixtureSite();
});

afterAll(async () => {
  await fixture.close();
});

beforeEach(async () => {
  db = await createTestDb();
  account = await seedAccountWithProfile(db.prisma);
});

afterEach(async () => {
  await db.cleanup();
});

function scopeWith(overrides: Record<string, unknown>): ScanScopeInput {
  return scanScopeSchema.parse({
    includeSubdomains: false,
    maxPages: 6,
    maxDepth: 1,
    ...overrides,
  });
}

/** A paid-plan scan with no purchase: the billing gate is not what is under test. */
async function seedCompleteScan(scope: ScanScopeInput): Promise<Scan> {
  const scan = await db.prisma.scan.create({
    data: {
      accountId: account.accountId,
      siteProfileId: account.siteProfileId,
      plan: 'Complete',
      domain: account.domain,
      status: 'Pending',
      scopeJson: JSON.stringify(scope),
      rulesetVersion: RULESET_VERSION,
    },
  });
  await db.prisma.job.create({ data: { scanId: scan.id, type: 'scan', status: 'Pending' } });
  return scan;
}

function deps(overrides: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    prisma: db.prisma,
    logger: silentLogger,
    createAiProvider: (scan, profile) =>
      createDefaultAiProvider(profile.name, new URL(scan.domain).hostname),
    crawl: {
      originOverride: () => fixture.origin,
      dangerouslyAllowLoopback: true,
      limiter: new HostLimiter({ rps: 1000, concurrency: 4 }),
    },
    ...overrides,
  };
}

/** The transport the worker would have built for itself, for tests that wrap it. */
function realFetch(url: string, init?: CrawlFetchInit) {
  return safeFetch(url, {
    headers: { 'user-agent': 'FluxRadarBot/0.1' },
    dangerouslyAllowLoopback: true,
    ...(init?.method !== undefined ? { method: init.method } : {}),
    ...(init?.maxBodyBytes !== undefined ? { maxBodyBytes: init.maxBodyBytes } : {}),
    ...(init?.timeoutMs !== undefined ? { timeoutMs: init.timeoutMs } : {}),
  });
}

/** Leaves a scan exactly as the removed pause did: parked, flagged, job held. */
async function parkAsLegacyPause(scanId: string, jobStatus: string = JOB_STATUSES.paused) {
  await db.prisma.scan.update({
    where: { id: scanId },
    data: {
      status: 'Paused',
      statusReason: STATUS_REASONS.pausedAfterStart,
      pauseRequestedAt: new Date(),
    },
  });
  await db.prisma.job.update({ where: { scanId }, data: { status: jobStatus } });
}

describe('legacy paused scans', () => {
  // The whole path with a real purchase, which is what the worker's billing
  // gate reads: a scan paused before it was queued comes back as Pending and
  // is run exactly like one that was never paused; one paused later comes back
  // as Queued. Both complete on the job they already had.
  it.each([
    ['before it was queued', STATUS_REASONS.pausedPreQueue, 'Pending'],
    ['after it had started', STATUS_REASONS.pausedAfterStart, 'Queued'],
  ] as const)(
    'a paid legacy scan paused %s is resumed by the sweep and completed by the worker',
    async (_when, statusReason, restored) => {
      const { scan, purchase } = await seedScan(db.prisma, {
        account,
        status: 'Paused',
        statusReason,
        plan: 'Complete',
      });
      if (purchase === null) throw new Error('seedScan did not create a purchase');
      await db.prisma.entitlement.create({
        data: { purchaseId: purchase.id, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
      await db.prisma.scan.update({
        where: { id: scan.id },
        data: {
          scopeJson: JSON.stringify(scopeWith({ maxDepth: 0 })),
          pauseRequestedAt: new Date(),
        },
      });
      const job = await db.prisma.job.create({
        data: { scanId: scan.id, type: 'scan', status: JOB_STATUSES.paused },
      });

      const swept = await resumeLegacyPausedScans(db.prisma, new Date());
      expect(swept.resumedScanIds).toEqual([scan.id]);
      const waiting = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
      expect(waiting.status).toBe(restored);

      const result = await processScan(deps(), scan.id);

      expect(['Completed', 'Partial']).toContain(result.outcome);
      const settled = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
      expect(settled.startedAt).not.toBeNull();
      expect(settled.completedAt).not.toBeNull();
      const settledJob = await db.prisma.job.findUniqueOrThrow({ where: { scanId: scan.id } });
      expect(settledJob.id).toBe(job.id);
      expect(settledJob.status).toBe('Done');
      await expect(db.prisma.job.count()).resolves.toBe(1);
      await expect(db.prisma.purchase.count()).resolves.toBe(1);
      await expect(db.prisma.refundRecord.count()).resolves.toBe(0);
    },
    30_000,
  );

  it('the sweep resumes a legacy paused scan on its own job, and it completes', async () => {
    const scan = await seedCompleteScan(scopeWith({ maxDepth: 0 }));
    await parkAsLegacyPause(scan.id);
    const job = await db.prisma.job.findUniqueOrThrow({ where: { scanId: scan.id } });

    await resumeLegacyPausedScans(db.prisma, new Date());
    const result = await processScan(deps(), scan.id);

    expect(['Completed', 'Partial']).toContain(result.outcome);
    const settledJob = await db.prisma.job.findUniqueOrThrow({ where: { scanId: scan.id } });
    expect(settledJob.id).toBe(job.id);
    expect(settledJob.status).toBe('Done');
    await expect(db.prisma.scan.count()).resolves.toBe(1);
    await expect(db.prisma.job.count()).resolves.toBe(1);
    await expect(db.prisma.purchase.count()).resolves.toBe(0);
    // A settled run has nothing left to resume from.
    await expect(db.prisma.scanCheckpoint.count()).resolves.toBe(0);
  });

  // Lease recovery hands a crashed claim back to the drain whatever its scan's
  // status, so a worker can hold the job of a scan that still reads Paused.
  it('a worker that claims the job of a legacy paused scan resumes it in place', async () => {
    const scan = await seedCompleteScan(scopeWith({ maxDepth: 0 }));
    await parkAsLegacyPause(scan.id, JOB_STATUSES.pending);

    const result = await processScan(deps(), scan.id);

    expect(['Completed', 'Partial']).toContain(result.outcome);
    const settled = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(settled.pauseRequestedAt).toBeNull();
    await expect(db.prisma.job.count()).resolves.toBe(1);
  });

  // A legacy paused scan that stopped mid-crawl left its pages and a checkpoint
  // behind. The resume continues from them: a frontier-only checkpoint would
  // quietly mean "re-crawl", and every site-level rule would judge half a site.
  it('a resumed legacy scan keeps the pages it had read, and does not ask for them again', async () => {
    const scan = await seedCompleteScan(scopeWith({ maxPages: 6, maxDepth: 2 }));
    await db.prisma.scan.update({
      where: { id: scan.id },
      data: { status: 'Running', startedAt: new Date() },
    });
    let stop = false;
    let pagesBeforeStop = 2;
    const requested: string[] = [];
    const trackingDeps = (stopAfterPages: boolean) =>
      deps({
        crawl: {
          originOverride: () => fixture.origin,
          dangerouslyAllowLoopback: true,
          limiter: new HostLimiter({ rps: 1000, concurrency: 1 }),
          fetcher: async (url, init) => {
            const pathname = new URL(url).pathname;
            requested.push(pathname);
            // robots.txt and sitemap.xml are fetched before any page, and
            // stopping on those would leave nothing read to preserve.
            const isPage = !['/robots.txt', '/sitemap.xml'].includes(pathname);
            if (stopAfterPages && init === undefined && isPage && --pagesBeforeStop === 0) {
              stop = true;
            }
            return realFetch(url, init);
          },
        },
      });
    // The interrupted first half, as the old pause left it: an attempt that
    // stopped mid-crawl and checkpointed what it had read.
    const first = await runScanAttempt(trackingDeps(true), scan.id, {
      control: {
        resumeFrom: null,
        isStopRequested: () => stop,
        save: (state) =>
          saveScanCheckpoint(db.prisma, {
            scanId: scan.id,
            accountId: account.accountId,
            state,
            now: new Date(),
          }),
      },
    });
    expect(first.stopped).toBe(true);
    await parkAsLegacyPause(scan.id);
    const storedPages = await db.prisma.scanCrawlPage.findMany({
      where: { scanId: scan.id },
      select: { normalizedUrl: true },
    });
    expect(storedPages.length).toBeGreaterThan(0);
    await expect(db.prisma.scanCheckpoint.count({ where: { scanId: scan.id } })).resolves.toBe(1);

    requested.length = 0;
    await resumeLegacyPausedScans(db.prisma, new Date());
    const second = await processScan(trackingDeps(false), scan.id);

    expect(['Completed', 'Partial']).toContain(second.outcome);
    // Not one of the stored pages was fetched a second time.
    for (const page of storedPages) {
      expect(requested).not.toContain(new URL(page.normalizedUrl).pathname);
    }
    // And the finished scan covers everything both halves read, without
    // counting a restored page twice.
    const finished = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(finished.scannedUrlCount).toBeGreaterThanOrEqual(storedPages.length);
    expect(finished.scannedUrlCount).toBeLessThanOrEqual(6);
    const issuePaths = new Set(
      (
        await db.prisma.issue.findMany({
          where: { scanId: scan.id },
          select: { normalizedUrl: true },
        })
      )
        .filter((issue) => issue.normalizedUrl !== '')
        .map((issue) => new URL(issue.normalizedUrl).pathname),
    );
    const restoredPaths = storedPages.map((page) => new URL(page.normalizedUrl).pathname);
    expect(restoredPaths.some((path) => issuePaths.has(path))).toBe(true);
    // Nothing is left behind to resume from once the run has settled.
    await expect(db.prisma.scanCrawlPage.count()).resolves.toBe(0);
    await expect(db.prisma.scanCheckpoint.count()).resolves.toBe(0);
  });

  // An expired or missing checkpoint is not an error: the resumed run reads the
  // site afresh and still settles.
  it('a resumed legacy scan without a usable checkpoint runs fresh', async () => {
    const scan = await seedCompleteScan(scopeWith({ maxDepth: 0 }));
    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: {
        schemaVersion: 2,
        stage: 'crawl',
        completedStages: ['crawl'],
        crawl: {
          frontier: [],
          unretained: [],
          scannedUrlCount: 1,
          discoveredUrlCount: 1,
          coverage: EMPTY_CRAWL_COVERAGE,
          truncated: false,
          egressRecorded: false,
        },
      },
      // Written long enough ago that it has expired.
      now: new Date('2020-01-01T00:00:00.000Z'),
    });
    await parkAsLegacyPause(scan.id);

    await resumeLegacyPausedScans(db.prisma, new Date());
    const result = await processScan(deps(), scan.id);

    expect(['Completed', 'Partial']).toContain(result.outcome);
    const finished = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(finished.scannedUrlCount).toBeGreaterThan(0);
  });
});
