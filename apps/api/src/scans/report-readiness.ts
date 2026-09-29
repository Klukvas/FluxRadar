import type { Job } from '@prisma/client';

import { conflict } from '../http/errors.ts';

type SnapshotJob = Pick<Job, 'status'> | null | undefined;

/**
 * A terminal scan is normally a finished report, except while the worker writes
 * its post-outcome Analytics section or has granted a retry. A missing Job is a
 * legacy row: no worker can still complete it, so its historical report remains
 * readable.
 */
export function isReportSnapshotReady(
  scan: { readonly status: string },
  job: SnapshotJob = undefined,
): boolean {
  if (!['Completed', 'Partial', 'Failed', 'Cancelled'].includes(scan.status)) return false;
  return job === null || job === undefined || job.status === 'Done';
}

/** Refuse report data until the terminal snapshot has been fully persisted. */
export function assertReportSnapshotReady(
  scan: { readonly status: string },
  job: SnapshotJob = undefined,
): void {
  if (!isReportSnapshotReady(scan, job)) {
    throw conflict('REPORT_NOT_READY', 'the report is still being finalized');
  }
}
