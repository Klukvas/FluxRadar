// Scans paused before the pause feature was removed.
//
// Nothing puts a scan into `Paused` or sets `pauseRequestedAt` any more, but
// production may still hold rows from before: paid runs whose owner pressed
// Pause and never came back. They are not abandoned work — the owner paid for
// them — so they are resumed automatically, on the job and purchase they
// already have, and continue from their checkpoint when one is still usable.
//
// Kept until no Paused rows remain; removed with the schema in a follow-up.

import type { PrismaClient } from '@prisma/client';

import { JOB_STATUSES, STATUS_REASONS } from '../billing/constants.ts';
import type { ApiLogger } from '../http/logger.ts';
import { InvalidTransitionError } from '../billing/errors.ts';
import { transitionScan } from '../billing/state-machine.ts';

/**
 * Puts a legacy paused scan back in the queue, on the job it already has.
 *
 * No new job, no new purchase and no entitlement is spent: `Paused → Queued` is
 * the same run continuing. The checkpoint is deliberately left in place — the
 * attempt reads it to know which stages not to repeat, and clears it itself
 * once the scan settles. One transaction, so a scan that reads `Queued` always
 * has a job something will claim.
 *
 * Throws InvalidTransitionError when the scan is not paused (a cancel or an
 * earlier resume won the compare-and-set).
 */
export async function resumeScan(prisma: PrismaClient, scanId: string, now: Date): Promise<void> {
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
 * The state a legacy paused scan was paused from, read back from its status
 * reason. Cancelling it refunds as that state would have (§18): a scan paused
 * before it was ever queued is still a pre-queue cancellation.
 */
export function pausedFromReason(statusReason: string | null): 'Pending' | 'Queued' | 'Running' {
  if (statusReason === STATUS_REASONS.pausedPreQueue) return 'Pending';
  if (statusReason === STATUS_REASONS.pausedAfterQueue) return 'Queued';
  return 'Running';
}

export interface LegacyPauseSweepResult {
  /** Paused scans put back in the queue on their own job. */
  readonly resumedScanIds: readonly string[];
  /** Parked jobs released under a scan that was no longer paused. */
  readonly releasedJobCount: number;
  /** Stray pause flags cleared on scans that were never parked. */
  readonly clearedFlagCount: number;
}

/**
 * Resumes every legacy paused scan and clears what the removed pause left behind.
 *
 * Idempotent and safe to run from several processes at once: each resume is the
 * same `Paused → Queued` compare-and-set a cancel competes on, so a scan that a
 * cancel (or another sweep) took first is skipped, never resumed twice. The
 * release and the flag clear are conditional updates that match nothing on a
 * second pass.
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
  for (const { id } of paused) {
    if (await resumeIfPaused(prisma, id, now)) resumedScanIds.push(id);
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
      result.releasedJobCount > 0 ||
      result.clearedFlagCount > 0
    ) {
      logger.info('legacy paused scans resumed', { ...result });
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
