import { randomUUID } from 'node:crypto';
import { SCAN_CHECKPOINT_LIMITS, SCAN_EVIDENCE_LIMITS } from '@fluxradar/contracts';
import type { PageSnapshot, ResourceSnapshot } from '@fluxradar/crawler';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JOB_STATUSES } from '../billing/constants.ts';
import { sweepExpiredCheckpoints } from './checkpoint.ts';
import {
  EMPTY_CRAWL_COVERAGE,
  clearScanCheckpoint,
  loadScanCheckpoint,
  saveScanCheckpoint,
  type ScanCheckpointState,
} from './checkpoint.ts';
import {
  clearCrawlEvidence,
  loadCrawlEvidence,
  loadCrawlResources,
  saveCrawlEvidence,
  saveCrawlResources,
  sweepExpiredCrawlEvidence,
} from './crawl-store.ts';
import { CrawlProgressWriter } from './crawl-progress.ts';
import { deleteAccountData } from '../data-retention.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedScan,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';

// What an interrupted run keeps so the attempt that continues it does not read
// the site or pay for a stage twice: the checkpoint, the stored pages and media
// probes, and the URL counters a resumed crawl writes.

let db: TestDb;
let account: SeededAccount;

beforeEach(async () => {
  db = await createTestDb();
  account = await seedAccountWithProfile(db.prisma);
});

afterEach(async () => {
  await db.cleanup();
});

async function seedWithJob(status: 'Pending' | 'Queued' | 'Running') {
  const { scan, purchase } = await seedScan(db.prisma, { account, status, plan: 'Complete' });
  await db.prisma.job.create({
    data: { scanId: scan.id, type: 'scan', status: JOB_STATUSES.pending },
  });
  return { scan, purchase };
}

function checkpoint(overrides: Partial<ScanCheckpointState> = {}): ScanCheckpointState {
  return {
    schemaVersion: 2,
    stage: 'SEO',
    completedStages: ['crawl', 'SEO'],
    crawl: {
      frontier: [{ url: 'https://example.com/next', depth: 1 }],
      unretained: [],
      scannedUrlCount: 1,
      discoveredUrlCount: 2,
      coverage: {
        skippedOverLimit: ['https://example.com/over-limit'],
        blockedByRobots: ['https://example.com/private/x'],
        errors: [{ url: 'https://example.com/boom', reason: 'timeout' }],
        rejectedSeeds: [],
        urlVariants: { 'https://example.com/dup': ['https://example.com/dup?a=1'] },
      },
      truncated: false,
      egressRecorded: false,
    },
    ...overrides,
  };
}

function snapshot(path: string, html: string, depth = 0): PageSnapshot {
  const url = `https://example.com${path}`;
  return {
    requestedUrl: url,
    normalizedUrl: url,
    depth,
    finalUrl: url,
    status: 200,
    headers: { 'content-type': 'text/html' },
    redirectChain: [],
    html,
    contentType: 'text/html; charset=utf-8',
    timingMs: 4,
    truncated: false,
  };
}

describe('the URL counters a resumed crawl writes', () => {
  // The crawler counts its restored pages in its own page list, so the numbers
  // it reports are already absolute. Adding the restored count on top of them
  // told the owner more pages had been read than the plan's limit allows, and
  // the inflated value was then written into the checkpoint the next resume
  // started from.
  it('does not count a restored page twice', async () => {
    const { scan } = await seedWithJob('Running');
    const writer = new CrawlProgressWriter(db.prisma, scan.id, 2, 5);

    expect(writer.counts()).toEqual({ scanned: 2, discovered: 5 });
    // Two restored pages plus four read after the resume: the crawler reports
    // six read out of nine known, not "four more on top of two".
    writer.record(6, 9);

    expect(writer.counts()).toEqual({ scanned: 6, discovered: 9 });
    await writer.flush();
    const row = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(row.scannedUrlCount).toBe(6);
    expect(row.discoveredUrlCount).toBe(9);
  });

  it('never reports fewer discovered URLs than a previous attempt already knew', async () => {
    const { scan } = await seedWithJob('Running');
    const writer = new CrawlProgressWriter(db.prisma, scan.id, 3, 20);

    writer.record(4, 6);

    expect(writer.counts()).toEqual({ scanned: 4, discovered: 20 });
  });
});

describe('the media probes an interrupted scan keeps', () => {
  const probe = (path: string, status: number): ResourceSnapshot => ({
    requestedUrl: `https://example.com${path}`,
    normalizedUrl: `https://example.com${path}`,
    finalUrl: `https://example.com${path}`,
    status,
    contentType: 'image/png',
    method: 'HEAD',
    timingMs: 3,
    referencedBy: 'https://example.com/',
  });

  it('round-trips what was probed, so a resume does not ask the site again', async () => {
    const { scan } = await seedWithJob('Running');
    const resources = [probe('/a.png', 200), probe('/b.png', 404)];

    const stored = await saveCrawlResources(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      resources,
      now: new Date(),
    });

    expect(stored).toBe(2);
    await expect(loadCrawlResources(db.prisma, scan.id, new Date())).resolves.toEqual(resources);
  });

  it('is not offered once expired, and goes away with the rest of the evidence', async () => {
    const { scan } = await seedWithJob('Running');
    const issued = new Date('2026-01-01T00:00:00.000Z');
    await saveCrawlResources(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      resources: [probe('/a.png', 200)],
      now: issued,
    });
    const afterExpiry = new Date(
      issued.getTime() + (SCAN_EVIDENCE_LIMITS.expiryDays + 1) * 24 * 60 * 60 * 1000,
    );

    await expect(loadCrawlResources(db.prisma, scan.id, afterExpiry)).resolves.toEqual([]);
    await expect(sweepExpiredCrawlEvidence(db.prisma, afterExpiry)).resolves.toBeGreaterThan(0);

    await saveCrawlResources(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      resources: [probe('/a.png', 200)],
      now: new Date(),
    });
    await clearCrawlEvidence(db.prisma, scan.id);
    await expect(db.prisma.scanCrawlResourceSet.count()).resolves.toBe(0);
  });
});

describe('the checkpoint an interrupted scan leaves', () => {
  it('round-trips the stages a resumed attempt must not repeat', async () => {
    const { scan } = await seedWithJob('Running');
    const now = new Date();

    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: checkpoint(),
      now,
    });

    const loaded = await loadScanCheckpoint(db.prisma, scan.id, now);
    expect(loaded?.completedStages).toEqual(['crawl', 'SEO']);
    expect(loaded?.crawl.frontier).toEqual([{ url: 'https://example.com/next', depth: 1 }]);
  });

  // Coverage is the half of a crawl that leaves no trace in anyone's HTML: a
  // URL over the tariff limit and a URL robots closed cannot be re-derived from
  // the pages that were read.
  it('carries the coverage a resumed crawl cannot rediscover', async () => {
    const { scan } = await seedWithJob('Running');
    const now = new Date();

    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: checkpoint(),
      now,
    });

    const loaded = await loadScanCheckpoint(db.prisma, scan.id, now);
    expect(loaded?.crawl.coverage.skippedOverLimit).toEqual(['https://example.com/over-limit']);
    expect(loaded?.crawl.coverage.blockedByRobots).toEqual(['https://example.com/private/x']);
    expect(loaded?.crawl.coverage.errors).toEqual([
      { url: 'https://example.com/boom', reason: 'timeout' },
    ]);
    expect(loaded?.crawl.coverage.urlVariants).toEqual({
      'https://example.com/dup': ['https://example.com/dup?a=1'],
    });
  });

  // Version 1 stored no page evidence, so honouring it would mean resuming with
  // the earlier pages silently missing.
  it('refuses a payload written by the previous checkpoint format', async () => {
    const { scan } = await seedWithJob('Running');
    await db.prisma.scanCheckpoint.create({
      data: {
        id: randomUUID(),
        scanId: scan.id,
        accountId: account.accountId,
        schemaVersion: 1,
        stage: 'SEO',
        payloadJson: JSON.stringify({
          schemaVersion: 1,
          stage: 'SEO',
          completedStages: ['crawl'],
          crawl: {
            frontier: [],
            visited: ['https://example.com/'],
            scannedUrlCount: 1,
            discoveredUrlCount: 1,
            truncated: false,
          },
        }),
        sizeBytes: 100,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect(await loadScanCheckpoint(db.prisma, scan.id, new Date())).toBeNull();
  });

  // The checkpoints already parked in production were written before the egress
  // flag existed, so their payload has no such field at all. Refusing them would
  // throw away the work of every scan paused at deploy time; reading the missing
  // field as false counts those bytes once more rather than never at all.
  it('accepts a payload written before the egress flag, and reads it as nothing counted', async () => {
    const { scan } = await seedWithJob('Running');
    const payloadJson = JSON.stringify(checkpoint(), (key, value) =>
      key === 'egressRecorded' ? undefined : value,
    );
    expect(payloadJson).not.toContain('egressRecorded');
    await db.prisma.scanCheckpoint.create({
      data: {
        id: randomUUID(),
        scanId: scan.id,
        accountId: account.accountId,
        schemaVersion: 2,
        stage: 'SEO',
        payloadJson,
        sizeBytes: Buffer.byteLength(payloadJson, 'utf8'),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const loaded = await loadScanCheckpoint(db.prisma, scan.id, new Date());
    expect(loaded).not.toBeNull();
    expect(loaded?.crawl.egressRecorded).toBe(false);
    // The rest of the payload is honoured, not discarded along with the field it
    // does not have: this is a resume, not a fresh attempt.
    expect(loaded?.completedStages).toEqual(['crawl', 'SEO']);
    expect(loaded?.crawl.frontier).toEqual([{ url: 'https://example.com/next', depth: 1 }]);
  });

  it('bounds what it stores, and says it was truncated', async () => {
    const { scan } = await seedWithJob('Running');
    const frontier = Array.from(
      { length: SCAN_CHECKPOINT_LIMITS.maxFrontierUrls + 50 },
      (_entry, index) => ({ url: `https://example.com/${index}`, depth: 1 }),
    );

    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: checkpoint({ crawl: { ...checkpoint().crawl, frontier } }),
      now: new Date(),
    });

    const row = await db.prisma.scanCheckpoint.findUniqueOrThrow({ where: { scanId: scan.id } });
    expect(row.sizeBytes).toBeLessThanOrEqual(SCAN_CHECKPOINT_LIMITS.maxBytes);
    const loaded = await loadScanCheckpoint(db.prisma, scan.id, new Date());
    expect(loaded?.crawl.truncated).toBe(true);
    // Whatever had to be dropped, the stage list is what protects paid work.
    expect(loaded?.completedStages).toEqual(['crawl', 'SEO']);
  });

  // The last resort inside the byte bound keeps the counters and drops the index
  // — but the pages are in the evidence store, not in the index, so a resume
  // still gets them back. What their bytes already cost has to come back too.
  it('keeps the egress flag when the byte bound leaves nothing but the counters', async () => {
    const { scan } = await seedWithJob('Running');
    // The count bound alone cannot force this branch: 2000 frontier entries are
    // allowed, so the megabyte is reached through the length of each URL — and
    // dropping coverage first cannot bring a frontier this long inside it.
    const longPath = 'p'.repeat(600);
    const frontier = Array.from(
      { length: SCAN_CHECKPOINT_LIMITS.maxFrontierUrls },
      (_entry, index) => ({ url: `https://example.com/${index}/${longPath}`, depth: 1 }),
    );

    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: checkpoint({ crawl: { ...checkpoint().crawl, frontier, egressRecorded: true } }),
      now: new Date(),
    });

    const row = await db.prisma.scanCheckpoint.findUniqueOrThrow({ where: { scanId: scan.id } });
    expect(row.sizeBytes).toBeLessThanOrEqual(SCAN_CHECKPOINT_LIMITS.maxBytes);
    const loaded = await loadScanCheckpoint(db.prisma, scan.id, new Date());
    // The index is gone — which is what makes this the index-only branch and not
    // the one above it — and the counters and the stage list stayed.
    expect(loaded?.crawl.frontier).toEqual([]);
    expect(loaded?.crawl.coverage).toEqual(EMPTY_CRAWL_COVERAGE);
    expect(loaded?.crawl.truncated).toBe(true);
    expect(loaded?.crawl.scannedUrlCount).toBe(1);
    expect(loaded?.crawl.discoveredUrlCount).toBe(2);
    expect(loaded?.completedStages).toEqual(['crawl', 'SEO']);
    // The pages this checkpoint's scan read were counted against its egress
    // location once. The resumed attempt gets them back and must not book them.
    expect(loaded?.crawl.egressRecorded).toBe(true);
  });

  it('is not offered once it has expired, and the sweep removes it', async () => {
    const { scan } = await seedWithJob('Running');
    const issued = new Date('2026-01-01T00:00:00.000Z');
    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: checkpoint(),
      now: issued,
    });
    const afterExpiry = new Date(
      issued.getTime() + (SCAN_CHECKPOINT_LIMITS.expiryDays + 1) * 24 * 60 * 60 * 1000,
    );

    expect(await loadScanCheckpoint(db.prisma, scan.id, afterExpiry)).toBeNull();
    await expect(sweepExpiredCheckpoints(db.prisma, afterExpiry)).resolves.toBe(1);
    await expect(db.prisma.scanCheckpoint.count()).resolves.toBe(0);
  });

  it('is removed with the account that owned it', async () => {
    const { scan } = await seedWithJob('Running');
    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: checkpoint(),
      now: new Date(),
    });

    await deleteAccountData(db.prisma, account.accountId, null);

    await expect(db.prisma.scanCheckpoint.count()).resolves.toBe(0);
  });

  it('is cleared explicitly when a run settles', async () => {
    const { scan } = await seedWithJob('Running');
    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: checkpoint(),
      now: new Date(),
    });

    await clearScanCheckpoint(db.prisma, scan.id);

    await expect(db.prisma.scanCheckpoint.count()).resolves.toBe(0);
  });

  it('ignores a payload that does not parse rather than resuming from nonsense', async () => {
    const { scan } = await seedWithJob('Running');
    await db.prisma.scanCheckpoint.create({
      data: {
        scanId: scan.id,
        accountId: account.accountId,
        stage: 'SEO',
        payloadJson: '{not json',
        sizeBytes: 9,
        expiresAt: new Date(Date.now() + 60_000),
        id: randomUUID(),
      },
    });

    expect(await loadScanCheckpoint(db.prisma, scan.id, new Date())).toBeNull();
  });
});

describe('the pages an interrupted scan keeps', () => {
  it('round-trips a page snapshot, body and all', async () => {
    const { scan } = await seedWithJob('Running');
    const page = snapshot('/', '<html><head><title>Home</title></head><body>Hello</body></html>');

    const saved = await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages: [page],
      now: new Date(),
    });

    expect(saved).toMatchObject({ retained: 1, unretained: [] });
    const restored = await loadCrawlEvidence(db.prisma, scan.id, new Date());
    expect(restored).toEqual([page]);
  });

  // The failure this prevents is a resume that reports fewer pages than it
  // scanned. A page that does not fit is handed back as a URL to read again.
  it('hands back the URL of a page too large to store, rather than losing it', async () => {
    const { scan } = await seedWithJob('Running');
    // Random text so gzip cannot shrink it under the per-page cap.
    const incompressible = Array.from({ length: SCAN_EVIDENCE_LIMITS.maxPageBytes * 2 }, () =>
      String.fromCharCode(33 + Math.floor(Math.random() * 90)),
    ).join('');

    const saved = await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages: [
        snapshot('/small', '<html><body>ok</body></html>'),
        snapshot('/huge', incompressible, 2),
      ],
      now: new Date(),
    });

    expect(saved.retained).toBe(1);
    expect(saved.unretained).toEqual([{ url: 'https://example.com/huge', depth: 2 }]);
  });

  it('stops at the page count bound and reports the remainder as unretained', async () => {
    const { scan } = await seedWithJob('Running');
    const pages = Array.from({ length: SCAN_EVIDENCE_LIMITS.maxPages + 3 }, (_entry, index) =>
      snapshot(`/page-${index}`, '<html><body>x</body></html>'),
    );

    const saved = await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages,
      now: new Date(),
    });

    expect(saved.retained).toBe(SCAN_EVIDENCE_LIMITS.maxPages);
    expect(saved.unretained).toHaveLength(3);
  });

  // `retained` decides how many URLs the resumed scan treats as done. A page
  // the insert could not write — the store is keyed by (scan, URL) — must be
  // handed back as unretained, not counted as stored and quietly dropped.
  it('does not count a page it could not store, and hands the URL back', async () => {
    const { scan } = await seedWithJob('Running');
    const page = snapshot('/same', '<html><body>first</body></html>');

    const saved = await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages: [page, { ...page, html: '<html><body>second</body></html>' }],
      now: new Date(),
    });

    expect(saved.retained).toBe(1);
    expect(saved.unretained).toEqual([{ url: 'https://example.com/same', depth: 0 }]);
    await expect(db.prisma.scanCrawlPage.count({ where: { scanId: scan.id } })).resolves.toBe(1);
  });

  it('restores the pages in the order the crawl read them', async () => {
    const { scan } = await seedWithJob('Running');
    const pages = Array.from({ length: 12 }, (_entry, index) =>
      snapshot(`/page-${index}`, `<html><body>${index}</body></html>`, index % 3),
    );

    await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages,
      now: new Date(),
    });

    const restored = await loadCrawlEvidence(db.prisma, scan.id, new Date());
    expect(restored.map((page) => page.normalizedUrl)).toEqual(
      pages.map((page) => page.normalizedUrl),
    );
  });

  it('replaces the previous attempt’s pages instead of stacking them', async () => {
    const { scan } = await seedWithJob('Running');
    const now = new Date();
    const input = { scanId: scan.id, accountId: account.accountId, now };

    await saveCrawlEvidence(db.prisma, { ...input, pages: [snapshot('/a', '<html>a</html>')] });
    await saveCrawlEvidence(db.prisma, {
      ...input,
      pages: [snapshot('/a', '<html>a</html>'), snapshot('/b', '<html>b</html>')],
    });

    await expect(db.prisma.scanCrawlPage.count()).resolves.toBe(2);
  });

  it('is not offered once expired, and the sweep removes it', async () => {
    const { scan } = await seedWithJob('Running');
    const issued = new Date('2026-01-01T00:00:00.000Z');
    await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages: [snapshot('/', '<html>home</html>')],
      now: issued,
    });
    const afterExpiry = new Date(
      issued.getTime() + (SCAN_EVIDENCE_LIMITS.expiryDays + 1) * 24 * 60 * 60 * 1000,
    );

    expect(await loadCrawlEvidence(db.prisma, scan.id, afterExpiry)).toEqual([]);
    await expect(sweepExpiredCrawlEvidence(db.prisma, afterExpiry)).resolves.toBe(1);
  });

  it('ignores a stored payload that no longer parses', async () => {
    const { scan } = await seedWithJob('Running');
    await db.prisma.scanCrawlPage.create({
      data: {
        id: randomUUID(),
        scanId: scan.id,
        accountId: account.accountId,
        normalizedUrl: 'https://example.com/broken',
        payload: new Uint8Array([1, 2, 3, 4]),
        sizeBytes: 4,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect(await loadCrawlEvidence(db.prisma, scan.id, new Date())).toEqual([]);
  });

  it('goes away with the account, and on demand', async () => {
    const { scan } = await seedWithJob('Running');
    await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages: [snapshot('/', '<html>home</html>')],
      now: new Date(),
    });

    await clearCrawlEvidence(db.prisma, scan.id);
    await expect(db.prisma.scanCrawlPage.count()).resolves.toBe(0);

    await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages: [snapshot('/', '<html>home</html>')],
      now: new Date(),
    });
    await deleteAccountData(db.prisma, account.accountId, null);
    await expect(db.prisma.scanCrawlPage.count()).resolves.toBe(0);
  });
});
