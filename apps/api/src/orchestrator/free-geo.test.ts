// The Free GEO preview (D-236): exactly one closed-book question to Anthropic,
// one evaluation of its answer, the tariff quota enforcing that ceiling, nothing
// sent without consent — and none of it reaching the Free score.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  AiQuotaTracker,
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
  mockRoutingProvider,
  runGeoModule,
} from '@fluxradar/ai';
import type { AiConsent, AiProvider, AiProviderName, AiRequest } from '@fluxradar/ai';
import { TARIFFS } from '@fluxradar/contracts';
import { createSiteContext } from '@fluxradar/rules';
import { computeOverallScore } from '@fluxradar/scoring';
import type { CrawlSummary } from '@fluxradar/contracts';
import type { PrismaClient, SiteProfile } from '@prisma/client';

import {
  decideFreeGeo,
  freeGeoConsent,
  freePreviewFacts,
  geoStageReached,
  freeGeoRequests,
  freePreviewAlreadyRequested,
  runFreeGeoPreview,
  skippedQuestionGeneration,
} from './free-geo.ts';
import { buildScanEvidence } from './geo-evidence.ts';
import { freePreviewSkippedRow, geoModuleRow } from './geo-module-row.ts';
import { closedBookQuestions, defaultGeoFixtures } from './geo.ts';
import { markEveryModuleUnreadable, setModule } from './module-persistence.ts';
import { FREE_PREVIEW_REQUESTED_METADATA, prepareModuleRows } from './module-rows.ts';

const SCAN_ID = 'scan-free-1';
const BRAND = 'Smile Clinic';
const HOST = 'smile.example';

const READINESS = {
  automation: 'public-http-dom',
  providerTokenRequired: false,
  robots: { present: true, aiCrawlersBlocked: [] },
  pages: { checked: 1, withMainContent: 1 },
  limitations: [],
} as unknown as Parameters<typeof geoModuleRow>[2];

function consent(providers: readonly AiProviderName[]): AiConsent {
  return { scanId: SCAN_ID, providers, noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION };
}

function siteContext() {
  const html =
    '<html><head><title>Smile Clinic — dental care</title></head>' +
    '<body><h1>Implants</h1><p>We place implants and see emergency patients.</p></body></html>';
  return createSiteContext({
    origin: `https://${HOST}`,
    plan: 'Free',
    crawl: {
      pages: [
        {
          requestedUrl: `https://${HOST}/`,
          normalizedUrl: `https://${HOST}/`,
          depth: 0,
          finalUrl: `https://${HOST}/`,
          status: 200,
          headers: { 'content-type': 'text/html' },
          redirectChain: [],
          html,
          contentType: 'text/html',
          timingMs: 10,
          truncated: false,
        },
      ],
      skippedOverLimit: [],
      blockedByRobots: [],
      errors: [],
      urlVariants: {},
      sitemapUrls: [],
      rejectedSeeds: [],
      rendering: { status: 'NotRequested' },
      resources: [],
      pendingQueue: [],
      stoppedEarly: false,
      scope: { origin: `https://${HOST}`, includeSubdomains: false, maxPages: 1 },
    },
  });
}

const PROFILE = {
  id: 'profile-1',
  accountId: 'account-1',
  name: BRAND,
  domain: `https://${HOST}`,
  industry: 'Dental clinic',
  region: 'Kyiv',
  businessDescription: 'Dental clinic with implants',
  offerings: 'implants',
  scanConfigJson: '{}',
  scanConfigVersion: 1,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} as unknown as SiteProfile;

/** The worker's test provider, recording every request that reaches a transport. */
function recordingProvider(): { provider: AiProvider; sent: AiRequest[] } {
  const inner = mockRoutingProvider(defaultGeoFixtures(BRAND, HOST), [
    'anthropic',
    'openai',
    'google',
    'perplexity',
  ]);
  const sent: AiRequest[] = [];
  return {
    sent,
    provider: {
      config: inner.config,
      send: (request, promptText, signal) => {
        sent.push(request);
        return inner.send(request, promptText, signal);
      },
    },
  };
}

async function runPreview(previewConsent: AiConsent | null) {
  const { provider, sent } = recordingProvider();
  const quota = AiQuotaTracker.forPlan('Free');
  const generation = skippedQuestionGeneration(quota);
  const evidence = previewConsent === null ? null : buildScanEvidence(siteContext(), PROFILE, HOST);
  const geo = await runGeoModule(
    {
      scanId: SCAN_ID,
      plan: 'Free',
      brand: BRAND,
      siteOrigin: `https://${HOST}`,
      siteDomain: HOST,
      consent: previewConsent,
      requests: freeGeoRequests(SCAN_ID, BRAND, HOST),
      evidence,
    },
    { provider, quota: generation.quota },
  );
  const row = geoModuleRow(
    geo,
    generation,
    READINESS,
    geo.evaluatedEvidence,
    HOST,
    BRAND,
    [],
    'free-preview',
  );
  return { geo, row, sent };
}

describe('Free GEO preview requests', () => {
  it('is the first closed-book question, to Anthropic, without search', () => {
    const requests = freeGeoRequests(SCAN_ID, BRAND, HOST);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      provider: 'anthropic',
      sequence: 1,
      question: closedBookQuestions(BRAND, HOST)[0],
      promptVersion: 'geo-questions-v5-closed-book',
      brandFacts: [],
      pageTitles: [],
    });
    expect(requests[0]).not.toHaveProperty('webSearch');
  });

  it('asks about the domain when the brand is the hostname', () => {
    const [request] = freeGeoRequests(SCAN_ID, HOST, HOST);
    expect(request?.question).toContain(`business associated with ${HOST}`);
  });
});

describe('Free GEO preview consent', () => {
  it('narrows any record to Anthropic and never widens it', () => {
    expect(freeGeoConsent(consent(['anthropic', 'openai', 'google']))?.providers).toEqual([
      'anthropic',
    ]);
    expect(freeGeoConsent(consent(['openai']))).toBeNull();
    expect(freeGeoConsent(null)).toBeNull();
  });
});

describe('Free GEO preview run', () => {
  it('sends one question and one evaluation, both to Anthropic, within the tariff limit', async () => {
    const { geo, row, sent } = await runPreview(consent(['anthropic']));

    expect(sent.map((request) => request.provider)).toEqual(['anthropic', 'anthropic']);
    expect(
      sent.filter((request) => request.promptVersion.startsWith('geo-questions')),
    ).toHaveLength(1);
    expect(sent.some((request) => /discovery/.test(request.promptVersion))).toBe(false);
    expect(geo.quota.spent).toBe(2);
    expect(geo.quota.spent).toBeLessThanOrEqual(TARIFFS.Free.aiRequestLimit);
    expect(geo.responses).toHaveLength(1);

    expect(row.runtimeStatus).toBe('Completed');
    expect(row.score).toBeNull();
    expect(row.usableOutput).toBe(true);
    const metadata = JSON.parse(row.metadataJson ?? '{}') as Record<string, unknown>;
    expect(metadata.freePreview).toBe(true);
    expect(metadata.providerVisibility).toMatchObject({
      providers: ['anthropic'],
      webSearch: { discovery: false, closedBook: false },
    });
  });

  it('asks no provider anything when a stored record names only OpenAI', async () => {
    const { sent } = await runPreview(freeGeoConsent(consent(['openai'])));
    expect(sent).toEqual([]);
  });

  it('without consent sends nothing and reports Not applicable / ConsentMissing', async () => {
    const { provider, sent } = recordingProvider();
    const result = await runFreeGeoPreview({
      scanId: SCAN_ID,
      brand: BRAND,
      siteOrigin: `https://${HOST}`,
      siteHostname: HOST,
      language: 'en',
      facts: { consent: null, allowlistedOrigin: false, alreadyRequested: false },
      buildEvidence: () => buildScanEvidence(siteContext(), PROFILE, HOST),
      provider,
      quota: AiQuotaTracker.forPlan('Free'),
    });

    expect(sent).toEqual([]);
    expect(result).toEqual({ kind: 'skipped', reason: 'ConsentMissing' });
    if (result.kind !== 'skipped') throw new Error('expected a skipped preview');
    // The one builder for the Free "not asked" row.
    expect(freePreviewSkippedRow(result.reason, READINESS)).toMatchObject({
      runtimeStatus: 'Not applicable',
      statusReason: 'ConsentMissing',
      applicableChecks: 0,
      completedApplicableChecks: 0,
      usableOutput: false,
      score: null,
    });
  });

  it('never moves the Free score, answered or not', async () => {
    const seo = {
      module: 'SEO' as const,
      moduleStatus: 'Completed' as const,
      coverage: 1,
      score: 82.5,
      usableOutput: true,
    };
    const alone = computeOverallScore('Free', [seo]);
    const skipped = freePreviewSkippedRow('ConsentMissing', READINESS);
    const asked = (await runPreview(consent(['anthropic']))).row;
    for (const row of [asked, skipped]) {
      const geo = {
        module: 'AI SEO / GEO' as const,
        moduleStatus: row.runtimeStatus as 'Completed' | 'Not applicable',
        coverage: row.coverage ?? 0,
        score: row.score ?? null,
        usableOutput: row.usableOutput ?? false,
      };
      expect(computeOverallScore('Free', [seo, geo])).toEqual(alone);
    }
    expect(alone.score).toBe(82.5);
  });
});

// The wiring run-attempt.ts uses for the Free GEO stage, end to end short of the
// database: decision, requests, quota and the provider calls actually made.
describe('runFreeGeoPreview', () => {
  async function preview(facts: Parameters<typeof decideFreeGeo>[0]) {
    const { provider, sent } = recordingProvider();
    const result = await runFreeGeoPreview({
      scanId: SCAN_ID,
      brand: BRAND,
      siteOrigin: `https://${HOST}`,
      siteHostname: HOST,
      language: 'en',
      facts,
      buildEvidence: () => buildScanEvidence(siteContext(), PROFILE, HOST),
      provider,
      quota: AiQuotaTracker.forPlan('Free'),
    });
    return { result, sent };
  }

  const consented = {
    consent: consent(['anthropic']),
    allowlistedOrigin: false,
    alreadyRequested: false,
  };

  it('sends exactly two Anthropic requests and never asks for discovery questions', async () => {
    const { result, sent } = await preview(consented);
    expect(result.kind).toBe('asked');
    expect(sent).toHaveLength(2);
    expect(sent.every((request) => request.provider === 'anthropic')).toBe(true);
    expect(sent.some((request) => request.promptVersion.startsWith('geo-query-generation'))).toBe(
      false,
    );
  });

  it.each([
    ['no consent', { ...consented, consent: null }, 'ConsentMissing'],
    [
      'an allowlisted origin',
      { ...consented, allowlistedOrigin: true },
      'FreePreviewAllowlistedOrigin',
    ],
    [
      'an earlier attempt that asked',
      { ...consented, alreadyRequested: true },
      'FreePreviewAlreadyRequested',
    ],
  ] as const)('sends nothing for %s', async (_label, facts, reason) => {
    const { result, sent } = await preview(facts);
    expect(sent).toEqual([]);
    expect(result).toEqual({ kind: 'skipped', reason });
  });

  // Pinned order: allowlisted origin > missing consent > already requested.
  it.each([
    [
      { consent: null, allowlistedOrigin: true, alreadyRequested: true },
      'FreePreviewAllowlistedOrigin',
    ],
    [
      { ...consented, allowlistedOrigin: true, alreadyRequested: true },
      'FreePreviewAllowlistedOrigin',
    ],
    [{ consent: null, allowlistedOrigin: false, alreadyRequested: true }, 'ConsentMissing'],
    [{ ...consented, alreadyRequested: true }, 'FreePreviewAlreadyRequested'],
  ] as const)('decides %o as %s', (facts, reason) => {
    expect(decideFreeGeo(facts)).toEqual({ kind: 'skip', reason });
  });
});

/**
 * An in-memory stand-in for the two tables the guard reads, applying the same
 * `where` the real queries send: rows are written with the production writers
 * (setModule, markEveryModuleUnreadable) and read back through the real query.
 */
function fakeScanStore() {
  type Row = { runtimeStatus: string; metadataJson: string | null };
  type ModuleFilter = { scanId: string; module?: string | { in: string[] } };
  const modules = new Map<string, Row>();
  let answers: { scanId: string; module: string }[] = [];
  // Simulates a process that dies at the next row write.
  let upsertFails = false;
  const order: string[] = [];
  const key = (scanId: string, module: string): string => `${scanId}|${module}`;
  const matches = (where: ModuleFilter, scanId: string, module: string): boolean =>
    where.scanId === scanId &&
    (where.module === undefined ||
      (typeof where.module === 'string'
        ? where.module === module
        : where.module.in.includes(module)));
  const prisma = {
    scanModule: {
      // Like Prisma: create when absent, otherwise apply only the fields given.
      upsert: (args: {
        where: { scanId_module: { scanId: string; module: string } };
        create: { runtimeStatus: string; metadataJson?: string };
        update: { runtimeStatus?: string; metadataJson?: string };
      }) => {
        if (upsertFails) return Promise.reject(new Error('process died at the row write'));
        const { scanId, module } = args.where.scanId_module;
        const existing = modules.get(key(scanId, module));
        modules.set(
          key(scanId, module),
          existing === undefined
            ? {
                runtimeStatus: args.create.runtimeStatus,
                metadataJson: args.create.metadataJson ?? null,
              }
            : {
                runtimeStatus: args.update.runtimeStatus ?? existing.runtimeStatus,
                metadataJson: args.update.metadataJson ?? existing.metadataJson,
              },
        );
        return Promise.resolve({});
      },
      findFirst: (args: { where: { scanId: string; module: string } }) => {
        order.push('read-guard');
        return Promise.resolve(modules.get(key(args.where.scanId, args.where.module)) ?? null);
      },
      deleteMany: (args: { where: ModuleFilter }) => {
        order.push('clear');
        for (const stored of [...modules.keys()]) {
          const [scanId = '', module = ''] = stored.split('|');
          if (matches(args.where, scanId, module)) modules.delete(stored);
        }
        return Promise.resolve({ count: 0 });
      },
    },
    aiResponseRecord: {
      count: (args: { where: { scanId: string; module: string } }) =>
        Promise.resolve(
          answers.filter((answer) => matches(args.where, answer.scanId, answer.module)).length,
        ),
      deleteMany: (args: { where: ModuleFilter }) => {
        answers = answers.filter((answer) => !matches(args.where, answer.scanId, answer.module));
        return Promise.resolve({ count: 0 });
      },
    },
    issue: { deleteMany: () => Promise.resolve({ count: 0 }) },
    // Modelled explicitly: the callback runs against the same store, and a
    // throw restores the snapshot taken before it, as a rolled-back
    // transaction leaves the database.
    $transaction: async (run: (tx: unknown) => Promise<void>) => {
      const savedModules = new Map(modules);
      const savedAnswers = [...answers];
      order.push('begin');
      try {
        await run(prisma);
      } catch (error) {
        modules.clear();
        for (const [stored, row] of savedModules) modules.set(stored, row);
        answers = savedAnswers;
        throw error;
      }
    },
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    storeAnswer: (scanId: string) => answers.push({ scanId, module: 'AI SEO / GEO' }),
    row: (module = 'AI SEO / GEO') => modules.get(key(SCAN_ID, module)),
    answerCount: () => answers.length,
    failUpserts: () => {
      upsertFails = true;
    },
    order,
  };
}

const UNREADABLE_CRAWL = { reach: 'unreachable' } as unknown as CrawlSummary;

describe('freePreviewAlreadyRequested', () => {
  it('is false for a first attempt', async () => {
    const { prisma } = fakeScanStore();
    expect(await freePreviewAlreadyRequested(prisma, SCAN_ID, undefined)).toBe(false);
  });

  // The external retry exists for a site that could not be read; its GEO row
  // was written by markEveryModuleUnreadable and no request was ever built.
  it('lets the retry of an unreadable site ask its opted-in question', async () => {
    const { prisma } = fakeScanStore();
    await markEveryModuleUnreadable(prisma, SCAN_ID, ['SEO', 'AI SEO / GEO'], UNREADABLE_CRAWL);
    expect(await freePreviewAlreadyRequested(prisma, SCAN_ID, undefined)).toBe(false);
    const facts = freePreviewFacts({
      consent: consent(['anthropic']),
      profileDomain: `https://${HOST}`,
      allowedOrigins: new Set(),
      alreadyRequested: await freePreviewAlreadyRequested(prisma, SCAN_ID, undefined),
    });
    expect(decideFreeGeo(facts).kind).toBe('ask');
  });

  it('lets a retry decide afresh after a preview that asked nothing', async () => {
    const { prisma } = fakeScanStore();
    await setModule(
      prisma,
      SCAN_ID,
      'AI SEO / GEO',
      freePreviewSkippedRow('ConsentMissing', READINESS),
    );
    expect(await freePreviewAlreadyRequested(prisma, SCAN_ID, undefined)).toBe(false);
  });

  it('blocks a retry once the stage started, wrote its row, or stored an answer', async () => {
    const running = fakeScanStore();
    await setModule(running.prisma, SCAN_ID, 'AI SEO / GEO', { runtimeStatus: 'Running' });
    expect(await freePreviewAlreadyRequested(running.prisma, SCAN_ID, undefined)).toBe(true);

    const written = fakeScanStore();
    const { row } = await runPreview(consent(['anthropic']));
    await setModule(written.prisma, SCAN_ID, 'AI SEO / GEO', row);
    expect(await freePreviewAlreadyRequested(written.prisma, SCAN_ID, undefined)).toBe(true);

    const answered = fakeScanStore();
    await markEveryModuleUnreadable(answered.prisma, SCAN_ID, ['AI SEO / GEO'], UNREADABLE_CRAWL);
    answered.storeAnswer(SCAN_ID);
    expect(await freePreviewAlreadyRequested(answered.prisma, SCAN_ID, undefined)).toBe(true);

    expect(await freePreviewAlreadyRequested(fakeScanStore().prisma, SCAN_ID, 'AI SEO / GEO')).toBe(
      true,
    );
  });

  it('reads only this scan’s rows', async () => {
    const { prisma, storeAnswer } = fakeScanStore();
    await setModule(prisma, 'other-scan', 'AI SEO / GEO', { runtimeStatus: 'Running' });
    storeAnswer('other-scan');
    expect(await freePreviewAlreadyRequested(prisma, SCAN_ID, undefined)).toBe(false);
  });
});

describe('geoStageReached', () => {
  it.each([
    ['no row', null, false],
    ['a Pending row', { runtimeStatus: 'Pending', metadataJson: null }, false],
    [
      'an unreadable-site row',
      { runtimeStatus: 'Unavailable', metadataJson: '{"crawl":{}}' },
      false,
    ],
    [
      'a skipped preview row',
      { runtimeStatus: 'Not applicable', metadataJson: '{"freePreview":true}' },
      false,
    ],
    ['a Running row', { runtimeStatus: 'Running', metadataJson: null }, true],
    [
      'a Pending row with the sticky marker',
      { runtimeStatus: 'Pending', metadataJson: '{"freePreview":true,"previewRequested":true}' },
      true,
    ],
    [
      'an unreadable-site row that kept the marker',
      { runtimeStatus: 'Unavailable', metadataJson: '{"previewRequested":true,"crawl":{}}' },
      true,
    ],
    [
      'a preview-stage Unavailable row',
      { runtimeStatus: 'Unavailable', metadataJson: '{"freePreview":true}' },
      true,
    ],
    ['an unparseable row', { runtimeStatus: 'Completed', metadataJson: '{' }, false],
  ] as const)('%s → %s', (_label, row, expected) => {
    expect(geoStageReached(row, 0, undefined)).toBe(expected);
  });
});

describe('freePreviewFacts', () => {
  it('checks the profile domain against the allowlist, normalised as the route does', () => {
    const allowed = new Set([`https://${HOST}`]);
    const facts = (profileDomain: string) =>
      freePreviewFacts({
        consent: null,
        profileDomain,
        allowedOrigins: allowed,
        alreadyRequested: false,
      });
    expect(facts(`https://${HOST}`).allowlistedOrigin).toBe(true);
    expect(facts(`https://${HOST.toUpperCase()}/`).allowlistedOrigin).toBe(true);
    expect(facts('https://other.example').allowlistedOrigin).toBe(false);
  });
});

// What runScanAttempt does with the rows before an attempt starts, run against
// the fake store: the guard is read BEFORE the clear, and its proof is written
// back so it survives any number of consecutive failed attempts.
describe('prepareModuleRows', () => {
  const continuing = {
    modules: ['AI SEO / GEO'],
    modulesToRun: ['AI SEO / GEO'],
    geoScope: 'free-preview' as const,
  };

  it('reads the guard before it clears the rows that prove it', async () => {
    const store = fakeScanStore();
    await setModule(store.prisma, SCAN_ID, 'AI SEO / GEO', { runtimeStatus: 'Running' });
    const { freePreviewRequestedBefore } = await prepareModuleRows(
      store.prisma,
      SCAN_ID,
      continuing,
    );
    expect(freePreviewRequestedBefore).toBe(true);
    expect(store.order).toEqual(['read-guard', 'begin', 'clear']);
  });

  it('keeps the proof across two failed attempts: Running -> clear -> Pending marker', async () => {
    const store = fakeScanStore();
    // A1 reached the AI step and died.
    await setModule(store.prisma, SCAN_ID, 'AI SEO / GEO', { runtimeStatus: 'Running' });
    // A2 resets the row and dies before the GEO stage.
    expect(
      (await prepareModuleRows(store.prisma, SCAN_ID, continuing)).freePreviewRequestedBefore,
    ).toBe(true);
    expect(store.row()?.runtimeStatus).toBe('Pending');
    expect(JSON.parse(store.row()?.metadataJson ?? '{}')).toMatchObject({ previewRequested: true });
    // A2's crawl may even find the site unreadable; the marker survives that too.
    await markEveryModuleUnreadable(
      store.prisma,
      SCAN_ID,
      ['AI SEO / GEO'],
      UNREADABLE_CRAWL,
      FREE_PREVIEW_REQUESTED_METADATA,
    );
    // A3 (and the external retry, which replaces everything) still refuses.
    expect(
      (await prepareModuleRows(store.prisma, SCAN_ID, continuing)).freePreviewRequestedBefore,
    ).toBe(true);
    expect(
      (await prepareModuleRows(store.prisma, SCAN_ID, { ...continuing, modules: null }))
        .freePreviewRequestedBefore,
    ).toBe(true);
  });

  it('writes no marker for a scan whose preview never reached the AI step', async () => {
    const store = fakeScanStore();
    await markEveryModuleUnreadable(store.prisma, SCAN_ID, ['AI SEO / GEO'], UNREADABLE_CRAWL);
    expect(
      (await prepareModuleRows(store.prisma, SCAN_ID, continuing)).freePreviewRequestedBefore,
    ).toBe(false);
    expect(store.row()?.metadataJson ?? null).toBeNull();
  });

  it('writes the unreadable-site row byte-for-byte as before without a marker', async () => {
    const store = fakeScanStore();
    await markEveryModuleUnreadable(store.prisma, SCAN_ID, ['AI SEO / GEO'], UNREADABLE_CRAWL);
    expect(store.row()?.metadataJson).toBe(JSON.stringify({ crawl: UNREADABLE_CRAWL }));
  });

  it('keeps the proof when A2 dies before its crawl (Pending + marker only)', async () => {
    const store = fakeScanStore();
    await setModule(store.prisma, SCAN_ID, 'AI SEO / GEO', { runtimeStatus: 'Running' });
    store.storeAnswer(SCAN_ID);
    await prepareModuleRows(store.prisma, SCAN_ID, continuing); // A2, then it dies.
    expect(store.answerCount()).toBe(0);
    expect(
      (await prepareModuleRows(store.prisma, SCAN_ID, continuing)).freePreviewRequestedBefore,
    ).toBe(true); // A3
  });

  it('clears and re-marks atomically: a death at the marker write loses nothing', async () => {
    const store = fakeScanStore();
    await setModule(store.prisma, SCAN_ID, 'AI SEO / GEO', { runtimeStatus: 'Running' });
    store.storeAnswer(SCAN_ID);
    store.failUpserts();
    await expect(prepareModuleRows(store.prisma, SCAN_ID, continuing)).rejects.toThrow(
      'process died',
    );
    // Rolled back: the Running row and the stored answer are still the proof.
    expect(store.row()?.runtimeStatus).toBe('Running');
    expect(store.answerCount()).toBe(1);
    expect(store.order).toEqual(['read-guard', 'begin', 'clear']);
    expect(await freePreviewAlreadyRequested(store.prisma, SCAN_ID, undefined)).toBe(true);
  });

  it('never reads the guard for a paid scan', async () => {
    const store = fakeScanStore();
    await setModule(store.prisma, SCAN_ID, 'AI SEO / GEO', { runtimeStatus: 'Running' });
    const result = await prepareModuleRows(store.prisma, SCAN_ID, {
      ...continuing,
      geoScope: 'full',
    });
    expect(result.freePreviewRequestedBefore).toBe(false);
    expect(store.order).not.toContain('read-guard');
    // The paid path keeps its separate writes: no transaction around them.
    expect(store.order).not.toContain('begin');
  });
});

// Only runScanAttempt hands the profile domain to the allowlist check; the
// database suite exercises it at runtime, this pins the call site.
describe('run-attempt.ts allowlist wiring', () => {
  const source = readFileSync(new URL('./run-attempt.ts', import.meta.url), 'utf8');

  it('hands the profile domain to the allowlist check', () => {
    expect(source).toMatch(/freePreviewFacts\(\{[^}]*profileDomain: profile\.domain,/);
  });
});

describe('freePreviewSkippedRow', () => {
  it('carries the sticky marker only when the AI step was already reached', () => {
    const marked = (reason: Parameters<typeof freePreviewSkippedRow>[0]) =>
      (
        JSON.parse(freePreviewSkippedRow(reason, READINESS).metadataJson ?? '{}') as {
          previewRequested?: boolean;
        }
      ).previewRequested === true;
    expect(marked('FreePreviewAlreadyRequested')).toBe(true);
    expect(marked('ConsentMissing')).toBe(false);
    expect(marked('FreePreviewAllowlistedOrigin')).toBe(false);
    const row = freePreviewSkippedRow('FreePreviewAlreadyRequested', READINESS);
    expect(
      geoStageReached(
        { runtimeStatus: row.runtimeStatus, metadataJson: row.metadataJson ?? null },
        0,
        undefined,
      ),
    ).toBe(true);
  });

  it('is an honest Not applicable row naming the reason, with no requests', () => {
    const row = freePreviewSkippedRow('FreePreviewAllowlistedOrigin', READINESS);
    expect(row).toMatchObject({
      runtimeStatus: 'Not applicable',
      statusReason: 'FreePreviewAllowlistedOrigin',
      applicableChecks: 0,
      usableOutput: false,
      score: null,
    });
    const metadata = JSON.parse(row.metadataJson ?? '{}') as {
      freePreview?: boolean;
      providerVisibility?: { requests?: unknown[] };
    };
    expect(metadata.freePreview).toBe(true);
    expect(metadata.providerVisibility?.requests).toEqual([]);
  });
});
