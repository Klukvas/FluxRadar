// Scans paused before the pause feature was removed.
//
// Nothing puts a scan into `Paused` or sets `pauseRequestedAt` any more, but
// production may still hold rows from before: paid runs whose owner pressed
// Pause and never came back. They are not abandoned work — the owner paid for
// them — so they are resumed automatically, on the job and purchase they
// already have, and continue from their checkpoint when one is still usable.
// A scan whose paid access is gone (refunded, suspended, expired) cannot run,
// so it is cancelled instead, under the pre-pause refund policy.
//
// Kept until no Paused rows remain; removed with the schema in a follow-up.

import type { PrismaClient } from '@prisma/client';

import { cancelLegacyPausedScan, pausedFromReason } from '../billing/cancel-scan.ts';
import { JOB_STATUSES } from '../billing/constants.ts';
import { InvalidTransitionError } from '../billing/errors.ts';
import { paidAccessDenial } from '../billing/report-access.ts';
import { transitionScan } from '../billing/state-machine.ts';
import type { ApiLogger } from '../http/logger.ts';

/**
 * Puts a legacy paused scan back where it was paused from, on the job it
 * already has.
 *
 * A scan paused before it was ever queued goes back to `Pending`, so cancelling
 * it still refunds in full (§18); every other one goes back to `Queued`. No new
 * job, no new purchase and no entitlement is spent: it is the same run
 * continuing. The checkpoint is deliberately left in place — the attempt reads
 * it to know which stages not to repeat, and clears it itself once the scan
 * settles. One transaction, so the scan never reads as waiting without a job
 * something will claim.
 *
 * Throws InvalidTransitionError when the scan is not paused (a cancel or an
 * earlier resume won the compare-and-set).
 */
export async function resumeScan(prisma: PrismaClient, scanId: string, now: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const scan = await tx.scan.findUnique({
      where: { id: scanId },
      select: { statusReason: true },
    });
    const to = pausedFromReason(scan?.statusReason ?? null) === 'Pending' ? 'Pending' : 'Queued';
    await transitionScan(tx, scanId, 'Paused', to, { statusReason: null, now });
    await tx.scan.updateMany({ where: { id: scanId }, data: { pauseRequestedAt: null } });
    await tx.job.updateMany({
      where: { scanId, status: JOB_STATUSES.paused },
      data: { status: JOB_STATUSES.pending, claimedAt: null, leaseUntil: null },
    });
  });
}

/** What happened to one legacy paused scan. */
export type LegacyPausedOutcome = 'resumed' | 'cancelled' | 'skipped';

/**
 * Resumes a legacy paused scan whose purchase may still run, and cancels one
 * whose paid access is gone.
 *
 * Resuming a scan the worker's billing gate will refuse leaves it waiting
 * forever with a finished job — the workspace keeps opening it and the profile
 * cannot be deleted. Cancelling it applies the policy of the state it was
 * paused from, through the same Paused compare-and-set the owner's own cancel
 * uses; refunds are only recorded, and an existing one is not duplicated.
 * `skipped` means the scan was no longer paused: someone else moved it first.
 */
export async function settleLegacyPausedScan(
  prisma: PrismaClient,
  scanId: string,
  now: Date,
): Promise<LegacyPausedOutcome> {
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    select: {
      status: true,
      purchaseId: true,
      purchase: { select: { status: true, entitlement: true } },
    },
  });
  if (scan === null || scan.status !== 'Paused') return 'skipped';
  if (paidAccessDenial(scan, { now }) !== null) {
    if ((await cancelLegacyPausedScan(prisma, scanId)) === null) return 'skipped';
    // The parked job will never run; a claimed one is its worker's to finish.
    await prisma.job.updateMany({
      where: { scanId, status: JOB_STATUSES.paused },
      data: { status: JOB_STATUSES.done, claimedAt: null, leaseUntil: null },
    });
    return 'cancelled';
  }
  return (await resumeIfPaused(prisma, scanId, now)) ? 'resumed' : 'skipped';
}

export interface LegacyPauseSweepResult {
  /** Paused scans put back where they were paused from, on their own job. */
  readonly resumedScanIds: readonly string[];
  /** Paused scans whose paid access is gone, cancelled under §18. */
  readonly cancelledScanIds: readonly string[];
  /** Parked jobs released under a scan that was no longer paused. */
  readonly releasedJobCount: number;
  /** Stray pause flags cleared on scans that were never parked. */
  readonly clearedFlagCount: number;
}

/**
 * Settles every legacy paused scan and clears what the removed pause left behind.
 *
 * Idempotent and safe to run from several processes at once: each resume and
 * each cancel is a compare-and-set on `Paused`, so a scan another writer moved
 * first is skipped, never settled twice. The release and the flag clear are
 * conditional updates that match nothing on a second pass.
 */
export async function resumeLegacyPausedScans(
  prisma: PrismaClient,
  now: Date,
): Promise<LegacyPauseSweepResult> {
  const paused = await prisma.scan.findMany({
    where: { status: 'Paused' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  const resumedScanIds: string[] = [];
  const cancelledScanIds: string[] = [];
  for (const { id } of paused) {
    const outcome = await settleLegacyPausedScan(prisma, id, now);
    if (outcome === 'resumed') resumedScanIds.push(id);
    if (outcome === 'cancelled') cancelledScanIds.push(id);
  }
  // A job parked under a scan that is queued or pending was stranded by the
  // old park/resume race: nothing claims a parked job, so it is handed back to
  // the drain. A running scan's job is left alone — a live worker may own it.
  const released = await prisma.job.updateMany({
    where: {
      status: JOB_STATUSES.paused,
      scan: { status: { in: ['Pending', 'Queued'] } },
    },
    data: { status: JOB_STATUSES.pending, claimedAt: null, leaseUntil: null },
  });
  // The worker no longer reads the flag, so a stray one changes nothing about
  // the run; it is cleared so no reader mistakes it for a pending pause.
  const cleared = await prisma.scan.updateMany({
    where: { pauseRequestedAt: { not: null }, status: { not: 'Paused' } },
    data: { pauseRequestedAt: null },
  });
  return {
    resumedScanIds,
    cancelledScanIds,
    releasedJobCount: released.count,
    clearedFlagCount: cleared.count,
  };
}

/**
 * How often the sweep runs after startup. Only rows from before the pause was
 * removed can match, so the interval bounds how long a straggler written by a
 * process still running the old code during a deploy waits to be resumed.
 */
export const LEGACY_PAUSE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Runs the sweep and reports what it did. Never rejects: it is background
 * housekeeping, and the next pass retries.
 */
export async function sweepLegacyPausedScans(
  prisma: PrismaClient,
  now: Date,
  logger: ApiLogger,
): Promise<void> {
  try {
    const result = await resumeLegacyPausedScans(prisma, now);
    if (
      result.resumedScanIds.length > 0 ||
      result.cancelledScanIds.length > 0 ||
      result.releasedJobCount > 0 ||
      result.clearedFlagCount > 0
    ) {
      logger.info('legacy paused scans settled', { ...result });
    }
  } catch (error) {
    logger.error('legacy paused scan sweep failed', {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

/** `resumeScan`, or false when the scan was no longer paused to resume. */
export async function resumeIfPaused(
  prisma: PrismaClient,
  scanId: string,
  now: Date,
): Promise<boolean> {
  try {
    await resumeScan(prisma, scanId, now);
    return true;
  } catch (error) {
    // Only the compare-and-set losing is expected: a cancel or a concurrent
    // sweep moved the scan first. Anything else is a real error.
    if (error instanceof InvalidTransitionError) return false;
    throw error;
  }
}
