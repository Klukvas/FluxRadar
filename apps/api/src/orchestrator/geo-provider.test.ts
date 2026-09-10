import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiQuotaTracker, MockAiProvider, runGeoModule } from '@fluxradar/ai';

import { buildGeoRequests, createDefaultAiProvider, generateGeoDiscoveryQuestions } from './geo.ts';

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

    const requests = buildGeoRequests(
      'scan-context',
      'Smile Clinic',
      'smile.example',
      generation.questions,
    );

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

    const requests = buildGeoRequests(
      'neutral-scan',
      'SableOrchid',
      'sableorchid.example',
      generation.questions,
    ).filter((request) => request.promptVersion.includes('discovery'));
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

    const scanId = 'scan-provider-unconfigured';
    const result = await runGeoModule(
      {
        scanId,
        plan: 'Complete',
        brand: 'Example',
        siteOrigin: 'https://example.com',
        siteDomain: 'example.com',
        consent: { scanId, providers: ['anthropic'], noticeVersion: 'v1' },
        requests: buildGeoRequests(scanId, 'Example', 'example.com'),
      },
      { provider: createDefaultAiProvider('Example', 'example.com') },
    );

    expect(result.status).toBe('Unavailable');
    expect(result.statusReason).toBe('ProviderUnavailable');
    expect(result.responses).toEqual([]);
  });

  it('uses the configured Anthropic model instead of a second env parser', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-sonnet-5');
    vi.stubEnv('ANTHROPIC_API_VERSION', '2023-06-01');

    expect(createDefaultAiProvider('Example', 'example.com').config).toMatchObject({
      provider: 'anthropic',
      modelId: 'claude-sonnet-5',
      apiVersion: '2023-06-01',
    });
  });
});
