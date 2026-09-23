// In-process scan worker for the local v0.1 runtime. Jobs are claimed from
// PostgreSQL with the same compare-and-set primitive used by the production queue;
// the execution loop therefore remains useful in integration tests and can be
// replaced by a separate worker process without changing scan semantics.

import type { ScanRuntimeStatus } from '@fluxradar/contracts';
import type { PrismaClient, Scan } from '@prisma/client';

import { InvalidTransitionError } from '../billing/errors.ts';
import { requestRefund } from '../billing/refund.ts';
import { paidAccessDenial } from '../billing/report-access.ts';
import { resolveScanOutcome } from '../billing/resolve-outcome.ts';
import { transitionScan } from '../billing/state-machine.ts';
import { persistAnalyticsModule } from './analytics-module.ts';
import { decideAfterFailedAttempt, watchScanCancellation } from './cancellation.ts';
import {
  clearScanCheckpoint,
  loadScanCheckpoint,
  saveScanCheckpoint,
  type ScanCheckpointState,
} from './checkpoint.ts';
import { clearCrawlEvidence } from './crawl-store.ts';
import { markResolvedAgainstPrevious } from './issue-sync.ts';
import type { RunCoverage } from './resolution-policy.ts';
import { loadScanCoverage, pruneCoverageProofs, type UnreadableCoverage } from './run-coverage.ts';
import { modulePlanFor } from './module-plan.ts';
import { ScanStopWatcher, holdJobWhilePaused, parkPausedScan } from './pause.ts';
import type { WorkerDeps } from './deps.ts';
import {
  JOB_LEASE_MS,
  claimNextJob,
  finishJob,
  refreshJobLease,
  requeueAndClaimJob,
} from './claim.ts';
import { runScanAttempt } from './run-attempt.ts';
import { notifyScanEvent } from '../email/notifications.ts';

// The current runtime has one in-process queue drain and HTTP enqueue path.
// Keeping active scan IDs shared between both paths closes the retry window in
// which a job is briefly Pending while its original process is still alive.
const activeScanIds = new Set<string>();

export interface ScanProcessResult {
  readonly scanId: string;
  readonly status: ScanRuntimeStatus;
  readonly outcome: 'Completed' | 'Partial' | 'Failed' | 'Cancelled' | 'Queued' | 'Paused';
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
  // Set for the one loop turn that follows an ExternalRetryGranted outcome:
  // that retry is a replacement of the result, not a continuation of it.
  let externalRetry = false;
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
        // A pause recorded while the scan is still Pending has to park it from
        // Pending: §18 reads that state back out of the status reason when the
        // scan is cancelled later, and a run queued first is parked as "paused
        // after start", which drops the full pre-queue refund the owner is owed.
        // The window is one write wide — requestScanPause records the flag
        // before it parks — and this is the read that races it.
        if (scan.pauseRequestedAt !== null) {
          return await settleStoppedScan(deps, scanId, activeJobId, 'paused');
        }
        // Losing this compare-and-set means the pause parked the scan, or a
        // cancel took it, between the read above and here. The re-read below
        // settles the job against whatever won instead of throwing out of the
        // loop with the job still claimed.
        await tryTransitionScan(prisma, scanId, 'Pending', 'Queued', deps.now?.());
      }
      const afterQueue = await prisma.scan.findUnique({ where: { id: scanId } });
      if (afterQueue === null) {
        throw new Error(`worker: scan ${scanId} disappeared after queueing`);
      }
      if (afterQueue.status === 'Cancelled' || afterQueue.status === 'Completed') {
        await finishJob(prisma, activeJobId);
        return resultFromExisting(scanId, afterQueue.status as ScanRuntimeStatus);
      }
      // A pause that arrived while this job was being claimed must be honoured
      // before any outbound work — and before the start, so the run is parked
      // from the state it actually reached rather than from a Running it entered
      // only to stop again.
      if (afterQueue.status === 'Paused' || afterQueue.pauseRequestedAt !== null) {
        return await settleStoppedScan(deps, scanId, activeJobId, 'paused');
      }
      if (afterQueue.status === 'Queued') {
        // A user cancel can land between the read above and this transition.
        // The CAS is the arbiter: losing it means the scan is no longer ours to
        // start, and the job is closed against whatever state actually won.
        if (!(await tryTransitionScan(prisma, scanId, 'Queued', 'Running', deps.now?.()))) {
          const current = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
          await finishJob(prisma, activeJobId);
          return resultFromExisting(scanId, current.status as ScanRuntimeStatus);
        }
      }

      // Two readers of the same fact, because they answer different questions.
      // The watcher owns the AbortSignal that reaches safe-fetch and the AI
      // adapters, so a cancel stops the request already on the wire; the stop
      // watcher is what the attempt consults at stage boundaries, and it is the
      // only one that can tell a pause from a cancel.
      const stopWatcher = new ScanStopWatcher(prisma, scanId, deps.stopPollMs);
      const cancellation = watchScanCancellation(prisma, scanId, {
        onPollError: (error: unknown) =>
          logger.warn('cancellation poll failed', { scanId, error: String(error) }),
      });
      try {
        // A cancel that landed between the CAS above and this line must be seen
        // before the first network request, not one poll interval later.
        await cancellation.ready;
        const now = deps.now?.() ?? new Date();
        const resumeFrom = await loadScanCheckpoint(prisma, scanId, now);
        // A checkpoint written by a process that stopped mid-run is read here,
        // not only after an explicit pause: after a restart the job is requeued
        // and this is what stops the finished stages being run again.
        const facts = await runScanAttempt(deps, scanId, {
          ...(moduleFromRetryJob(jobType) !== undefined
            ? { retryModule: moduleFromRetryJob(jobType) }
            : {}),
          signal: cancellation.signal,
          control: {
            resumeFrom,
            // The external retry the customer was granted after a Partial run
            // is the one attempt that replaces the previous result outright;
            // every other one continues what already settled.
            replacesPreviousResult: externalRetry,
            isStopRequested: () => stopWatcher.isStopRequested(),
            save: (state: ScanCheckpointState) =>
              saveScanCheckpoint(prisma, {
                scanId,
                accountId: scan.accountId,
                state,
                now: deps.now?.() ?? new Date(),
              }),
          },
        });
        if (facts.stopped) {
          // Why it stopped decides everything that follows: a pause parks the
          // job and keeps the checkpoint, a cancel is terminal and throws it
          // away. Reading the reason before branching is what keeps a cancelled
          // run from being parked as if it could still be resumed.
          const stopReason = await stopWatcher.refresh();
          return stopReason === 'cancelled'
            ? await finishCancelledScan(prisma, scanId, activeJobId)
            : await settleStoppedScan(deps, scanId, activeJobId, stopReason);
        }
        if (await isCancelled(prisma, scanId)) {
          // The attempt finished its last phase just as the cancel landed.
          // resolveScanOutcome only terminalizes Running scans; calling it here
          // is what used to throw and leave the job unfinished.
          return await finishCancelledScan(prisma, scanId, activeJobId);
        }
        const outcome = await resolveScanOutcome(prisma, scanId);
        if (outcome.kind === 'ExternalRetryGranted') {
          // The retry is represented as a real Partial→Running budget in the
          // state machine. runScanAttempt starts by replacing the old snapshot.
          externalRetry = true;
          continue;
        }
        externalRetry = false;

        await persistUnavailableModules(prisma, scanId);
        await persistAnalyticsModule(deps, scanId, facts.analyticsPages);
        // The run settled, so its checkpoint describes nothing that can be
        // resumed. Removing it here is also what keeps the table bounded by the
        // number of *paused* scans rather than by every scan ever run.
        await clearScanCheckpoint(prisma, scanId);
        await clearCrawlEvidence(prisma, scanId);
        if (outcome.kind === 'Completed') {
          const completed = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
          const onUnreadableCoverage = unreadableCoverageLogger(deps, scanId);
          await markResolvedAgainstPrevious(
            prisma,
            completed,
            await runCoverageOf(prisma, completed, onUnreadableCoverage),
            { onUnreadableCoverage },
          );
          await pruneOldCoverageProofs(deps, completed);
        }
        await finishJob(prisma, activeJobId);
        if (outcome.kind === 'Failed' && outcome.refund !== null) {
          void notifyScanEvent(
            prisma,
            deps.mailer,
            scanId,
            'refund_created',
            'A refund record was created for this audit.',
          ).catch((error: unknown) =>
            logger.warn('refund notification failed', { scanId, error: String(error) }),
          );
        }
        return {
          scanId,
          status: outcome.kind,
          outcome: outcome.kind,
          refundId: outcome.kind === 'Failed' ? (outcome.refund?.id ?? null) : null,
        };
      } catch (error) {
        const current = await prisma.scan.findUnique({ where: { id: scanId } });
        if (current === null) {
          throw new Error(`worker: scan ${scanId} disappeared after execution failure`, {
            cause: error,
          });
        }
        const decision = decideAfterFailedAttempt({
          error,
          currentStatus: current.status,
          pauseRequestedAt: current.pauseRequestedAt,
          platformRetryCount: current.platformRetryCount,
        });
        // A cancelled scan did exactly what the user asked for. Treating it as
        // a platform failure was the whole defect: it logged an error, tried
        // Running→Failed, then spent the free platform retry on Failed→Queued
        // from a state the machine does not allow, and the job never finished.
        if (decision.kind === 'cancelled') {
          logger.info('scan cancelled during execution', { scanId });
          return await finishCancelledScan(prisma, scanId, activeJobId);
        }
        // A pause is the same story with the opposite ending: the run is meant
        // to continue later, so the failure branch below — which clears the
        // checkpoint and spends the platform retry — would destroy exactly what
        // the pause was for.
        if (decision.kind === 'paused') {
          logger.info('scan paused during execution', { scanId });
          return await settleStoppedScan(deps, scanId, activeJobId, 'paused');
        }
        logger.error('scan execution failed', {
          scanId,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
        if (current.status === 'Running') {
          await transitionScan(prisma, scanId, 'Running', 'Failed', {
            statusReason: 'PlatformFailure',
            now: deps.now?.(),
          });
        }
        const failed = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
        if (failed.platformRetryCount < 1) {
          // A platform retry re-crawls: the checkpoint and the stored pages go,
          // because the failure may be in what they describe and a fresh read
          // of the site is cheap. What does *not* go is the modules that
          // already settled — an AI stage that completed was paid for, and
          // running it again because an unrelated stage crashed would charge
          // the customer twice for one scan. The retry keeps the scan's own
          // `startedAt` for the same reason, so those findings stay inside the
          // lifetime the export contract requires them to be in.
          await clearScanCheckpoint(prisma, scanId);
          await clearCrawlEvidence(prisma, scanId);
          externalRetry = false;
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
        await terminalizeIncompleteModules(prisma, scanId);
        await clearScanCheckpoint(prisma, scanId);
        await clearCrawlEvidence(prisma, scanId);
        const refund =
          failed.purchaseId === null
            ? null
            : (await requestRefund(prisma, failed.purchaseId, 'PLATFORM_FAILURE_AFTER_RETRY'))
                .record;
        await finishJob(prisma, activeJobId);
        if (refund !== null) {
          void notifyScanEvent(
            prisma,
            deps.mailer,
            scanId,
            'refund_created',
            'A refund record was created for this audit.',
          ).catch((error: unknown) =>
            logger.warn('refund notification failed', { scanId, error: String(error) }),
          );
        }
        return {
          scanId,
          status: 'Failed',
          outcome: 'Failed',
          refundId: refund?.id ?? null,
        };
      } finally {
        stopWatcher.close();
        cancellation.stop();
      }
    }
  } finally {
    clearInterval(leaseTimer);
    activeScanIds.delete(scanId);
  }
}

/**
 * Settles a run the owner stopped: paused, or cancelled while it was running.
 *
 * A pause is not an outcome — nothing is scored, nothing is refunded and the
 * purchase is untouched, because the run has not been given up on. The job is
 * parked rather than finished, so resuming claims the same job instead of
 * creating a second one. A cancellation is already terminal by the time the
 * attempt notices it, so there is nothing left to do but release the job.
 */
async function settleStoppedScan(
  deps: WorkerDeps,
  scanId: string,
  jobId: string,
  stopReason: 'paused' | 'cancelled' | null,
): Promise<ScanProcessResult> {
  const { prisma } = deps;
  const scan = await prisma.scan.findUnique({ where: { id: scanId } });
  if (scan === null) {
    throw new Error(`worker: scan ${scanId} disappeared after it was stopped`);
  }
  if (stopReason === 'cancelled' || scan.status === 'Cancelled') {
    return await releaseStoppedJob(prisma, scanId, jobId, scan.status as ScanRuntimeStatus);
  }
  if (scan.status === 'Running' || scan.status === 'Queued' || scan.status === 'Pending') {
    // One transaction, so a resume landing between the two writes cannot leave
    // the job parked under a scan that is already back in the queue.
    if (!(await tryParkPausedScan(prisma, scanId, scan.status, deps.now?.()))) {
      // The owner's own park — `requestScanPause` parks from the same state a
      // moment after it records the flag — or a cancel won the compare-and-set
      // since the read above. Two writers agreeing on a stop is an ordinary
      // outcome, not an error: throwing here left the job claimed until the
      // lease sweep recovered it minutes later, so the run settles against
      // whichever writer actually won instead.
      const winner = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
      deps.logger.info('scan park lost to another writer', { scanId, winner: winner.status });
      if (winner.status === 'Cancelled') {
        // Nothing else releases this job: `cancelScan` settles the scan and the
        // money and does not touch the queue.
        return await releaseStoppedJob(prisma, scanId, jobId, 'Cancelled');
      }
      // A pause winner parks scan and job in one transaction, so this normally
      // changes nothing; it re-reads under a row lock, which is also what makes
      // it a no-op for a scan a resume has already put back in the queue.
      await holdJobWhilePaused(prisma, scanId);
    }
  } else {
    // The scan already read `Paused` — the pause parked its job in the same
    // transaction that set the status, so this normally changes nothing. It
    // stays as the guard for a job that was claimed just before that write,
    // and it re-checks the status under a lock because the read above is old
    // enough for a resume to have happened since.
    await holdJobWhilePaused(prisma, scanId);
  }
  const paused = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
  return {
    scanId,
    status: paused.status as ScanRuntimeStatus,
    outcome: paused.status === 'Paused' ? 'Paused' : 'Queued',
    refundId: null,
  };
}

/**
 * Releases the job of a run that has already settled terminally.
 *
 * The scan is `Cancelled` — `cancelScan` owns that transition and the refund
 * that goes with it — so nothing here continues the run: the job is finished
 * rather than parked, and the checkpoint and stored pages that only a resume
 * could have used go with it.
 */
async function releaseStoppedJob(
  prisma: PrismaClient,
  scanId: string,
  jobId: string,
  status: ScanRuntimeStatus,
): Promise<ScanProcessResult> {
  await finishJob(prisma, jobId);
  await clearScanCheckpoint(prisma, scanId);
  await clearCrawlEvidence(prisma, scanId);
  return resultFromExisting(scanId, status);
}

/** Парковка паузы; false — гонку за переход выиграл кто-то другой. */
async function tryParkPausedScan(
  prisma: PrismaClient,
  scanId: string,
  from: 'Pending' | 'Queued' | 'Running',
  now: Date | undefined,
): Promise<boolean> {
  try {
    await parkPausedScan(prisma, scanId, from, now);
    return true;
  } catch (error) {
    // Only the compare-and-set losing is expected here. A connection failure or
    // a constraint violation is a real error and must not be read as a race.
    if (error instanceof InvalidTransitionError) {
      return false;
    }
    throw error;
  }
}

/** Атомарный переход; false — гонку выиграл кто-то другой (пауза или отмена). */
async function tryTransitionScan(
  prisma: PrismaClient,
  scanId: string,
  from: ScanRuntimeStatus,
  to: ScanRuntimeStatus,
  now: Date | undefined,
): Promise<boolean> {
  try {
    await transitionScan(prisma, scanId, from, to, { now });
    return true;
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return false;
    }
    throw error;
  }
}

async function isCancelled(prisma: PrismaClient, scanId: string): Promise<boolean> {
  const scan = await prisma.scan.findUnique({ where: { id: scanId }, select: { status: true } });
  return scan?.status === 'Cancelled';
}

/**
 * Чистое завершение отменённого прогона.
 *
 * Скан уже в терминальном Cancelled (перевод делает cancelScan), поэтому здесь
 * остаётся закрыть недоработанные модули и сам job. Ни refund, ни platform
 * retry: отмена после постановки в очередь по §18 — использованный прогон, а
 * не сбой платформы. Модули, успевшие отработать, сохраняют свои результаты.
 */
async function finishCancelledScan(
  prisma: PrismaClient,
  scanId: string,
  jobId: string,
): Promise<ScanProcessResult> {
  await terminalizeIncompleteModules(prisma, scanId, 'ScanCancelled');
  await finishJob(prisma, jobId);
  // Отмена терминальна: продолжать этот скан уже нечем, поэтому checkpoint и
  // накопленные страницы — мусор, который иначе дожидался бы TTL.
  await clearScanCheckpoint(prisma, scanId);
  await clearCrawlEvidence(prisma, scanId);
  return { scanId, status: 'Cancelled', outcome: 'Cancelled', refundId: null };
}

/**
 * Покрытие прогона для политики Resolved: что реально проверено (§14).
 *
 * Читается из строк модулей этого же скана, а не из памяти попытки: module retry
 * переигрывает одну секцию, и покрытие остальных должно остаться тем, что они
 * записали, когда работали.
 */
async function runCoverageOf(
  prisma: PrismaClient,
  scan: Scan,
  onUnreadableCoverage: UnreadableCoverage,
): Promise<RunCoverage> {
  const modules = await prisma.scanModule.findMany({
    where: { scanId: scan.id, runtimeStatus: 'Completed', usableOutput: true },
    select: { module: true },
  });
  return {
    coverageByRule: (await loadScanCoverage(prisma, scan.id, onUnreadableCoverage)).byRule,
    completedModules: new Set(modules.map((module) => module.module)),
    rulesetVersion: scan.rulesetVersion,
  };
}

/**
 * Доказательства покрытия старых сканов профиля после разбора Resolved.
 *
 * Политика читает ровно одно прошлое покрытие — предыдущего завершённого
 * Complete-скана, — поэтому всё, что старше двух последних завершённых, уже
 * никем не будет прочитано (run-coverage.ts). Только что записанное
 * доказательство самого скана уборка не трогает: он передаётся ей явно.
 * Уборка идёт после разбора и не роняет прогон: скан уже завершён, а неудачную
 * уборку повторит следующий.
 */
async function pruneOldCoverageProofs(deps: WorkerDeps, scan: Scan): Promise<void> {
  try {
    const removed = await pruneCoverageProofs(deps.prisma, scan);
    if (removed > 0) {
      deps.logger.info('coverage proofs pruned', { scanId: scan.id, removed });
    }
  } catch (error) {
    deps.logger.warn('coverage proof pruning failed', {
      scanId: scan.id,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

/**
 * Непригодное доказательство покрытия не роняет скан: находка просто остаётся
 * открытой (консервативная сторона ошибки). Но и молчать об этом нельзя — это
 * либо повреждённая метадата модуля, либо обход крупнее лимита доказательства.
 */
function unreadableCoverageLogger(deps: WorkerDeps, scanId: string): UnreadableCoverage {
  return ({ module, problem }) =>
    deps.logger.warn('scan module coverage proof is unusable', { scanId, module, problem });
}

/**
 * Закрывает модули, не дошедшие до собственной записи (отмена или сбой).
 *
 * §575: незавершённые проверки баллов не получают, а завершённая часть
 * сохраняется как `Partial`; модуль, не закрывший ни одной применимой проверки,
 * становится `Unavailable`. Поэтому строка, успевшая записать свои счётчики,
 * сохраняет их, а не обнуляется до «ничего не было». Модули, которые пишут
 * результат целиком (правила) либо сами сохраняют частичный результат до
 * прерывания (GEO, UX), сюда приходят с нулём завершённых проверок и
 * терминализируются как Unavailable.
 */
async function terminalizeIncompleteModules(
  prisma: PrismaClient,
  scanId: string,
  statusReason = 'PlatformFailureBeforeCompletion',
): Promise<void> {
  const incomplete = await prisma.scanModule.findMany({
    where: { scanId, runtimeStatus: { in: ['Pending', 'Running'] } },
    select: { module: true, applicableChecks: true, completedApplicableChecks: true },
  });
  for (const module of incomplete) {
    const completed = module.completedApplicableChecks ?? 0;
    // Export semantics require an applicable unavailable module to record at
    // least one attempted check. A module still Pending/Running by definition
    // had at least one check left — a module that had finished all of them
    // would have written its own terminal row — so applicable stays above
    // completed even when the stored denominator says otherwise.
    const applicable = Math.max(module.applicableChecks ?? 1, completed + 1);
    await prisma.scanModule.update({
      where: { scanId_module: { scanId, module: module.module } },
      data: {
        runtimeStatus: completed > 0 ? 'Partial' : 'Unavailable',
        statusReason,
        coverage: completed / applicable,
        score: null,
        applicableChecks: applicable,
        completedApplicableChecks: completed,
        usableOutput: false,
      },
    });
  }
}

function moduleFromRetryJob(jobType: string): string | undefined {
  const prefix = 'module-retry:';
  return jobType.startsWith(prefix) ? jobType.slice(prefix.length) : undefined;
}

/**
 * Whether a refund, a chargeback or an expired entitlement forbids running this
 * scan. The rule itself lives in billing/report-access.ts, next to the one the
 * read paths apply, so the worker and the API can no longer drift apart.
 */
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
  return paidAccessDenial({ purchaseId, purchase }, { now }) !== null;
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
