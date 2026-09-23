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
