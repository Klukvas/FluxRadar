// RoutingAiProvider: one AiProvider that hands each request to the adapter of
// the provider the request names, and treats an unroutable request as a bug.

import { describe, expect, it } from 'vitest';

import { AiModuleError } from './errors.js';
import { geoVisibilityFixtures, mockRoutingProvider, MockAiProvider } from './mock-provider.js';
import { RoutingAiProvider } from './routing-provider.js';
import { BRAND, DOMAIN, makeRequest, QUESTION_WITHOUT_BRAND } from './testing/harness.js';

const fixtures = geoVisibilityFixtures(BRAND, DOMAIN);

function adapter(provider: 'anthropic' | 'openai', modelId: string): MockAiProvider {
  return new MockAiProvider(fixtures, {
    config: { provider, apiVersion: 'v1', modelId, timeoutMs: 10_000, maxRetries: 1 },
  });
}

describe('RoutingAiProvider', () => {
  it('sends each request to the adapter of its own provider', async () => {
    const router = new RoutingAiProvider([
      adapter('anthropic', 'claude-sonnet-5'),
      adapter('openai', 'gpt-5.6-terra'),
    ]);

    const claude = await router.send(
      makeRequest({ provider: 'anthropic', question: QUESTION_WITHOUT_BRAND }),
      'prompt',
    );
    const chatgpt = await router.send(
      makeRequest({ provider: 'openai', question: QUESTION_WITHOUT_BRAND }),
      'prompt',
    );

    expect(claude).toMatchObject({ provider: 'anthropic', modelId: 'claude-sonnet-5' });
    expect(chatgpt).toMatchObject({ provider: 'openai', modelId: 'gpt-5.6-terra' });
    expect(router.providers).toEqual(['anthropic', 'openai']);
    // Callers that read one config predate routing; the first adapter answers.
    expect(router.config.provider).toBe('anthropic');
  });

  it('treats a request no adapter routes as a wiring bug, not an outage', async () => {
    const router = new RoutingAiProvider([adapter('anthropic', 'claude-sonnet-5')]);

    await expect(router.send(makeRequest({ provider: 'openai' }), 'prompt')).rejects.toBeInstanceOf(
      AiModuleError,
    );
    expect(router.adapterFor('openai')).toBeNull();
  });

  it('refuses to be built empty or with two adapters for one provider', () => {
    expect(() => new RoutingAiProvider([])).toThrow(AiModuleError);
    expect(() => new RoutingAiProvider([adapter('openai', 'a'), adapter('openai', 'b')])).toThrow(
      AiModuleError,
    );
  });
});

describe('mockRoutingProvider', () => {
  it('shares one fixture set across one mock adapter per provider', async () => {
    const router = mockRoutingProvider(fixtures, ['anthropic', 'openai']);

    const claude = await router.send(
      makeRequest({ provider: 'anthropic', question: QUESTION_WITHOUT_BRAND }),
      'prompt',
    );
    const chatgpt = await router.send(
      makeRequest({ provider: 'openai', question: QUESTION_WITHOUT_BRAND }),
      'prompt',
    );

    expect(router.providers).toEqual(['anthropic', 'openai']);
    expect(claude).toMatchObject({ provider: 'anthropic', modelId: 'claude-sonnet-5' });
    expect(chatgpt).toMatchObject({ provider: 'openai', modelId: 'gpt-5.6-terra' });
    expect(claude.rawText).toBe(chatgpt.rawText);
  });

  it('takes a model override per provider', () => {
    const router = mockRoutingProvider(fixtures, ['openai'], {
      models: { openai: 'gpt-5.6-luna' },
    });

    expect(router.adapterFor('openai')?.config.modelId).toBe('gpt-5.6-luna');
  });
});
