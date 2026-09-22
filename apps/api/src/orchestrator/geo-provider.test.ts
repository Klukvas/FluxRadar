import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiQuotaTracker, MockAiProvider, runGeoModule } from '@fluxradar/ai';

import {
  buildGeoRequests,
  createDefaultAiProvider,
  GEO_VISIBILITY_PROVIDERS,
  generateGeoDiscoveryQuestions,
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
      consent: { scanId: 'scan-context', providers: ['anthropic'], noticeVersion: 'v2' },
      provider,
      quota: AiQuotaTracker.forPlan('Complete'),
    });

    expect(generation.status).toBe('Completed');
    expect(generation.questions).toEqual([
      'Which dental clinics in Kyiv offer implants and emergency appointments?',
      'What are the best dental care options in Kyiv for families?',
    ]);
    expect(generation.quota.spent).toBe(1);

    const requests = buildGeoRequests('scan-context', 'Smile Clinic', generation.questions, [
      'anthropic',
    ]);

    expect(requests).toHaveLength(4);
    expect(requests[0]?.question).toContain('official website');
    expect(requests[2]?.question).toContain('implants and emergency appointments');
    expect(requests[2]?.question).toContain('Kyiv');
    expect(requests[3]?.question).toContain('families');
    expect(requests[0]?.promptVersion).toContain('awareness');
    expect(requests[2]?.promptVersion).toContain('discovery');
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
      consent: { scanId: 'neutral-scan', providers: ['anthropic'], noticeVersion: 'v2' },
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

    const requests = buildGeoRequests('neutral-scan', 'SableOrchid', generation.questions, [
      'anthropic',
    ]).filter((request) => request.promptVersion.includes('discovery'));
    await runGeoModule(
      {
        scanId: 'neutral-scan',
        plan: 'Complete',
        brand: 'SableOrchid',
        siteOrigin: 'https://sableorchid.example',
        siteDomain: 'sableorchid.example',
        consent: { scanId: 'neutral-scan', providers: ['anthropic'], noticeVersion: 'v1' },
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
      consent: { scanId: 'bad-generation', providers: ['anthropic'], noticeVersion: 'v2' },
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
      consent: { scanId: 'short-domain-label', providers: ['anthropic'], noticeVersion: 'v2' },
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
        consent: { scanId, providers: ['anthropic', 'openai'], noticeVersion: 'v1' },
        requests: buildGeoRequests(scanId, 'Example'),
      },
      { provider: createDefaultAiProvider('Example', 'example.com') },
    );

    expect(result.status).toBe('Unavailable');
    expect(result.statusReason).toBe('ProviderUnavailable');
    expect(result.responses).toEqual([]);
  });

  it('uses the configured models instead of a second env parser', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-sonnet-5');
    vi.stubEnv('ANTHROPIC_API_VERSION', '2023-06-01');
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test');
    vi.stubEnv('OPENAI_MODEL', 'gpt-5.6-terra');

    const router = createDefaultAiProvider('Example', 'example.com');

    expect(router.providers).toEqual([...GEO_VISIBILITY_PROVIDERS]);
    expect(router.adapterFor('anthropic')?.config).toMatchObject({
      provider: 'anthropic',
      modelId: 'claude-sonnet-5',
      apiVersion: '2023-06-01',
    });
    expect(router.adapterFor('openai')?.config).toMatchObject({
      provider: 'openai',
      modelId: 'gpt-5.6-terra',
      apiVersion: 'v1',
    });
  });

  it('fails only the unconfigured provider closed, and keeps the configured one', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    vi.stubEnv('OPENAI_API_KEY', '');

    const router = createDefaultAiProvider('Example', 'example.com');

    // A missing key never becomes a fake answer: the request comes back
    // Unavailable, the module reports Partial and the score does not move.
    await expect(
      router.send(
        {
          scanId: 'scan-openai-unconfigured',
          provider: 'openai',
          promptVersion: 'geo-questions-v5-awareness',
          sequence: 1,
          question: 'What is Example?',
          brandFacts: [],
          pageTitles: [],
          systemInstructions: 'irrelevant',
        },
        'prompt',
      ),
    ).rejects.toMatchObject({
      name: 'UnavailableError',
      reason: 'OpenAI API key is not configured',
    });
    expect(router.adapterFor('anthropic')?.config.provider).toBe('anthropic');
  });

  it('answers both providers from mock fixtures under Vitest, never a real adapter', async () => {
    const router = createDefaultAiProvider('Example', 'example.com');

    expect(router.providers).toEqual([...GEO_VISIBILITY_PROVIDERS]);
    const answers = await Promise.all(
      GEO_VISIBILITY_PROVIDERS.map(async (provider) =>
        router.send(
          {
            scanId: 'scan-mocked',
            provider,
            promptVersion: 'geo-questions-v5-awareness',
            sequence: 1,
            question: 'What is Example? What is its official website, and who is it for?',
            brandFacts: [],
            pageTitles: [],
            systemInstructions: 'irrelevant',
          },
          'prompt',
        ),
      ),
    );

    expect(answers.map((answer) => answer.provider)).toEqual([...GEO_VISIBILITY_PROVIDERS]);
  });
});

describe('visibility requests', () => {
  const questions = ['Which providers serve families in Kyiv?', 'What are the best options there?'];

  it('asks every provider every question, restarting the sequence for each', () => {
    const requests = buildGeoRequests('scan-two-providers', 'Example', questions);

    expect(requests).toHaveLength(2 * (2 + questions.length));
    expect(requests.map((request) => request.provider)).toEqual([
      'anthropic',
      'anthropic',
      'anthropic',
      'anthropic',
      'openai',
      'openai',
      'openai',
      'openai',
    ]);
    // The sequence is part of ai_request_key together with the provider, so it
    // restarts rather than running on: the pair has to stay unique, not the number.
    expect(requests.map((request) => request.sequence)).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
    const [claude, chatgpt] = [requests[0], requests[4]];
    expect(claude?.question).toBe(chatgpt?.question);
    expect(claude?.systemInstructions).toBe(chatgpt?.systemInstructions);
    // Nothing about the site travels with the question beyond the brand name.
    expect(requests.every((request) => request.brandFacts.length === 0)).toBe(true);
    expect(requests.every((request) => request.pageTitles.length === 0)).toBe(true);
  });

  it('turns web search on for visibility questions and leaves generation without it', async () => {
    const requests = buildGeoRequests('scan-search-flag', 'Example', questions);

    expect(requests.every((request) => request.webSearch === true)).toBe(true);
    expect(requests.every((request) => request.reasoningMode === 'disabled')).toBe(true);
    expect(requests.every((request) => request.promptVersion.startsWith('geo-questions-v5-'))).toBe(
      true,
    );

    const provider = new MockAiProvider(
      [
        {
          questionIncludes: 'Generate neutral discovery questions',
          response: {
            status: 'completed',
            output_text: JSON.stringify({ questions }),
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
      scanId: 'scan-search-flag',
      brand: 'Example',
      siteHostname: 'example.com',
      context: { industry: 'dental clinic', offerings: 'implants', region: 'Kyiv' },
      consent: { scanId: 'scan-search-flag', providers: ['anthropic'], noticeVersion: 'v2' },
      provider,
      quota: AiQuotaTracker.forPlan('Complete'),
    });

    // D-176: the generator must not be able to read the answer it is setting up.
    expect(send.mock.calls[0]?.[0].webSearch).toBeUndefined();
    expect(send.mock.calls[0]?.[0].provider).toBe('anthropic');
  });
});
