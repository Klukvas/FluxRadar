// What an interrupted attempt leaves behind, and what a resumed one picks up.
//
// Two rules shape everything here. The evidence store is the authority on which
// pages survived — a page missing from it is simply absent, which is what puts
// its URL back on the frontier. And none of these writes may fail an attempt:
// they are an optimisation that saves a re-crawl, while the `ScanModule` rows
// are what actually protects the customer from paying for a stage twice.

import type { CrawlResult, RestoredCrawlState } from '@fluxradar/crawler';
import type { PrismaClient } from '@prisma/client';

import {
  EMPTY_CRAWL_CHECKPOINT,
  clearScanCheckpoint,
  type CrawlCheckpoint,
  type CrawlCheckpointCoverage,
} from './checkpoint.ts';
import type { CrawlCounts } from './crawl-progress.ts';
import {
  clearCrawlEvidence,
  loadCrawlEvidence,
  loadCrawlResources,
  saveCrawlEvidence,
  saveCrawlResources,
} from './crawl-store.ts';
import type { WorkerDeps } from './deps.ts';

/** Module rows that already reached a terminal state for this scan. */
const SETTLED_MODULE_STATUSES = ['Completed', 'Partial', 'Unavailable', 'Not applicable'];

/**
 * Stages this scan has already finished and paid for.
 *
 * Read from the `ScanModule` rows rather than from the checkpoint, because the
 * checkpoint is the thing that may be missing: a process that wrote a module's
 * rows and died before writing — or failed to write — its checkpoint would
 * otherwise run that module, and pay a provider for it, a second time.
 */
export async function settledModules(
  prisma: PrismaClient,
  scanId: string,
): Promise<readonly string[]> {
  const rows = await prisma.scanModule.findMany({
    where: { scanId, runtimeStatus: { in: SETTLED_MODULE_STATUSES } },
    select: { module: true },
  });
  return rows.map((row) => row.module);
}

/**
 * Stores what this crawl read and returns the index of it.
 *
 * Pages that did not fit the evidence store come back as URLs to re-read. They
 * are put on the frontier rather than counted as done, because a page whose
 * evidence is gone is a page the report cannot show — the resumed scan has to
 * read it again for the report to mean what it says.
 *
 * A failure here is *not* fatal. The write exists to save a re-crawl, and
 * letting it fail the attempt would turn a transient database error into a
 * platform retry — which discards the run and re-charges the AI stages the
 * checkpoint exists to protect. So it is logged and the caller continues with
 * an index that says, truthfully, that it kept nothing.
 */
export async function persistCrawlEvidence(
  deps: WorkerDeps,
  accountId: string,
  scanId: string,
  result: CrawlResult,
  counts: CrawlCounts,
): Promise<CrawlCheckpoint> {
  const now = deps.now?.() ?? new Date();
  try {
    const saved = await saveCrawlEvidence(deps.prisma, {
      scanId,
      accountId,
      pages: result.pages,
      now,
    });
    if (saved.unretained.length > 0) {
      deps.logger.warn('scan evidence store full: some pages will be re-read on resume', {
        scanId,
        retained: saved.retained,
        unretained: saved.unretained.length,
        totalBytes: saved.totalBytes,
      });
    }
    await saveCrawlResources(deps.prisma, {
      scanId,
      accountId,
      resources: result.resources,
      now,
    });
    return {
      frontier: result.pendingQueue.map((entry) => ({ url: entry.url, depth: entry.depth })),
      unretained: saved.unretained.map((entry) => ({ url: entry.url, depth: entry.depth })),
      scannedUrlCount: counts.scanned,
      discoveredUrlCount: counts.discovered,
      coverage: coverageOf(result),
      truncated: false,
      // Whether these pages' bytes reached the egress counter is not known
      // here: the caller counts them after this write and sets the flag then.
      egressRecorded: false,
    };
  } catch (error) {
    deps.logger.error('scan evidence could not be stored; a resume will re-crawl', {
      scanId,
      error: messageOf(error),
    });
    // Nothing was kept, and the index says so: a resume re-crawls the site,
    // which is cheap and correct, instead of trusting pages that are not there.
    return { ...EMPTY_CRAWL_CHECKPOINT, truncated: true };
  }
}

function coverageOf(result: CrawlResult): CrawlCheckpointCoverage {
  return {
    skippedOverLimit: [...result.skippedOverLimit],
    blockedByRobots: [...result.blockedByRobots],
    errors: result.errors.map((error) => ({ ...error })),
    rejectedSeeds: result.rejectedSeeds.map((seed) => ({ ...seed })),
    urlVariants: Object.fromEntries(
      Object.entries(result.urlVariants).map(([url, variants]) => [url, [...variants]]),
    ),
  };
}

/**
 * The pages, probes and coverage a resumed crawl continues from.
 *
 * The evidence store is the authority on which pages survived; the checkpoint
 * supplies the facts no page carries. A page missing from the store is simply
 * absent here, which is what puts it back on the frontier.
 */
export async function restoreCrawl(
  prisma: PrismaClient,
  scanId: string,
  checkpoint: CrawlCheckpoint,
  now: Date,
): Promise<RestoredCrawlState> {
  return {
    pages: await loadCrawlEvidence(prisma, scanId, now),
    resources: await loadCrawlResources(prisma, scanId, now),
    coverage: checkpoint.coverage,
  };
}

/** Drops what a finished attempt would otherwise leave behind to resume from. */
export async function releaseResumeState(prisma: PrismaClient, scanId: string): Promise<void> {
  await clearCrawlEvidence(prisma, scanId);
  await clearScanCheckpoint(prisma, scanId);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
