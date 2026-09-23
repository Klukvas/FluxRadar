import { RULESET_VERSION, scanScopeSchema, type ScanScopeInput } from '@fluxradar/contracts';
import type { CrawlFetchInit, RenderRuntimeResult } from '@fluxradar/crawler';
import { startFixtureSite, type FixtureSite } from '@fluxradar/crawler';
import { HostLimiter, safeFetch } from '@fluxradar/safe-fetch';
import type { Scan, ScanModule } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { silentLogger } from '../http/logger.ts';
import { EMPTY_CRAWL_COVERAGE, saveScanCheckpoint } from '../orchestrator/checkpoint.ts';
import { saveCrawlEvidence } from '../orchestrator/crawl-store.ts';
import type { WorkerDeps } from '../orchestrator/deps.ts';
import { createDefaultAiProvider } from '../orchestrator/geo.ts';
import { requestScanPause, resumeScan } from '../orchestrator/pause.ts';
import { runScanAttempt } from '../orchestrator/run-attempt.ts';
import { processScan } from '../orchestrator/worker.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';

// A real Complete scan of the local fixture site, driven through the worker.
//
// These are the acceptance checks for the four crawl-side features: the seed
// list is actually crawled, the configured API endpoints are actually called
// and land in the Reliability section, a requested render that has no runtime
// is reported as unavailable instead of being faked, and a resumed attempt does
// not re-run the stages a previous one finished.

const AI_MODULES = ['AI SEO / GEO', 'UX/Conversion'];

let db: TestDb;
let account: SeededAccount;
let fixture: FixtureSite;

beforeAll(async () => {
  fixture = await startFixtureSite();
});

afterAll(async () => {
  await fixture.close();
});

beforeEach(async () => {
  db = await createTestDb();
  account = await seedAccountWithProfile(db.prisma);
});

afterEach(async () => {
  await db.cleanup();
});

function scopeWith(overrides: Record<string, unknown>): ScanScopeInput {
  return scanScopeSchema.parse({
    includeSubdomains: false,
    maxPages: 6,
    maxDepth: 1,
    ...overrides,
  });
}

/** A paid-plan scan with no purchase: the billing gate is not what is under test. */
async function seedCompleteScan(scope: ScanScopeInput): Promise<Scan> {
  const scan = await db.prisma.scan.create({
    data: {
      accountId: account.accountId,
      siteProfileId: account.siteProfileId,
      plan: 'Complete',
      domain: account.domain,
      status: 'Pending',
      scopeJson: JSON.stringify(scope),
      rulesetVersion: RULESET_VERSION,
    },
  });
  await db.prisma.job.create({ data: { scanId: scan.id, type: 'scan', status: 'Pending' } });
  return scan;
}

function deps(overrides: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    prisma: db.prisma,
    logger: silentLogger,
    createAiProvider: (scan, profile) =>
      createDefaultAiProvider(profile.name, new URL(scan.domain).hostname),
    crawl: {
      originOverride: () => fixture.origin,
      dangerouslyAllowLoopback: true,
      limiter: new HostLimiter({ rps: 1000, concurrency: 4 }),
    },
    ...overrides,
  };
}

/** The transport the worker would have built for itself, for tests that wrap it. */
function realFetch(url: string, init?: CrawlFetchInit) {
  return safeFetch(url, {
    headers: { 'user-agent': 'FluxRadarBot/0.1' },
    dangerouslyAllowLoopback: true,
    ...(init?.method !== undefined ? { method: init.method } : {}),
    ...(init?.maxBodyBytes !== undefined ? { maxBodyBytes: init.maxBodyBytes } : {}),
    ...(init?.timeoutMs !== undefined ? { timeoutMs: init.timeoutMs } : {}),
  });
}

async function moduleRow(scanId: string, module: string): Promise<ScanModule> {
  return db.prisma.scanModule.findFirstOrThrow({ where: { scanId, module } });
}

function metadataOf(row: ScanModule): Record<string, unknown> {
  return JSON.parse(row.metadataJson) as Record<string, unknown>;
}

describe('explicit seed URLs', () => {
  it('reads a page that nothing links to', async () => {
    // maxDepth 0 means discovery finds only the homepage, so a page that turns
    // up can only have come from the seed list.
    const scan = await seedCompleteScan(
      scopeWith({ maxDepth: 0, seedUrls: [`${fixture.origin}/deep/level2/page.html`] }),
    );

    await processScan(deps(), scan.id);

    const issueUrls = await db.prisma.issue.findMany({
      where: { scanId: scan.id },
      select: { normalizedUrl: true },
    });
    const urls = new Set(issueUrls.map((issue) => issue.normalizedUrl));
    expect([...urls].some((url) => url.includes('/deep/level2/page.html'))).toBe(true);
  });

  it('records how far the scan actually got, in URLs', async () => {
    const scan = await seedCompleteScan(scopeWith({}));

    await processScan(deps(), scan.id);

    const finished = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(finished.scannedUrlCount).toBeGreaterThan(0);
    expect(finished.discoveredUrlCount).toBeGreaterThanOrEqual(finished.scannedUrlCount);
  });
});

describe('configured API checks', () => {
  it('calls the endpoints and records each outcome on the Reliability section', async () => {
    const scan = await seedCompleteScan(
      scopeWith({
        maxDepth: 0,
        apiChecks: [
          { method: 'GET', url: `${fixture.origin}/index.html`, expectedStatus: [200] },
          { method: 'GET', url: `${fixture.origin}/does-not-exist.html`, expectedStatus: [200] },
        ],
      }),
    );

    await processScan(deps(), scan.id);

    const reliability = await moduleRow(scan.id, 'Reliability');
    const apiChecks = metadataOf(reliability).apiChecks as readonly Record<string, unknown>[];
    expect(apiChecks).toHaveLength(2);
    expect(apiChecks[0]).toMatchObject({ status: 200 });
    expect(apiChecks[1]).toMatchObject({ status: 404 });
    // The unexpected status is a finding of the rule, not a note in metadata.
    const findings = await db.prisma.issue.findMany({
      where: { scanId: scan.id, ruleId: 'REL-API-003' },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetUrl).toContain('/does-not-exist.html');
  });

  it('does not call an endpoint on another site', async () => {
    const scan = await seedCompleteScan(
      scopeWith({
        maxDepth: 0,
        apiChecks: [{ method: 'GET', url: 'https://somewhere-else.example/api' }],
      }),
    );

    await processScan(deps(), scan.id);

    const reliability = await moduleRow(scan.id, 'Reliability');
    const apiChecks = metadataOf(reliability).apiChecks as readonly Record<string, unknown>[];
    expect(apiChecks[0]).toMatchObject({ status: null, skippedReason: 'OutsideScannedSite' });
  });
});

describe('JS rendering', () => {
  it('reports unavailable rather than passing static HTML off as a rendered page', async () => {
    const unavailable: RenderRuntimeResult = {
      kind: 'unavailable',
      reason: 'RuntimeNotInstalled',
      detail: 'playwright is not installed in this deployment',
    };
    const scan = await seedCompleteScan(scopeWith({ maxDepth: 0, renderJs: true }));

    await processScan(deps({ createRenderRuntime: () => Promise.resolve(unavailable) }), scan.id);

    const seo = metadataOf(await moduleRow(scan.id, 'SEO'));
    expect(seo.javascriptRendering).toBe('Unavailable');
    expect(seo.javascriptRenderingReason).toBe('RuntimeNotInstalled');
    expect(seo.clientRenderedMarkup).toContain('not verifiable');
  });

  it('says nothing about rendering when it was never asked for', async () => {
    const scan = await seedCompleteScan(scopeWith({ maxDepth: 0 }));

    await processScan(deps(), scan.id);

    expect(metadataOf(await moduleRow(scan.id, 'SEO')).javascriptRendering).toBe('not requested');
  });

  it('records the engine and page counts when a runtime is available', async () => {
    const rendered =
      '<!doctype html><html lang="en"><head><title>Rendered fixture page</title>' +
      '<meta name="description" content="A description long enough to be a real one for the check.">' +
      '</head><body><h1>Rendered</h1><p>Body text.</p></body></html>';
    const runtime: RenderRuntimeResult = {
      kind: 'ready',
      runtime: {
        engine: 'stub',
        version: '1.0',
        render: () =>
          Promise.resolve({
            kind: 'rendered',
            html: rendered,
            subresourceCount: 1,
            subresourceBytes: 10,
            blocked: [],
            timingMs: 3,
          }),
        close: () => Promise.resolve(),
      },
    };
    const scan = await seedCompleteScan(scopeWith({ maxDepth: 0, renderJs: true }));

    await processScan(deps({ createRenderRuntime: () => Promise.resolve(runtime) }), scan.id);

    const seo = metadataOf(await moduleRow(scan.id, 'SEO'));
    expect(seo.javascriptRendering).toBe('Rendered');
    expect(seo.renderEngine).toBe('stub 1.0');
    expect(seo.renderedPages).toBe(1);
    // The rules read the rendered DOM: the fixture homepage has no such title.
    const titles = await db.prisma.issue.count({
      where: { scanId: scan.id, ruleId: 'SEO-ONPAGE-001' },
    });
    expect(titles).toBe(0);
  });
});

describe('pause and resume of a real run', () => {
  it('stops before any outbound work when the pause arrives first', async () => {
    const scan = await seedCompleteScan(scopeWith({}));
    await requestScanPause(db.prisma, scan.id, new Date());

    const result = await processScan(deps(), scan.id);

    expect(result.outcome).toBe('Paused');
    const paused = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(paused.status).toBe('Paused');
    // Nothing ran, so nothing was written and nothing was charged for.
    await expect(db.prisma.issue.count({ where: { scanId: scan.id } })).resolves.toBe(0);
    await expect(db.prisma.scan.count()).resolves.toBe(1);
    await expect(db.prisma.job.count()).resolves.toBe(1);
  });

  it('resumes the same scan and job, and completes it', async () => {
    const scan = await seedCompleteScan(scopeWith({ maxDepth: 0 }));
    await requestScanPause(db.prisma, scan.id, new Date());
    await processScan(deps(), scan.id);

    await resumeScan(db.prisma, scan.id, new Date());
    const result = await processScan(deps(), scan.id);

    expect(['Completed', 'Partial']).toContain(result.outcome);
    await expect(db.prisma.scan.count()).resolves.toBe(1);
    await expect(db.prisma.job.count()).resolves.toBe(1);
    await expect(db.prisma.purchase.count()).resolves.toBe(0);
    // A settled run has nothing left to resume from.
    await expect(db.prisma.scanCheckpoint.count()).resolves.toBe(0);
  });

  // A pause in the middle of a crawl is the case a frontier-only checkpoint got
  // wrong: the pages already read were gone, so "resume" quietly meant
  // "re-crawl", and every site-level rule then judged half a site.
  it('keeps the pages it had already read, and does not ask for them again', async () => {
    const scan = await seedCompleteScan(scopeWith({ maxPages: 6, maxDepth: 2 }));
    let pauseAfter = 2;
    const requested: string[] = [];
    const pausingDeps = deps({
      // A fixture crawl finishes in milliseconds, so the attempt has to be
      // asking about the pause far more often than a real one needs to.
      stopPollMs: 5,
      crawl: {
        originOverride: () => fixture.origin,
        dangerouslyAllowLoopback: true,
        limiter: new HostLimiter({ rps: 1000, concurrency: 4 }),
        fetcher: async (url, init) => {
          const pathname = new URL(url).pathname;
          requested.push(pathname);
          // robots.txt and sitemap.xml are fetched before any page, and pausing
          // on those would leave nothing read to preserve.
          const isPage = !['/robots.txt', '/sitemap.xml'].includes(pathname);
          if (init === undefined && isPage && --pauseAfter === 0) {
            await requestScanPause(db.prisma, scan.id, new Date());
            // Long enough for the running attempt to observe the request.
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return realFetch(url, init);
        },
      },
    });

    const first = await processScan(pausingDeps, scan.id);
    expect(first.outcome).toBe('Paused');
    const storedPages = await db.prisma.scanCrawlPage.findMany({
      where: { scanId: scan.id },
      select: { normalizedUrl: true },
    });
    expect(storedPages.length).toBeGreaterThan(0);
    const readBeforePause = new Set(requested);

    requested.length = 0;
    await resumeScan(db.prisma, scan.id, new Date());
    const second = await processScan(deps(), scan.id);

    expect(['Completed', 'Partial']).toContain(second.outcome);
    // Not one of the stored pages was fetched a second time.
    for (const page of storedPages) {
      expect(requested).not.toContain(new URL(page.normalizedUrl).pathname);
    }
    // And the finished scan covers everything both halves read — without
    // counting a restored page twice, which used to push the total past the
    // plan's own page limit and then seed the next resume with it.
    const finished = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(finished.scannedUrlCount).toBeGreaterThanOrEqual(storedPages.length);
    expect(finished.scannedUrlCount).toBeLessThanOrEqual(6);
    expect(finished.discoveredUrlCount).toBeGreaterThanOrEqual(finished.scannedUrlCount);
    const issuePaths = new Set(
      (
        await db.prisma.issue.findMany({
          where: { scanId: scan.id },
          select: { normalizedUrl: true },
        })
      )
        .filter((issue) => issue.normalizedUrl !== '')
        .map((issue) => new URL(issue.normalizedUrl).pathname),
    );
    const restoredPaths = storedPages.map((page) => new URL(page.normalizedUrl).pathname);
    expect(restoredPaths.some((path) => issuePaths.has(path))).toBe(true);
    expect(readBeforePause.size).toBeGreaterThan(0);
    // Nothing is left behind to resume from once the run has settled.
    await expect(db.prisma.scanCrawlPage.count()).resolves.toBe(0);

    // The export contract reads these three as one ordering. A resume that
    // moved the start forward would put findings from before the pause outside
    // their own scan's lifetime.
    const settled = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    const issues = await db.prisma.issue.findMany({
      where: { scanId: scan.id },
      select: { observedAt: true },
    });
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(settled.startedAt?.getTime()).toBeLessThanOrEqual(issue.observedAt.getTime());
      expect(issue.observedAt.getTime()).toBeLessThanOrEqual(settled.completedAt?.getTime() ?? 0);
    }
  });

  // The point of the checkpoint: the expensive stages are not paid for twice.
  it('does not re-run a stage a previous attempt finished', async () => {
    const scan = await seedCompleteScan(scopeWith({ maxDepth: 0 }));
    // Stand in for what the interrupted attempt left behind: the AI stages
    // already done, with a marker that a re-run would necessarily overwrite.
    for (const module of AI_MODULES) {
      await db.prisma.scanModule.create({
        data: {
          scanId: scan.id,
          module,
          runtimeStatus: 'Completed',
          statusReason: 'FromTheInterruptedAttempt',
          coverage: 1,
          score: 100,
          applicableChecks: 1,
          completedApplicableChecks: 1,
          usableOutput: true,
          metadataJson: JSON.stringify({ marker: 'kept' }),
        },
      });
    }
    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: {
        schemaVersion: 2,
        stage: 'Security',
        completedStages: ['crawl', ...AI_MODULES],
        crawl: {
          frontier: [],
          unretained: [],
          scannedUrlCount: 1,
          discoveredUrlCount: 1,
          coverage: EMPTY_CRAWL_COVERAGE,
          truncated: false,
        },
      },
      now: new Date(),
    });
    await db.prisma.scan.update({ where: { id: scan.id }, data: { status: 'Queued' } });

    await processScan(deps(), scan.id);

    for (const module of AI_MODULES) {
      const row = await moduleRow(scan.id, module);
      expect(row.statusReason).toBe('FromTheInterruptedAttempt');
      expect(metadataOf(row).marker).toBe('kept');
    }
    // No AI request was made for the stages that were already complete.
    await expect(db.prisma.aiResponseRecord.count({ where: { scanId: scan.id } })).resolves.toBe(0);
    // The stages that had not run did run.
    expect((await moduleRow(scan.id, 'SEO')).runtimeStatus).not.toBe('Pending');
  });

  // Pausing *after* a module has written its findings is where a resumed run's
  // clock matters: the export contract reads
  // started_at <= observed_at <= completed_at, so a resume that restarted the
  // clock would put the earlier half's findings outside their own scan.
  it('keeps a resumed run’s timestamps consistent with findings recorded before the pause', async () => {
    const scan = await seedCompleteScan(scopeWith({ maxDepth: 0 }));
    // Stand in for an attempt that got as far as SEO and was then paused: its
    // module row, its finding, and a checkpoint that names the stage as done.
    const startedAt = new Date(Date.now() - 60_000);
    const observedAt = new Date(startedAt.getTime() + 1_000);
    await db.prisma.scan.update({
      where: { id: scan.id },
      data: { status: 'Paused', statusReason: 'UserPausedAfterStart', startedAt },
    });
    await db.prisma.scanModule.create({
      data: {
        scanId: scan.id,
        module: 'SEO',
        runtimeStatus: 'Completed',
        coverage: 1,
        score: 90,
        applicableChecks: 1,
        completedApplicableChecks: 1,
        usableOutput: true,
        metadataJson: '{}',
      },
    });
    await db.prisma.issue.create({
      data: {
        scanId: scan.id,
        ruleId: 'SEO-ONPAGE-001',
        module: 'SEO',
        fingerprint: `fp-before-pause-${scan.id}`,
        severity: 'Medium',
        severityRank: 2,
        category: 'SEO',
        status: 'New',
        targetKind: 'page',
        normalizedUrl: `${fixture.origin}/`,
        normalizedResource: '',
        normalizedSelector: 'title',
        normalizedParameter: '',
        ruleVariant: 'v1',
        targetUrl: `${fixture.origin}/`,
        evidenceType: 'dom',
        recommendation: 'Recorded before the pause.',
        confidence: 1,
        applicableTargets: 1,
        affectedTargets: 1,
        rulePenalty: 1,
        scoreDelta: -1,
        observedAt,
      },
    });
    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: {
        schemaVersion: 2,
        stage: 'Accessibility',
        completedStages: ['crawl', 'SEO'],
        crawl: {
          frontier: [],
          unretained: [],
          scannedUrlCount: 1,
          discoveredUrlCount: 1,
          coverage: EMPTY_CRAWL_COVERAGE,
          truncated: false,
        },
      },
      now: new Date(),
    });

    await resumeScan(db.prisma, scan.id, new Date());
    await processScan(deps(), scan.id);

    const settled = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    // The finding from before the pause is still there, and still inside the
    // lifetime of the scan that produced it.
    const preserved = await db.prisma.issue.findFirstOrThrow({
      where: { scanId: scan.id, fingerprint: `fp-before-pause-${scan.id}` },
    });
    expect(preserved.observedAt.getTime()).toBe(observedAt.getTime());
    expect(settled.startedAt?.getTime()).toBe(startedAt.getTime());
    const issues = await db.prisma.issue.findMany({
      where: { scanId: scan.id },
      select: { observedAt: true },
    });
    for (const issue of issues) {
      expect(settled.startedAt?.getTime()).toBeLessThanOrEqual(issue.observedAt.getTime());
      expect(issue.observedAt.getTime()).toBeLessThanOrEqual(settled.completedAt?.getTime() ?? 0);
    }
  });

  // The window a checkpoint alone cannot cover: a process that wrote a module's
  // rows and died before writing the checkpoint that names it. Believing the
  // checkpoint there would run — and pay for — that module a second time.
  it('does not re-run a stage whose rows are persisted but whose checkpoint is behind', async () => {
    const scan = await seedCompleteScan(scopeWith({ maxDepth: 0 }));
    for (const module of AI_MODULES) {
      await db.prisma.scanModule.create({
        data: {
          scanId: scan.id,
          module,
          runtimeStatus: 'Completed',
          statusReason: 'WrittenBeforeTheProcessDied',
          coverage: 1,
          score: 100,
          applicableChecks: 1,
          completedApplicableChecks: 1,
          usableOutput: true,
          metadataJson: JSON.stringify({ marker: 'kept' }),
        },
      });
    }
    // The checkpoint knows only about the crawl: the AI stages finished after
    // it was last written.
    await saveScanCheckpoint(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      state: {
        schemaVersion: 2,
        stage: 'crawl',
        completedStages: ['crawl'],
        crawl: {
          frontier: [],
          unretained: [],
          scannedUrlCount: 1,
          discoveredUrlCount: 1,
          coverage: EMPTY_CRAWL_COVERAGE,
          truncated: false,
        },
      },
      now: new Date(),
    });
    await db.prisma.scan.update({ where: { id: scan.id }, data: { status: 'Queued' } });

    await processScan(deps(), scan.id);

    for (const module of AI_MODULES) {
      const row = await moduleRow(scan.id, module);
      expect(row.statusReason).toBe('WrittenBeforeTheProcessDied');
      expect(metadataOf(row).marker).toBe('kept');
    }
    await expect(db.prisma.aiResponseRecord.count({ where: { scanId: scan.id } })).resolves.toBe(0);
  });

  // No checkpoint at all — the row was never written, or the process that
  // would have written it died first. The persisted module rows are what has
  // to protect the customer here; the checkpoint only saves a re-crawl.
  it('does not re-run a paid stage when there is no checkpoint at all', async () => {
    const scan = await seedCompleteScan(scopeWith({ maxDepth: 0 }));
    for (const module of AI_MODULES) {
      await db.prisma.scanModule.create({
        data: {
          scanId: scan.id,
          module,
          runtimeStatus: 'Completed',
          statusReason: 'PaidForByTheAttemptThatDied',
          coverage: 1,
          score: 100,
          applicableChecks: 1,
          completedApplicableChecks: 1,
          usableOutput: true,
          metadataJson: JSON.stringify({ marker: 'kept' }),
        },
      });
    }
    await db.prisma.scan.update({ where: { id: scan.id }, data: { status: 'Queued' } });
    await expect(db.prisma.scanCheckpoint.count({ where: { scanId: scan.id } })).resolves.toBe(0);

    await processScan(deps(), scan.id);

    for (const module of AI_MODULES) {
      const row = await moduleRow(scan.id, module);
      expect(row.statusReason).toBe('PaidForByTheAttemptThatDied');
      expect(metadataOf(row).marker).toBe('kept');
    }
    await expect(db.prisma.aiResponseRecord.count({ where: { scanId: scan.id } })).resolves.toBe(0);
    // The stages that had not run did run, against a crawl of their own.
    expect((await moduleRow(scan.id, 'SEO')).runtimeStatus).not.toBe('Pending');
  });

  // A checkpoint write is an optimisation. Failing the attempt over it would
  // escalate a transient database error into a platform retry — the one path
  // that really does discard the run — so the attempt has to survive it.
  it('finishes the run when every checkpoint write fails', async () => {
    const scan = await seedCompleteScan(scopeWith({ maxDepth: 0 }));
    await db.prisma.scan.update({
      where: { id: scan.id },
      data: { status: 'Running', startedAt: new Date() },
    });
    let saveAttempts = 0;

    const facts = await runScanAttempt(deps(), scan.id, {
      control: {
        resumeFrom: null,
        isStopRequested: () => false,
        save: () => {
          saveAttempts += 1;
          return Promise.reject(new Error('checkpoint write failed'));
        },
      },
    });

    expect(facts.stopped).toBe(false);
    expect(saveAttempts).toBeGreaterThan(0);
    // And the modules the attempt ran are on record, which is what the *next*
    // attempt reads instead of the checkpoint that never landed.
    expect((await moduleRow(scan.id, 'SEO')).runtimeStatus).not.toBe('Pending');
  });

  // The external retry granted after a Partial run is the one attempt that
  // replaces the previous result outright. The stages it must not skip are
  // covered above; this is the other half of the same flag — the pages. An
  // attempt that starts from nothing must read the site itself rather than
  // show evidence gathered by the run it replaces. (The continuing case is
  // "keeps the pages it had already read", earlier in this file.)
  it('re-reads the site when the attempt replaces the previous result', async () => {
    const scan = await seedCompleteScan(scopeWith({ maxPages: 2, maxDepth: 0 }));
    await db.prisma.scan.update({
      where: { id: scan.id },
      data: { status: 'Running', startedAt: new Date() },
    });
    const home = `${fixture.origin}/`;
    await saveCrawlEvidence(db.prisma, {
      scanId: scan.id,
      accountId: account.accountId,
      pages: [
        {
          requestedUrl: home,
          normalizedUrl: home,
          depth: 0,
          finalUrl: home,
          status: 200,
          headers: { 'content-type': 'text/html' },
          redirectChain: [],
          html: '<html><head><title>From the attempt being replaced</title></head><body>old</body></html>',
          contentType: 'text/html; charset=utf-8',
          timingMs: 4,
          truncated: false,
        },
      ],
      now: new Date(),
    });
    const requested: string[] = [];
    const recordingDeps = deps({
      crawl: {
        originOverride: () => fixture.origin,
        dangerouslyAllowLoopback: true,
        limiter: new HostLimiter({ rps: 1000, concurrency: 4 }),
        fetcher: (url, init) => {
          requested.push(new URL(url).pathname);
          return realFetch(url, init);
        },
      },
    });

    await runScanAttempt(recordingDeps, scan.id, {
      control: {
        resumeFrom: {
          schemaVersion: 2,
          stage: 'crawl',
          completedStages: [],
          crawl: {
            frontier: [],
            unretained: [],
            scannedUrlCount: 1,
            discoveredUrlCount: 1,
            coverage: EMPTY_CRAWL_COVERAGE,
            truncated: false,
          },
        },
        replacesPreviousResult: true,
        isStopRequested: () => false,
        save: () => Promise.resolve(),
      },
    });

    // The stored page was not handed to this attempt as something it had read.
    expect(requested).toContain('/');
  });

  // A platform retry re-crawls, but the customer already paid for the stages
  // that completed. Running them again because an unrelated one crashed would
  // charge for one scan twice.
  it('keeps the stages a failed attempt had already paid for across a platform retry', async () => {
    const scan = await seedCompleteScan(scopeWith({ maxDepth: 0 }));
    let attempts = 0;
    const failingOnce = deps({
      createAiProvider: (attemptScan, profile) => {
        attempts += 1;
        // The first attempt dies on its way into the AI stage, after the
        // deterministic modules have written their rows and findings.
        if (attempts === 1) throw new Error('provider wiring blew up');
        return createDefaultAiProvider(profile.name, new URL(attemptScan.domain).hostname);
      },
    });

    const result = await processScan(failingOnce, scan.id);

    const retried = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(retried.platformRetryCount).toBe(1);
    expect(['Completed', 'Partial', 'Failed']).toContain(result.outcome);
    // The deterministic modules of the first attempt were not thrown away, and
    // their findings still sit inside the scan's own lifetime.
    const seo = await moduleRow(scan.id, 'SEO');
    expect(seo.runtimeStatus).not.toBe('Pending');
    const issues = await db.prisma.issue.findMany({
      where: { scanId: scan.id },
      select: { observedAt: true },
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(retried.startedAt).not.toBeNull();
    for (const issue of issues) {
      expect(retried.startedAt?.getTime()).toBeLessThanOrEqual(issue.observedAt.getTime());
    }
  });
});
