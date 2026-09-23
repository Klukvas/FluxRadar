import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { SCAN_CHECKPOINT_LIMITS, SCAN_EVIDENCE_LIMITS } from '@fluxradar/contracts';
import type { PrismaClient } from '@prisma/client';
import type { PageSnapshot, ResourceSnapshot } from '@fluxradar/crawler';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cancelScan } from '../billing/cancel-scan.ts';
import { JOB_STATUSES, STATUS_REASONS } from '../billing/constants.ts';
import { InvalidTransitionError } from '../billing/errors.ts';
import { transitionScan } from '../billing/state-machine.ts';
import { sweepExpiredCheckpoints } from './checkpoint.ts';
import {
  clearScanCheckpoint,
  loadScanCheckpoint,
  saveScanCheckpoint,
  type ScanCheckpointState,
} from './checkpoint.ts';
import { silentLogger } from '../http/logger.ts';
import { createApp } from '../index.ts';
import {
  clearCrawlEvidence,
  loadCrawlEvidence,
  loadCrawlResources,
  saveCrawlEvidence,
  saveCrawlResources,
  sweepExpiredCrawlEvidence,
} from './crawl-store.ts';
import { CrawlProgressWriter } from './crawl-progress.ts';
import type { WorkerDeps } from './deps.ts';
import { parkPausedScan, requestScanPause, resumeScan, type PauseResult } from './pause.ts';
import { processScan, type ScanProcessResult } from './worker.ts';
import { deleteAccountData } from '../data-retention.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedScan,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';

// Pausing and resuming one scan: what it does to the scan, to its job, and to
// the money. The thing being defended is simple — pausing costs nothing and
// grants nothing, so the same run continues rather than a second one starting.

let db: TestDb;
let account: SeededAccount;

beforeEach(async () => {
  db = await createTestDb();
  account = await seedAccountWithProfile(db.prisma);
});

afterEach(async () => {
  await db.cleanup();
});

async function seedWithJob(status: 'Pending' | 'Queued' | 'Running') {
  const { scan, purchase } = await seedScan(db.prisma, { account, status, plan: 'Complete' });
  await db.prisma.job.create({
    data: { scanId: scan.id, type: 'scan', status: JOB_STATUSES.pending },
  });
  return { scan, purchase };
}

function checkpoint(overrides: Partial<ScanCheckpointState> = {}): ScanCheckpointState {
  return {
    schemaVersion: 2,
    stage: 'SEO',
    completedStages: ['crawl', 'SEO'],
    crawl: {
      frontier: [{ url: 'https://example.com/next', depth: 1 }],
      unretained: [],
      scannedUrlCount: 1,
      discoveredUrlCount: 2,
      coverage: {
        skippedOverLimit: ['https://example.com/over-limit'],
        blockedByRobots: ['https://example.com/private/x'],
        errors: [{ url: 'https://example.com/boom', reason: 'timeout' }],
        rejectedSeeds: [],
        urlVariants: { 'https://example.com/dup': ['https://example.com/dup?a=1'] },
      },
      truncated: false,
      egressRecorded: false,
    },
    ...overrides,
  };
}

function snapshot(path: string, html: string, depth = 0): PageSnapshot {
  const url = `https://example.com${path}`;
  return {
    requestedUrl: url,
    normalizedUrl: url,
    depth,
    finalUrl: url,
    status: 200,
    headers: { 'content-type': 'text/html' },
    redirectChain: [],
    html,
    contentType: 'text/html; charset=utf-8',
    timingMs: 4,
    truncated: false,
  };
}

describe('pausing a scan', () => {
  it('stops a queued scan outright and parks its job', async () => {
    const { scan } = await seedWithJob('Queued');

    const result = await requestScanPause(db.prisma, scan.id, new Date());

    expect(result).toEqual({ pausedFrom: 'Queued', state: 'paused' });
    const paused = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(paused.status).toBe('Paused');
    expect(paused.statusReason).toBe(STATUS_REASONS.pausedAfterQueue);
    expect(paused.pauseRequestedAt).not.toBeNull();
    const job = await db.prisma.job.findUniqueOrThrow({ where: { scanId: scan.id } });
    expect(job.status).toBe(JOB_STATUSES.paused);
  });

  // A running scan is mid-stage: the request is recorded and the worker stops
  // at the next boundary, which is what keeps a module from being half-written.
  it('records the request on a running scan without cutting it off', async () => {
    const { scan } = await seedWithJob('Running');

    const result = await requestScanPause(db.prisma, scan.id, new Date());

    expect(result).toEqual({ pausedFrom: 'Running', state: 'pausing' });
    const running = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(running.status).toBe('Running');
    expect(running.pauseRequestedAt).not.toBeNull();
  });

  it('is idempotent: pausing an already paused scan changes nothing', async () => {
    const { scan } = await seedWithJob('Queued');
    await requestScanPause(db.prisma, scan.id, new Date());
    const first = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });

    const again = await requestScanPause(db.prisma, scan.id, new Date());

    expect(again.state).toBe('paused');
    const second = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(second.pauseRequestedAt?.getTime()).toBe(first.pauseRequestedAt?.getTime());
  });

  it('refuses to pause a scan that has already finished', async () => {
    const { scan } = await seedScan(db.prisma, { account, status: 'Completed', plan: 'Complete' });

    await expect(requestScanPause(db.prisma, scan.id, new Date())).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });
});

describe('resuming a scan', () => {
  it('continues the same job and creates no second scan, job or purchase', async () => {
    const { scan, purchase } = await seedWithJob('Queued');
    await requestScanPause(db.prisma, scan.id, new Date());
    const jobBefore = await db.prisma.job.findUniqueOrThrow({ where: { scanId: scan.id } });

    await resumeScan(db.prisma, scan.id, new Date());

    const resumed = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(resumed.status).toBe('Queued');
    expect(resumed.pauseRequestedAt).toBeNull();
    expect(resumed.statusReason).toBeNull();
    const jobAfter = await db.prisma.job.findUniqueOrThrow({ where: { scanId: scan.id } });
    expect(jobAfter.id).toBe(jobBefore.id);
    expect(jobAfter.status).toBe(JOB_STATUSES.pending);
    await expect(db.prisma.scan.count()).resolves.toBe(1);
    await expect(db.prisma.job.count()).resolves.toBe(1);
    await expect(db.prisma.purchase.count()).resolves.toBe(purchase === null ? 0 : 1);
    await expect(db.prisma.refundRecord.count()).resolves.toBe(0);
  });

  // A pause is not a result and a resume is not a new run. Getting either
  // timestamp wrong is not cosmetic: the export contract requires
  // started_at <= observed_at <= completed_at, and findings recorded before the
  // pause would fall outside a start that moved forward on resume.
  it('does not complete a paused scan, and keeps the start it already had', async () => {
    const { scan } = await seedWithJob('Pending');
    await transitionScan(db.prisma, scan.id, 'Pending', 'Queued', {});
    await transitionScan(db.prisma, scan.id, 'Queued', 'Running', {});
    const started = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(started.startedAt).not.toBeNull();

    await requestScanPause(db.prisma, scan.id, new Date());
    await transitionScan(db.prisma, scan.id, 'Running', 'Paused', {
      statusReason: STATUS_REASONS.pausedAfterStart,
    });
    const paused = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(paused.completedAt).toBeNull();
    expect(paused.startedAt?.getTime()).toBe(started.startedAt?.getTime());

    await resumeScan(db.prisma, scan.id, new Date());
    await transitionScan(db.prisma, scan.id, 'Queued', 'Running', {});
    const resumed = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(resumed.startedAt?.getTime()).toBe(started.startedAt?.getTime());
  });

  it('refuses to resume a scan that is not paused', async () => {
    const { scan } = await seedWithJob('Running');

    await expect(resumeScan(db.prisma, scan.id, new Date())).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });

  // Two tabs, one scan: the state machine's compare-and-set decides.
  it('lets exactly one of two concurrent resumes win', async () => {
    const { scan } = await seedWithJob('Queued');
    await requestScanPause(db.prisma, scan.id, new Date());

    const outcomes = await Promise.allSettled([
      resumeScan(db.prisma, scan.id, new Date()),
      resumeScan(db.prisma, scan.id, new Date()),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const resumed = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(resumed.status).toBe('Queued');
  });
});

describe('parking the job and putting the scan back in the queue', () => {
  // The window two separate writes used to leave: a resume that landed between
  // them moved the scan to Queued, and the park — still in flight — then
  // pushed the job to Paused under it. Nothing claims a paused job and nothing
  // recovers it, so the scan sat in Queued with no way for its owner to know.
  //
  // The window is held open deliberately here rather than raced for: another
  // transaction locks the job row, so the park cannot finish, and the question
  // is whether the pause is already visible while it cannot.
  it('does not publish the pause until the job is parked with it', async () => {
    const { scan } = await seedWithJob('Running');
    let releaseJobLock = (): void => undefined;
    let jobLocked = (): void => undefined;
    const locked = new Promise<void>((resolve) => {
      jobLocked = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseJobLock = resolve;
    });
    const holder = db.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Job" WHERE "scanId" = ${scan.id} FOR UPDATE`;
        jobLocked();
        await released;
      },
      { timeout: 20_000 },
    );
    await locked;

    const park = parkPausedScan(db.prisma, scan.id, 'Running', new Date());
    // Long enough for the park to have run everything it can before the lock.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const midway = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });

    // The park cannot park the job yet, so it must not have announced the
    // pause either: a reader — or a resume — sees the run it can still act on.
    expect(midway.status).toBe('Running');

    releaseJobLock();
    await holder;
    await park;
    const paused = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    const job = await db.prisma.job.findFirstOrThrow({ where: { scanId: scan.id } });
    expect(paused.status).toBe('Paused');
    expect(job.status).toBe(JOB_STATUSES.paused);
  }, 30_000);

  it('leaves a resumed scan with a job the drain will claim', async () => {
    const { scan } = await seedWithJob('Queued');
    await requestScanPause(db.prisma, scan.id, new Date());

    await resumeScan(db.prisma, scan.id, new Date());

    const resumed = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    const job = await db.prisma.job.findFirstOrThrow({ where: { scanId: scan.id } });
    expect(resumed.status).toBe('Queued');
    expect(job.status).toBe(JOB_STATUSES.pending);
  });
});

describe('the URL counters a resumed crawl writes', () => {
  // The crawler counts its restored pages in its own page list, so the numbers
  // it reports are already absolute. Adding the restored count on top of them
  // told the owner more pages had been read than the plan's limit allows, and
  // the inflated value was then written into the checkpoint the next resume
  // started from.
  it('does not count a restored page twice', async () => {
    const { scan } = await seedWithJob('Running');
    const writer = new CrawlProgressWriter(db.prisma, scan.id, 2, 5);

    expect(writer.counts()).toEqual({ scanned: 2, discovered: 5 });
    // Two restored pages plus four read after the resume: the crawler reports
    // six read out of nine known, not "four more on top of two".
    writer.record(6, 9);

    expect(writer.counts()).toEqual({ scanned: 6, discovered: 9 });
    await writer.flush();
    const row = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(row.scannedUrlCount).toBe(6);
    expect(row.discoveredUrlCount).toBe(9);
  });

  it('never reports fewer discovered URLs than a previous attempt already knew', async () => {
    const { scan } = await seedWithJob('Running');
    const writer = new CrawlProgressWriter(db.prisma, scan.id, 3, 20);

    writer.record(4, 6);

    expect(writer.counts()).toEqual({ scanned: 4, discovered: 20 });
  });
});

describe('the media probes a paused scan keeps', () => {
  const probe = (path: string, status: number): ResourceSnapshot => ({
    requestedUrl: `https://example.com${path}`,
    normalizedUrl: `https://example.com${path}`,
    finalUrl: `https://example.com${path}`,
    status,
    contentType: 'image/png',
    method: 'HEAD',
    timingMs: 3,
    referencedBy: 'https://example.com/',
  });

  it('round-trips what was probed, so a resume does not ask the site again', async () => {
    const { scan } = await seedWithJob('Running');
    const resources = [probe('/a.png', 200), probe('/b.png', 404)];

    const stored = await saveCrawlResources(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      resources,
      now: new Date(),
    });

    expect(stored).toBe(2);
    await expect(loadCrawlResources(db.prisma, scan.id, new Date())).resolves.toEqual(resources);
  });

  it('is not offered once expired, and goes away with the rest of the evidence', async () => {
    const { scan } = await seedWithJob('Running');
    const issued = new Date('2026-01-01T00:00:00.000Z');
    await saveCrawlResources(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      resources: [probe('/a.png', 200)],
      now: issued,
    });
    const afterExpiry = new Date(
      issued.getTime() + (SCAN_EVIDENCE_LIMITS.expiryDays + 1) * 24 * 60 * 60 * 1000,
    );

    await expect(loadCrawlResources(db.prisma, scan.id, afterExpiry)).resolves.toEqual([]);
    await expect(sweepExpiredCrawlEvidence(db.prisma, afterExpiry)).resolves.toBeGreaterThan(0);

    await saveCrawlResources(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      resources: [probe('/a.png', 200)],
      now: new Date(),
    });
    await clearCrawlEvidence(db.prisma, scan.id);
    await expect(db.prisma.scanCrawlResourceSet.count()).resolves.toBe(0);
  });
});

describe('cancelling a paused scan', () => {
  // §18 is about what the run consumed, and a paused scan consumed nothing more
  // than the state it was paused from.
  it('refunds in full when it was paused before it was ever queued', async () => {
    const { scan } = await seedWithJob('Pending');
    await requestScanPause(db.prisma, scan.id, new Date());

    const cancelled = await cancelScan(db.prisma, scan.id);

    expect(cancelled.cancelledFrom).toBe('Paused');
    expect(cancelled.refund).not.toBeNull();
    expect(cancelled.refund?.reasonCode).toBe('PRE_QUEUE_CANCEL');
    const settled = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(settled.status).toBe('Cancelled');
  });

  it('does not refund when it was paused after the run had started', async () => {
    const { scan } = await seedWithJob('Queued');
    await requestScanPause(db.prisma, scan.id, new Date());

    const cancelled = await cancelScan(db.prisma, scan.id);

    expect(cancelled.cancelledFrom).toBe('Paused');
    expect(cancelled.refund).toBeNull();
    await expect(db.prisma.refundRecord.count()).resolves.toBe(0);
  });

  it('cancels a paused scan exactly once under two concurrent attempts', async () => {
    const { scan } = await seedWithJob('Pending');
    await requestScanPause(db.prisma, scan.id, new Date());

    const outcomes = await Promise.allSettled([
      cancelScan(db.prisma, scan.id),
      cancelScan(db.prisma, scan.id),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    await expect(db.prisma.refundRecord.count()).resolves.toBe(1);
  });
});

/**
 * A client that lets the other half of a race run at one exact point: around the
 * first `Scan` write it makes.
 *
 * The window these tests defend is a single write wide, so reproducing it by
 * starting two promises and hoping is not a test. The extension is a scheduling
 * seam and nothing else — every query still reaches the same database, and the
 * code under test is the real one.
 */
function prismaThatYields(
  when: 'before' | 'after',
  theOtherHalf: () => Promise<void>,
): PrismaClient {
  let yielded = false;
  const extended = db.prisma.$extends({
    query: {
      scan: {
        async updateMany({ args, query }) {
          const yieldOnce = async (): Promise<void> => {
            if (yielded) return;
            yielded = true;
            await theOtherHalf();
          };
          if (when === 'before') await yieldOnce();
          const result = await query(args);
          if (when === 'after') await yieldOnce();
          return result;
        },
      },
    },
  });
  // `$extends` widens the client's type; it adds no behaviour of its own and
  // removes nothing the code under test uses.
  return extended as unknown as PrismaClient;
}

/**
 * A paid scan the worker will actually claim.
 *
 * Without an entitlement the run is released as a billing block before it
 * reaches the state machine at all, so the race below would never happen.
 */
async function seedClaimableScan(status: 'Pending' | 'Queued') {
  const { scan, purchase } = await seedWithJob(status);
  if (purchase === null) throw new Error('seedScan did not create a purchase');
  await db.prisma.entitlement.create({
    data: { purchaseId: purchase.id, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });
  return scan;
}

/**
 * Just enough worker to claim a job and settle it.
 *
 * A scan the owner already asked to stop must not start outbound work, so
 * reaching for a provider fails the test instead of being mocked into silence.
 */
function claimOnlyWorkerDeps(): WorkerDeps {
  return {
    prisma: db.prisma,
    logger: silentLogger,
    createAiProvider: () => {
      throw new Error('a paused scan must not start any outbound work');
    },
  };
}

// §18 pays a pre-queue cancellation back in full, and the only record of where a
// paused scan was paused from is its status reason — `cancelScan` reads it back
// out. Whichever of the two writers wins, a pause requested before the scan was
// ever queued has to leave `UserPausedBeforeQueue` behind, or the refund the
// owner is owed disappears with no trace that it was ever due.
describe('a pause that races the worker claiming the job', () => {
  it('parks from Pending when the worker claims the scan between the flag and the park', async () => {
    const scan = await seedClaimableScan('Pending');
    const claims: ScanProcessResult[] = [];
    // requestScanPause records the flag first and parks second; the worker is
    // let in exactly between the two. Before this was fixed it queued the scan,
    // started it and parked it as `UserPausedAfterStart`.
    const racingPause = prismaThatYields('after', async () => {
      claims.push(await processScan(claimOnlyWorkerDeps(), scan.id));
    });

    const pause = await requestScanPause(racingPause, scan.id, new Date());

    expect(claims.map((claim) => claim.outcome)).toEqual(['Paused']);
    const paused = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(paused.status).toBe('Paused');
    expect(paused.statusReason).toBe(STATUS_REASONS.pausedPreQueue);
    // Nothing ran, so nothing may claim it did: a start would also make the run
    // look resumable from a stage it never reached.
    expect(paused.startedAt).toBeNull();
    const job = await db.prisma.job.findUniqueOrThrow({ where: { scanId: scan.id } });
    expect(job.status).toBe(JOB_STATUSES.paused);
    // The owner is told what actually happened, not "still stopping".
    expect(pause).toEqual({ pausedFrom: 'Pending', state: 'paused' });

    const cancelled = await cancelScan(db.prisma, scan.id);

    expect(cancelled.refund?.reasonCode).toBe('PRE_QUEUE_CANCEL');
  });

  // The mirror image: the pause parks the scan while the worker is between its
  // read and its own Pending → Queued write. Losing that compare-and-set is an
  // ordinary outcome, not an error — throwing left the claimed job behind.
  it('settles the job it holds when the pause parks the scan first', async () => {
    const scan = await seedClaimableScan('Pending');
    const pauses: PauseResult[] = [];
    const racingWorker = prismaThatYields('before', async () => {
      pauses.push(await requestScanPause(db.prisma, scan.id, new Date()));
    });

    const claimed = await processScan({ ...claimOnlyWorkerDeps(), prisma: racingWorker }, scan.id);

    expect(pauses).toEqual([{ pausedFrom: 'Pending', state: 'paused' }]);
    expect(claimed.outcome).toBe('Paused');
    const paused = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(paused.status).toBe('Paused');
    expect(paused.statusReason).toBe(STATUS_REASONS.pausedPreQueue);
    const job = await db.prisma.job.findUniqueOrThrow({ where: { scanId: scan.id } });
    expect(job.status).toBe(JOB_STATUSES.paused);

    const cancelled = await cancelScan(db.prisma, scan.id);

    expect(cancelled.refund?.reasonCode).toBe('PRE_QUEUE_CANCEL');
  });

  // A pause that arrives while the scan is already Queued is a different §18
  // branch — the run counts as used and nothing is refunded — but it still must
  // not be started only to be stopped again a line later.
  // The worker's own park is a compare-and-set too, and the owner's request
  // parks from the same state a moment earlier. Losing that race is two writers
  // agreeing, not an error: the run must settle against whoever won rather than
  // throw with the job still claimed for the lease sweep to recover minutes later.
  it('converges on the pause that parked the scan while the worker was parking it too', async () => {
    const scan = await seedClaimableScan('Pending');
    await db.prisma.scan.update({
      where: { id: scan.id },
      data: { pauseRequestedAt: new Date() },
    });
    const racingWorker = prismaThatYields('before', async () => {
      await parkPausedScan(db.prisma, scan.id, 'Pending', new Date());
    });

    const claimed = await processScan({ ...claimOnlyWorkerDeps(), prisma: racingWorker }, scan.id);

    expect(claimed.outcome).toBe('Paused');
    const paused = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(paused.status).toBe('Paused');
    expect(paused.statusReason).toBe(STATUS_REASONS.pausedPreQueue);
    const job = await db.prisma.job.findUniqueOrThrow({ where: { scanId: scan.id } });
    expect(job.status).toBe(JOB_STATUSES.paused);

    const cancelled = await cancelScan(db.prisma, scan.id);

    expect(cancelled.refund?.reasonCode).toBe('PRE_QUEUE_CANCEL');
  });

  // The same lost park, won by a cancel instead. Nothing parks the job in that
  // branch — `cancelScan` does not touch it — so the worker has to release it
  // itself, or the run the owner cancelled holds a claimed job until the lease
  // sweep requeues it.
  it('releases the job it holds when a cancel wins the park it was making', async () => {
    const scan = await seedClaimableScan('Pending');
    await db.prisma.scan.update({
      where: { id: scan.id },
      data: { pauseRequestedAt: new Date() },
    });
    const racingWorker = prismaThatYields('before', async () => {
      await cancelScan(db.prisma, scan.id);
    });

    const claimed = await processScan({ ...claimOnlyWorkerDeps(), prisma: racingWorker }, scan.id);

    expect(claimed.outcome).toBe('Cancelled');
    const settled = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(settled.status).toBe('Cancelled');
    const job = await db.prisma.job.findUniqueOrThrow({ where: { scanId: scan.id } });
    expect(job.status).toBe(JOB_STATUSES.done);
    // The cancel was pre-queue, so the refund is the full one §18 owes — and it
    // is owed exactly once, whichever writer lost the park.
    const refunds = await db.prisma.refundRecord.findMany();
    expect(refunds.map((refund) => refund.reasonCode)).toEqual(['PRE_QUEUE_CANCEL']);
  });

  it('parks a queued scan from Queued rather than starting it first', async () => {
    const scan = await seedClaimableScan('Queued');
    await db.prisma.scan.update({
      where: { id: scan.id },
      data: { pauseRequestedAt: new Date() },
    });

    const claimed = await processScan(claimOnlyWorkerDeps(), scan.id);

    expect(claimed.outcome).toBe('Paused');
    const paused = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(paused.statusReason).toBe(STATUS_REASONS.pausedAfterQueue);
    expect(paused.startedAt).toBeNull();
    const cancelled = await cancelScan(db.prisma, scan.id);
    expect(cancelled.refund).toBeNull();
  });
});

describe('the checkpoint a paused scan leaves', () => {
  it('round-trips the stages a resumed attempt must not repeat', async () => {
    const { scan } = await seedWithJob('Running');
    const now = new Date();

    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: checkpoint(),
      now,
    });

    const loaded = await loadScanCheckpoint(db.prisma, scan.id, now);
    expect(loaded?.completedStages).toEqual(['crawl', 'SEO']);
    expect(loaded?.crawl.frontier).toEqual([{ url: 'https://example.com/next', depth: 1 }]);
  });

  // Coverage is the half of a crawl that leaves no trace in anyone's HTML: a
  // URL over the tariff limit and a URL robots closed cannot be re-derived from
  // the pages that were read.
  it('carries the coverage a resumed crawl cannot rediscover', async () => {
    const { scan } = await seedWithJob('Running');
    const now = new Date();

    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: checkpoint(),
      now,
    });

    const loaded = await loadScanCheckpoint(db.prisma, scan.id, now);
    expect(loaded?.crawl.coverage.skippedOverLimit).toEqual(['https://example.com/over-limit']);
    expect(loaded?.crawl.coverage.blockedByRobots).toEqual(['https://example.com/private/x']);
    expect(loaded?.crawl.coverage.errors).toEqual([
      { url: 'https://example.com/boom', reason: 'timeout' },
    ]);
    expect(loaded?.crawl.coverage.urlVariants).toEqual({
      'https://example.com/dup': ['https://example.com/dup?a=1'],
    });
  });

  // Version 1 stored no page evidence, so honouring it would mean resuming with
  // the earlier pages silently missing.
  it('refuses a payload written by the previous checkpoint format', async () => {
    const { scan } = await seedWithJob('Running');
    await db.prisma.scanCheckpoint.create({
      data: {
        id: randomUUID(),
        scanId: scan.id,
        accountId: account.accountId,
        schemaVersion: 1,
        stage: 'SEO',
        payloadJson: JSON.stringify({
          schemaVersion: 1,
          stage: 'SEO',
          completedStages: ['crawl'],
          crawl: {
            frontier: [],
            visited: ['https://example.com/'],
            scannedUrlCount: 1,
            discoveredUrlCount: 1,
            truncated: false,
          },
        }),
        sizeBytes: 100,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect(await loadScanCheckpoint(db.prisma, scan.id, new Date())).toBeNull();
  });

  it('bounds what it stores, and says it was truncated', async () => {
    const { scan } = await seedWithJob('Running');
    const frontier = Array.from(
      { length: SCAN_CHECKPOINT_LIMITS.maxFrontierUrls + 50 },
      (_entry, index) => ({ url: `https://example.com/${index}`, depth: 1 }),
    );

    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: checkpoint({ crawl: { ...checkpoint().crawl, frontier } }),
      now: new Date(),
    });

    const row = await db.prisma.scanCheckpoint.findUniqueOrThrow({ where: { scanId: scan.id } });
    expect(row.sizeBytes).toBeLessThanOrEqual(SCAN_CHECKPOINT_LIMITS.maxBytes);
    const loaded = await loadScanCheckpoint(db.prisma, scan.id, new Date());
    expect(loaded?.crawl.truncated).toBe(true);
    // Whatever had to be dropped, the stage list is what protects paid work.
    expect(loaded?.completedStages).toEqual(['crawl', 'SEO']);
  });

  it('is not offered once it has expired, and the sweep removes it', async () => {
    const { scan } = await seedWithJob('Running');
    const issued = new Date('2026-01-01T00:00:00.000Z');
    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: checkpoint(),
      now: issued,
    });
    const afterExpiry = new Date(
      issued.getTime() + (SCAN_CHECKPOINT_LIMITS.expiryDays + 1) * 24 * 60 * 60 * 1000,
    );

    expect(await loadScanCheckpoint(db.prisma, scan.id, afterExpiry)).toBeNull();
    await expect(sweepExpiredCheckpoints(db.prisma, afterExpiry)).resolves.toBe(1);
    await expect(db.prisma.scanCheckpoint.count()).resolves.toBe(0);
  });

  it('is removed with the account that owned it', async () => {
    const { scan } = await seedWithJob('Running');
    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: checkpoint(),
      now: new Date(),
    });

    await deleteAccountData(db.prisma, account.accountId, null);

    await expect(db.prisma.scanCheckpoint.count()).resolves.toBe(0);
  });

  it('is cleared explicitly when a run settles', async () => {
    const { scan } = await seedWithJob('Running');
    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: checkpoint(),
      now: new Date(),
    });

    await clearScanCheckpoint(db.prisma, scan.id);

    await expect(db.prisma.scanCheckpoint.count()).resolves.toBe(0);
  });

  it('ignores a payload that does not parse rather than resuming from nonsense', async () => {
    const { scan } = await seedWithJob('Running');
    await db.prisma.scanCheckpoint.create({
      data: {
        scanId: scan.id,
        accountId: account.accountId,
        stage: 'SEO',
        payloadJson: '{not json',
        sizeBytes: 9,
        expiresAt: new Date(Date.now() + 60_000),
        id: randomUUID(),
      },
    });

    expect(await loadScanCheckpoint(db.prisma, scan.id, new Date())).toBeNull();
  });
});

describe('the pages a paused scan keeps', () => {
  it('round-trips a page snapshot, body and all', async () => {
    const { scan } = await seedWithJob('Running');
    const page = snapshot('/', '<html><head><title>Home</title></head><body>Hello</body></html>');

    const saved = await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages: [page],
      now: new Date(),
    });

    expect(saved).toMatchObject({ retained: 1, unretained: [] });
    const restored = await loadCrawlEvidence(db.prisma, scan.id, new Date());
    expect(restored).toEqual([page]);
  });

  // The failure this prevents is a resume that reports fewer pages than it
  // scanned. A page that does not fit is handed back as a URL to read again.
  it('hands back the URL of a page too large to store, rather than losing it', async () => {
    const { scan } = await seedWithJob('Running');
    // Random text so gzip cannot shrink it under the per-page cap.
    const incompressible = Array.from({ length: SCAN_EVIDENCE_LIMITS.maxPageBytes * 2 }, () =>
      String.fromCharCode(33 + Math.floor(Math.random() * 90)),
    ).join('');

    const saved = await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages: [
        snapshot('/small', '<html><body>ok</body></html>'),
        snapshot('/huge', incompressible, 2),
      ],
      now: new Date(),
    });

    expect(saved.retained).toBe(1);
    expect(saved.unretained).toEqual([{ url: 'https://example.com/huge', depth: 2 }]);
  });

  it('stops at the page count bound and reports the remainder as unretained', async () => {
    const { scan } = await seedWithJob('Running');
    const pages = Array.from({ length: SCAN_EVIDENCE_LIMITS.maxPages + 3 }, (_entry, index) =>
      snapshot(`/page-${index}`, '<html><body>x</body></html>'),
    );

    const saved = await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages,
      now: new Date(),
    });

    expect(saved.retained).toBe(SCAN_EVIDENCE_LIMITS.maxPages);
    expect(saved.unretained).toHaveLength(3);
  });

  // `retained` decides how many URLs the resumed scan treats as done. A page
  // the insert could not write — the store is keyed by (scan, URL) — must be
  // handed back as unretained, not counted as stored and quietly dropped.
  it('does not count a page it could not store, and hands the URL back', async () => {
    const { scan } = await seedWithJob('Running');
    const page = snapshot('/same', '<html><body>first</body></html>');

    const saved = await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages: [page, { ...page, html: '<html><body>second</body></html>' }],
      now: new Date(),
    });

    expect(saved.retained).toBe(1);
    expect(saved.unretained).toEqual([{ url: 'https://example.com/same', depth: 0 }]);
    await expect(db.prisma.scanCrawlPage.count({ where: { scanId: scan.id } })).resolves.toBe(1);
  });

  it('restores the pages in the order the crawl read them', async () => {
    const { scan } = await seedWithJob('Running');
    const pages = Array.from({ length: 12 }, (_entry, index) =>
      snapshot(`/page-${index}`, `<html><body>${index}</body></html>`, index % 3),
    );

    await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages,
      now: new Date(),
    });

    const restored = await loadCrawlEvidence(db.prisma, scan.id, new Date());
    expect(restored.map((page) => page.normalizedUrl)).toEqual(
      pages.map((page) => page.normalizedUrl),
    );
  });

  it('replaces the previous attempt’s pages instead of stacking them', async () => {
    const { scan } = await seedWithJob('Running');
    const now = new Date();
    const input = { scanId: scan.id, accountId: account.accountId, now };

    await saveCrawlEvidence(db.prisma, { ...input, pages: [snapshot('/a', '<html>a</html>')] });
    await saveCrawlEvidence(db.prisma, {
      ...input,
      pages: [snapshot('/a', '<html>a</html>'), snapshot('/b', '<html>b</html>')],
    });

    await expect(db.prisma.scanCrawlPage.count()).resolves.toBe(2);
  });

  it('is not offered once expired, and the sweep removes it', async () => {
    const { scan } = await seedWithJob('Running');
    const issued = new Date('2026-01-01T00:00:00.000Z');
    await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages: [snapshot('/', '<html>home</html>')],
      now: issued,
    });
    const afterExpiry = new Date(
      issued.getTime() + (SCAN_EVIDENCE_LIMITS.expiryDays + 1) * 24 * 60 * 60 * 1000,
    );

    expect(await loadCrawlEvidence(db.prisma, scan.id, afterExpiry)).toEqual([]);
    await expect(sweepExpiredCrawlEvidence(db.prisma, afterExpiry)).resolves.toBe(1);
  });

  it('ignores a stored payload that no longer parses', async () => {
    const { scan } = await seedWithJob('Running');
    await db.prisma.scanCrawlPage.create({
      data: {
        id: randomUUID(),
        scanId: scan.id,
        accountId: account.accountId,
        normalizedUrl: 'https://example.com/broken',
        payload: new Uint8Array([1, 2, 3, 4]),
        sizeBytes: 4,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect(await loadCrawlEvidence(db.prisma, scan.id, new Date())).toEqual([]);
  });

  it('goes away with the account, and on demand', async () => {
    const { scan } = await seedWithJob('Running');
    await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages: [snapshot('/', '<html>home</html>')],
      now: new Date(),
    });

    await clearCrawlEvidence(db.prisma, scan.id);
    await expect(db.prisma.scanCrawlPage.count()).resolves.toBe(0);

    await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages: [snapshot('/', '<html>home</html>')],
      now: new Date(),
    });
    await deleteAccountData(db.prisma, account.accountId, null);
    await expect(db.prisma.scanCrawlPage.count()).resolves.toBe(0);
  });
});

describe('the pause and resume endpoints', () => {
  const PASSWORD = 'sufficiently-long-password';

  function app(prisma: PrismaClient = db.prisma) {
    return createApp({
      prisma,
      autoProcess: false,
      logger: silentLogger,
    });
  }

  async function signedIn(email: string) {
    const agent = request.agent(app());
    const registered = await agent.post('/auth/register').send({ email, password: PASSWORD });
    expect(registered.status).toBe(201);
    const accountRow = await db.prisma.account.findUniqueOrThrow({ where: { email } });
    const profile = await db.prisma.siteProfile.create({
      data: {
        accountId: accountRow.id,
        name: 'Site',
        domain: `https://${email.split('@')[0]}.example`,
      },
    });
    const scan = await db.prisma.scan.create({
      data: {
        accountId: accountRow.id,
        siteProfileId: profile.id,
        plan: 'Complete',
        domain: profile.domain,
        status: 'Queued',
        scopeJson: JSON.stringify({ includeSubdomains: false }),
        rulesetVersion: 'rules-mvp-0.1',
      },
    });
    await db.prisma.job.create({
      data: { scanId: scan.id, type: 'scan', status: JOB_STATUSES.pending },
    });
    return { agent, scanId: scan.id };
  }

  it('pauses and resumes over HTTP, on the same scan', async () => {
    const { agent, scanId } = await signedIn('http-pause@example.com');

    const paused = await agent.post(`/scans/${scanId}/pause`);
    expect(paused.status).toBe(200);
    expect(paused.body.data).toMatchObject({ status: 'Paused', pause: 'paused' });

    const read = await agent.get(`/scans/${scanId}`);
    expect(read.body.data.status).toBe('Paused');
    expect(read.body.data.progress).toHaveProperty('scannedUrls');

    const resumed = await agent.post(`/scans/${scanId}/resume`);
    expect(resumed.status).toBe(202);
    expect(resumed.body.data.status).toBe('Queued');
    await expect(db.prisma.scan.count()).resolves.toBe(1);
  });

  // A running scan is answered "stopping" because the worker stops it at its
  // next stage boundary — but the boundary can be reached while the request is
  // still in flight, and then the two halves of the answer disagree: the status
  // says the scan is stopped and the pause field says it is still stopping.
  it('answers a running scan the worker parks mid-request with the state it actually reached', async () => {
    const email = 'http-pause-race@example.com';
    const { scanId } = await signedIn(email);
    await db.prisma.scan.update({
      where: { id: scanId },
      data: { status: 'Running', startedAt: new Date() },
    });
    // The window is the one write `requestScanPause` makes for a running scan.
    const racing = prismaThatYields('after', async () => {
      await parkPausedScan(db.prisma, scanId, 'Running', new Date());
    });
    const agent = request.agent(app(racing));
    const loggedIn = await agent.post('/auth/login').send({ email, password: PASSWORD });
    expect(loggedIn.status).toBe(200);

    const paused = await agent.post(`/scans/${scanId}/pause`);

    expect(paused.status).toBe(200);
    expect(paused.body.data).toMatchObject({ status: 'Paused', pause: 'paused' });
  });

  it('lists a paused scan as the account’s active one, so it can be resumed after a refresh', async () => {
    const { agent, scanId } = await signedIn('http-active@example.com');
    await agent.post(`/scans/${scanId}/pause`);

    const active = await agent.get('/scans/active');

    expect(active.body.data?.id).toBe(scanId);
    expect(active.body.data?.status).toBe('Paused');
  });

  it('refuses to resume a scan that is not paused, with a closed code', async () => {
    const { agent, scanId } = await signedIn('http-resume@example.com');

    const resumed = await agent.post(`/scans/${scanId}/resume`);

    expect(resumed.status).toBe(409);
    expect(resumed.body.error.code).toBe('RESUME_NOT_ALLOWED');
  });

  it('refuses to re-process a paused scan and points at resume instead', async () => {
    const { agent, scanId } = await signedIn('http-process@example.com');
    await agent.post(`/scans/${scanId}/pause`);

    const processed = await agent.post(`/scans/${scanId}/process`);

    expect(processed.status).toBe(409);
    expect(processed.body.error.code).toBe('SCAN_PAUSED');
  });

  it('hides another account’s scan behind the same 404 as every other read', async () => {
    const owner = await signedIn('http-owner@example.com');
    const stranger = await signedIn('http-stranger@example.com');

    const paused = await stranger.agent.post(`/scans/${owner.scanId}/pause`);
    const resumed = await stranger.agent.post(`/scans/${owner.scanId}/resume`);

    expect([paused.status, resumed.status]).toEqual([404, 404]);
  });
});
