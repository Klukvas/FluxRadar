import { describe, expect, it, vi } from 'vitest';

import { AnthropicProvider } from './anthropic-provider.js';
import { UnavailableError } from './errors.js';
import { validateNormalizedResponse } from './response-contract.js';
import { makeRequest } from './testing/harness.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AnthropicProvider', () => {
  it('sends the redacted prompt and normalizes a Messages API response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'msg_123',
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'A useful answer.' }],
        usage: { input_tokens: 40, output_tokens: 12 },
      }),
    );
    const provider = new AnthropicProvider({
      apiKey: 'sk-test',
      fetcher,
      now: () => new Date('2026-09-03T12:00:00.000Z'),
    });

    const response = await provider.send(makeRequest({ provider: 'anthropic' }), 'redacted prompt');

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'sk-test',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
    const init = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'claude-sonnet-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: 'redacted prompt' }],
    });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('thinking');
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('output_config');
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('tools');
    expect(response).toMatchObject({
      provider: 'anthropic',
      requestId: 'msg_123',
      requestIdSource: 'provider',
      createdAt: '2026-09-03T12:00:00.000Z',
      rawText: 'A useful answer.',
      usage: { inputTokens: 40, outputTokens: 12, totalTokens: 52 },
      finishReason: 'stop',
    });
    expect(validateNormalizedResponse(response)).toEqual([]);
  });

  it('disables reasoning and requests schema-constrained JSON when configured', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'msg_structured',
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"findings":[]}' }],
        usage: { input_tokens: 40, output_tokens: 8 },
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });
    const schema = {
      type: 'object',
      properties: { findings: { type: 'array', items: { type: 'object' } } },
      required: ['findings'],
      additionalProperties: false,
    } as const;

    await provider.send(
      makeRequest({ provider: 'anthropic', reasoningMode: 'disabled', responseSchema: schema }),
      'redacted prompt',
    );

    const init = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      max_tokens: 2000,
      thinking: { type: 'disabled' },
      output_config: { format: { type: 'json_schema', schema } },
    });
  });

  it('adds the basic web search tool only when the request asks for search', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'msg_search',
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
        content: [
          { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search' },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srvtoolu_1',
            content: [
              { type: 'web_search_result', url: 'https://listed.example/only', title: 'x' },
            ],
          },
          {
            type: 'text',
            text: 'FluxRadar publishes its pricing openly.',
            citations: [
              {
                type: 'web_search_result_location',
                url: 'https://fluxradar.test/pricing',
                title: 'Pricing',
                cited_text: 'Pay per scan',
                encrypted_index: 'abc',
              },
              {
                type: 'web_search_result_location',
                url: 'https://fluxradar.test/pricing',
                title: 'Pricing',
                cited_text: 'again',
                encrypted_index: 'def',
              },
              {
                type: 'web_search_result_location',
                url: 'https://fluxradar.test/docs',
                title: 'Docs',
                cited_text: 'docs',
                encrypted_index: 'ghi',
              },
            ],
          },
        ],
        usage: {
          input_tokens: 11_400,
          output_tokens: 180,
          server_tool_use: { web_search_requests: 2 },
        },
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });

    const response = await provider.send(
      makeRequest({ provider: 'anthropic', webSearch: true }),
      'redacted prompt',
    );

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
    });
    // Inline citations only, de-duplicated; the tool result list is not a citation.
    expect(response.citations).toEqual([
      'https://fluxradar.test/pricing',
      'https://fluxradar.test/docs',
    ]);
    expect(response.usage.searchUnits).toBe(2);
    // Provider truth: search content arrives as input tokens and is reported
    // as-is, which the search allowance keeps inside the contract.
    expect(response.usage.inputTokens).toBe(11_400);
    expect(validateNormalizedResponse(response)).toEqual([]);
  });

  it('keeps the answer when a search result block carries an error code', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'msg_err',
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
        content: [
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srvtoolu_1',
            content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' },
          },
          { type: 'text', text: 'What I could verify without more searches.' },
        ],
        usage: { input_tokens: 90, output_tokens: 20, server_tool_use: { web_search_requests: 8 } },
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });

    const response = await provider.send(
      makeRequest({ provider: 'anthropic', webSearch: true }),
      'prompt',
    );

    expect(response.rawText).toBe('What I could verify without more searches.');
    expect(response.finishReason).toBe('stop');
  });

  it('treats a paused search turn as a cut-short answer', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'msg_pause',
        model: 'claude-sonnet-5',
        stop_reason: 'pause_turn',
        content: [{ type: 'text', text: 'Partial answer so far.' }],
        usage: { input_tokens: 90, output_tokens: 20 },
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });

    const response = await provider.send(
      makeRequest({ provider: 'anthropic', webSearch: true }),
      'prompt',
    );

    expect(response).toMatchObject({ rawText: 'Partial answer so far.', finishReason: 'length' });
  });

  it('asks for server-side fallback and records the model that answered', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'msg_fallback',
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"overview":"x"}' }],
        usage: { input_tokens: 90, output_tokens: 20 },
      }),
    );
    const provider = new AnthropicProvider({
      apiKey: 'sk-test',
      modelId: 'claude-opus-5',
      fetcher,
    });

    const response = await provider.send(
      makeRequest({ provider: 'anthropic', allowModelFallback: true }),
      'prompt',
    );

    const call = fetcher.mock.calls[0];
    expect(call?.[1]?.headers).toMatchObject({
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    });
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ fallbacks: 'default' });
    expect(response.modelId).toBe('claude-sonnet-5');
  });

  it('honours per-request caps instead of the module caps', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'msg_caps',
        model: 'claude-opus-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'x'.repeat(6_000) }],
        usage: { input_tokens: 90, output_tokens: 2_900 },
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });
    const caps = {
      maxInputTokens: 24_000,
      maxOutputTokens: 16_000,
      maxReasoningUnits: 4_000,
      maxSearchUnits: 0,
      maxCitationUnits: 0,
      maxSearchContentTokens: 0,
    };

    const response = await provider.send(makeRequest({ provider: 'anthropic', caps }), 'prompt');

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      max_tokens: 16_000,
    });
    // 6,000 characters stay whole under the larger cap, and the reported output
    // is no longer clamped down to 2,000.
    expect(response.rawText).toHaveLength(6_000);
    expect(response.usage.outputTokens).toBe(2_900);
    expect(validateNormalizedResponse(response, caps)).toEqual([]);
  });

  it('maps provider throttling/server errors to Unavailable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 429 }));
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });
    await expect(
      provider.send(makeRequest({ provider: 'anthropic' }), 'prompt'),
    ).rejects.toBeInstanceOf(UnavailableError);
  });

  it('maps a rejected parameter to Unavailable rather than retrying without it', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"error":{"message":"bad tool"}}', { status: 400 }));
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });

    await expect(
      provider.send(makeRequest({ provider: 'anthropic', webSearch: true }), 'prompt'),
    ).rejects.toMatchObject({ reason: 'Anthropic rejected the request' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['timeout', new DOMException('timed out', 'TimeoutError'), 'Anthropic request timed out'],
    ['abort', new DOMException('aborted', 'AbortError'), 'Anthropic request timed out'],
    ['network failure', new TypeError('fetch failed'), 'Anthropic network request failed'],
  ])('maps %s transport failures to Unavailable', async (_kind, failure, reason) => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(failure);
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });

    await expect(
      provider.send(makeRequest({ provider: 'anthropic' }), 'prompt'),
    ).rejects.toMatchObject({
      name: 'UnavailableError',
      reason,
    });
  });

  it('allows a bounded 45 second model turn by default', () => {
    const provider = new AnthropicProvider({
      apiKey: 'sk-test',
      fetcher: vi.fn<typeof fetch>(),
    });

    expect(provider.config.timeoutMs).toBe(45_000);
  });
});

function messagesResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AnthropicProvider — per-request caps', () => {
  it('sends the request cap as max_tokens and clamps usage to it, not to the shared caps', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      messagesResponse({
        id: 'msg_caps',
        model: 'claude-opus-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"overview":"ok","actions":[]}' }],
        // Adaptive thinking counts against output_tokens: far above the shared
        // 2,000 cap, within this request's own.
        usage: { input_tokens: 12_345, output_tokens: 15_000 },
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });

    const response = await provider.send(
      makeRequest({
        provider: 'anthropic',
        caps: { maxInputTokens: 20_000, maxOutputTokens: 16_000 },
      }),
      'prompt',
    );

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      max_tokens: 16_000,
    });
    expect(response.usage).toEqual({
      inputTokens: 12_345,
      outputTokens: 15_000,
      totalTokens: 27_345,
    });
    expect(response.finishReason).toBe('stop');
  });

  it('truncates text at a request cap smaller than the shared one and reports input as billed', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      messagesResponse({
        id: 'msg_small',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'a'.repeat(50) }],
        usage: { input_tokens: 500, output_tokens: 30 },
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });

    const response = await provider.send(
      makeRequest({ provider: 'anthropic', caps: { maxInputTokens: 100, maxOutputTokens: 10 } }),
      'prompt',
    );

    expect(response.rawText).toBe('a'.repeat(20));
    expect(response.finishReason).toBe('length');
    // Usage is provider truth: the text is cut to the request's cap, and the
    // tokens the provider billed for are reported as billed.
    expect(response.usage).toEqual({ inputTokens: 500, outputTokens: 30, totalTokens: 530 });
  });
});

describe('AnthropicProvider — refusal fallback', () => {
  it('asks for the default fallback with its beta header only when the request opts in', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      messagesResponse({
        id: 'msg_fallback',
        model: 'claude-opus-4-8',
        stop_reason: 'end_turn',
        content: [
          { type: 'fallback', from: { model: 'claude-opus-5' }, to: { model: 'claude-opus-4-8' } },
          { type: 'text', text: 'Answered by the fallback model.' },
        ],
        usage: { input_tokens: 40, output_tokens: 12 },
      }),
    );
    const provider = new AnthropicProvider({
      apiKey: 'sk-test',
      fetcher,
      modelId: 'claude-opus-5',
    });

    const rescued = await provider.send(
      makeRequest({ provider: 'anthropic', allowModelFallback: true }),
      'prompt',
    );
    await provider.send(makeRequest({ provider: 'anthropic' }), 'prompt');

    const [optedIn, plain] = fetcher.mock.calls.map(([, init]) => init);
    expect(optedIn?.headers).toMatchObject({ 'anthropic-beta': 'server-side-fallback-2026-07-01' });
    expect(JSON.parse(String(optedIn?.body))).toMatchObject({
      model: 'claude-opus-5',
      fallbacks: 'default',
    });
    expect(plain?.headers).not.toHaveProperty('anthropic-beta');
    expect(JSON.parse(String(plain?.body))).not.toHaveProperty('fallbacks');
    // The model that served the answer, not the one that was asked.
    expect(rescued.modelId).toBe('claude-opus-4-8');
    expect(rescued.rawText).toBe('Answered by the fallback model.');
  });

  function refusedResponse(): Response {
    return messagesResponse({
      id: 'msg_refused',
      model: 'claude-opus-4-8',
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber', explanation: null },
      content: [
        { type: 'fallback', from: { model: 'claude-opus-5' }, to: { model: 'claude-opus-4-8' } },
      ],
      usage: { input_tokens: 40, output_tokens: 0 },
    });
  }

  it('returns a refusal nothing rescued as a safety finish to a request that opted in', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(refusedResponse());
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });

    const response = await provider.send(
      makeRequest({ provider: 'anthropic', allowModelFallback: true }),
      'prompt',
    );

    expect(response).toMatchObject({
      rawText: '',
      finishReason: 'safety',
      modelId: 'claude-opus-4-8',
      usage: { inputTokens: 40, outputTokens: 0, totalTokens: 40 },
    });
  });

  it('keeps a refusal Unavailable for a request that did not opt in', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(refusedResponse());
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });

    await expect(
      provider.send(makeRequest({ provider: 'anthropic' }), 'prompt'),
    ).rejects.toMatchObject({ name: 'UnavailableError', reason: 'Anthropic declined the request' });
  });
});

describe('AnthropicProvider — web search', () => {
  function searchedResponse(overrides: Record<string, unknown> = {}): Response {
    return messagesResponse({
      id: 'msg_search',
      model: 'claude-sonnet-5',
      stop_reason: 'end_turn',
      content: [
        { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search' },
        { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [] },
        {
          type: 'text',
          text: 'FluxRadar audits public signals.',
          citations: [
            {
              type: 'web_search_result_location',
              url: 'https://fluxradar.test/',
              title: 'Home',
              cited_text: 'FluxRadar audits',
            },
            {
              type: 'web_search_result_location',
              url: 'https://fluxradar.test/pricing',
              title: 'Pricing',
              cited_text: 'per scan',
            },
            {
              type: 'web_search_result_location',
              url: 'https://fluxradar.test/',
              title: 'Home again',
              cited_text: 'audits',
            },
          ],
        },
      ],
      usage: {
        input_tokens: 21_500,
        output_tokens: 90,
        server_tool_use: { web_search_requests: 3 },
      },
      ...overrides,
    });
  }

  it('adds the basic web_search tool with the search cap only for a visibility request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => searchedResponse());
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });

    await provider.send(makeRequest({ provider: 'anthropic', webSearch: true }), 'prompt');
    await provider.send(makeRequest({ provider: 'anthropic' }), 'prompt');

    const [searching, plain] = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(searching).toMatchObject({
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
    });
    expect(plain).not.toHaveProperty('tools');
  });

  it('reports the cited pages once each and the provider search count', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(searchedResponse());
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });

    const response = await provider.send(
      makeRequest({ provider: 'anthropic', webSearch: true }),
      'prompt',
    );

    expect(response.citations).toEqual([
      'https://fluxradar.test/',
      'https://fluxradar.test/pricing',
    ]);
    // Search content is billed as input: reported as billed, above the 8,000
    // prompt cap, and inside the contract's search allowance.
    expect(response.usage).toEqual({
      inputTokens: 21_500,
      outputTokens: 90,
      totalTokens: 21_590,
      searchUnits: 3,
      citationUnits: 2,
    });
    expect(validateNormalizedResponse(response)).toEqual([]);
  });

  it('keeps the answer when a search itself failed', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      messagesResponse({
        id: 'msg_search_error',
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
        content: [
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srvtoolu_1',
            content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' },
          },
          { type: 'text', text: 'Answered from what I already had.' },
        ],
        usage: { input_tokens: 40, output_tokens: 9, server_tool_use: { web_search_requests: 8 } },
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });

    const response = await provider.send(
      makeRequest({ provider: 'anthropic', webSearch: true }),
      'prompt',
    );

    expect(response.rawText).toBe('Answered from what I already had.');
    expect(response.usage.searchUnits).toBe(8);
    expect(response.finishReason).toBe('stop');
  });

  it('keeps the text of a paused search turn and reports it as a length finish', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(searchedResponse({ stop_reason: 'pause_turn' }));
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });

    const response = await provider.send(
      makeRequest({ provider: 'anthropic', webSearch: true }),
      'prompt',
    );

    expect(response.rawText).toBe('FluxRadar audits public signals.');
    expect(response.finishReason).toBe('length');
  });

  it('concatenates the text blocks a searching turn splits at citation boundaries', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_split',
          model: 'claude-sonnet-5',
          stop_reason: 'end_turn',
          content: [
            { type: 'text', text: 'Based on the search results, ' },
            {
              type: 'text',
              text: 'Acme was founded in 2007',
              citations: [
                {
                  type: 'web_search_result_location',
                  url: 'https://acme.example/about',
                  title: 'About Acme',
                  cited_text: 'founded in 2007',
                  encrypted_index: 'idx',
                },
              ],
            },
            { type: 'text', text: ' and sells to small teams.' },
          ],
          usage: { input_tokens: 40, output_tokens: 12 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });

    const response = await provider.send(makeRequest({ provider: 'anthropic' }), 'redacted prompt');

    expect(response.rawText).toBe(
      'Based on the search results, Acme was founded in 2007 and sells to small teams.',
    );
    expect(response.citations).toEqual(['https://acme.example/about']);
  });
});
