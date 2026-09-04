import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { JOB_LEASE_MS, claimNextJob, recoverClaimedJobs, requeueAndClaimJob } from './claim.ts';

describe('database queue recovery', () => {
  it('requeues claimed jobs atomically and clears the old claim metadata', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = { job: { updateMany } } as unknown as PrismaClient;
    const now = new Date('2026-09-04T00:10:00.000Z');

    await expect(recoverClaimedJobs(prisma, now)).resolves.toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        status: 'Claimed',
        OR: [
          { leaseUntil: { lte: now } },
          { leaseUntil: null, claimedAt: { lte: new Date(now.getTime() - JOB_LEASE_MS) } },
        ],
      },
      data: { status: 'Pending', claimedAt: null, leaseUntil: null },
    });
  });

  it('keeps recovery idempotent when a concurrent startup finds no claim left', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = { job: { updateMany } } as unknown as PrismaClient;

    await expect(recoverClaimedJobs(prisma, new Date('2026-09-04T00:10:00.000Z'))).resolves.toBe(0);
  });

  it('still uses CAS after recovery so only one worker can claim the job', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'job-1',
      scanId: 'scan-1',
      type: 'scan',
      createdAt: new Date('2026-09-04T00:00:00.000Z'),
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = { job: { findFirst, updateMany } } as unknown as PrismaClient;

    await expect(claimNextJob(prisma, new Date('2026-09-04T00:01:00.000Z'))).resolves.toEqual({
      jobId: 'job-1',
      scanId: 'scan-1',
      type: 'scan',
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', status: 'Pending' },
      data: {
        status: 'Claimed',
        claimedAt: new Date('2026-09-04T00:01:00.000Z'),
        leaseUntil: new Date('2026-09-04T00:06:00.000Z'),
        attempts: { increment: 1 },
      },
    });
  });

  it('does not claim a scan already executing in the in-process worker', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { job: { findFirst } } as unknown as PrismaClient;
    const excludedScanIds = new Set(['scan-1']);

    await expect(
      claimNextJob(prisma, new Date('2026-09-04T00:01:00.000Z'), excludedScanIds),
    ).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: { status: 'Pending', scanId: { notIn: ['scan-1'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('requeues and reclaims a retry without exposing a pending window', async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const transaction = { job: { updateMany } };
    const prisma = {
      $transaction: vi.fn(async (callback: (db: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaClient;
    const now = new Date('2026-09-04T00:02:00.000Z');

    await expect(requeueAndClaimJob(prisma, 'job-1', 'scan-1', 'scan', now)).resolves.toEqual({
      jobId: 'job-1',
      scanId: 'scan-1',
      type: 'scan',
    });
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'job-1', scanId: 'scan-1', status: 'Claimed' },
      data: { status: 'Pending', claimedAt: null, leaseUntil: null },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'job-1', scanId: 'scan-1', status: 'Pending' },
      data: {
        status: 'Claimed',
        claimedAt: now,
        leaseUntil: new Date(now.getTime() + JOB_LEASE_MS),
        attempts: { increment: 1 },
      },
    });
  });
});
