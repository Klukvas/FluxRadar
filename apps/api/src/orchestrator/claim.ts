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

export async function claimNextJob(prisma: PrismaClient, now: Date): Promise<ClaimedJob | null> {
  for (;;) {
    const job = await prisma.job.findFirst({
      where: { status: JOB_STATUSES.pending },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (job === null) {
      return null;
    }
    const { count } = await prisma.job.updateMany({
      where: { id: job.id, status: JOB_STATUSES.pending },
      data: { status: JOB_STATUSES.claimed, claimedAt: now, attempts: { increment: 1 } },
    });
    if (count === 1) {
      return { jobId: job.id, scanId: job.scanId, type: job.type };
    }
    // CAS проигран другому воркеру — пробуем следующий job.
  }
}

export async function finishJob(prisma: PrismaClient, jobId: string): Promise<void> {
  await prisma.job.update({ where: { id: jobId }, data: { status: JOB_STATUSES.done } });
}

/** Возврат job-а в очередь для platform retry (§18: один бесплатный повтор). */
export async function requeueJob(prisma: PrismaClient, jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: JOB_STATUSES.pending, claimedAt: null },
  });
}
