// Pausing and resuming one scan.
//
// Pause means one thing precisely: no new outbound work. It is not a soft
// cancel and it is not a second purchase — the same Scan row and the same Job
// row continue, so resuming costs nothing and grants nothing. Everything here
// is a compare-and-set on the state the §18 machine already defines, so a pause
// racing a cancel, a resume or a worker claim always leaves exactly one winner.

import type { ScanRuntimeStatus } from '@fluxradar/contracts';
import { PAUSABLE_SCAN_STATUSES } from '@fluxradar/contracts';
import type { PrismaClient } from '@prisma/client';

import { JOB_STATUSES, STATUS_REASONS } from '../billing/constants.ts';
import { InvalidTransitionError } from '../billing/errors.ts';
import { transitionScan, type DbClient } from '../billing/state-machine.ts';

/** Why a scan is paused — and, when it is cancelled later, what it was doing. */
export const PAUSE_STATUS_REASONS: Readonly<Record<'Pending' | 'Queued' | 'Running', string>> = {
  Pending: STATUS_REASONS.pausedPreQueue,
  Queued: STATUS_REASONS.pausedAfterQueue,
  Running: STATUS_REASONS.pausedAfterStart,
};

export interface PauseResult {
  /** The state the scan was in when the pause was accepted. */
  readonly pausedFrom: 'Pending' | 'Queued' | 'Running';
  /**
   * `paused` — the scan is already stopped. `pausing` — a worker is mid-stage
   * and will stop at the next boundary; the request is recorded either way.
   */
  readonly state: 'paused' | 'pausing';
}

/**
 * Records the owner's request to stop, and stops the scan where it is safe to.
 *
 * A scan that has not started can be paused outright. A running one cannot:
 * killing a request mid-flight would leave a module half-written, so the flag
 * is recorded and the worker stops at its next stage boundary. Both branches
 * mark `pauseRequestedAt`, which is also what a worker started by a *different*
 * process reads — so a pause survives the process that was serving it.
 */
export async function requestScanPause(
  prisma: PrismaClient,
  scanId: string,
  now: Date,
): Promise<PauseResult> {
  const scan = await prisma.scan.findUnique({ where: { id: scanId } });
  if (scan === null) {
    throw new InvalidTransitionError(`scan ${scanId} cannot be paused: it does not exist`);
  }
  const status = scan.status as ScanRuntimeStatus;
  if (status === 'Paused') {
    return { pausedFrom: pausedFromReason(scan.statusReason), state: 'paused' };
  }
  if (!PAUSABLE_SCAN_STATUSES.includes(status)) {
    throw new InvalidTransitionError(`scan ${scanId} cannot be paused from ${status}`);
  }
  // The flag is written first and unconditionally: a worker that reads it one
  // millisecond later must see the request even if the transition below loses
  // its compare-and-set to that same worker.
  await prisma.scan.updateMany({
    where: { id: scanId, pauseRequestedAt: null },
    data: { pauseRequestedAt: now },
  });
  if (status === 'Running') {
    return { pausedFrom: 'Running', state: 'pausing' };
  }
  const from = status === 'Pending' ? 'Pending' : 'Queued';
  try {
    await parkPausedScan(prisma, scanId, from, now);
  } catch (error) {
    if (!(error instanceof InvalidTransitionError)) throw error;
    // A worker got there first — either by claiming the scan, or by parking it
    // for this very request: it reads the same flag and parks from the state it
    // finds. Which of the two happened decides what the owner is told, so the
    // row is re-read rather than assumed. Telling them "still stopping" about a
    // scan that is already stopped is how the endpoint came to answer
    // `status: Paused` with `pause: pausing`.
    const current = await prisma.scan.findUnique({ where: { id: scanId } });
    if (current?.status === 'Paused') {
      return { pausedFrom: pausedFromReason(current.statusReason), state: 'paused' };
    }
    return { pausedFrom: current?.status === 'Queued' ? 'Queued' : 'Running', state: 'pausing' };
  }
  return { pausedFrom: from, state: 'paused' };
}

/**
 * Moves the scan to `Paused` and parks its job as one write.
 *
 * Two statements left a window a resume could land in: the resume moved the
 * scan back to `Queued` and its job back to `Pending`, and then the park —
 * still in flight — pushed the job to `Paused` under a scan that was already
 * queued. Nothing claims a paused job and nothing recovers it, so the scan sat
 * in `Queued` forever with no way for its owner to know why.
 */
export async function parkPausedScan(
  prisma: PrismaClient,
  scanId: string,
  from: 'Pending' | 'Queued' | 'Running',
  now: Date | undefined,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await transitionScan(tx, scanId, from, 'Paused', {
      statusReason: PAUSE_STATUS_REASONS[from],
      ...(now !== undefined ? { now } : {}),
    });
    await holdJob(tx, scanId);
  });
}

/**
 * Puts a paused scan back in the queue, on the job it already has.
 *
 * No new job, no new purchase and no entitlement is spent: `Paused → Queued` is
 * the same run continuing. The checkpoint is deliberately left in place — the
 * attempt reads it to know which stages not to repeat, and clears it itself
 * once the scan settles.
 */
export async function resumeScan(prisma: PrismaClient, scanId: string, now: Date): Promise<void> {
  // The mirror image of the pause: one transaction, so a scan that reads
  // `Queued` always has a job something will claim.
  await prisma.$transaction(async (tx) => {
    await transitionScan(tx, scanId, 'Paused', 'Queued', { statusReason: null, now });
    await tx.scan.updateMany({ where: { id: scanId }, data: { pauseRequestedAt: null } });
    await tx.job.updateMany({
      where: { scanId, status: JOB_STATUSES.paused },
      data: { status: JOB_STATUSES.pending, claimedAt: null, leaseUntil: null },
    });
  });
}

/**
 * Parks the job so the queue drain skips it while the scan is paused.
 *
 * Not exported: every park belongs to a write that also settles the scan's own
 * status, and parking a job on its own is what used to strand a resumed run.
 */
async function holdJob(db: DbClient, scanId: string): Promise<void> {
  await db.job.updateMany({
    where: { scanId, status: { in: [JOB_STATUSES.pending, JOB_STATUSES.claimed] } },
    data: { status: JOB_STATUSES.paused, claimedAt: null, leaseUntil: null },
  });
}

/**
 * Parks the job of a scan that is *already* paused — and only while it still is.
 *
 * A worker that finds its scan paused parks the job on the way out, from a
 * status it read a moment earlier. A resume landing in between moves the scan
 * to `Queued` and its job back to `Pending`, and parking on top of that leaves
 * a queued scan with a job nothing claims and nothing recovers: the drain takes
 * only `Pending` and the lease sweep only `Claimed`. The status is therefore
 * re-read inside the transaction, under a row lock the resume's own write has
 * to wait for, so the two orderings both end with a job the drain will claim.
 */
export async function holdJobWhilePaused(prisma: PrismaClient, scanId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      { status: string }[]
    >`SELECT "status" FROM "Scan" WHERE "id" = ${scanId} FOR UPDATE`;
    if (locked[0]?.status !== 'Paused') return;
    await holdJob(tx, scanId);
  });
}

/** The state a paused scan was paused from, read back from its status reason. */
export function pausedFromReason(statusReason: string | null): 'Pending' | 'Queued' | 'Running' {
  if (statusReason === STATUS_REASONS.pausedPreQueue) return 'Pending';
  if (statusReason === STATUS_REASONS.pausedAfterQueue) return 'Queued';
  return 'Running';
}

/**
 * A cheap, synchronous answer to "should this run stop now?".
 *
 * The crawler asks it before every request and the attempt asks it between
 * stages, so it cannot be a database round trip. It polls instead, and the poll
 * also notices a cancellation — a cancelled scan has no reason to keep fetching
 * pages either.
 */
export class ScanStopWatcher {
  private readonly prisma: PrismaClient;
  private readonly scanId: string;
  private readonly timer: NodeJS.Timeout;
  private stopReason: 'paused' | 'cancelled' | null = null;

  constructor(prisma: PrismaClient, scanId: string, pollMs: number = 1_000) {
    this.prisma = prisma;
    this.scanId = scanId;
    this.timer = setInterval(() => void this.poll(), pollMs);
    this.timer.unref();
  }

  /** True once the owner asked to stop, by pausing or by cancelling. */
  isStopRequested(): boolean {
    return this.stopReason !== null;
  }

  reason(): 'paused' | 'cancelled' | null {
    return this.stopReason;
  }

  /** One immediate read, for the boundaries where staleness would matter. */
  async refresh(): Promise<'paused' | 'cancelled' | null> {
    await this.poll();
    return this.stopReason;
  }

  close(): void {
    clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    if (this.stopReason !== null) return;
    try {
      const scan = await this.prisma.scan.findUnique({
        where: { id: this.scanId },
        select: { status: true, pauseRequestedAt: true },
      });
      if (scan === null) return;
      if (scan.status === 'Cancelled') {
        this.stopReason = 'cancelled';
        return;
      }
      if (scan.pauseRequestedAt !== null) {
        this.stopReason = 'paused';
      }
    } catch {
      // A transient database error must not stop a running scan: the next poll
      // asks again, and a pause is not lost because the flag is persisted.
    }
  }
}
