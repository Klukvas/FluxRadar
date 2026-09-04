// Claim задач из DB-очереди (D-005): выборка старейшего Pending-job +
// атомарный CAS Pending → Claimed. Из N конкурентных воркеров ровно один
// увидит count === 1; проигравшие идут за следующим job-ом.

import type { PrismaClient } from '@prisma/client';

import { JOB_STATUSES } from '../billing/constants.ts';

export interface ClaimedJob {
  readonly jobId: string;
  readonly scanId: string;
  readonly type: string;
}

/** Claims live long enough for the crawler; the worker heartbeat keeps active
 * work from being mistaken for a crashed process. */
export const JOB_LEASE_MS = 5 * 60 * 1000;

function leaseUntil(now: Date): Date {
  return new Date(now.getTime() + JOB_LEASE_MS);
}

export async function claimNextJob(
  prisma: PrismaClient,
  now: Date,
  excludedScanIds: ReadonlySet<string> = new Set(),
): Promise<ClaimedJob | null> {
  for (;;) {
    const job = await prisma.job.findFirst({
      where: {
        status: JOB_STATUSES.pending,
        ...(excludedScanIds.size > 0 ? { scanId: { notIn: [...excludedScanIds] } } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (job === null) {
      return null;
    }
    const { count } = await prisma.job.updateMany({
      where: { id: job.id, status: JOB_STATUSES.pending },
      data: {
        status: JOB_STATUSES.claimed,
        claimedAt: now,
        leaseUntil: leaseUntil(now),
        attempts: { increment: 1 },
      },
    });
    if (count === 1) {
      return { jobId: job.id, scanId: job.scanId, type: job.type };
    }
    // CAS проигран другому воркеру — пробуем следующий job.
  }
}

/**
 * Requeues claims left behind by an API process that stopped before finishing.
 * The conditional update is intentionally idempotent: concurrent API starts
 * may both attempt recovery, but only Pending jobs can subsequently be
 * claimed by the CAS in claimNextJob.
 */
export async function recoverClaimedJobs(prisma: PrismaClient, now = new Date()): Promise<number> {
  const legacyClaimCutoff = new Date(now.getTime() - JOB_LEASE_MS);
  const { count } = await prisma.job.updateMany({
    where: {
      status: JOB_STATUSES.claimed,
      OR: [
        { leaseUntil: { lte: now } },
        // Claims created before leases were introduced have no lease. Only
        // reclaim old ones so a live legacy worker is not interrupted.
        { leaseUntil: null, claimedAt: { lte: legacyClaimCutoff } },
      ],
    },
    data: { status: JOB_STATUSES.pending, claimedAt: null, leaseUntil: null },
  });
  return count;
}

/** Extends an active claim without reviving a job that has been requeued. */
export async function refreshJobLease(
  prisma: PrismaClient,
  jobId: string,
  now = new Date(),
): Promise<boolean> {
  const { count } = await prisma.job.updateMany({
    where: { id: jobId, status: JOB_STATUSES.claimed },
    data: { leaseUntil: leaseUntil(now) },
  });
  return count === 1;
}

/**
 * Atomically requeues a failed claim and claims it again for its one platform
 * retry. Other queue drainers only observe the committed end state (Claimed),
 * so they cannot steal the retry during a Pending window.
 */
export async function requeueAndClaimJob(
  prisma: PrismaClient,
  jobId: string,
  scanId: string,
  type: string,
  now: Date,
): Promise<ClaimedJob | null> {
  return prisma.$transaction(async (transaction) => {
    const { count: requeued } = await transaction.job.updateMany({
      where: { id: jobId, scanId, status: JOB_STATUSES.claimed },
      data: { status: JOB_STATUSES.pending, claimedAt: null, leaseUntil: null },
    });
    if (requeued !== 1) {
      return null;
    }
    const { count: claimed } = await transaction.job.updateMany({
      where: { id: jobId, scanId, status: JOB_STATUSES.pending },
      data: {
        status: JOB_STATUSES.claimed,
        claimedAt: now,
        leaseUntil: leaseUntil(now),
        attempts: { increment: 1 },
      },
    });
    return claimed === 1 ? { jobId, scanId, type } : null;
  });
}

export async function finishJob(prisma: PrismaClient, jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: JOB_STATUSES.done, claimedAt: null, leaseUntil: null },
  });
}

/** Возврат job-а в очередь для platform retry (§18: один бесплатный повтор). */
export async function requeueJob(prisma: PrismaClient, jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: JOB_STATUSES.pending, claimedAt: null, leaseUntil: null },
  });
}
