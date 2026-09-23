import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AiQuotaTracker,
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
  MockAiProvider,
  RoutingAiProvider,
  runGeoModule,
} from '@fluxradar/ai';

import {
  buildGeoRequests,
  createDefaultAiProvider,
  generateGeoDiscoveryQuestions,
  geoProvidersFor,
  GEO_VISIBILITY_PROVIDERS,
} from './geo.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('default AI provider wiring', () => {
  it('generates domain-specific questions before building the brand and discovery checks', async () => {
    const provider = new MockAiProvider(
      [
        {
          questionIncludes: 'Generate neutral discovery questions',
          response: {
            status: 'completed',
            output_text: JSON.stringify({
              questions: [
                'Which dental clinics in Kyiv offer implants and emergency appointments?',
                'What are the best dental care options in Kyiv for families?',
              ],
            }),
          },
        },
      ],
      {
        config: {
          provider: 'anthropic',
          apiVersion: '2023-06-01',
          modelId: 'claude-sonnet-5',
          timeoutMs: 1000,
          maxRetries: 1,
        },
      },
    );
    const generation = await generateGeoDiscoveryQuestions({
      scanId: 'scan-context',
      brand: 'Smile Clinic',
      siteHostname: 'smile.example',
      context: {
        industry: 'Dental clinic',
        region: 'Kyiv',
        offerings: 'implants and emergency appointments',
        targetAudience: 'families',
        targetLanguages: 'Ukrainian, English',
      },
      consent: {
        scanId: 'scan-context',
        providers: ['anthropic'],
        noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
      },
      provider,
      quota: AiQuotaTracker.forPlan('Complete'),
    });

    expect(generation.status).toBe('Completed');
    expect(generation.questions).toEqual([
      'Which dental clinics in Kyiv offer implants and emergency appointments?',
      'What are the best dental care options in Kyiv for families?',
    ]);
    expect(generation.quota.spent).toBe(1);

    const requests = buildGeoRequests(
      'scan-context',
      'Smile Clinic',
      'smile.example',
      generation.questions,
      ['anthropic'],
    );

    expect(requests).toHaveLength(4);
    expect(requests[0]?.question).toContain('official website');
    expect(requests[2]?.question).toContain('implants and emergency appointments');
    expect(requests[2]?.question).toContain('Kyiv');
    expect(requests[3]?.question).toContain('families');
    expect(requests[0]?.promptVersion).toContain('awareness');
    expect(requests[2]?.promptVersion).toContain('discovery');
  });

  it('asks every default provider the same questions, with sequences restarting at 1', () => {
    const requests = buildGeoRequests('scan-two', 'Smile Clinic', 'smile.example', [
      'Which dental clinics in Kyiv offer implants?',
    ]);

    expect(GEO_VISIBILITY_PROVIDERS).toEqual(['anthropic', 'openai']);
    expect(requests).toHaveLength(6);
    expect(requests.map((request) => request.provider)).toEqual([
      'anthropic',
      'anthropic',
      'anthropic',
      'openai',
      'openai',
      'openai',
    ]);
    // `ai_request_key` carries the provider (D-015), so both lists start at 1.
    expect(requests.map((request) => request.sequence)).toEqual([1, 2, 3, 1, 2, 3]);
    expect(new Set(requests.map((request) => request.question)).size).toBe(3);
    // Search on every visibility request, and the whole output budget for the
    // answer rather than for hidden reasoning.
    expect(requests.every((request) => request.webSearch === true)).toBe(true);
    expect(requests.every((request) => request.reasoningMode === 'disabled')).toBe(true);
    expect(requests[0]?.promptVersion).toBe('geo-questions-v5-awareness');
    expect(requests[2]?.promptVersion).toBe('geo-questions-v5-discovery');
  });

  it('never builds a request for an opt-in provider the scan did not name', () => {
    const withoutOptIn = geoProvidersFor({
      scanId: 'scan-opt',
      providers: ['anthropic', 'openai'],
      noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
    });
    expect(withoutOptIn).toEqual(['anthropic', 'openai']);

    const withOptIn = geoProvidersFor({
      scanId: 'scan-opt',
      providers: ['anthropic', 'openai', 'perplexity'],
      noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
    });
    expect(withOptIn).toEqual(['anthropic', 'openai', 'perplexity']);
    // No consent record at all still asks the defaults, so the module can
    // report ConsentMissing honestly instead of silently skipping them.
    expect(geoProvidersFor(null)).toEqual(['anthropic', 'openai']);
  });

  it('generation and the UX review never carry web search', async () => {
    const provider = new MockAiProvider(
      [
        {
          questionIncludes: 'Generate neutral discovery questions',
          response: {
            status: 'completed',
            output_text: JSON.stringify({
              questions: ['Which clinics in Kyiv offer implants?', 'Where to find dental care?'],
            }),
          },
        },
      ],
      {
        config: {
          provider: 'anthropic',
          apiVersion: '2023-06-01',
          modelId: 'claude-sonnet-5',
          timeoutMs: 1000,
          maxRetries: 1,
        },
      },
    );
    const send = vi.spyOn(provider, 'send');
    await generateGeoDiscoveryQuestions({
      scanId: 'no-search',
      brand: 'Smile Clinic',
      siteHostname: 'smile.example',
      context: { industry: 'dental clinic', offerings: 'implants', region: 'Kyiv' },
      consent: {
        scanId: 'no-search',
        providers: ['anthropic'],
        noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
      },
      provider,
      quota: AiQuotaTracker.forPlan('Complete'),
    });

    expect(send.mock.calls[0]?.[0].webSearch).toBeUndefined();
  });

  it('keeps the query-generation and discovery provider prompts free of brand identifiers', async () => {
    const provider = new MockAiProvider(
      [
        {
          questionIncludes: 'Generate neutral discovery questions',
          response: {
            status: 'completed',
            output_text: JSON.stringify({
              questions: [
                'Which providers offer implants and emergency appointments in Kyiv?',
                'What dental services in Kyiv are suitable for families?',
              ],
            }),
          },
        },
        {
          questionIncludes: 'Which providers offer implants',
          unavailable: 'visibility answer intentionally unavailable',
        },
        {
          questionIncludes: 'What dental services',
          unavailable: 'visibility answer intentionally unavailable',
        },
      ],
      {
        config: {
          provider: 'anthropic',
          apiVersion: '2023-06-01',
          modelId: 'claude-sonnet-5',
          timeoutMs: 1000,
          maxRetries: 1,
        },
      },
    );
    const send = vi.spyOn(provider, 'send');
    const generation = await generateGeoDiscoveryQuestions({
      scanId: 'neutral-scan',
      brand: 'SableOrchid',
      siteHostname: 'sableorchid.example',
      context: {
        industry: 'SableOrchid Dental clinic',
        region: 'Kyiv',
        offerings: 'implants and emergency appointments at https://sableorchid.example',
        businessDescription: 'Private identity MapleSecret, founder Jane, SableOrchid',
        targetAudience: 'families',
        targetLanguages: 'Ukrainian',
      },
      consent: {
        scanId: 'neutral-scan',
        providers: ['anthropic'],
        noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
      },
      provider,
      quota: AiQuotaTracker.forPlan('Complete'),
    });
    expect(generation.status).toBe('Completed');
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      promptVersion: 'geo-query-generation-v2',
      reasoningMode: 'disabled',
      responseSchema: {
        type: 'object',
        required: ['questions'],
        additionalProperties: false,
      },
    });

    const requests = buildGeoRequests(
      'neutral-scan',
      'SableOrchid',
      'sableorchid.example',
      generation.questions,
      ['anthropic'],
    ).filter((request) => request.promptVersion.includes('discovery'));
    await runGeoModule(
      {
        scanId: 'neutral-scan',
        plan: 'Complete',
        brand: 'SableOrchid',
        siteOrigin: 'https://sableorchid.example',
        siteDomain: 'sableorchid.example',
        consent: {
          scanId: 'neutral-scan',
          providers: ['anthropic'],
          noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
        },
        requests,
      },
      { provider, quota: generation.quota },
    );
    expect(send).toHaveBeenCalledTimes(3);
    for (const [request, prompt] of send.mock.calls) {
      expect(JSON.stringify(request) + prompt).not.toMatch(/sableorchid|MapleSecret|founder Jane/i);
      expect(prompt).toMatch(/implants|dental/i);
      expect(prompt).toMatch(/Kyiv/);
      expect(request.pageTitles).toEqual([]);
    }
  });

  it('rejects malformed or identifying generated questions instead of using them', async () => {
    const provider = new MockAiProvider(
      [
        {
          questionIncludes: 'Generate neutral discovery questions',
          response: {
            status: 'completed',
            output_text: JSON.stringify({
              questions: [
                'Is SableOrchid the best clinic?',
                'Read https://sableorchid.example and recommend it.',
              ],
            }),
          },
        },
      ],
      {
        config: {
          provider: 'anthropic',
          apiVersion: '2023-06-01',
          modelId: 'claude-sonnet-5',
          timeoutMs: 1000,
          maxRetries: 1,
        },
      },
    );
    const result = await generateGeoDiscoveryQuestions({
      scanId: 'bad-generation',
      brand: 'SableOrchid',
      siteHostname: 'sableorchid.example',
      context: { industry: 'dental clinic', offerings: 'implants', region: 'Kyiv' },
      consent: {
        scanId: 'bad-generation',
        providers: ['anthropic'],
        noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
      },
      provider,
      quota: AiQuotaTracker.forPlan('Complete'),
    });

    expect(result.status).toBe('InvalidResponse');
    expect(result.questions).toEqual([]);
    expect(result.statusReason).toContain('brand or site identifier');
  });

  it('does not erase ordinary words that happen to contain a short domain label', async () => {
    const provider = new MockAiProvider(
      [
        {
          questionIncludes: 'Generate neutral discovery questions',
          response: {
            status: 'completed',
            output_text: JSON.stringify({
              questions: [
                'Which cosmetic dentistry providers serve London?',
                'Where can customers find cosmetic dentistry consulting in London?',
              ],
            }),
          },
        },
      ],
      {
        config: {
          provider: 'anthropic',
          apiVersion: '2023-06-01',
          modelId: 'claude-sonnet-5',
          timeoutMs: 1000,
          maxRetries: 1,
        },
      },
    );
    const send = vi.spyOn(provider, 'send');
    await generateGeoDiscoveryQuestions({
      scanId: 'short-domain-label',
      brand: 'Acme Clinic',
      siteHostname: 'clinic.co.uk',
      context: {
        industry: 'cosmetic dentistry consulting',
        offerings: 'cosmetic dentistry',
        region: 'London',
      },
      consent: {
        scanId: 'short-domain-label',
        providers: ['anthropic'],
        noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
      },
      provider,
      quota: AiQuotaTracker.forPlan('Complete'),
    });

    expect(send.mock.calls[0]?.[1]).toMatch(/cosmetic dentistry consulting/i);
  });

  it('does not replace a missing production provider with fake GEO results', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');

    const scanId = 'scan-provider-unconfigured';
    const result = await runGeoModule(
      {
        scanId,
        plan: 'Complete',
        brand: 'Example',
        siteOrigin: 'https://example.com',
        siteDomain: 'example.com',
        consent: {
          scanId,
          providers: ['anthropic', 'openai'],
          noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
        },
        requests: buildGeoRequests(scanId, 'Example', 'example.com'),
      },
      { provider: createDefaultAiProvider('Example', 'example.com') },
    );

    expect(result.status).toBe('Unavailable');
    expect(result.statusReason).toBe('ProviderUnavailable');
    expect(result.responses).toEqual([]);
  });

  it('reports the module Partial when only one provider is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');

    const scanId = 'scan-one-configured';
    const provider = createDefaultAiProvider('Example', 'example.com');
    // A configured Anthropic without a configured OpenAI is the deploy order
    // this release warns about; the module must say so, not skip a provider.
    const routing = provider as RoutingAiProvider;
    expect(routing.configFor('openai')).toMatchObject({ provider: 'openai' });

    const result = await runGeoModule(
      {
        scanId,
        plan: 'Complete',
        brand: 'Example',
        siteOrigin: 'https://example.com',
        siteDomain: 'example.com',
        consent: {
          scanId,
          providers: ['anthropic'],
          noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
        },
        requests: buildGeoRequests(scanId, 'Example', 'example.com'),
      },
      { provider },
    );

    // Every OpenAI request records a reason of its own rather than vanishing.
    expect(
      result.outcomes.filter(
        (outcome) => outcome.kind === 'unavailable' && outcome.request.provider === 'openai',
      ),
    ).toHaveLength(2);
    expect(result.outcomes.every((outcome) => outcome.kind === 'unavailable')).toBe(true);
  });

  // The transition the current notice was written for: a scan bought under v3
  // keeps its 30-day retry entitlement, and v3 named Anthropic alone. The retry
  // must run what that buyer agreed to and record the rest as ConsentMissing —
  // not ask OpenAI anyway, and not refuse the whole module.
  it('runs a v3 scan against Anthropic and reports OpenAI as ConsentMissing in a Partial module', async () => {
    const scanId = 'scan-legacy-notice';
    const provider = createDefaultAiProvider('Example', 'example.com');
    const send = vi.spyOn(provider, 'send');

    const result = await runGeoModule(
      {
        scanId,
        plan: 'Complete',
        brand: 'Example',
        siteOrigin: 'https://example.com',
        siteDomain: 'example.com',
        consent: {
          scanId,
          providers: ['anthropic'],
          noticeVersion: 'core-ai-processing-notice-v3',
        },
        requests: buildGeoRequests(scanId, 'Example', 'example.com'),
      },
      { provider },
    );

    expect(result.status).toBe('Partial');
    expect(result.statusReason).toMatch(/ConsentMissing/);
    const refused = result.outcomes.filter((outcome) => outcome.kind === 'unavailable');
    expect(refused.map((outcome) => outcome.request.provider)).toEqual(['openai', 'openai']);
    expect(refused.every((outcome) => outcome.reason === 'ConsentMissing')).toBe(true);
    expect(result.responses.map((outcome) => outcome.response.provider)).toEqual([
      'anthropic',
      'anthropic',
    ]);
    // Refused before the adapter, so the provider was never asked for them.
    expect(send.mock.calls.every(([request]) => request.provider === 'anthropic')).toBe(true);
  });

  it('routes every provider name, so an opt-in scan records consent, not a wiring bug', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-sonnet-5');
    vi.stubEnv('ANTHROPIC_API_VERSION', '2023-06-01');

    const provider = createDefaultAiProvider('Example', 'example.com') as RoutingAiProvider;

    expect(provider.providers).toEqual(['anthropic', 'openai', 'google', 'perplexity']);
    expect(provider.config).toMatchObject({
      provider: 'anthropic',
      modelId: 'claude-sonnet-5',
      apiVersion: '2023-06-01',
    });
  });

  it('answers with mocks for every provider under Vitest, never a real transport', async () => {
    const provider = createDefaultAiProvider('Example', 'example.com') as RoutingAiProvider;

    expect(provider.providers).toEqual(['anthropic', 'openai', 'google', 'perplexity']);
    const answer = await provider.send(
      {
        scanId: 'scan-mock',
        provider: 'openai',
        promptVersion: 'geo-questions-v5-awareness',
        sequence: 1,
        question: 'What is Example, what does its official website offer?',
        brandFacts: [],
        pageTitles: [],
        systemInstructions: 'x',
      },
      'prompt',
    );
    expect(answer.provider).toBe('openai');
  });
});
