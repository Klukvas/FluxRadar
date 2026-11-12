// Worker language capture and historical compatibility, with local transports only.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient, Scan } from '@prisma/client';
import {
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
  buildPrompt,
  aiRequestKey,
  mockRoutingProvider,
} from '@fluxradar/ai';
import type { AiProvider, MockAiFixture } from '@fluxradar/ai';
import type { CrawlFetcher } from '@fluxradar/crawler';
import type { SafeFetchResult } from '@fluxradar/safe-fetch';
import { scanScopeSchema } from '@fluxradar/contracts';
import { silentLogger } from '../http/logger.ts';
import { captureExecutionConfig } from '../profiles/execution-config.ts';
import { fakePerformanceRunner } from '../test-utils/performance-fixtures.ts';
import { defaultGeoFixtures, GEO_VISIBILITY_PROVIDERS } from './geo.ts';
import { processScan } from './worker.ts';
import type { WorkerDeps } from './deps.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedScan,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';

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
    collectSiteSecurityFacts: async () => ({}),
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

async function moduleRow(prisma: PrismaClient, scanId: string, module: string) {
  return prisma.scanModule.findUniqueOrThrow({ where: { scanId_module: { scanId, module } } });
}

describe('frozen GEO language in the real worker and module retry', () => {
  let db: TestDb | undefined;
  afterEach(async () => {
    await db?.cleanup();
    db = undefined;
  });
  it.each(['en', 'uk', 'ru'] as const)(
    'keeps %s after profile edits and worker retries',
    async (aiLanguage) => {
      db = await createTestDb();
      const prisma = db.prisma;
      const account = await seedAccountWithProfile(prisma);
      const scan = await queueCompleteScan(prisma, account);
      const profile = await prisma.siteProfile.update({
        where: { id: account.siteProfileId },
        data: {
          industry: 'SaaS',
          offerings: 'website audits',
          language: 'pl',
          targetLanguages: 'Polish',
        },
      });
      const configJson = JSON.stringify(
        captureExecutionConfig(
          profile,
          'Complete',
          scanScopeSchema.parse({ includeSubdomains: false }),
          aiLanguage,
        ),
      );
      await prisma.scan.update({
        where: { id: scan.id },
        data: { executionConfigJson: configJson },
      });
      await prisma.siteProfile.update({
        where: { id: account.siteProfileId },
        data: { language: 'de', targetLanguages: 'German', name: 'Changed after launch' },
      });
      const provider = aiProvider();
      const send = vi.spyOn(provider, 'send');
      const deps = workerDeps(
        prisma,
        { policyLink: true, robotsTxt: true, pricing: true },
        { createAiProvider: () => provider },
      );
      await processScan(deps, scan.id);
      const first = await moduleRow(prisma, scan.id, 'AI SEO / GEO');
      expect(JSON.parse(first.metadataJson)).toMatchObject({ language: aiLanguage });
      const questions = send.mock.calls
        .filter(([request]) => request.promptVersion.endsWith('-closed-book'))
        .map(([request]) => request.question);
      expect(questions.length).toBeGreaterThan(0);
      expect(questions.join(' ')).not.toContain('Changed after launch');
      const name = { en: 'English', uk: 'Ukrainian', ru: 'Russian' }[aiLanguage];
      for (const [request] of send.mock.calls.filter(
        ([request]) =>
          request.promptVersion.endsWith('-closed-book') ||
          request.promptVersion.endsWith('-discovery'),
      ))
        expect(request.systemInstructions).toContain(`Answer in ${name}.`);
      const firstKeys = await prisma.aiResponseRecord.findMany({
        where: { scanId: scan.id, module: 'AI SEO / GEO' },
        select: { aiRequestKey: true },
      });
      // Reproduce the persisted state the retry route creates, without HTTP or a provider charge.
      await prisma.scan.update({ where: { id: scan.id }, data: { status: 'Running' } });
      await prisma.job.updateMany({
        where: { scanId: scan.id },
        data: { status: 'Pending', type: 'module-retry:AI SEO / GEO', claimedAt: null },
      });
      send.mockClear();
      await processScan(deps, scan.id);
      expect(
        (await prisma.scan.findUniqueOrThrow({ where: { id: scan.id } })).executionConfigJson,
      ).toBe(configJson);
      expect(
        JSON.parse((await moduleRow(prisma, scan.id, 'AI SEO / GEO')).metadataJson),
      ).toMatchObject({ language: aiLanguage });
      const retried = send.mock.calls
        .filter(([request]) => request.promptVersion.endsWith('-closed-book'))
        .map(([request]) => request.question);
      expect(retried).toEqual(questions);
      const retryKeys = await prisma.aiResponseRecord.findMany({
        where: { scanId: scan.id, module: 'AI SEO / GEO' },
        select: { aiRequestKey: true },
      });
      expect(retryKeys.map((row) => row.aiRequestKey).sort()).toEqual(
        firstKeys.map((row) => row.aiRequestKey).sort(),
      );
    },
  );
});

describe('historical language snapshots through the actual worker', () => {
  let db: TestDb | undefined;
  afterEach(async () => {
    await db?.cleanup();
    db = undefined;
  });
  const goldens = JSON.parse(
    readFileSync(new URL('./geo-language.legacy.json', import.meta.url), 'utf8'),
  ) as {
    records: Readonly<Record<string, { promptDigest: string; systemDigest: string; key: string }>>;
  };
  const snapshotBase =
    '{"schemaVersion":1,"source":"launch","profileConfigVersion":1,"profile":{"name":"Smile Clinic","domain":"https://smile.example","industry":"Dental clinic","targetLanguages":"Polish, German","language":"pl"},"scope":{"includeSubdomains":false},';
  it.each([
    ['Free', 'en', snapshotBase + '"plan":"Free","language":"en"}'],
    ['Free', 'uk', snapshotBase + '"plan":"Free","language":"uk"}'],
    ['Basic', undefined, snapshotBase + '"plan":"Basic"}'],
  ] as const)(
    'runs serialized legacy %s/%s with pinned original prompts',
    async (plan, language, snapshot) => {
      db = await createTestDb();
      const prisma = db.prisma;
      const account = await seedAccountWithProfile(prisma);
      const { scan } = await seedScan(prisma, {
        account,
        plan,
        status: 'Pending',
        withPurchase: false,
      });
      await prisma.scan.update({
        where: { id: scan.id },
        data: { domain: 'https://smile.example', executionConfigJson: snapshot },
      });
      await prisma.aiConsent.create({
        data: {
          accountId: account.accountId,
          scanId: scan.id,
          providersJson: JSON.stringify(GEO_VISIBILITY_PROVIDERS),
          noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
        },
      });
      await prisma.job.create({ data: { scanId: scan.id, type: 'scan', status: 'Pending' } });
      const provider = mockRoutingProvider(
        [
          {
            questionIncludes: 'Generate neutral discovery questions',
            response: {
              status: 'completed',
              output_text: JSON.stringify({
                questions: [
                  'Which dental clinics offer implants?',
                  'Where can families find dental care?',
                ],
              }),
            },
          },
          ...defaultGeoFixtures('Smile Clinic', 'smile.example'),
          ...['Which dental clinics offer implants?', 'Where can families find dental care?'].map(
            (questionIncludes): MockAiFixture => ({
              questionIncludes,
              response: {
                status: 'completed',
                output_text: 'I have no reliable information about the business.',
              },
            }),
          ),
        ],
        GEO_VISIBILITY_PROVIDERS,
      );
      const send = vi.spyOn(provider, 'send');
      await processScan(
        workerDeps(
          prisma,
          { policyLink: true, robotsTxt: true, pricing: true },
          { createAiProvider: () => provider, freeCheckAllowedOrigins: new Set() },
        ),
        scan.id,
      );
      const direct = send.mock.calls.find(
        ([request]) =>
          request.provider === 'anthropic' && request.promptVersion.endsWith('-closed-book'),
      )?.[0];
      if (direct === undefined) throw new Error('historical worker asked no direct question');
      const expected = goldens.records[plan === 'Free' ? `free-${language}` : 'paid-1'];
      const prompt = buildPrompt(direct).promptText;
      expect(createHash('sha256').update(prompt).digest('hex')).toBe(expected?.promptDigest);
      expect(
        aiRequestKey(
          'legacy-language-proof',
          direct.provider,
          prompt,
          direct.sequence,
          direct.keyIdentity,
        ),
      ).toBe(expected?.key);
      const judge = send.mock.calls.find(([request]) =>
        request.promptVersion.startsWith('geo-answer-evaluation-'),
      )?.[0];
      if (judge === undefined) throw new Error('historical worker asked no judge');
      expect(createHash('sha256').update(judge.systemInstructions).digest('hex')).toBe(
        goldens.records[plan === 'Free' ? `free-${language}-judge` : 'paid-judge']?.systemDigest,
      );
      if (plan === 'Basic') {
        const generator = send.mock.calls.find(
          ([request]) => request.promptVersion === 'geo-query-generation-v2',
        )?.[0];
        if (generator === undefined) throw new Error('historical worker asked no generator');
        expect(createHash('sha256').update(buildPrompt(generator).promptText).digest('hex')).toBe(
          goldens.records['paid-generator']?.promptDigest,
        );
        const discoveries = send.mock.calls.filter(
          ([request]) =>
            request.provider === 'anthropic' && request.promptVersion.endsWith('-discovery'),
        );
        expect(discoveries).toHaveLength(2);
        discoveries.forEach(([request], index) =>
          expect(createHash('sha256').update(buildPrompt(request).promptText).digest('hex')).toBe(
            goldens.records[`paid-${index + 3}`]?.promptDigest,
          ),
        );
      }
      expect(
        (await prisma.scan.findUniqueOrThrow({ where: { id: scan.id } })).executionConfigJson,
      ).toBe(snapshot);
    },
  );
});
