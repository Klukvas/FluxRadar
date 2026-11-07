// The Free GEO preview in the scan's AI language (D-237): the question, the
// answer and the judged claims are Ukrainian for a Ukrainian scan, English
// stays byte-identical to the paid first closed-book request, and the D-236
// per-scan ceiling holds in both languages.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  AiQuotaTracker,
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
  GEO_EVALUATION_CAPS,
  GEO_EVALUATION_PROMPT_VERSION,
  GEO_EVALUATION_SYSTEM_INSTRUCTIONS,
  GEO_EVALUATION_UKRAINIAN_INSTRUCTION,
  GEO_EVALUATION_UKRAINIAN_MAX_OUTPUT_TOKENS,
  mockRoutingProvider,
} from '@fluxradar/ai';
import type { AiConsent, AiProvider, AiRequest, GeoAnswerLanguage } from '@fluxradar/ai';
import { TARIFFS } from '@fluxradar/contracts';
import { createSiteContext } from '@fluxradar/rules';
import type { SiteProfile } from '@prisma/client';

import { freeGeoRequests, geoStageReached, runFreeGeoPreview } from './free-geo.ts';
import { UKRAINIAN_ANSWER_INSTRUCTION, ukrainianClosedBookQuestion } from './free-geo-question.ts';
import { buildScanEvidence } from './geo-evidence.ts';
import { geoModuleRow } from './geo-module-row.ts';
import {
  buildGeoRequests,
  defaultGeoFixtures,
  GEO_CLOSED_BOOK_SYSTEM_INSTRUCTIONS,
} from './geo.ts';

const SCAN_ID = 'scan-free-uk';
const BRAND = 'Smile Clinic';
const HOST = 'smile.example';

const READINESS = {
  automation: 'public-http-dom',
  providerTokenRequired: false,
  robots: { present: true, aiCrawlersBlocked: [] },
  pages: { checked: 1, withMainContent: 1 },
  limitations: [],
} as unknown as Parameters<typeof geoModuleRow>[2];

const CONSENT: AiConsent = {
  scanId: SCAN_ID,
  providers: ['anthropic'],
  noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
};

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

function siteContext() {
  const html =
    '<html><head><title>Smile Clinic — dental care</title></head>' +
    '<body><h1>Implants</h1><p>We place implants and see emergency patients.</p></body></html>';
  const url = `https://${HOST}/`;
  return createSiteContext({
    origin: `https://${HOST}`,
    plan: 'Free',
    crawl: {
      pages: [
        {
          requestedUrl: url,
          normalizedUrl: url,
          depth: 0,
          finalUrl: url,
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

function recordingProvider(brand = BRAND): { provider: AiProvider; sent: AiRequest[] } {
  const inner = mockRoutingProvider(defaultGeoFixtures(brand, HOST), ['anthropic']);
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

async function preview(
  language: GeoAnswerLanguage,
  options: { brand?: string; alreadyRequested?: boolean } = {},
) {
  const brand = options.brand ?? BRAND;
  const { provider, sent } = recordingProvider(brand);
  const result = await runFreeGeoPreview({
    scanId: SCAN_ID,
    brand,
    siteOrigin: `https://${HOST}`,
    siteHostname: HOST,
    language,
    facts: {
      consent: CONSENT,
      allowlistedOrigin: false,
      alreadyRequested: options.alreadyRequested ?? false,
    },
    buildEvidence: () => buildScanEvidence(siteContext(), PROFILE, HOST),
    provider,
    quota: AiQuotaTracker.forPlan('Free'),
  });
  return { result, sent };
}

async function askedPreview(language: GeoAnswerLanguage, brand?: string) {
  const { result, sent } = await preview(language, brand === undefined ? {} : { brand });
  if (result.kind !== 'asked') throw new Error('expected the preview to ask');
  return { ...result, sent };
}

describe('the Free question request', () => {
  it('is byte-identical to the paid first closed-book request in English', () => {
    const [paidFirst] = buildGeoRequests(SCAN_ID, BRAND, HOST, [], ['anthropic']);
    for (const request of [
      freeGeoRequests(SCAN_ID, BRAND, HOST),
      freeGeoRequests(SCAN_ID, BRAND, HOST, 'en'),
    ]) {
      expect(request).toHaveLength(1);
      expect(JSON.stringify(request[0])).toBe(JSON.stringify(paidFirst));
    }
    const [paidHostname] = buildGeoRequests(SCAN_ID, HOST, HOST, [], ['anthropic']);
    expect(JSON.stringify(freeGeoRequests(SCAN_ID, HOST, HOST, 'en')[0])).toBe(
      JSON.stringify(paidHostname),
    );
  });

  it('leaves the paid builder untouched: no language line anywhere', () => {
    const paid = buildGeoRequests(SCAN_ID, BRAND, HOST, ['Which clinic?']);
    expect(paid.some((request) => request.systemInstructions.includes('Ukrainian'))).toBe(false);
    expect(paid.some((request) => /[А-Яа-яІіЇїЄєҐґ]/.test(request.question))).toBe(false);
  });

  it('asks in Ukrainian with the no-guessing suffix and one extra system line', () => {
    const [request] = freeGeoRequests(SCAN_ID, BRAND, HOST, 'uk');
    expect(request).toMatchObject({
      provider: 'anthropic',
      sequence: 1,
      question:
        `Що вам відомо про ${BRAND}? Якщо ви цього не знаєте, скажіть, що не маєте ` +
        'інформації, замість того щоб вгадувати.',
      systemInstructions: `${GEO_CLOSED_BOOK_SYSTEM_INSTRUCTIONS} ${UKRAINIAN_ANSWER_INSTRUCTION}`,
      brandFacts: [],
      pageTitles: [],
      reasoningMode: 'disabled',
    });
    expect(request).not.toHaveProperty('webSearch');
    expect(request).not.toHaveProperty('caps');
    expect(UKRAINIAN_ANSWER_INSTRUCTION).toBe('Answer in Ukrainian.');
  });

  it('keeps the -closed-book prompt version in Ukrainian, so the answer stays closed-book', () => {
    const [english] = freeGeoRequests(SCAN_ID, BRAND, HOST, 'en');
    const [ukrainian] = freeGeoRequests(SCAN_ID, BRAND, HOST, 'uk');
    expect(ukrainian?.promptVersion).toBe(english?.promptVersion);
    expect(ukrainian?.promptVersion).toMatch(/-closed-book$/);
    expect(english?.systemInstructions).not.toContain(UKRAINIAN_ANSWER_INSTRUCTION);
  });

  it('asks about the domain in Ukrainian when the brand is the hostname', () => {
    const [request] = freeGeoRequests(SCAN_ID, HOST, HOST, 'uk');
    expect(request?.question).toBe(ukrainianClosedBookQuestion(HOST, HOST));
    expect(request?.question).toContain(`бізнес, повʼязаний із ${HOST}`);
  });
});

describe('the Ukrainian preview run', () => {
  it('returns a Ukrainian answer and Ukrainian claims whose quotes are in the answer', async () => {
    const { geo } = await askedPreview('uk');
    const [answer] = geo.responses;
    expect(answer?.response.rawText).toContain('сервіс аудиту вебсайтів');
    expect(answer?.response.rawText).toContain('ʼ');
    const evaluation = geo.answerEvaluations.get(answer?.aiRequestKey ?? '');
    expect(evaluation?.status).toBe('Completed');
    const claims = evaluation?.payload?.claims ?? [];
    expect(claims).toHaveLength(5);
    for (const claim of claims) expect(claim.claim).toMatch(/[А-Яа-яІіЇїЄєҐґ]/);
    // The judge re-typed ʼ as ' in this quote; it still counts as verbatim.
    expect(claims.map((claim) => claim.answerQuote)).toContain(
      "обʼєм модулів пов'язані з тарифами",
    );
    expect(evaluation?.payload?.overall).toBe('contradicts-evidence');
  });

  it('puts the language rule in the judge system prompt only, without a new version', async () => {
    const { sent } = await askedPreview('uk');
    const judge = sent[1];
    expect(judge?.systemInstructions).toBe(
      `${GEO_EVALUATION_SYSTEM_INSTRUCTIONS} ${GEO_EVALUATION_UKRAINIAN_INSTRUCTION}`,
    );
    expect(judge?.question).not.toContain(GEO_EVALUATION_UKRAINIAN_INSTRUCTION);
    expect(judge?.promptVersion).toBe(GEO_EVALUATION_PROMPT_VERSION);
    expect(judge?.caps?.maxOutputTokens).toBe(GEO_EVALUATION_UKRAINIAN_MAX_OUTPUT_TOKENS);
  });

  it('leaves the English judge request exactly as before', async () => {
    const { sent } = await askedPreview('en');
    const judge = sent[1];
    expect(judge?.systemInstructions).toBe(GEO_EVALUATION_SYSTEM_INSTRUCTIONS);
    expect(judge?.caps).toBe(GEO_EVALUATION_CAPS);
  });

  it('answers the hostname question in Ukrainian with an honest no-description', async () => {
    const { geo } = await askedPreview('uk', HOST);
    const [answer] = geo.responses;
    expect(answer?.response.rawText).toContain('Я не маю достовірної інформації');
    expect(geo.answerEvaluations.get(answer?.aiRequestKey ?? '')?.payload?.overall).toBe(
      'no-description',
    );
  });

  it('yields the same request keys on two attempts in the same language', async () => {
    const keys = async (language: GeoAnswerLanguage) =>
      (await askedPreview(language)).geo.responses.map((response) => response.aiRequestKey);
    const first = await keys('uk');
    expect(first).toHaveLength(1);
    expect(await keys('uk')).toEqual(first);
    expect(await keys('en')).not.toEqual(first);
  });
});

describe('the D-236 per-scan ceiling in Ukrainian', () => {
  it('sends at most two Anthropic requests per Free scan', async () => {
    const { geo, sent } = await askedPreview('uk');
    expect(sent).toHaveLength(2);
    expect(sent.every((request) => request.provider === 'anthropic')).toBe(true);
    expect(geo.quota.spent).toBeLessThanOrEqual(TARIFFS.Free.aiRequestLimit);
    expect(TARIFFS.Free.aiRequestLimit).toBe(2);
  });

  it('asks nothing when an earlier attempt already asked', async () => {
    const { result, sent } = await preview('uk', { alreadyRequested: true });
    expect(sent).toEqual([]);
    expect(result).toEqual({ kind: 'skipped', reason: 'FreePreviewAlreadyRequested' });
  });

  it('records the language on the row, and that row still proves the stage was reached', async () => {
    const { geo, generation } = await askedPreview('uk');
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
    const metadata = JSON.parse(row.metadataJson ?? '{}') as Record<string, unknown>;
    expect(metadata).toMatchObject({ freePreview: true, language: 'uk' });
    expect(
      geoStageReached(
        { runtimeStatus: row.runtimeStatus, metadataJson: row.metadataJson ?? null },
        0,
        undefined,
      ),
    ).toBe(true);
  });
});

// The worker reads the AI language from the stored execution config, the
// same snapshot the rest of the scan runs from; the database suite exercises it.
describe('run-attempt.ts language wiring', () => {
  const source = readFileSync(new URL('./run-attempt.ts', import.meta.url), 'utf8');

  it('hands the stored AI language to the Free preview', () => {
    expect(source).toMatch(
      /language:\s*storedExecutionConfig\(\s*scan\.executionConfigJson\s*\)\?\.language\s*\?\?\s*'en'/,
    );
  });
});
