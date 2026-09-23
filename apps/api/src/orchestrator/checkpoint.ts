// What a paused run remembers, and the bounds it remembers it within.
//
// The checkpoint is the *index* of a paused scan: which stages finished, what
// the crawl had left to do, and what it had already learned about the site that
// cannot be read off a page — URLs skipped over the tariff limit, URLs robots
// closed, errors, duplicate-URL groups. The pages themselves are not here; they
// are in the evidence store (crawl-store.ts), because a site's worth of HTML
// does not belong in a JSON column.
//
// Two rules shape everything below. Finished stages must survive, because those
// are the stages the customer paid for and an AI stage run twice is a second
// charge. And nothing may be dropped silently: a page whose evidence was not
// retained comes back as a URL to re-read, not as a page quietly missing from
// the report.

import { SCAN_CHECKPOINT_LIMITS } from '@fluxradar/contracts';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const queueEntrySchema = z.object({
  url: z.string().min(1),
  depth: z.number().int().min(0),
});

const crawlErrorSchema = z.object({ url: z.string(), reason: z.string() });

/**
 * What the crawl knew about the site beyond its pages.
 *
 * None of this can be recovered from the stored pages: a URL that did not fit
 * the tariff's page limit and a URL robots.txt closed leave no trace in anyone
 * else's HTML. Losing them would make a resumed scan report better coverage
 * than it achieved.
 */
const crawlCoverageSchema = z.object({
  skippedOverLimit: z.array(z.string()),
  blockedByRobots: z.array(z.string()),
  errors: z.array(crawlErrorSchema),
  rejectedSeeds: z.array(crawlErrorSchema),
  urlVariants: z.record(z.string(), z.array(z.string())),
});

const crawlCheckpointSchema = z.object({
  /** URLs discovered but not yet read. */
  frontier: z.array(queueEntrySchema),
  /**
   * URLs already read whose evidence could not be kept inside the store's
   * bounds. They go back on the frontier, so the resumed scan reads them again
   * rather than reporting a page it can no longer show.
   */
  unretained: z.array(queueEntrySchema),
  scannedUrlCount: z.number().int().min(0),
  discoveredUrlCount: z.number().int().min(0),
  coverage: crawlCoverageSchema,
  /** True when the bounds below dropped part of the index. */
  truncated: z.boolean(),
  /**
   * True once the bytes of the pages in the evidence store were counted against
   * the egress location's monthly allowance.
   *
   * A resumed crawl hands its restored pages back as part of its own result, so
   * without this the resume would book the whole first attempt's traffic again.
   * It defaults to false, which is both what a checkpoint written before this
   * field says and the safe reading of it: bytes are counted once more rather
   * than never at all.
   */
  egressRecorded: z.boolean().default(false),
});

export const scanCheckpointPayloadSchema = z.object({
  // Version 1 stored a visited-URL list and no page evidence, so resuming it
  // would silently re-crawl. Those payloads are rejected on read, which starts
  // a clean attempt instead of an incomplete one.
  schemaVersion: z.literal(2),
  /** Where the run stopped: 'crawl' or the module that was next. */
  stage: z.string().min(1),
  /**
   * Stages this attempt finished. A resumed attempt skips them, which is what
   * stops an AI module from being run — and charged for — a second time.
   */
  completedStages: z.array(z.string().min(1)),
  crawl: crawlCheckpointSchema,
});

export type ScanCheckpointState = z.infer<typeof scanCheckpointPayloadSchema>;
export type CrawlCheckpoint = z.infer<typeof crawlCheckpointSchema>;
export type CrawlCheckpointCoverage = z.infer<typeof crawlCoverageSchema>;

export const EMPTY_CRAWL_COVERAGE: CrawlCheckpointCoverage = {
  skippedOverLimit: [],
  blockedByRobots: [],
  errors: [],
  rejectedSeeds: [],
  urlVariants: {},
};

export const EMPTY_CRAWL_CHECKPOINT: CrawlCheckpoint = {
  frontier: [],
  unretained: [],
  scannedUrlCount: 0,
  discoveredUrlCount: 0,
  coverage: EMPTY_CRAWL_COVERAGE,
  truncated: false,
  egressRecorded: false,
};

export interface SaveCheckpointInput {
  readonly scanId: string;
  readonly accountId: string;
  readonly state: ScanCheckpointState;
  readonly now: Date;
}

/**
 * Writes the checkpoint for a scan, bounded twice.
 *
 * First by count, so a large site cannot write a large row; then by serialized
 * size, because a site can also have very long URLs. When the second bound is
 * hit the crawl index is dropped and the stage list is kept: losing the
 * frontier costs a re-crawl, losing the stage list costs the customer money.
 * Either way `truncated` is set, so the loss is a fact the run can report
 * rather than a difference nobody can see.
 */
export async function saveScanCheckpoint(
  prisma: PrismaClient,
  input: SaveCheckpointInput,
): Promise<void> {
  const bounded = boundedState(input.state);
  const payloadJson = serializeWithinLimit(bounded);
  const expiresAt = new Date(
    input.now.getTime() + SCAN_CHECKPOINT_LIMITS.expiryDays * 24 * 60 * 60 * 1000,
  );
  const data = {
    accountId: input.accountId,
    schemaVersion: bounded.schemaVersion,
    stage: bounded.stage,
    payloadJson,
    sizeBytes: Buffer.byteLength(payloadJson, 'utf8'),
    expiresAt,
  };
  await prisma.scanCheckpoint.upsert({
    where: { scanId: input.scanId },
    create: { scanId: input.scanId, ...data },
    update: data,
  });
}

/** The checkpoint of a scan, or null when there is none it may still use. */
export async function loadScanCheckpoint(
  prisma: PrismaClient,
  scanId: string,
  now: Date,
): Promise<ScanCheckpointState | null> {
  const row = await prisma.scanCheckpoint.findUnique({ where: { scanId } });
  if (row === null) return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    // An expired checkpoint is not a usable one. It is left for the retention
    // sweep rather than deleted here: a read path must not write.
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payloadJson);
  } catch {
    return null;
  }
  const result = scanCheckpointPayloadSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export async function clearScanCheckpoint(prisma: PrismaClient, scanId: string): Promise<void> {
  await prisma.scanCheckpoint.deleteMany({ where: { scanId } });
}

/** Removes checkpoints nobody resumed inside the retention window. */
export async function sweepExpiredCheckpoints(prisma: PrismaClient, now: Date): Promise<number> {
  const { count } = await prisma.scanCheckpoint.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  return count;
}

function boundedState(state: ScanCheckpointState): ScanCheckpointState {
  const frontier = state.crawl.frontier.slice(0, SCAN_CHECKPOINT_LIMITS.maxFrontierUrls);
  const unretained = state.crawl.unretained.slice(0, SCAN_CHECKPOINT_LIMITS.maxUnretainedUrls);
  const coverage = boundedCoverage(state.crawl.coverage);
  return {
    ...state,
    crawl: {
      ...state.crawl,
      frontier,
      unretained,
      coverage: coverage.value,
      truncated:
        state.crawl.truncated ||
        coverage.truncated ||
        frontier.length < state.crawl.frontier.length ||
        unretained.length < state.crawl.unretained.length,
    },
  };
}

function boundedCoverage(coverage: CrawlCheckpointCoverage): {
  readonly value: CrawlCheckpointCoverage;
  readonly truncated: boolean;
} {
  const cap = SCAN_CHECKPOINT_LIMITS.maxCoverageEntries;
  const variantEntries = Object.entries(coverage.urlVariants).slice(
    0,
    SCAN_CHECKPOINT_LIMITS.maxUrlVariantGroups,
  );
  const value: CrawlCheckpointCoverage = {
    skippedOverLimit: coverage.skippedOverLimit.slice(0, cap),
    blockedByRobots: coverage.blockedByRobots.slice(0, cap),
    errors: coverage.errors.slice(0, cap),
    rejectedSeeds: coverage.rejectedSeeds.slice(0, cap),
    urlVariants: Object.fromEntries(variantEntries),
  };
  const truncated =
    value.skippedOverLimit.length < coverage.skippedOverLimit.length ||
    value.blockedByRobots.length < coverage.blockedByRobots.length ||
    value.errors.length < coverage.errors.length ||
    value.rejectedSeeds.length < coverage.rejectedSeeds.length ||
    variantEntries.length < Object.keys(coverage.urlVariants).length;
  return { value, truncated };
}

/**
 * Serializes within the row limit, giving up the least valuable part first.
 *
 * The order is deliberate: coverage lists can be re-derived by crawling again,
 * the frontier and the unretained URLs only cost a re-read, and the stage list
 * cannot be recovered at all — running an AI stage twice charges the customer
 * twice. So the stage list is the one thing that is never dropped.
 */
function serializeWithinLimit(state: ScanCheckpointState): string {
  const full = JSON.stringify(state);
  if (Buffer.byteLength(full, 'utf8') <= SCAN_CHECKPOINT_LIMITS.maxBytes) return full;
  const withoutCoverage: ScanCheckpointState = {
    ...state,
    crawl: { ...state.crawl, coverage: EMPTY_CRAWL_COVERAGE, truncated: true },
  };
  const trimmed = JSON.stringify(withoutCoverage);
  if (Buffer.byteLength(trimmed, 'utf8') <= SCAN_CHECKPOINT_LIMITS.maxBytes) return trimmed;
  const indexOnly: ScanCheckpointState = {
    ...state,
    crawl: {
      ...EMPTY_CRAWL_CHECKPOINT,
      scannedUrlCount: state.crawl.scannedUrlCount,
      discoveredUrlCount: state.crawl.discoveredUrlCount,
      truncated: true,
      // Dropping the index costs a re-crawl of what was still queued; the pages
      // themselves are in the evidence store and are still restored, so what
      // was already counted must not be counted again with them.
      egressRecorded: state.crawl.egressRecorded,
    },
  };
  return JSON.stringify(indexOnly);
}
