// DB-backed runtime of the worker for the three defects whose wiring only shows
// up in a real run: cancellation, the GEO row, and the Resolved policy.
//
// The site is an injected crawl transport rather than a live server, so a page
// can be healthy in one run and gone in the next — which is exactly the
// difference between "the owner fixed it" and "we stopped looking".

import { afterEach, describe, expect, it } from 'vitest';
import type { PrismaClient, Scan } from '@prisma/client';
import { AiRequestAbortedError, CURRENT_AI_PROCESSING_NOTICE_VERSION } from '@fluxradar/ai';
import type { AiProvider, MockAiFixture } from '@fluxradar/ai';
import { mockRoutingProvider } from '@fluxradar/ai';
import type { CrawlFetcher } from '@fluxradar/crawler';
import type { SafeFetchResult } from '@fluxradar/safe-fetch';

import { scanScopeSchema } from '@fluxradar/contracts';

import { cancelScan } from '../billing/cancel-scan.ts';
import { requestScanPause } from './pause.ts';
import { silentLogger } from '../http/logger.ts';
import { captureExecutionConfig } from '../profiles/execution-config.ts';
import { fakePerformanceRunner } from '../test-utils/performance-fixtures.ts';
import { defaultGeoFixtures, GEO_VISIBILITY_PROVIDERS } from './geo.ts';
import { decodeCoverageProof, type CoverageRead } from './run-coverage.ts';
import { processScan } from './worker.ts';
import type { WorkerDeps } from './deps.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedScan,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';

const ORIGIN = 'https://example.com';
const BRAND = 'Test Site';

/** A fixture answer for the UX review, so the module can reach Completed. */
const UX_FIXTURE: MockAiFixture = {
  questionIncludes: 'for UX/Conversion',
  response: {
    status: 'completed',
    output_text: JSON.stringify({ findings: [] }),
    usage: { input_tokens: 220, output_tokens: 12 },
  },
};

/**
 * One mock adapter per default recipient, because a paid GEO run asks all of
 * them. A single-provider mock would leave the other default asking an adapter
 * that is not there, and the module would settle Partial for a reason that
 * belongs to the fixture rather than to the run under test.
 */
function aiProvider(): AiProvider {
  return mockRoutingProvider(
    [...defaultGeoFixtures(BRAND, 'example.com'), UX_FIXTURE],
    GEO_VISIBILITY_PROVIDERS,
  );
}

function htmlPage(url: string, body: string): SafeFetchResult {
  return {
    finalUrl: url,
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body,
    redirectChain: [],
    timingMs: 3,
    truncated: false,
  };
}

function notFound(url: string): SafeFetchResult {
  return {
    finalUrl: url,
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '<html><body><h1>Not found</h1></body></html>',
    redirectChain: [],
    timingMs: 2,
    truncated: false,
  };
}

function textPage(url: string, body: string): SafeFetchResult {
  return {
    finalUrl: url,
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body,
    redirectChain: [],
    timingMs: 1,
    truncated: false,
  };
}

const PARAGRAPH = 'Real editorial content about the offering and how to reach the team. '.repeat(4);

/** The homepage, with or without the privacy-policy link PRIVACY-004 looks for. */
function homepage(url: string, shape: SiteShape): SafeFetchResult {
  return htmlPage(
    url,
    '<!doctype html><html lang="en"><head><title>Test Site — home</title>' +
      '<meta name="description" content="A test site used by the worker runtime suite." />' +
      `</head><body><h1>Test Site</h1><p>${PARAGRAPH}</p>` +
      (shape.pricingLink === false ? '' : '<a href="/pricing">Pricing</a>') +
      (shape.policyLink ? '<a href="/privacy">Privacy policy</a>' : '') +
      '</body></html>',
  );
}

/** A page whose missing title is a page-level SEO finding. */
function pricingPage(url: string): SafeFetchResult {
  return htmlPage(
    url,
    '<!doctype html><html lang="en"><head>' +
      '<meta name="description" content="Pricing of the test site." />' +
      `</head><body><h1>Pricing</h1><p>${PARAGRAPH}</p></body></html>`,
  );
}

interface SiteShape {
  readonly policyLink: boolean;
  readonly robotsTxt: boolean;
  readonly pricing: boolean;
  /** A path robots.txt keeps the crawl out of, so it gets no snapshot at all. */
  readonly disallow?: string;
  /** false — the homepage no longer links to /pricing: the owner removed it. */
  readonly pricingLink?: boolean;
}

/** The crawl transport: one function that decides what the site looks like now. */
function siteFetcher(shape: SiteShape): CrawlFetcher {
  return (url) => {
    const { pathname } = new URL(url);
    if (pathname === '/robots.txt') {
      return Promise.resolve(
        shape.robotsTxt
          ? textPage(
              url,
              `User-agent: *\n${shape.disallow === undefined ? 'Allow: /' : `Disallow: ${shape.disallow}`}\n`,
            )
          : notFound(url),
      );
    }
    if (pathname === '/sitemap.xml') {
      return Promise.resolve(notFound(url));
    }
    if (pathname === '/') {
      return Promise.resolve(homepage(url, shape));
    }
    if (pathname === '/pricing') {
      return Promise.resolve(shape.pricing ? pricingPage(url) : notFound(url));
    }
    if (pathname === '/privacy') {
      return Promise.resolve(
        htmlPage(
          url,
          '<!doctype html><html lang="en"><head><title>Privacy policy</title>' +
            '<meta name="description" content="How the test site handles data." />' +
            `</head><body><h1>Privacy policy</h1><p>${PARAGRAPH}</p></body></html>`,
        ),
      );
    }
    return Promise.resolve(notFound(url));
  };
}

/**
 * A Performance audit that answers from a fixture.
 *
 * No test in this repository may make a real PageSpeed or CrUX request: those
 * calls are billable and rate-limited, and a suite that made them would fail for
 * reasons that have nothing to do with the code under test.
 */
function performanceRunner(): WorkerDeps['createPerformanceRunner'] {
  return () => fakePerformanceRunner({ score: 90 });
}

function workerDeps(
  prisma: PrismaClient,
  shape: SiteShape,
  overrides: Partial<WorkerDeps> = {},
): WorkerDeps {
  return {
    prisma,
    logger: silentLogger,
    createAiProvider: () => aiProvider(),
    createPerformanceRunner: performanceRunner(),
    crawl: { fetcher: siteFetcher(shape) },
    ...overrides,
  };
}

/** A Complete scan of the account, queued for the worker with its AI consent. */
async function queueCompleteScan(
  prisma: PrismaClient,
  account: SeededAccount,
  options: { readonly withPurchase?: boolean; readonly excludePatterns?: readonly string[] } = {},
): Promise<Scan> {
  const withPurchase = options.withPurchase ?? false;
  const seeded = await seedScan(prisma, {
    account,
    plan: 'Complete',
    status: 'Pending',
    withPurchase,
  });
  if (options.excludePatterns !== undefined) {
    // The scope the owner chose on the new-scan screen: the crawl never touches
    // these paths again (scanRequestInputSchema.scope).
    await prisma.scan.update({
      where: { id: seeded.scan.id },
      data: {
        scopeJson: JSON.stringify(
          scanScopeSchema.parse({
            includeSubdomains: false,
            excludePatterns: options.excludePatterns,
          }),
        ),
      },
    });
  }
  if (seeded.purchase !== null) {
    await prisma.entitlement.create({
      data: { purchaseId: seeded.purchase.id, expiresAt: new Date(Date.now() + 86_400_000) },
    });
  }
  await prisma.aiConsent.create({
    data: {
      accountId: account.accountId,
      scanId: seeded.scan.id,
      // What the form actually sends: the default recipients of the current
      // notice. Consenting to one of two would make every run Partial on the
      // other, which is a consent test, not a runtime one.
      providersJson: JSON.stringify([...GEO_VISIBILITY_PROVIDERS]),
      noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
    },
  });
  await prisma.job.create({ data: { scanId: seeded.scan.id, type: 'scan', status: 'Pending' } });
  return seeded.scan;
}

/**
 * Gives the scan the stored profile context GEO needs to generate questions.
 *
 * The run reads the execution config captured at launch, never today's profile,
 * so without this the discovery-question request is `NotApplicable` and the
 * first paid request never happens.
 */
async function withProfileContext(
  prisma: PrismaClient,
  account: SeededAccount,
  scan: Scan,
): Promise<void> {
  const profile = await prisma.siteProfile.update({
    where: { id: account.siteProfileId },
    data: { industry: 'SaaS', offerings: 'automated website audits', region: 'EU' },
  });
  await prisma.scan.update({
    where: { id: scan.id },
    data: {
      executionConfigJson: JSON.stringify(
        captureExecutionConfig(
          profile,
          'Complete',
          scanScopeSchema.parse({ includeSubdomains: false }),
        ),
      ),
    },
  });
}

/** Waits for the worker's cancellation watch to abort the run's signal. */
async function waitUntilAborted(signal: AbortSignal | undefined): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (signal?.aborted !== true) {
    if (Date.now() > deadline) {
      throw new Error('the cancellation watch never aborted the run');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function moduleRow(prisma: PrismaClient, scanId: string, module: string) {
  return prisma.scanModule.findUniqueOrThrow({ where: { scanId_module: { scanId, module } } });
}

/** The repeat-check proof a module stored, read the way the policy reads it. */
async function coverageOf(
  prisma: PrismaClient,
  scanId: string,
  module: string,
): Promise<CoverageRead> {
  const stored = await prisma.ruleCoverageProof.findUniqueOrThrow({
    where: { scanId_module: { scanId, module } },
  });
  return decodeCoverageProof(stored.proof);
}

describe('cancelling a running scan', () => {
  let db: TestDb | undefined;

  afterEach(async () => {
    await db?.cleanup();
    db = undefined;
  });

  it('keeps the finished sections with their findings, spends no refund and no retry', async () => {
    db = await createTestDb();
    const prisma = db.prisma;
    const account = await seedAccountWithProfile(prisma);
    const scan = await queueCompleteScan(prisma, account, { withPurchase: true });

    // The cancel lands while the first paid AI request is in flight — after the
    // rule modules have finished and before GEO could write its row.
    const cancellingProvider: AiProvider = {
      config: aiProvider().config,
      send: async (request) => {
        await cancelScan(prisma, scan.id);
        throw new AiRequestAbortedError(request.scanId);
      },
    };
    const result = await processScan(
      workerDeps(
        prisma,
        { policyLink: true, robotsTxt: true, pricing: true },
        {
          createAiProvider: () => cancellingProvider,
        },
      ),
      scan.id,
    );

    expect(result).toMatchObject({ outcome: 'Cancelled', status: 'Cancelled', refundId: null });
    const cancelled = await prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(cancelled.status).toBe('Cancelled');
    // §18: a cancel after queueing is a used run — no refund, and the free
    // platform retry is not spent on the owner's own decision.
    expect(cancelled.platformRetryCount).toBe(0);
    expect(cancelled.purchaseId).not.toBeNull();
    expect(
      await prisma.refundRecord.count({ where: { purchaseId: cancelled.purchaseId ?? '' } }),
    ).toBe(0);
    expect((await prisma.job.findUniqueOrThrow({ where: { scanId: scan.id } })).status).toBe(
      'Done',
    );

    // The sections that finished keep their score AND the findings behind it:
    // the snapshot used to be written once at the end, so a cancelled run showed
    // a scored section with no evidence at all.
    const seo = await moduleRow(prisma, scan.id, 'SEO');
    expect(seo.runtimeStatus).toBe('Completed');
    expect(seo.usableOutput).toBe(true);
    expect(await prisma.issue.count({ where: { scanId: scan.id, module: 'SEO' } })).toBeGreaterThan(
      0,
    );
    // And each of them carries the proof of what its rules read — written in the
    // same transaction as the row and the findings, in its own table.
    expect((await coverageOf(prisma, scan.id, 'SEO')).coverage.size).toBeGreaterThan(0);
    expect(seo.metadataJson).not.toContain('coverageProof');

    // The section the cancel interrupted says so, instead of claiming a result.
    const geo = await moduleRow(prisma, scan.id, 'AI SEO / GEO');
    expect(geo).toMatchObject({
      runtimeStatus: 'Unavailable',
      statusReason: 'ScanCancelled',
      score: null,
      usableOutput: false,
    });
    expect(await prisma.issue.count({ where: { scanId: scan.id, module: 'AI SEO / GEO' } })).toBe(
      0,
    );
  });

  it('keeps the answers the provider already sent, with their deletion evidence', async () => {
    db = await createTestDb();
    const prisma = db.prisma;
    const account = await seedAccountWithProfile(prisma);
    const scan = await queueCompleteScan(prisma, account, { withPurchase: true });
    await withProfileContext(prisma, account, scan);

    // The cancel lands on the third paid request: the question generation and
    // the first visibility question have already been answered and billed.
    const inner = aiProvider();
    let calls = 0;
    const cancellingProvider: AiProvider = {
      config: inner.config,
      send: async (request, promptText, signal) => {
        calls += 1;
        if (calls <= 2) {
          return inner.send(request, promptText);
        }
        await cancelScan(prisma, scan.id);
        // Wait for the worker's own watch to see it, so the run is interrupted
        // by the real cancellation signal rather than by a provider error.
        await waitUntilAborted(signal);
        throw new AiRequestAbortedError(request.scanId);
      },
    };
    const result = await processScan(
      workerDeps(
        prisma,
        { policyLink: true, robotsTxt: true, pricing: true },
        { createAiProvider: () => cancellingProvider },
      ),
      scan.id,
    );
    expect(result.outcome).toBe('Cancelled');

    // The provider holds the prompt and the answer of every request it served.
    // Their ai_response records are the only thing that carries the deletion
    // reference AI-001/DATA-006 requires, so a cancelled run must not drop them.
    const records = await prisma.aiResponseRecord.findMany({
      where: { scanId: scan.id, module: 'AI SEO / GEO' },
    });
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.deletionEvidenceRef).toBe(`ai-001/deletion/${record.aiRequestKey}`);
      expect(JSON.parse(record.usageJson)).toMatchObject({ totalTokens: expect.any(Number) });
    }

    // §575: the part that completed is stored as Partial, with the unanswered
    // questions still in the denominator.
    const geo = await moduleRow(prisma, scan.id, 'AI SEO / GEO');
    expect(geo.runtimeStatus).toBe('Partial');
    expect(geo.statusReason).toContain('ScanCancelled');
    expect(geo.score).toBeNull();
    expect(geo.usableOutput).toBe(true);
    expect(geo.completedApplicableChecks).toBe(2);
    expect(geo.applicableChecks ?? 0).toBeGreaterThan(geo.completedApplicableChecks ?? 0);
  });

  it('keeps the static part of an interrupted UX review as Partial', async () => {
    // §575 again, on the module where a cancellation actually splits the work:
    // the three static checks finished before the AI review was interrupted.
    db = await createTestDb();
    const prisma = db.prisma;
    const account = await seedAccountWithProfile(prisma);
    const scan = await queueCompleteScan(prisma, account);

    const inner = aiProvider();
    const cancellingProvider: AiProvider = {
      config: inner.config,
      send: async (request, promptText, signal) => {
        if (!request.promptVersion.startsWith('ux-conversion')) {
          return inner.send(request, promptText);
        }
        await cancelScan(prisma, scan.id);
        await waitUntilAborted(signal);
        throw new AiRequestAbortedError(request.scanId);
      },
    };
    const result = await processScan(
      workerDeps(
        prisma,
        { policyLink: true, robotsTxt: true, pricing: true },
        { createAiProvider: () => cancellingProvider },
      ),
      scan.id,
    );
    expect(result.outcome).toBe('Cancelled');

    const ux = await moduleRow(prisma, scan.id, 'UX/Conversion');
    expect(ux.runtimeStatus).toBe('Partial');
    expect(ux.statusReason).toBe('UxAiScanCancelled');
    expect(ux.completedApplicableChecks).toBe(3);
    expect(ux.applicableChecks).toBe(4);
    expect(ux.usableOutput).toBe(true);
    // The static evidence is what makes the row worth keeping at all.
    const metadata = JSON.parse(ux.metadataJson) as { ruleChecks: readonly unknown[] };
    expect(metadata.ruleChecks).toHaveLength(3);
    // No ai_response record: the request was interrupted before an answer.
    expect(
      await prisma.aiResponseRecord.count({ where: { scanId: scan.id, module: 'UX/Conversion' } }),
    ).toBe(0);
  });
});

/**
 * Pause and cancellation were built in two different lanes, and the worker is
 * where they meet. Both stop a run in flight; everything after that differs,
 * and getting it wrong is silent in each direction — a paused run terminalized
 * as a platform failure loses the checkpoint the owner paid to keep, and a
 * cancelled run parked as paused leaves evidence behind for a run that will
 * never resume.
 */
describe('stopping a running scan: pause and cancellation do not become each other', () => {
  let db: TestDb | undefined;

  afterEach(async () => {
    await db?.cleanup();
    db = undefined;
  });

  it('a pause mid-crawl parks the run and never reads as a platform failure', async () => {
    db = await createTestDb();
    const prisma = db.prisma;
    const account = await seedAccountWithProfile(prisma);
    const scan = await queueCompleteScan(prisma, account, { withPurchase: true });

    // The owner pauses while the crawl is still reading pages. The stop watcher
    // polls, so the interval is shortened rather than waited out.
    const shape: SiteShape = { policyLink: true, robotsTxt: true, pricing: true };
    const site = siteFetcher(shape);
    let paused = false;
    const result = await processScan(
      workerDeps(prisma, shape, {
        stopPollMs: 5,
        crawl: {
          fetcher: async (url, init) => {
            if (!paused && new URL(url).pathname !== '/robots.txt') {
              paused = true;
              await requestScanPause(prisma, scan.id, new Date());
            }
            return site(url, init);
          },
        },
      }),
      scan.id,
    );

    expect(result).toMatchObject({ outcome: 'Paused', status: 'Paused', refundId: null });
    const stopped = await prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    // A pause is not an outcome: nothing is scored, nothing is refunded, and the
    // one free platform retry is not spent on the owner's own decision.
    expect(stopped.completedAt).toBeNull();
    expect(stopped.platformRetryCount).toBe(0);
    // The job is parked, not finished, so resuming claims the same one.
    expect((await prisma.job.findUniqueOrThrow({ where: { scanId: scan.id } })).status).not.toBe(
      'Done',
    );
    // What the run got to is still there to continue from.
    expect(await prisma.scanCheckpoint.count({ where: { scanId: scan.id } })).toBe(1);
    // And the defect this pins: the core lane's terminalizer defaults to
    // `PlatformFailureBeforeCompletion`, which would describe the owner's pause
    // as a crash and take the checkpoint with it on the retry that follows.
    const modules = await prisma.scanModule.findMany({ where: { scanId: scan.id } });
    expect(modules.map((module) => module.statusReason)).not.toContain(
      'PlatformFailureBeforeCompletion',
    );
  });

  it('a cancel after the crawl is terminal and leaves no evidence behind to resume from', async () => {
    db = await createTestDb();
    const prisma = db.prisma;
    const account = await seedAccountWithProfile(prisma);
    const scan = await queueCompleteScan(prisma, account, { withPurchase: true });

    // The cancel lands on the first paid AI request: by then the crawl has
    // finished, its pages are stored and a checkpoint names the stage — which is
    // exactly the state a cancelled run must not leave behind, because nothing
    // will ever resume from it.
    const shape: SiteShape = { policyLink: true, robotsTxt: true, pricing: true };
    const cancellingProvider: AiProvider = {
      config: aiProvider().config,
      send: async (request, _promptText, signal) => {
        await cancelScan(prisma, scan.id);
        await waitUntilAborted(signal);
        throw new AiRequestAbortedError(request.scanId);
      },
    };
    const result = await processScan(
      workerDeps(prisma, shape, {
        stopPollMs: 5,
        createAiProvider: () => cancellingProvider,
      }),
      scan.id,
    );

    expect(result).toMatchObject({ outcome: 'Cancelled', status: 'Cancelled', refundId: null });
    expect((await prisma.job.findUniqueOrThrow({ where: { scanId: scan.id } })).status).toBe(
      'Done',
    );
    // Nothing to resume: a cancelled run's checkpoint and stored pages are not
    // left to age out of the store on their TTL.
    expect(await prisma.scanCheckpoint.count({ where: { scanId: scan.id } })).toBe(0);
    expect(await prisma.scanCrawlPage.count({ where: { scanId: scan.id } })).toBe(0);
    // The sections that never ran say why, and the reason is the owner's.
    const modules = await prisma.scanModule.findMany({ where: { scanId: scan.id } });
    expect(modules.length).toBeGreaterThan(0);
    for (const module of modules) {
      expect(module.statusReason).not.toBe('PlatformFailureBeforeCompletion');
    }
    expect(modules.some((module) => module.statusReason === 'ScanCancelled')).toBe(true);
  });
});

describe('a finished Complete run', () => {
  let db: TestDb | undefined;

  afterEach(async () => {
    await db?.cleanup();
    db = undefined;
  });

  it('stores the GEO section as observations without inventing a score', async () => {
    db = await createTestDb();
    const prisma = db.prisma;
    const account = await seedAccountWithProfile(prisma);
    const scan = await queueCompleteScan(prisma, account);

    const result = await processScan(
      workerDeps(prisma, { policyLink: true, robotsTxt: true, pricing: true }),
      scan.id,
    );
    expect(result.outcome).toBe('Completed');

    const geo = await moduleRow(prisma, scan.id, 'AI SEO / GEO');
    expect(geo.runtimeStatus).toBe('Completed');
    expect(geo.score).toBeNull();
    expect(geo.usableOutput).toBe(true);
    const metadata = JSON.parse(geo.metadataJson) as {
      scoring: string;
      providerVisibility: { observations: Record<string, { asked: number; answered: number }> };
    };
    expect(metadata.scoring).toBe('InformationalOnly');
    expect(metadata.providerVisibility.observations.awareness?.asked).toBeGreaterThan(0);
    // The section never carried a rule-level coverage proof, and must not
    // pretend to: its rules are informational and close nothing.
    expect(
      await prisma.ruleCoverageProof.count({
        where: { scanId: scan.id, module: 'AI SEO / GEO' },
      }),
    ).toBe(0);
  });
});

describe('Resolved across two Complete runs of the same profile', () => {
  let db: TestDb | undefined;

  afterEach(async () => {
    await db?.cleanup();
    db = undefined;
  });

  it('closes what the second run re-checked and leaves the dead page open', async () => {
    db = await createTestDb();
    const prisma = db.prisma;
    const account = await seedAccountWithProfile(prisma);

    // First run: no robots.txt, no privacy link on the homepage, and a /pricing
    // page without a title.
    const first = await queueCompleteScan(prisma, account);
    expect(
      (
        await processScan(
          workerDeps(prisma, { policyLink: false, robotsTxt: false, pricing: true }),
          first.id,
        )
      ).outcome,
    ).toBe('Completed');

    const firstIssues = await prisma.issue.findMany({ where: { scanId: first.id } });
    const privacyIssue = firstIssues.find((issue) => issue.ruleId === 'PRIVACY-004');
    const robotsIssue = firstIssues.find((issue) => issue.ruleId === 'SEO-TECH-001');
    const pricingIssue = firstIssues.find(
      (issue) => issue.targetKind === 'page' && issue.normalizedUrl === `${ORIGIN}/pricing`,
    );
    expect(privacyIssue).toBeDefined();
    expect(robotsIssue).toBeDefined();
    expect(pricingIssue).toBeDefined();

    // Second run: both site-level problems are genuinely fixed, and /pricing is
    // gone — the crawl fetched it and got a 404, so no page rule looked at it.
    const second = await queueCompleteScan(prisma, account);
    expect(
      (
        await processScan(
          workerDeps(prisma, { policyLink: true, robotsTxt: true, pricing: false }),
          second.id,
        )
      ).outcome,
    ).toBe('Completed');

    const resolved = await prisma.issue.findMany({
      where: { scanId: first.id },
      select: { id: true, ruleId: true, status: true, normalizedUrl: true },
    });
    const statusOf = (id: string | undefined): string | undefined =>
      resolved.find((issue) => issue.id === id)?.status;

    expect(statusOf(privacyIssue?.id)).toBe('Resolved');
    expect(statusOf(robotsIssue?.id)).toBe('Resolved');
    // The page died; that is not a fix, and claiming it would tell the owner the
    // opposite of what happened.
    expect(statusOf(pricingIssue?.id)).toBe('New');
    // The sitemap is still missing in both runs, so nothing to resolve there.
    expect(
      (await prisma.issue.findMany({ where: { scanId: second.id, ruleId: 'SEO-TECH-002' } }))
        .length,
    ).toBe(1);
  });

  it('a link target that robots.txt now hides does not resolve the broken-link finding', async () => {
    // The homepage links to /pricing, which answers 404: a broken-link finding
    // on the HOMEPAGE. In the second run robots.txt keeps the crawl out of
    // /pricing, so the link target has no snapshot and the finding disappears —
    // while the link is just as broken as before. The homepage itself is
    // re-checked in both runs, so target applicability alone would close it.
    db = await createTestDb();
    const prisma = db.prisma;
    const account = await seedAccountWithProfile(prisma);

    const first = await queueCompleteScan(prisma, account);
    expect(
      (
        await processScan(
          workerDeps(prisma, { policyLink: true, robotsTxt: true, pricing: false }),
          first.id,
        )
      ).outcome,
    ).toBe('Completed');
    const brokenLink = await prisma.issue.findFirstOrThrow({
      where: { scanId: first.id, ruleId: 'SEO-TECH-006' },
    });
    expect(brokenLink.normalizedUrl).toBe(`${ORIGIN}/`);

    const second = await queueCompleteScan(prisma, account);
    expect(
      (
        await processScan(
          workerDeps(prisma, {
            policyLink: true,
            robotsTxt: true,
            pricing: false,
            disallow: '/pricing',
          }),
          second.id,
        )
      ).outcome,
    ).toBe('Completed');

    expect(await prisma.issue.count({ where: { scanId: second.id, ruleId: 'SEO-TECH-006' } })).toBe(
      0,
    );
    const after = await prisma.issue.findUniqueOrThrow({ where: { id: brokenLink.id } });
    expect(after.status).toBe('New');

    // And the stored proof shows exactly why: the homepage was re-checked, the
    // link target answered nothing — and the homepage still asks about it.
    const entry = (await coverageOf(prisma, second.id, 'SEO')).coverage.get('SEO-TECH-006');
    expect(entry?.checkedTargets.has(`${ORIGIN}/`)).toBe(true);
    expect(entry?.inputTargets.has(`${ORIGIN}/pricing`)).toBe(false);
    expect(entry?.requestedInputs?.has(`${ORIGIN}/pricing`)).toBe(true);
  });

  it('resolves the broken-link finding when the owner removes the link itself', async () => {
    // The fix the report recommends, end to end. The target has no snapshot in
    // the second run either — but the homepage no longer points at it, and that
    // is a repair, not a gap. Before this pass the recommended remedy produced
    // a finding that stayed New forever.
    db = await createTestDb();
    const prisma = db.prisma;
    const account = await seedAccountWithProfile(prisma);

    const first = await queueCompleteScan(prisma, account);
    expect(
      (
        await processScan(
          workerDeps(prisma, { policyLink: true, robotsTxt: true, pricing: false }),
          first.id,
        )
      ).outcome,
    ).toBe('Completed');
    const brokenLink = await prisma.issue.findFirstOrThrow({
      where: { scanId: first.id, ruleId: 'SEO-TECH-006' },
    });
    expect(brokenLink.normalizedResource).toBe(`${ORIGIN}/pricing`);

    const second = await queueCompleteScan(prisma, account);
    expect(
      (
        await processScan(
          workerDeps(prisma, {
            policyLink: true,
            robotsTxt: true,
            pricing: false,
            pricingLink: false,
          }),
          second.id,
        )
      ).outcome,
    ).toBe('Completed');

    const after = await prisma.issue.findUniqueOrThrow({ where: { id: brokenLink.id } });
    expect(after.status).toBe('Resolved');
    const entry = (await coverageOf(prisma, second.id, 'SEO')).coverage.get('SEO-TECH-006');
    expect(entry?.requestedInputs?.has(`${ORIGIN}/pricing`)).toBe(false);
  });

  it('resolves a repaired link target even though another page went dark', async () => {
    // Per-issue proof, end to end. The finding rests on one snapshot — the
    // target of its link — and that target is healthy again. Meanwhile
    // robots.txt hides /privacy, which the homepage still links to: a real gap
    // in this rule's material, and one that used to freeze every finding of
    // SEO-TECH-006 on the whole site, including this proven repair.
    db = await createTestDb();
    const prisma = db.prisma;
    const account = await seedAccountWithProfile(prisma);

    const first = await queueCompleteScan(prisma, account);
    expect(
      (
        await processScan(
          workerDeps(prisma, { policyLink: true, robotsTxt: true, pricing: false }),
          first.id,
        )
      ).outcome,
    ).toBe('Completed');
    const brokenLink = await prisma.issue.findFirstOrThrow({
      where: { scanId: first.id, ruleId: 'SEO-TECH-006' },
    });

    const second = await queueCompleteScan(prisma, account);
    expect(
      (
        await processScan(
          workerDeps(prisma, {
            policyLink: true,
            robotsTxt: true,
            pricing: true,
            disallow: '/privacy',
          }),
          second.id,
        )
      ).outcome,
    ).toBe('Completed');

    const entry = (await coverageOf(prisma, second.id, 'SEO')).coverage.get('SEO-TECH-006');
    // The gap is real and recorded: still asked about, no answer this run.
    expect(entry?.requestedInputs?.has(`${ORIGIN}/privacy`)).toBe(true);
    expect(entry?.inputTargets.has(`${ORIGIN}/privacy`)).toBe(false);
    // And it does not touch a finding that never rested on that page.
    expect(entry?.inputTargets.has(`${ORIGIN}/pricing`)).toBe(true);
    const after = await prisma.issue.findUniqueOrThrow({ where: { id: brokenLink.id } });
    expect(after.status).toBe('Resolved');
  });

  it('a run under a different scope is not compared at all', async () => {
    // Same two repairs as the first test of this block — which does resolve
    // them — plus one change: the owner excluded /pricing from the crawl. A URL
    // dropped by a scope filter leaves no trace in the crawl result (not in
    // pages, skippedOverLimit, blockedByRobots or errors), so the rules whose
    // demand is "every URL the crawl saw" would read it as a page removed from
    // the site. The two runs are therefore not comparable, and the policy keeps
    // the previous statuses instead of guessing.
    db = await createTestDb();
    const prisma = db.prisma;
    const account = await seedAccountWithProfile(prisma);

    const first = await queueCompleteScan(prisma, account);
    expect(
      (
        await processScan(
          workerDeps(prisma, { policyLink: false, robotsTxt: false, pricing: true }),
          first.id,
        )
      ).outcome,
    ).toBe('Completed');
    const privacyIssue = await prisma.issue.findFirstOrThrow({
      where: { scanId: first.id, ruleId: 'PRIVACY-004' },
    });
    const robotsIssue = await prisma.issue.findFirstOrThrow({
      where: { scanId: first.id, ruleId: 'SEO-TECH-001' },
    });

    const second = await queueCompleteScan(prisma, account, { excludePatterns: ['/pricing'] });
    expect(
      (
        await processScan(
          workerDeps(prisma, { policyLink: true, robotsTxt: true, pricing: true }),
          second.id,
        )
      ).outcome,
    ).toBe('Completed');

    // The narrowing really happened: the crawl of the second run never judged
    // /pricing, and its stored proof records a different request context.
    const secondSeo = await coverageOf(prisma, second.id, 'SEO');
    const checkedNow = secondSeo.coverage.get('SEO-TECH-004')?.checkedTargets;
    expect(checkedNow?.has(`${ORIGIN}/`)).toBe(true);
    expect(checkedNow?.has(`${ORIGIN}/pricing`)).toBe(false);
    const scopeOf = async (scanId: string): Promise<string | null | undefined> =>
      (await coverageOf(prisma, scanId, 'SEO')).coverage.get('SEO-TECH-004')?.context.crawlScope;
    expect(await scopeOf(second.id)).not.toBe(await scopeOf(first.id));
    // v3 since the fingerprint gained the render mode, the API checks and the
    // country the crawl left from: each changes what a run reads at the same
    // address, so a proof written before they were part of it cannot be
    // compared with one written after.
    expect(await scopeOf(second.id)).toEqual(expect.stringMatching(/^scope-v3:/));

    for (const issue of [privacyIssue, robotsIssue]) {
      const after = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
      expect(after.status).toBe('New');
    }
  });

  it('keeps only the proofs the policy can still read', async () => {
    // Three Complete runs of one profile: the oldest proof can never be opened
    // again, and the worker removes it once the comparison is done.
    db = await createTestDb();
    const prisma = db.prisma;
    const account = await seedAccountWithProfile(prisma);
    const shape: SiteShape = { policyLink: true, robotsTxt: true, pricing: true };

    const scans: string[] = [];
    for (let run = 0; run < 3; run += 1) {
      const scan = await queueCompleteScan(prisma, account);
      expect((await processScan(workerDeps(prisma, shape), scan.id)).outcome).toBe('Completed');
      scans.push(scan.id);
    }

    const [oldest, middle, newest] = scans;
    expect(await prisma.ruleCoverageProof.count({ where: { scanId: oldest } })).toBe(0);
    expect(await prisma.ruleCoverageProof.count({ where: { scanId: middle } })).toBeGreaterThan(0);
    expect(await prisma.ruleCoverageProof.count({ where: { scanId: newest } })).toBeGreaterThan(0);
    // The report of the pruned scan is untouched: only the internal proof goes.
    expect(await prisma.scanModule.count({ where: { scanId: oldest } })).toBeGreaterThan(0);
  });
});
