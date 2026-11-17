// The GEO-row transitions of the late Free AI preview (D-236), each one a
// compare-and-set on the row's status so no two of them can both apply.
//
//   Pending  ── release ──▶ Not applicable / ConsentMissing   (nothing was sent)
//   Pending  ── start ────▶ Running                           (late-free-preview.ts)
//   Running  ── refuse ───▶ Not applicable / FreePreviewAlreadyRequested
//   Running  ── fail ─────▶ Unavailable / PlatformFailure
//
// Release is the only way back to the state the report's button keys on, and
// it is only reachable from Pending: once a row has been Running, the sticky
// `previewRequested` marker is on it and nothing is ever asked again.

import type { PrismaClient } from '@prisma/client';

import { JOB_STATUSES } from '../billing/constants.ts';
import { freePreviewSkippedRowWith, storedReadinessFacts } from './geo-module-row.ts';
import {
  LATE_ATTEMPT_KEY,
  LATE_PREVIEW_MODULE,
  LATE_PREVIEW_STARTED_METADATA,
  MAX_RELEASED_ATTEMPTS,
  metadataRecord,
  releasedAttemptsOf,
  skippedRowMetadata,
} from './late-free-preview-job.ts';

/**
 * How one attempt ended, and so who closes the job:
 *  - `released` the claim was handed back, and its job closed with it;
 *  - `settled`  this attempt finished the row (or found it finished or gone):
 *               the worker closes the job;
 *  - `held`     another attempt holds the provider step: the row and the job
 *               are its to finish, and this one touches neither.
 */
export type LateOutcome = 'released' | 'settled' | 'held';

export interface LateRow {
  readonly runtimeStatus: string;
  readonly metadataJson: string | null;
}

export async function lateGeoRow(prisma: PrismaClient, scanId: string): Promise<LateRow | null> {
  return prisma.scanModule.findUnique({
    where: { scanId_module: { scanId, module: LATE_PREVIEW_MODULE } },
    select: { runtimeStatus: true, metadataJson: true },
  });
}

/**
 * Hands the claim back after an attempt that sent nothing: the homepage could
 * not be read now, the egress probe failed, or the platform threw before the
 * provider step. One transaction, guarded by the row still being Pending:
 *
 *  - the row becomes the skipped ConsentMissing row again, rebuilt from the
 *    facts the claim kept, plus a note of why this attempt did not start;
 *  - the consent record goes: nothing was sent under it, and a later press
 *    writes a fresh one under the notice shown at that moment;
 *  - the job is closed here, not by the worker afterwards, so a press that
 *    lands right after this commit cannot have its new job closed for it.
 *
 * False when the row was no longer Pending: another attempt has taken the
 * provider step (or the row is settled or gone), and this attempt leaves it
 * alone. Only the attempt that won the step ever settles a Running row.
 */
export async function releaseLatePreview(
  prisma: PrismaClient,
  params: {
    readonly scanId: string;
    readonly jobId: string;
    readonly reason: string;
    readonly now: Date;
  },
): Promise<boolean> {
  const { scanId, jobId, reason, now } = params;
  return prisma.$transaction(async (tx) => {
    const row = await tx.scanModule.findUnique({
      where: { scanId_module: { scanId, module: LATE_PREVIEW_MODULE } },
      select: { runtimeStatus: true, metadataJson: true },
    });
    if (row?.runtimeStatus !== 'Pending') return false;
    const skipped = freePreviewSkippedRowWith(
      'ConsentMissing',
      storedReadinessFacts(skippedRowMetadata(row.metadataJson)),
    );
    const released = releasedAttemptsOf(metadataRecord(row.metadataJson)) + 1;
    const metadataJson = JSON.stringify({
      ...metadataRecord(skipped.metadataJson),
      // `at` tells a report that is waiting for this attempt that it ended;
      // `remaining` how many presses are still accepted, and `final` that none
      // is (MAX_RELEASED_ATTEMPTS). The report reads these rather than the bound.
      [LATE_ATTEMPT_KEY]: {
        started: false,
        reason,
        at: now.toISOString(),
        count: released,
        remaining: Math.max(0, MAX_RELEASED_ATTEMPTS - released),
        final: released >= MAX_RELEASED_ATTEMPTS,
      },
    });
    const { count } = await tx.scanModule.updateMany({
      where: { scanId, module: LATE_PREVIEW_MODULE, runtimeStatus: 'Pending' },
      data: { ...skipped, metadataJson },
    });
    if (count !== 1) return false;
    await tx.aiConsent.deleteMany({ where: { scanId } });
    await tx.job.updateMany({
      where: { id: jobId, status: JOB_STATUSES.claimed },
      data: { status: JOB_STATUSES.done, claimedAt: null, leaseUntil: null },
    });
    return true;
  });
}

/** Pending → Running, the claim on the provider step. False: someone else has it. */
export async function startProviderStep(
  prisma: PrismaClient,
  scanId: string,
  queuedMetadataJson: string | null,
): Promise<boolean> {
  const { count } = await prisma.scanModule.updateMany({
    where: { scanId, module: LATE_PREVIEW_MODULE, runtimeStatus: 'Pending' },
    data: {
      runtimeStatus: 'Running',
      metadataJson: JSON.stringify({
        ...metadataRecord(queuedMetadataJson),
        ...LATE_PREVIEW_STARTED_METADATA,
      }),
    },
  });
  return count === 1;
}

/**
 * A resumed attempt that finds the row Running: an earlier one reached the
 * provider step and may have sent its requests. It records that and asks
 * nothing, from the facts the claim kept, without reading the site again.
 */
export async function refuseRepeatedAttempt(
  prisma: PrismaClient,
  scanId: string,
  row: LateRow,
): Promise<void> {
  const refused = freePreviewSkippedRowWith(
    'FreePreviewAlreadyRequested',
    storedReadinessFacts(skippedRowMetadata(row.metadataJson)),
  );
  await prisma.scanModule.updateMany({
    where: { scanId, module: LATE_PREVIEW_MODULE, runtimeStatus: 'Running' },
    data: refused,
  });
}

/**
 * The honest unavailable row of an attempt that failed after the provider step
 * began. Only the attempt that won `startProviderStep` may call this: a Running
 * row held by another attempt is live work, not a failure.
 */
export async function settleStartedFailure(prisma: PrismaClient, scanId: string): Promise<void> {
  const row = await lateGeoRow(prisma, scanId);
  if (row === null) return;
  await prisma.scanModule.updateMany({
    where: { scanId, module: LATE_PREVIEW_MODULE, runtimeStatus: 'Running' },
    data: {
      runtimeStatus: 'Unavailable',
      statusReason: 'PlatformFailure',
      coverage: 0,
      score: null,
      applicableChecks: 1,
      completedApplicableChecks: 0,
      usableOutput: false,
      metadataJson: JSON.stringify({
        ...metadataRecord(row.metadataJson),
        ...LATE_PREVIEW_STARTED_METADATA,
      }),
    },
  });
}

/** What a row that is no longer Pending means for an attempt that did not win it. */
export async function outcomeWhenNotPending(
  prisma: PrismaClient,
  scanId: string,
): Promise<LateOutcome> {
  const row = await lateGeoRow(prisma, scanId);
  return row?.runtimeStatus === 'Running' ? 'held' : 'settled';
}

/**
 * After an attempt threw before it won the provider step (the winner settles
 * its own failures, late-free-preview.ts): release the claim if nothing was
 * sent. A Running row belongs to the attempt that holds it and is left alone;
 * a row that is gone (the scan was deleted) or settled needs nothing.
 */
export async function recordLatePreviewFailure(
  prisma: PrismaClient,
  params: { readonly scanId: string; readonly jobId: string; readonly now: Date },
): Promise<LateOutcome> {
  const row = await lateGeoRow(prisma, params.scanId);
  if (row?.runtimeStatus === 'Pending') {
    const released = await releaseLatePreview(prisma, { ...params, reason: 'PlatformFailure' });
    if (released) return 'released';
  }
  return outcomeWhenNotPending(prisma, params.scanId);
}

/** Closes the late job unless it is gone or has already moved on. */
export async function finishLateJob(prisma: PrismaClient, jobId: string): Promise<void> {
  await prisma.job.updateMany({
    where: { id: jobId, status: JOB_STATUSES.claimed },
    data: { status: JOB_STATUSES.done, claimedAt: null, leaseUntil: null },
  });
}
