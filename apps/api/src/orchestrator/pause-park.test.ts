import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JOB_STATUSES } from '../billing/constants.ts';
import { holdJobWhilePaused, requestScanPause, resumeScan } from './pause.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedScan,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';

// The last window a resume could land in.
//
// A worker that finds its scan already paused parks the job on the way out
// (worker.ts, settleStoppedScan) — from a status it read a moment earlier.
// That read is the whole problem: between it and the park, a resume can move
// the scan to Queued and its job back to Pending, and a park applied on top of
// that leaves a queued scan with a job nothing will ever claim. The drain takes
// only Pending jobs and the lease sweep revives only Claimed ones, so the run
// stops there with no way for its owner to see why.
//
// The window cannot be staged through the worker's own entry points — reaching
// that branch requires a pause to commit between a claim and a read — so the
// park itself is driven here, with the interleaving reproduced around it.

let db: TestDb;
let account: SeededAccount;

beforeEach(async () => {
  db = await createTestDb();
  account = await seedAccountWithProfile(db.prisma);
});

afterEach(async () => {
  await db.cleanup();
});

async function seedPausedScanWithJob(): Promise<{ scanId: string }> {
  const { scan } = await seedScan(db.prisma, { account, status: 'Queued', plan: 'Complete' });
  await db.prisma.job.create({
    data: { scanId: scan.id, type: 'scan', status: JOB_STATUSES.pending },
  });
  await requestScanPause(db.prisma, scan.id, new Date());
  return { scanId: scan.id };
}

async function stateOf(scanId: string): Promise<{ scan: string; job: string }> {
  const scan = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
  const job = await db.prisma.job.findFirstOrThrow({ where: { scanId } });
  return { scan: scan.status, job: job.status };
}

describe('parking the job of a scan that was already paused', () => {
  it('leaves the job alone when a resume happened after the status was read', async () => {
    const { scanId } = await seedPausedScanWithJob();
    // What the worker read before it decided to park: the scan was paused.
    const asRead = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    expect(asRead.status).toBe('Paused');

    // The owner resumes while the worker is still on its way to the park.
    await resumeScan(db.prisma, scanId, new Date());
    await holdJobWhilePaused(db.prisma, scanId);

    // A scan that reads Queued always has a job the drain will claim.
    expect(await stateOf(scanId)).toEqual({ scan: 'Queued', job: JOB_STATUSES.pending });
  });

  it('parks a job that is still claimable while the scan is genuinely paused', async () => {
    const { scanId } = await seedPausedScanWithJob();
    // The job a worker claimed just before the pause was written: it is neither
    // pending nor parked, and nothing else will park it.
    await db.prisma.job.updateMany({
      where: { scanId },
      data: { status: JOB_STATUSES.claimed, claimedAt: new Date() },
    });

    await holdJobWhilePaused(db.prisma, scanId);

    expect(await stateOf(scanId)).toEqual({ scan: 'Paused', job: JOB_STATUSES.paused });
  });

  it('holds the same invariant when the resume and the park actually race', async () => {
    const { scanId } = await seedPausedScanWithJob();
    let releaseScanLock = (): void => undefined;
    let scanLocked = (): void => undefined;
    const locked = new Promise<void>((resolve) => {
      scanLocked = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseScanLock = resolve;
    });
    // Both the park and the resume have to go through this row, so holding it
    // lines them up against each other instead of letting one finish first.
    const holder = db.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Scan" WHERE "id" = ${scanId} FOR UPDATE`;
        scanLocked();
        await released;
      },
      { timeout: 20_000 },
    );
    await locked;

    const park = holdJobWhilePaused(db.prisma, scanId);
    const resume = resumeScan(db.prisma, scanId, new Date());
    // Long enough for both to have reached the lock and be waiting on it.
    await new Promise((resolve) => setTimeout(resolve, 300));
    releaseScanLock();
    await holder;
    await Promise.all([park, resume]);

    // Whichever of the two the database let through first, the scan is back in
    // the queue with a job that will be claimed.
    expect(await stateOf(scanId)).toEqual({ scan: 'Queued', job: JOB_STATUSES.pending });
  }, 30_000);
});
