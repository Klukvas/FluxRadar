import { describe, expect, it, vi } from 'vitest';

import { PerplexityProvider } from './perplexity-provider.js';
import { validateNormalizedResponse } from './response-contract.js';
import { makeRequest } from './testing/harness.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('PerplexityProvider', () => {
  it('posts a chat-completions body and normalizes the answer', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'pplx-1',
        created: 1_790_000_200,
        model: 'sonar',
        choices: [
          { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'A.' } },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 4, total_tokens: 34 },
      }),
    );
    const provider = new PerplexityProvider({ apiKey: 'pplx-key', fetcher });

    const response = await provider.send(
      makeRequest({ provider: 'perplexity' }),
      'redacted prompt',
    );

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.perplexity.ai/v1/sonar',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer pplx-key' }),
      }),
    );
    // A request without the search flag must stay recall-only here too.
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'sonar',
      max_tokens: 2000,
      disable_search: true,
      messages: [
        { role: 'system', content: 'Answer factually. Cite sources when possible.' },
        { role: 'user', content: 'redacted prompt' },
      ],
    });
    expect(response).toMatchObject({
      provider: 'perplexity',
      requestId: 'pplx-1',
      requestIdSource: 'provider',
      createdAt: new Date(1_790_000_200 * 1000).toISOString(),
      rawText: 'A.',
      usage: { inputTokens: 30, outputTokens: 4, totalTokens: 34 },
      finishReason: 'stop',
    });
    expect(validateNormalizedResponse(response)).toEqual([]);
  });

  it('enables search and reads sources and the search count from the answer', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'pplx-2',
        model: 'sonar',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'FluxRadar publishes pricing openly.' },
          },
        ],
        citations: ['https://fluxradar.test/pricing'],
        search_results: [
          { title: 'Pricing', url: 'https://fluxradar.test/pricing', source: 'web' },
          { title: 'Docs', url: 'https://fluxradar.test/docs', source: 'web' },
        ],
        usage: {
          prompt_tokens: 12_000,
          completion_tokens: 90,
          num_search_queries: 3,
          reasoning_tokens: 20,
        },
      }),
    );
    const provider = new PerplexityProvider({ apiKey: 'pplx-key', fetcher });

    const response = await provider.send(
      makeRequest({ provider: 'perplexity', webSearch: true }),
      'prompt',
    );

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ web_search_options: { search_context_size: 'low' } });
    expect(body).not.toHaveProperty('disable_search');
    expect(response.citations).toEqual([
      'https://fluxradar.test/pricing',
      'https://fluxradar.test/docs',
    ]);
    expect(response.usage).toMatchObject({
      searchUnits: 3,
      reasoningUnits: 20,
      inputTokens: 12_000,
    });
    expect(validateNormalizedResponse(response)).toEqual([]);
  });

  it('fails the contract when the answer searched more than the cap allows', async () => {
    // Perplexity documents no request parameter that caps the search count.
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'pplx-3',
        model: 'sonar',
        choices: [{ index: 0, finish_reason: 'stop', message: { content: 'Answer.' } }],
        usage: { prompt_tokens: 100, completion_tokens: 10, num_search_queries: 20 },
      }),
    );
    const provider = new PerplexityProvider({ apiKey: 'pplx-key', fetcher });

    const response = await provider.send(
      makeRequest({ provider: 'perplexity', webSearch: true }),
      'prompt',
    );

    expect(validateNormalizedResponse(response)).toEqual(['usage.searchUnits 20 exceeds cap 8']);
  });

  it('maps a length stop and a cut answer to length', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'pplx-4',
        model: 'sonar',
        choices: [{ index: 0, finish_reason: 'length', message: { content: 'Cut' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2000 },
      }),
    );
    const provider = new PerplexityProvider({ apiKey: 'pplx-key', fetcher });

    await expect(
      provider.send(makeRequest({ provider: 'perplexity' }), 'prompt'),
    ).resolves.toMatchObject({ finishReason: 'length' });
  });

  it('refuses a constrained-JSON request instead of guessing the field', async () => {
    const provider = new PerplexityProvider({ apiKey: 'pplx-key', fetcher: vi.fn<typeof fetch>() });

    await expect(
      provider.send(
        makeRequest({ provider: 'perplexity', responseSchema: { type: 'object' } }),
        'prompt',
      ),
    ).rejects.toMatchObject({
      reason: 'Perplexity adapter does not support constrained JSON output',
    });
  });

  it.each([
    [500, 'Perplexity HTTP 500'],
    [401, 'Perplexity rejected the request'],
  ])('maps HTTP %s to Unavailable', async (status, reason) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status }));
    const provider = new PerplexityProvider({ apiKey: 'pplx-key', fetcher });

    await expect(
      provider.send(makeRequest({ provider: 'perplexity' }), 'prompt'),
    ).rejects.toMatchObject({ name: 'UnavailableError', reason });
  });

  it('accepts a configured endpoint while the API is migrating', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'pplx-5',
        model: 'sonar-pro',
        choices: [{ index: 0, finish_reason: 'stop', message: { content: 'A.' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
    );
    const provider = new PerplexityProvider({
      apiKey: 'pplx-key',
      endpointUrl: 'https://api.perplexity.ai/chat/completions',
      modelId: 'sonar-pro',
      fetcher,
    });

    await provider.send(makeRequest({ provider: 'perplexity' }), 'prompt');

    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.perplexity.ai/chat/completions');
  });
});
