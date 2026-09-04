// In-process scan worker for the local v0.1 runtime. Jobs are claimed from
// PostgreSQL with the same compare-and-set primitive used by the production queue;
// the execution loop therefore remains useful in integration tests and can be
// replaced by a separate worker process without changing scan semantics.

import type { ScanRuntimeStatus } from '@fluxradar/contracts';
import type { PrismaClient } from '@prisma/client';

import { requestRefund } from '../billing/refund.ts';
import { resolveScanOutcome } from '../billing/resolve-outcome.ts';
import { transitionScan } from '../billing/state-machine.ts';
import { markResolvedAgainstPrevious } from './issue-sync.ts';
import { modulePlanFor } from './module-plan.ts';
import type { WorkerDeps } from './deps.ts';
import {
  JOB_LEASE_MS,
  claimNextJob,
  finishJob,
  refreshJobLease,
  requeueAndClaimJob,
} from './claim.ts';
import { runScanAttempt } from './run-attempt.ts';

// The current runtime has one in-process queue drain and HTTP enqueue path.
// Keeping active scan IDs shared between both paths closes the retry window in
// which a job is briefly Pending while its original process is still alive.
const activeScanIds = new Set<string>();

export interface ScanProcessResult {
  readonly scanId: string;
  readonly status: ScanRuntimeStatus;
  readonly outcome: 'Completed' | 'Partial' | 'Failed' | 'Cancelled' | 'Queued';
  readonly refundId: string | null;
}

/**
 * Claims and executes one named scan. A platform retry is re-queued and then
 * claimed again in the same call so a local dev checkout eventually settles
 * without requiring a second HTTP request.
 */
export async function processScan(deps: WorkerDeps, scanId: string): Promise<ScanProcessResult> {
  if (activeScanIds.has(scanId)) {
    const activeScan = await deps.prisma.scan.findUnique({ where: { id: scanId } });
    if (activeScan === null) {
      throw new Error(`processScan: scan ${scanId} not found`);
    }
    return resultFromExisting(scanId, activeScan.status as ScanRuntimeStatus);
  }
  const job = await claimJobForScan(deps.prisma, scanId, new Date());
  if (job === null) {
    const scan = await deps.prisma.scan.findUnique({ where: { id: scanId } });
    if (scan === null) {
      throw new Error(`processScan: scan ${scanId} not found`);
    }
    return resultFromExisting(scanId, scan.status as ScanRuntimeStatus);
  }
  return processClaimedJob(deps, job.jobId, job.scanId, job.type);
}

/** Claims the oldest pending job and executes it; null means the queue is idle. */
export async function processNextJob(deps: WorkerDeps): Promise<ScanProcessResult | null> {
  const job = await claimNextJob(deps.prisma, new Date(), activeScanIds);
  return job === null ? null : processClaimedJob(deps, job.jobId, job.scanId, job.type);
}

/** Drains all currently pending jobs. Useful for CLI/CI and integration tests. */
export async function processPendingJobs(deps: WorkerDeps): Promise<readonly ScanProcessResult[]> {
  const results: ScanProcessResult[] = [];
  for (;;) {
    const result = await processNextJob(deps);
    if (result === null) {
      return results;
    }
    results.push(result);
  }
}

interface ClaimedScanJob {
  readonly jobId: string;
  readonly scanId: string;
  readonly type: string;
}

async function claimJobForScan(
  prisma: PrismaClient,
  scanId: string,
  now: Date,
): Promise<ClaimedScanJob | null> {
  const job = await prisma.job.findUnique({ where: { scanId } });
  if (job === null) {
    throw new Error(`processScan: scan ${scanId} has no job`);
  }
  const { count } = await prisma.job.updateMany({
    where: { id: job.id, status: 'Pending' },
    data: {
      status: 'Claimed',
      claimedAt: now,
      leaseUntil: new Date(now.getTime() + JOB_LEASE_MS),
      attempts: { increment: 1 },
    },
  });
  return count === 1 ? { jobId: job.id, scanId: job.scanId, type: job.type } : null;
}

async function processClaimedJob(
  deps: WorkerDeps,
  jobId: string,
  scanId: string,
  jobType: string,
): Promise<ScanProcessResult> {
  const { prisma, logger } = deps;
  activeScanIds.add(scanId);
  let activeJobId = jobId;
  const leaseTimer = setInterval(
    () => {
      void refreshJobLease(prisma, activeJobId).catch((error: unknown) => {
        logger.warn('scan job lease refresh failed', {
          scanId,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
      });
    },
    Math.max(1_000, Math.floor(JOB_LEASE_MS / 3)),
  );
  leaseTimer.unref();
  try {
    for (;;) {
      const scan = await prisma.scan.findUnique({ where: { id: scanId } });
      if (scan === null) {
        throw new Error(`worker: scan ${scanId} not found`);
      }
      if (await isBillingBlocked(prisma, scan.purchaseId, deps.now?.() ?? new Date())) {
        // A refund/dispute overlay must not consume the paid job. The scan is
        // left in its current state for the billing/admin reconciliation flow.
        await finishJob(prisma, activeJobId);
        return resultFromExisting(scanId, scan.status as ScanRuntimeStatus);
      }
      const status = scan.status as ScanRuntimeStatus;
      if (status === 'Pending') {
        await transitionScan(prisma, scanId, 'Pending', 'Queued', { now: deps.now?.() });
      }
      const afterQueue = await prisma.scan.findUnique({ where: { id: scanId } });
      if (afterQueue === null) {
        throw new Error(`worker: scan ${scanId} disappeared after queueing`);
      }
      if (afterQueue.status === 'Queued') {
        await transitionScan(prisma, scanId, 'Queued', 'Running', { now: deps.now?.() });
      }
      if (afterQueue.status === 'Cancelled' || afterQueue.status === 'Completed') {
        await finishJob(prisma, activeJobId);
        return resultFromExisting(scanId, afterQueue.status as ScanRuntimeStatus);
      }

      try {
        await runScanAttempt(deps, scanId, moduleFromRetryJob(jobType));
        const outcome = await resolveScanOutcome(prisma, scanId);
        if (outcome.kind === 'ExternalRetryGranted') {
          // The retry is represented as a real Partial→Running budget in the
          // state machine. runScanAttempt starts by replacing the old snapshot.
          continue;
        }

        await persistUnavailableModules(prisma, scanId);
        if (outcome.kind === 'Completed') {
          await markResolvedAgainstPrevious(
            prisma,
            await prisma.scan.findUniqueOrThrow({ where: { id: scanId } }),
          );
        }
        await finishJob(prisma, activeJobId);
        return {
          scanId,
          status: outcome.kind,
          outcome: outcome.kind,
          refundId: outcome.kind === 'Failed' ? (outcome.refund?.id ?? null) : null,
        };
      } catch (error) {
        logger.error('scan execution failed', {
          scanId,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
        const current = await prisma.scan.findUnique({ where: { id: scanId } });
        if (current === null) {
          throw new Error(`worker: scan ${scanId} disappeared after execution failure`, {
            cause: error,
          });
        }
        if (current.status === 'Running') {
          await transitionScan(prisma, scanId, 'Running', 'Failed', {
            statusReason: 'PlatformFailure',
            now: deps.now?.(),
          });
        }
        const failed = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
        if (failed.platformRetryCount < 1) {
          await transitionScan(prisma, scanId, 'Failed', 'Queued', { now: deps.now?.() });
          const claimed = await requeueAndClaimJob(
            prisma,
            activeJobId,
            scanId,
            jobType,
            deps.now?.() ?? new Date(),
          );
          if (claimed === null) {
            throw new Error(`platform retry for ${scanId} could not be claimed`, { cause: error });
          }
          activeJobId = claimed.jobId;
          jobType = claimed.type;
          continue;
        }
        const refund =
          failed.purchaseId === null
            ? null
            : (await requestRefund(prisma, failed.purchaseId, 'PLATFORM_FAILURE_AFTER_RETRY'))
                .record;
        await finishJob(prisma, activeJobId);
        return {
          scanId,
          status: 'Failed',
          outcome: 'Failed',
          refundId: refund?.id ?? null,
        };
      }
    }
  } finally {
    clearInterval(leaseTimer);
    activeScanIds.delete(scanId);
  }
}

function moduleFromRetryJob(jobType: string): string | undefined {
  const prefix = 'module-retry:';
  return jobType.startsWith(prefix) ? jobType.slice(prefix.length) : undefined;
}

async function isBillingBlocked(
  prisma: PrismaClient,
  purchaseId: string | null,
  now: Date,
): Promise<boolean> {
  if (purchaseId === null) {
    return false;
  }
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    include: { entitlement: true },
  });
  return (
    purchase === null ||
    purchase.status !== 'paid' ||
    purchase.entitlement === null ||
    purchase.entitlement.suspended ||
    purchase.entitlement.expiresAt.getTime() <= now.getTime()
  );
}

async function persistUnavailableModules(prisma: PrismaClient, scanId: string): Promise<void> {
  const scan = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
  for (const stub of modulePlanFor(scan.plan as 'Free' | 'Basic' | 'Complete').stubs) {
    await prisma.scanModule.upsert({
      where: { scanId_module: { scanId, module: stub.module } },
      create: {
        scanId,
        module: stub.module,
        runtimeStatus: stub.runtimeStatus,
        statusReason: stub.statusReason,
        coverage: 0,
        applicableChecks: stub.applicableChecks,
        completedApplicableChecks: 0,
        score: null,
        usableOutput: false,
      },
      update: {
        runtimeStatus: stub.runtimeStatus,
        statusReason: stub.statusReason,
        coverage: 0,
        applicableChecks: stub.applicableChecks,
        completedApplicableChecks: 0,
        score: null,
        usableOutput: false,
      },
    });
  }
}

function resultFromExisting(scanId: string, status: ScanRuntimeStatus): ScanProcessResult {
  const outcome = status === 'Queued' || status === 'Pending' ? 'Queued' : status;
  return {
    scanId,
    status,
    outcome: outcome as ScanProcessResult['outcome'],
    refundId: null,
  };
}
