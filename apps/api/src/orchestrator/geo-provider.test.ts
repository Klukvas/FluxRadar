import { afterEach, describe, expect, it, vi } from 'vitest';

import { runGeoModule } from '@fluxradar/ai';

import { buildGeoRequests, createDefaultAiProvider } from './geo.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('default AI provider wiring', () => {
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
