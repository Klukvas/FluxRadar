import { describe, expect, it, vi } from 'vitest';

import { UnavailableError } from './errors.js';
import { OPENAI_DEFAULT_MODEL, OpenAiProvider } from './openai-provider.js';
import { validateNormalizedResponse } from './response-contract.js';
import { makeRequest } from './testing/harness.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function messageOutput(text: string, annotations: readonly unknown[] = []): unknown {
  return {
    type: 'message',
    id: 'msg_1',
    content: [{ type: 'output_text', text, annotations }],
  };
}

describe('OpenAiProvider', () => {
  it('defaults to the model this release was chosen for', () => {
    // The identifier the owner recorded for this release on
    // 2026-09-22. Moving it is a product decision — the cost tier and the
    // answers change with it — so it fails here rather than shipping quietly.
    expect(OPENAI_DEFAULT_MODEL).toBe('gpt-5.6-luna');
  });

  it('posts a minimal Responses body and normalizes the answer', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'resp_abc',
        created_at: 1_790_000_000,
        model: 'gpt-5.6-luna',
        status: 'completed',
        output: [messageOutput('A useful answer.')],
        usage: { input_tokens: 44, output_tokens: 10 },
      }),
    );
    const provider = new OpenAiProvider({ apiKey: 'sk-openai', fetcher });

    const response = await provider.send(makeRequest({ provider: 'openai' }), 'redacted prompt');

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer sk-openai' }),
      }),
    );
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-5.6-luna',
      instructions: 'Answer factually. Cite sources when possible.',
      input: 'redacted prompt',
      max_output_tokens: 2000,
      store: false,
    });
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('max_tool_calls');
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('include');
    expect(response).toMatchObject({
      provider: 'openai',
      apiVersion: 'v1',
      modelId: 'gpt-5.6-luna',
      requestId: 'resp_abc',
      requestIdSource: 'provider',
      createdAt: new Date(1_790_000_000 * 1000).toISOString(),
      rawText: 'A useful answer.',
      usage: { inputTokens: 44, outputTokens: 10, totalTokens: 54 },
      finishReason: 'stop',
    });
    expect(validateNormalizedResponse(response)).toEqual([]);
  });

  it('adds the web_search tool and the call cap only when search is requested', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'resp_search',
        created_at: 1_790_000_100,
        model: 'gpt-5.6-luna',
        status: 'completed',
        output: [
          { type: 'web_search_call', id: 'ws_1', status: 'completed' },
          { type: 'web_search_call', id: 'ws_2', status: 'completed' },
          messageOutput('FluxRadar lists its pricing publicly.', [
            { type: 'url_citation', url: 'https://fluxradar.test/pricing', title: 'Pricing' },
            { type: 'url_citation', url: 'https://fluxradar.test/pricing', title: 'Pricing' },
            { type: 'url_citation', url: 'https://fluxradar.test/docs', title: 'Docs' },
          ]),
        ],
        usage: {
          input_tokens: 24_000,
          output_tokens: 120,
          output_tokens_details: { reasoning_tokens: 30 },
        },
      }),
    );
    const provider = new OpenAiProvider({ apiKey: 'sk-openai', fetcher });

    const response = await provider.send(
      makeRequest({ provider: 'openai', webSearch: true }),
      'prompt',
    );

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      tools: [{ type: 'web_search' }],
      max_tool_calls: 8,
      reasoning: { effort: 'low' },
    });
    expect(response.citations).toEqual([
      'https://fluxradar.test/pricing',
      'https://fluxradar.test/docs',
    ]);
    expect(response.usage).toMatchObject({
      inputTokens: 24_000,
      searchUnits: 2,
      reasoningUnits: 30,
      citationUnits: 2,
    });
    expect(validateNormalizedResponse(response)).toEqual([]);
  });

  it('maps an incomplete response that hit the output cap to length', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'resp_inc',
        model: 'gpt-5.6-luna',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [messageOutput('Cut short')],
        usage: { input_tokens: 20, output_tokens: 2000 },
      }),
    );
    const provider = new OpenAiProvider({ apiKey: 'sk-openai', fetcher });

    const response = await provider.send(makeRequest({ provider: 'openai' }), 'prompt');

    expect(response.finishReason).toBe('length');
  });

  it('maps a refusal part to a safety finish', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'resp_refusal',
        model: 'gpt-5.6-luna',
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              { type: 'refusal', refusal: 'I cannot help with that.' },
              { type: 'output_text', text: 'Nothing to report.', annotations: [] },
            ],
          },
        ],
        usage: { input_tokens: 20, output_tokens: 5 },
      }),
    );
    const provider = new OpenAiProvider({ apiKey: 'sk-openai', fetcher });

    const response = await provider.send(makeRequest({ provider: 'openai' }), 'prompt');

    expect(response.finishReason).toBe('safety');
  });

  it('sends a strict json_schema format when the request carries a schema', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'resp_schema',
        model: 'gpt-5.6-luna',
        status: 'completed',
        output: [messageOutput('{"questions":[]}')],
        usage: { input_tokens: 20, output_tokens: 5 },
      }),
    );
    const provider = new OpenAiProvider({ apiKey: 'sk-openai', fetcher });
    const schema = { type: 'object', properties: {}, additionalProperties: false } as const;

    await provider.send(makeRequest({ provider: 'openai', responseSchema: schema }), 'prompt');

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      text: {
        format: { type: 'json_schema', name: 'fluxradar_response', schema, strict: true },
      },
    });
  });

  it.each([
    [429, 'OpenAI HTTP 429'],
    [503, 'OpenAI HTTP 503'],
    [400, 'OpenAI rejected the request'],
  ])('maps HTTP %s to Unavailable', async (status, reason) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status }));
    const provider = new OpenAiProvider({ apiKey: 'sk-openai', fetcher });

    await expect(
      provider.send(makeRequest({ provider: 'openai' }), 'prompt'),
    ).rejects.toMatchObject({ name: 'UnavailableError', reason });
  });

  it('maps transport failures and an empty output to Unavailable', async () => {
    const failing = new OpenAiProvider({
      apiKey: 'sk-openai',
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')),
    });
    await expect(
      failing.send(makeRequest({ provider: 'openai' }), 'prompt'),
    ).rejects.toBeInstanceOf(UnavailableError);

    const empty = new OpenAiProvider({
      apiKey: 'sk-openai',
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ id: 'resp_empty', status: 'completed', output: [] })),
    });
    await expect(empty.send(makeRequest({ provider: 'openai' }), 'prompt')).rejects.toMatchObject({
      reason: 'OpenAI returned no text content',
    });
  });

  it('refuses a request routed to the wrong adapter', async () => {
    const provider = new OpenAiProvider({ apiKey: 'sk-openai', fetcher: vi.fn<typeof fetch>() });

    await expect(
      provider.send(makeRequest({ provider: 'anthropic' }), 'prompt'),
    ).rejects.toThrowError(/openai adapter received anthropic request/);
  });
});
