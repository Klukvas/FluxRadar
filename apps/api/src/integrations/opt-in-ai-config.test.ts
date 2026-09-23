import { GEMINI_API_VERSIONS, PERPLEXITY_DEFAULT_ENDPOINT } from '@fluxradar/ai';
import { describe, expect, it } from 'vitest';

import { validateRuntimeConfig } from './config.ts';
import {
  availableOptInAiProviders,
  DEFAULT_GEMINI_MODEL,
  readGeminiConfig,
  readPerplexityConfig,
} from './opt-in-ai-config.ts';

const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@db:5432/fluxradar',
  INTEGRATION_ENCRYPTION_KEY: 'dedicated-key',
} satisfies NodeJS.ProcessEnv;

describe('opt-in AI recipients', () => {
  it('is off without a key, and a key alone is enough to configure it', () => {
    expect(readGeminiConfig({}).state).toBe('not_configured');
    expect(readPerplexityConfig({}).state).toBe('not_configured');
    expect(readGeminiConfig({ GOOGLE_AI_API_KEY: 'k' })).toEqual({
      state: 'configured',
      model: DEFAULT_GEMINI_MODEL,
    });
  });

  it('refuses a Gemini API version the adapter cannot speak', () => {
    // The undocumented version costs nothing at boot and everything later: the
    // host answers 404 and the paid scan records an unavailable provider.
    const result = readGeminiConfig({ GOOGLE_AI_API_KEY: 'k', GOOGLE_AI_API_VERSION: 'v1betta' });

    expect(result).toMatchObject({ state: 'invalid', missing: ['GOOGLE_AI_API_VERSION'] });
    expect(() =>
      validateRuntimeConfig({
        ...PRODUCTION_ENV,
        GOOGLE_AI_API_KEY: 'k',
        GOOGLE_AI_API_VERSION: 'v1betta',
      }),
    ).toThrow('GOOGLE_AI_API_VERSION');
    expect(
      readGeminiConfig({ GOOGLE_AI_API_KEY: 'k', GOOGLE_AI_API_VERSION: GEMINI_API_VERSIONS[0] })
        .state,
    ).toBe('configured');
  });

  it('accepts a documented Perplexity endpoint', () => {
    expect(
      readPerplexityConfig({
        PERPLEXITY_API_KEY: 'k',
        PERPLEXITY_ENDPOINT_URL: PERPLEXITY_DEFAULT_ENDPOINT,
      }).state,
    ).toBe('configured');
  });

  it.each([
    'https://perplexity.evil.test/v1/sonar',
    'https://api.perplexity.ai.evil.test/v1/sonar',
    'http://127.0.0.1:8080/v1/sonar',
    'not-a-url',
  ])('refuses to send customer context to %s', (endpointUrl) => {
    const result = readPerplexityConfig({
      PERPLEXITY_API_KEY: 'k',
      PERPLEXITY_ENDPOINT_URL: endpointUrl,
    });

    expect(result).toMatchObject({ state: 'invalid', missing: ['PERPLEXITY_ENDPOINT_URL'] });
  });

  it('fails a production boot rather than falling back to the documented endpoint', () => {
    expect(() =>
      validateRuntimeConfig({
        ...PRODUCTION_ENV,
        PERPLEXITY_API_KEY: 'k',
        PERPLEXITY_ENDPOINT_URL: 'https://perplexity.evil.test/v1/sonar',
      }),
    ).toThrow('PERPLEXITY_ENDPOINT_URL');
  });
});

// What the new-scan form is allowed to offer. Anything this list does not name
// is refused at both checkout routes, so the two have to agree on "configured".
describe('availableOptInAiProviders', () => {
  it('offers nothing when no opt-in key is set', () => {
    expect(availableOptInAiProviders({})).toEqual([]);
  });

  it('offers each configured recipient, in the product order', () => {
    expect(availableOptInAiProviders({ PERPLEXITY_API_KEY: 'k' })).toEqual(['perplexity']);
    expect(availableOptInAiProviders({ GOOGLE_AI_API_KEY: 'k' })).toEqual(['google']);
    expect(availableOptInAiProviders({ GOOGLE_AI_API_KEY: 'k', PERPLEXITY_API_KEY: 'k' })).toEqual([
      'google',
      'perplexity',
    ]);
  });

  // Half-configured is not configured: the adapter would refuse the request
  // anyway, and offering the choice would sell a scan that cannot run it.
  it('does not offer a half-configured recipient', () => {
    expect(
      availableOptInAiProviders({ GOOGLE_AI_API_KEY: 'k', GOOGLE_AI_API_VERSION: 'v1betta' }),
    ).toEqual([]);
  });
});
