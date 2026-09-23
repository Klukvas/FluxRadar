// The pages a paused scan already read.
//
// A checkpoint that remembered only the frontier would make "resume" a polite
// word for "start again": the pages read before the pause would be gone, and
// every site-level rule — duplicate titles, orphan pages, coverage — would then
// be computed over half a site while the report still said the whole one was
// scanned. So the snapshots are persisted, compressed, under hard bounds.
//
// The bounds are where the honesty lives. A page that does not fit is not
// stored, and its URL is handed back to the caller as *unretained*, which the
// resumed crawl puts back on its frontier. The one thing this module must never
// do is quietly treat a URL as done while its evidence is gone.

import { gunzipSync, gzipSync } from 'node:zlib';

import { SCAN_EVIDENCE_LIMITS } from '@fluxradar/contracts';
import {
  BLOCKED_REQUEST_REASONS,
  RENDER_FAILURE_REASONS,
  RESOURCE_UNVERIFIED_REASONS,
} from '@fluxradar/crawler';
import type { PageSnapshot, ResourceSnapshot } from '@fluxradar/crawler';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

const DAY_MS = 24 * 60 * 60 * 1000;

const redirectHopSchema = z.object({
  url: z.string(),
  status: z.number().int(),
  location: z.string(),
});

// The reasons are validated against the crawler's own lists, not accepted as
// free strings: these rows outlive the process that wrote them, and a stored
// value that has drifted must be rejected rather than reach the report wearing
// the union's type.
const blockedRequestSchema = z.object({
  url: z.string(),
  reason: z.enum(BLOCKED_REQUEST_REASONS),
});

const pageRenderingSchema = z.union([
  z.object({
    status: z.literal('Rendered'),
    subresourceCount: z.number().int().min(0),
    subresourceBytes: z.number().int().min(0),
    blocked: z.array(blockedRequestSchema),
    timingMs: z.number().int().min(0),
  }),
  z.object({
    status: z.literal('Unavailable'),
    reason: z.enum(RENDER_FAILURE_REASONS),
    detail: z.string(),
  }),
]);

/**
 * The stored form of a page.
 *
 * Validated on the way back in rather than trusted: these rows outlive the
 * process that wrote them, and a snapshot that has drifted from the current
 * shape must be dropped — and re-fetched — instead of reaching a rule.
 */
const storedPageSchema = z.object({
  requestedUrl: z.string(),
  normalizedUrl: z.string(),
  depth: z.number().int().min(0),
  finalUrl: z.string(),
  status: z.number().int(),
  headers: z.record(z.string(), z.string()),
  redirectChain: z.array(redirectHopSchema),
  html: z.string().nullable(),
  contentType: z.string().nullable(),
  timingMs: z.number().int().min(0),
  truncated: z.boolean(),
  fetchError: z.string().optional(),
  rendering: pageRenderingSchema.optional(),
});

/**
 * The stored form of one media probe.
 *
 * `unverifiedReason` is validated against the crawler's own list for the same
 * reason the render reasons are: a rule reads this field to decide whether a
 * resource carries a verdict at all, and an unrecognised value there would be
 * a penalty or an exemption nobody wrote.
 */
const storedResourceSchema = z.object({
  requestedUrl: z.string(),
  normalizedUrl: z.string(),
  finalUrl: z.string(),
  status: z.number().int(),
  contentType: z.string().nullable(),
  method: z.enum(['HEAD', 'GET']).optional(),
  timingMs: z.number().int().min(0),
  unverifiedReason: z.enum(RESOURCE_UNVERIFIED_REASONS).optional(),
  fetchError: z.string().optional(),
  referencedBy: z.string(),
});

/** A URL and the depth it was reached at — enough to put it back in a queue. */
export interface EvidenceUrl {
  readonly url: string;
  readonly depth: number;
}

export interface SaveResourcesInput {
  readonly scanId: string;
  readonly accountId: string;
  readonly resources: readonly ResourceSnapshot[];
  readonly now: Date;
}

export interface SaveEvidenceInput {
  readonly scanId: string;
  readonly accountId: string;
  readonly pages: readonly PageSnapshot[];
  readonly now: Date;
}

export interface SaveEvidenceResult {
  /**
   * Pages whose evidence is stored; a resumed scan will not re-read them.
   *
   * Counted from what the database actually wrote, not from what was intended:
   * a row the insert dropped is a page the resumed scan would otherwise treat
   * as done with nothing to show for it.
   */
  readonly retained: number;
  /**
   * Pages whose evidence did not fit. They are *not* lost: the caller puts
   * these back on the frontier, so the resumed scan reads them again.
   */
  readonly unretained: readonly EvidenceUrl[];
  readonly totalBytes: number;
}

/**
 * Replaces the stored evidence of one scan with the pages given.
 *
 * Replacing rather than appending keeps the store consistent with the single
 * attempt it describes: a resumed run re-reads the unretained URLs, so writing
 * the full page list again is also what removes rows for pages that are no
 * longer part of the crawl.
 */
export async function saveCrawlEvidence(
  prisma: PrismaClient,
  input: SaveEvidenceInput,
): Promise<SaveEvidenceResult> {
  const expiresAt = new Date(input.now.getTime() + SCAN_EVIDENCE_LIMITS.expiryDays * DAY_MS);
  const rows: Prisma.ScanCrawlPageCreateManyInput[] = [];
  const unretained: EvidenceUrl[] = [];
  const claimed = new Set<string>();
  let totalBytes = 0;

  for (const page of input.pages) {
    const payload = gzipSync(Buffer.from(JSON.stringify(page), 'utf8'));
    const overPageCap = payload.byteLength > SCAN_EVIDENCE_LIMITS.maxPageBytes;
    const overTotalCap = totalBytes + payload.byteLength > SCAN_EVIDENCE_LIMITS.maxTotalBytes;
    const overCountCap = rows.length >= SCAN_EVIDENCE_LIMITS.maxPages;
    // The store is keyed by (scanId, normalizedUrl). A second page under the
    // same key cannot be written, so it is reported as unretained rather than
    // counted as stored and silently dropped by the insert.
    if (overPageCap || overTotalCap || overCountCap || claimed.has(page.normalizedUrl)) {
      unretained.push({ url: page.requestedUrl, depth: page.depth });
      continue;
    }
    claimed.add(page.normalizedUrl);
    totalBytes += payload.byteLength;
    rows.push({
      scanId: input.scanId,
      accountId: input.accountId,
      normalizedUrl: page.normalizedUrl,
      // Insertion order, so a resumed crawl restores its pages in the order it
      // read them rather than in whatever order equal timestamps come back in.
      ordinal: rows.length,
      payload: Uint8Array.from(payload),
      sizeBytes: payload.byteLength,
      expiresAt,
    });
  }

  // One transaction: a crash between the delete and the inserts would leave the
  // scan with fewer pages than its checkpoint accounts for, and the difference
  // would be read as "these URLs were done" with nothing to show for them.
  const retained = await prisma.$transaction(async (tx) => {
    await tx.scanCrawlPage.deleteMany({ where: { scanId: input.scanId } });
    let written = 0;
    for (let offset = 0; offset < rows.length; offset += SCAN_EVIDENCE_LIMITS.writeBatchSize) {
      const { count } = await tx.scanCrawlPage.createMany({
        data: rows.slice(offset, offset + SCAN_EVIDENCE_LIMITS.writeBatchSize),
      });
      written += count;
    }
    return written;
  });
  return { retained, unretained, totalBytes };
}

/**
 * The pages a resumed scan may use without asking the site again.
 *
 * A row that no longer parses is skipped rather than repaired: the URL it
 * describes is not in the caller's restored set, so the crawl fetches it. That
 * is the safe direction to fail in — an extra request, never invented evidence.
 */
export async function loadCrawlEvidence(
  prisma: PrismaClient,
  scanId: string,
  now: Date,
): Promise<readonly PageSnapshot[]> {
  const rows = await prisma.scanCrawlPage.findMany({
    where: { scanId, expiresAt: { gt: now } },
    // `createdAt` is identical across a batched insert, so it cannot order the
    // rows on its own; the ordinal is the crawl order, and the id is a stable
    // tie-break for rows written before the ordinal existed.
    orderBy: [{ ordinal: 'asc' }, { id: 'asc' }],
  });
  const pages: PageSnapshot[] = [];
  for (const row of rows) {
    const page = decodePage(row.payload);
    if (page !== null) pages.push(page);
  }
  return pages;
}

export async function clearCrawlEvidence(prisma: PrismaClient, scanId: string): Promise<void> {
  await prisma.scanCrawlPage.deleteMany({ where: { scanId } });
  await prisma.scanCrawlResourceSet.deleteMany({ where: { scanId } });
}

/** Removes evidence of scans nobody resumed inside the retention window. */
export async function sweepExpiredCrawlEvidence(prisma: PrismaClient, now: Date): Promise<number> {
  const pages = await prisma.scanCrawlPage.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  const resources = await prisma.scanCrawlResourceSet.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  return pages.count + resources.count;
}

/**
 * Stores what a scan learned about the media its pages reference.
 *
 * Probing media is the one part of a crawl that costs requests *after* the
 * pages are in, so without this a resume re-issued the whole set — up to
 * MEDIA_PROBE_LIMITS.maxProbes requests to the owner's server for answers the
 * interrupted attempt already had. Returns how many entries were kept: a set
 * that does not fit is simply not stored, and the resumed scan probes again.
 */
export async function saveCrawlResources(
  prisma: PrismaClient,
  input: SaveResourcesInput,
): Promise<number> {
  if (input.resources.length === 0) {
    await prisma.scanCrawlResourceSet.deleteMany({ where: { scanId: input.scanId } });
    return 0;
  }
  const payload = gzipSync(Buffer.from(JSON.stringify(input.resources), 'utf8'));
  if (payload.byteLength > SCAN_EVIDENCE_LIMITS.maxResourceBytes) {
    await prisma.scanCrawlResourceSet.deleteMany({ where: { scanId: input.scanId } });
    return 0;
  }
  const data = {
    accountId: input.accountId,
    payload: Uint8Array.from(payload),
    sizeBytes: payload.byteLength,
    count: input.resources.length,
    expiresAt: new Date(input.now.getTime() + SCAN_EVIDENCE_LIMITS.expiryDays * DAY_MS),
  };
  await prisma.scanCrawlResourceSet.upsert({
    where: { scanId: input.scanId },
    create: { scanId: input.scanId, ...data },
    update: data,
  });
  return input.resources.length;
}

/**
 * The media probes a resumed scan may reuse.
 *
 * A row that no longer parses yields nothing, exactly as a page does: the
 * resumed scan then probes again, which costs requests but never invents a
 * verdict about somebody's image.
 */
export async function loadCrawlResources(
  prisma: PrismaClient,
  scanId: string,
  now: Date,
): Promise<readonly ResourceSnapshot[]> {
  const row = await prisma.scanCrawlResourceSet.findUnique({ where: { scanId } });
  if (row === null || row.expiresAt.getTime() <= now.getTime()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(gunzipSync(Buffer.from(row.payload)).toString('utf8'));
  } catch {
    return [];
  }
  const result = z.array(storedResourceSchema).safeParse(parsed);
  return result.success ? result.data : [];
}

function decodePage(payload: Uint8Array): PageSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(gunzipSync(Buffer.from(payload)).toString('utf8'));
  } catch {
    return null;
  }
  const result = storedPageSchema.safeParse(parsed);
  // No cast: the schema now validates the same unions the type declares, so a
  // row that does not match is rejected here instead of being asserted into
  // shape and reaching a rule.
  return result.success ? result.data : null;
}
