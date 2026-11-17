import type { Job } from '@prisma/client';

import { conflict } from '../http/errors.ts';
import { LATE_FREE_PREVIEW_JOB_TYPE } from '../orchestrator/late-free-preview-job.ts';

type SnapshotJob = (Pick<Job, 'status'> & { readonly type?: string }) | null | undefined;

/**
 * A terminal scan is normally a finished report, except while the worker writes
 * its post-outcome Analytics section or has granted a retry. A missing Job is a
 * legacy row: no worker can still complete it, so its historical report remains
 * readable.
 *
 * One open job leaves the report readable: a finished Free check adding its
 * late AI answer (late-free-preview-job.ts). Nothing but its GEO row changes,
 * and that row says Pending/Running itself, so the report the owner pressed the
 * button on must not disappear while the answer is fetched. A caller that does
 * not select the job's type keeps the strict rule.
 */
export function isReportSnapshotReady(
  scan: { readonly status: string },
  job: SnapshotJob = undefined,
): boolean {
  if (!['Completed', 'Partial', 'Failed', 'Cancelled'].includes(scan.status)) return false;
  return (
    job === null ||
    job === undefined ||
    job.status === 'Done' ||
    job.type === LATE_FREE_PREVIEW_JOB_TYPE
  );
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
