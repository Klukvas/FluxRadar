// The direct GEO questions, and the evidence the scan judges their answers by.
//
// Two separate guarantees are checked here. First, a direct question is asked
// closed-book: the exact text that reaches the provider carries no profile
// field, no page content and no site description, so the answer is about what
// the model knows rather than about what we just told it. Second, the evidence
// snapshot is assembled from what the crawl actually read, keeping the owner's
// own claims apart from what the pages said.

import { describe, expect, it, vi } from 'vitest';

import {
  AiQuotaTracker,
  buildPrompt,
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
  MockAiProvider,
  runGeoModule,
} from '@fluxradar/ai';
import type { AiProviderConfig } from '@fluxradar/ai';
import { createSiteContext } from '@fluxradar/rules';
import type { SiteProfile } from '@prisma/client';

import { buildScanEvidence, geoEvidencePages } from './geo-evidence.ts';
import { buildGeoRequests, closedBookQuestions, defaultGeoFixtures } from './geo.ts';

const ANTHROPIC_CONFIG: AiProviderConfig = {
  provider: 'anthropic',
  apiVersion: '2023-06-01',
  modelId: 'claude-sonnet-5',
  timeoutMs: 1_000,
  maxRetries: 1,
};

const HOME_HTML =
  '<html><head><title>Smile Clinic — dental care in Kyiv</title>' +
  '<script type="application/ld+json">' +
  '{"@context":"https://schema.org","@type":"Dentist","name":"Smile Clinic","areaServed":"Kyiv"}' +
  '</script></head><body><h1>Implants in Kyiv</h1>' +
  '<p>We place implants and see emergency patients the same day.</p>' +
  '<a href="/pricing">Pricing</a></body></html>';

function siteContext(html: string = HOME_HTML) {
  return createSiteContext({
    origin: 'https://smile.example',
    plan: 'Complete',
    crawl: {
      pages: [
        {
          requestedUrl: 'https://smile.example/',
          normalizedUrl: 'https://smile.example/',
          depth: 0,
          finalUrl: 'https://smile.example/',
          status: 200,
          headers: { 'content-type': 'text/html' },
          redirectChain: [],
          html,
          contentType: 'text/html',
          timingMs: 12,
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
    },
  });
}

function profile(overrides: Partial<SiteProfile> = {}): SiteProfile {
  return {
    id: 'profile-1',
    accountId: 'account-1',
    name: 'Smile Clinic',
    domain: 'https://smile.example',
    industry: 'Dental clinic',
    region: 'Kyiv',
    language: 'uk',
    businessDescription: 'Dental clinic in Kyiv with implants and emergency care',
    offerings: 'implants, emergency appointments',
    targetLanguages: 'Ukrainian, English',
    targetAudience: 'families',
    scanConfigJson: '{}',
    scanConfigVersion: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as SiteProfile;
}

describe('closed-book direct questions', () => {
  it('asks one question about the domain when the profile has no brand name', () => {
    expect(closedBookQuestions('smile.example', 'smile.example')).toEqual([
      'What do you know about the business associated with smile.example? If you do not ' +
        'recognise it, say that you have no information instead of guessing.',
    ]);
  });

  it('drops the official-website question only when the domain was supplied', () => {
    const named = closedBookQuestions('Smile Clinic', 'smile.example');

    expect(named).toHaveLength(2);
    expect(named[1]).toContain('official website');
    // The brand-named case never spells the domain out, so asking the model to
    // name the site is still a measurement rather than a repetition.
    expect(named.join(' ')).not.toContain('smile.example');
  });

  it('sends no profile field or page content with a closed-book question', () => {
    // One provider: this is about what a question carries, not about the fan-out.
    const requests = buildGeoRequests(
      'scan-1',
      'smile.example',
      'smile.example',
      ['Which clinics in Kyiv place implants?'],
      ['anthropic'],
    );
    const direct = requests.filter((request) => request.promptVersion.endsWith('-closed-book'));

    expect(direct).toHaveLength(1);
    for (const request of direct) {
      const { promptText } = buildPrompt(request);
      expect(request.brandFacts).toEqual([]);
      expect(request.pageTitles).toEqual([]);
      expect(promptText).not.toMatch(/implants|Kyiv|families|Dental clinic/i);
      expect(promptText).toContain('Do not browse the web');
      expect(promptText).toContain('do not use any tool');
      expect(promptText).toContain('I have no information about this');
      expect(promptText).toContain('country code');
      expect(promptText).toContain('do not claim it proves what is or is not in your training');
    }
  });

  it('labels a direct question closed-book and a generated one discovery', () => {
    const requests = buildGeoRequests(
      'scan-1',
      'Smile Clinic',
      'smile.example',
      ['Which clinics?'],
      ['anthropic'],
    );

    expect(requests.map((request) => request.promptVersion)).toEqual([
      'geo-questions-v5-closed-book',
      'geo-questions-v5-closed-book',
      'geo-questions-v5-discovery',
    ]);
  });
});

describe('scan evidence assembly', () => {
  it('reads the crawled page and the owner profile, keeping them apart', () => {
    const evidence = buildScanEvidence(siteContext(), profile(), 'smile.example');

    const pages = evidence.sources.filter((source) => source.kind === 'page');
    const profileSources = evidence.sources.filter((source) => source.kind === 'profile');
    expect(evidence.sufficiency).toBe('substantive');
    expect(pages[0]?.url).toBe('https://smile.example/');
    expect(pages[0]?.excerpt).toContain('emergency patients');
    expect(profileSources[0]?.excerpt).toBe('Smile Clinic');
    expect(profileSources[0]?.provenance).toContain('site owner');
  });

  it('records JSON-LD as the page author’s own declaration', () => {
    const evidence = buildScanEvidence(siteContext(), profile(), 'smile.example');

    const structured = evidence.sources.find((source) => source.kind === 'structured-data');
    expect(structured?.excerpt).toContain('name=Smile Clinic');
    expect(structured?.provenance).toContain('unverified');
  });

  it('never turns a hostname-named profile into a confirmed brand', () => {
    const evidence = buildScanEvidence(
      siteContext(),
      profile({ name: 'smile.example', businessDescription: null, offerings: null }),
      'smile.example',
    );

    expect(evidence.sources.some((source) => source.excerpt === 'smile.example')).toBe(false);
    expect(evidence.limits.join(' ')).toContain('no brand name');
  });

  it('reports insufficient evidence rather than inventing some', () => {
    const empty = createSiteContext({
      origin: 'https://smile.example',
      plan: 'Complete',
      crawl: {
        pages: [],
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
      },
    });
    const bare = profile({
      name: 'smile.example',
      industry: null,
      region: null,
      language: null,
      businessDescription: null,
      offerings: null,
      targetLanguages: null,
      targetAudience: null,
    });

    expect(geoEvidencePages(empty)).toEqual([]);
    expect(buildScanEvidence(empty, bare, 'smile.example').sufficiency).toBe('insufficient');
  });
});

describe('the default fixtures still drive a complete local run', () => {
  it('answers every question and evaluates every answer', async () => {
    const provider = new MockAiProvider(defaultGeoFixtures('Smile Clinic', 'smile.example'), {
      config: ANTHROPIC_CONFIG,
    });
    const send = vi.spyOn(provider, 'send');
    const evidence = buildScanEvidence(siteContext(), profile(), 'smile.example');

    const result = await runGeoModule(
      {
        scanId: 'scan-fixtures',
        plan: 'Complete',
        brand: 'Smile Clinic',
        siteOrigin: 'https://smile.example',
        siteDomain: 'smile.example',
        consent: {
          scanId: 'scan-fixtures',
          providers: ['anthropic'],
          noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
        },
        requests: buildGeoRequests(
          'scan-fixtures',
          'Smile Clinic',
          'smile.example',
          ['Which providers best match the described service, audience, and region?'],
          ['anthropic'],
        ),
        evidence,
      },
      { provider, quota: AiQuotaTracker.forPlan('Complete') },
    );

    expect(result.status).toBe('Completed');
    expect(result.responses).toHaveLength(3);
    expect([...result.answerEvaluations.values()].map((value) => value.status)).toEqual([
      'Completed',
      'Completed',
      'Completed',
    ]);
    expect(send).toHaveBeenCalledTimes(6);
  });

  // The fixture answer invents a trade, a city and a different brand name
  // around a real one — which is how a model actually fails on a site it does
  // not know. The fixture verdict used to call that "matched" against the
  // profile's brand name alone, so every local run and every screenshot of this
  // feature ended in a green verdict the evaluator had not earned.
  //
  // The contradiction is on the profile's own attribute: it states the brand
  // name, and the answer asserts a different brand name. It used to be an
  // invented *legal entity* name, which the brand field cannot contradict — a
  // trading brand and a registered company name coexist routinely.
  it('shows an invented description as a contradiction, not as a match', async () => {
    const provider = new MockAiProvider(defaultGeoFixtures('Smile Clinic', 'smile.example'), {
      config: ANTHROPIC_CONFIG,
    });

    const result = await runGeoModule(
      {
        scanId: 'scan-fixture-honesty',
        plan: 'Complete',
        brand: 'Smile Clinic',
        siteOrigin: 'https://smile.example',
        siteDomain: 'smile.example',
        consent: {
          scanId: 'scan-fixture-honesty',
          providers: ['anthropic'],
          noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
        },
        requests: buildGeoRequests(
          'scan-fixture-honesty',
          'Smile Clinic',
          'smile.example',
          [],
          ['anthropic'],
        ),
        evidence: buildScanEvidence(siteContext(), profile(), 'smile.example'),
      },
      { provider, quota: AiQuotaTracker.forPlan('Complete') },
    );

    const described = [...result.answerEvaluations.values()].find(
      (evaluation) => (evaluation.payload?.claims.length ?? 0) > 0,
    );
    expect(described?.payload?.overall).toBe('contradicts-evidence');
    const claims = described?.payload?.claims ?? [];
    // Identity is the only thing a name can support, and the one claim that
    // cites the brand name as support says exactly that.
    const supportedByName = claims.filter(
      (claim) => claim.verdict === 'matched' && claim.sourceQuote === 'Smile Clinic',
    );
    expect(supportedByName.map((claim) => claim.claim)).toEqual([
      'The answer is about the business the profile names, Smile Clinic.',
    ]);
    // What the business does is not confirmed by its name.
    const activity = claims.find((claim) => claim.claim.includes('website audit service'));
    expect(activity?.verdict).toBe('unverified');
    expect(activity?.sourceId).toBeNull();
    // The one contradiction is the profile's own field against a different
    // value of that same field — a brand name against a brand name.
    const contradicted = claims.filter((claim) => claim.verdict === 'contradicted');
    expect(contradicted).toEqual([
      {
        claim: 'The brand name of the business is Northwind Digital, not Smile Clinic.',
        verdict: 'contradicted',
        answerQuote: 'Its brand name is Northwind Digital, not Smile Clinic',
        sourceId: 'profile-1',
        sourceQuote: 'Smile Clinic',
      },
    ]);
  });
});
