import { describe, expect, it } from 'vitest';

import { AiModuleError } from './errors.js';
import { GEMINI_DEFAULT_MODEL } from './gemini-provider.js';
import { mockRoutingProvider, MockAiProvider } from './mock-provider.js';
import { RoutingAiProvider, UnconfiguredProvider } from './routing-provider.js';
import { makeRequest } from './testing/harness.js';
import type { MockAiFixture } from './mock-provider.js';

const FIXTURES: readonly MockAiFixture[] = [
  {
    questionIncludes: 'best',
    response: {
      status: 'completed',
      output_text: 'An answer.',
      web_search_calls: 2,
      usage: { input_tokens: 40, output_tokens: 6 },
    },
  },
];

function adapter(provider: 'anthropic' | 'openai', modelId: string): MockAiProvider {
  return new MockAiProvider(FIXTURES, {
    config: { provider, apiVersion: 'v1', modelId, timeoutMs: 1000, maxRetries: 1 },
  });
}

describe('RoutingAiProvider', () => {
  it('dispatches each request to the adapter that owns its provider', async () => {
    const routing = new RoutingAiProvider([
      adapter('anthropic', 'claude-sonnet-5'),
      adapter('openai', 'gpt-5.6-luna'),
    ]);

    const anthropic = await routing.send(makeRequest({ provider: 'anthropic' }), 'prompt');
    const openai = await routing.send(makeRequest({ provider: 'openai' }), 'prompt');

    expect(anthropic).toMatchObject({ provider: 'anthropic', modelId: 'claude-sonnet-5' });
    expect(openai).toMatchObject({ provider: 'openai', modelId: 'gpt-5.6-luna' });
    expect(routing.providers).toEqual(['anthropic', 'openai']);
    expect(routing.config.provider).toBe('anthropic');
    expect(routing.configFor('openai')?.modelId).toBe('gpt-5.6-luna');
    expect(routing.configFor('google')).toBeNull();
  });

  it('treats an unrouted provider as a wiring bug, not an unavailable provider', async () => {
    const routing = new RoutingAiProvider([adapter('anthropic', 'claude-sonnet-5')]);

    await expect(
      routing.send(makeRequest({ provider: 'google' }), 'prompt'),
    ).rejects.toBeInstanceOf(AiModuleError);
  });

  it('refuses to be built empty or with two adapters for one provider', () => {
    expect(() => new RoutingAiProvider([])).toThrow(AiModuleError);
    expect(() => new RoutingAiProvider([adapter('openai', 'a'), adapter('openai', 'b')])).toThrow(
      AiModuleError,
    );
  });

  it('builds one mock adapter per named provider, sharing the fixtures', async () => {
    const routing = mockRoutingProvider(FIXTURES, ['anthropic', 'openai', 'google', 'perplexity']);

    expect(routing.providers).toEqual(['anthropic', 'openai', 'google', 'perplexity']);
    const google = await routing.send(makeRequest({ provider: 'google' }), 'prompt');
    expect(google).toMatchObject({
      provider: 'google',
      modelId: GEMINI_DEFAULT_MODEL,
      usage: { searchUnits: 2 },
    });
  });
});

describe('UnconfiguredProvider', () => {
  it('reports an unavailable provider instead of inventing an answer', async () => {
    const provider = new UnconfiguredProvider('openai', 'gpt-5.6-luna', 'v1', 'OpenAI');

    expect(provider.config).toMatchObject({ provider: 'openai', modelId: 'gpt-5.6-luna' });
    await expect(provider.send()).rejects.toMatchObject({
      name: 'UnavailableError',
      reason: 'OpenAI API key is not configured',
    });
  });
});
