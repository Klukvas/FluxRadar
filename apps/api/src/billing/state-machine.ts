import { canTransition } from '@fluxradar/contracts';
import type { ScanRuntimeStatus } from '@fluxradar/contracts';
import type { Prisma, PrismaClient } from '@prisma/client';

import { InvalidTransitionError } from './errors.ts';

/** Works both on the root client and inside prisma.$transaction callbacks. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface TransitionOptions {
  /** Written verbatim; pass null to clear the previous reason. */
  readonly statusReason?: string | null;
  readonly now?: Date;
}

/**
 * Atomic compare-and-set transition of the §18 scan state machine.
 *
 * The update is `updateMany({ where: { id, status: from } })`, so of N
 * concurrent claims exactly one observes `count === 1` and the rest fail —
 * this is the worker-claim primitive from D-005/D-011. Retry transitions
 * additionally guard their counters inside the same WHERE, which keeps
 * `platform_retry_count <= 1` and `module_retry_count <= 1` under concurrency.
 *
 * Throws InvalidTransitionError both for pairs outside SCAN_TRANSITIONS and
 * for a lost CAS (scan absent, already moved, or retry budget exhausted).
 */
export async function transitionScan(
  db: DbClient,
  scanId: string,
  from: ScanRuntimeStatus,
  to: ScanRuntimeStatus,
  options: TransitionOptions = {},
): Promise<void> {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(`scan transition ${from} -> ${to} is not allowed by §18`);
  }

  // Single free retries (§18): the counter guard is part of the CAS itself.
  const isPlatformRetry = from === 'Failed' && to === 'Queued';
  const isModuleRetry = from === 'Partial' && to === 'Running';

  const where: Prisma.ScanWhereInput = {
    id: scanId,
    status: from,
    ...(isPlatformRetry && { platformRetryCount: { lt: 1 } }),
    ...(isModuleRetry && { moduleRetryCount: { lt: 1 } }),
  };
  const data: Prisma.ScanUpdateManyMutationInput = {
    status: to,
    ...(options.statusReason !== undefined && { statusReason: options.statusReason }),
    ...timestampChanges(from, to, options.now ?? new Date()),
    ...(isPlatformRetry && { platformRetryCount: { increment: 1 } }),
    ...(isModuleRetry && { moduleRetryCount: { increment: 1 } }),
  };

  const { count } = await db.scan.updateMany({ where, data });
  if (count !== 1) {
    throw new InvalidTransitionError(
      `scan ${scanId}: compare-and-set ${from} -> ${to} matched no row ` +
        '(scan missing, state already changed, or retry budget exhausted)',
    );
  }
}

function timestampChanges(
  from: ScanRuntimeStatus,
  to: ScanRuntimeStatus,
  now: Date,
): Prisma.ScanUpdateManyMutationInput {
  if (to === 'Running') {
    // Partial -> Running is the free module retry: keep the original startedAt.
    return from === 'Queued' ? { startedAt: now, completedAt: null } : { completedAt: null };
  }
  if (to === 'Queued') {
    // Initial queueing or platform re-queue: the previous run's marks are stale.
    return { startedAt: null, completedAt: null };
  }
  // Completed / Partial / Failed / Cancelled are result states.
  return { completedAt: now };
}
