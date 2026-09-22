// OpenAI Responses adapter: the exact request body, the web-search parsing and
// every branch that must read as an unavailable provider rather than as data.

import { describe, expect, it, vi } from 'vitest';

import { AiModuleError, UnavailableError } from './errors.js';
import { OpenAiProvider } from './openai-provider.js';
import { validateNormalizedResponse } from './response-contract.js';
import { makeRequest } from './testing/harness.js';

function responsesReply(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function answeredBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'resp_0001',
    created_at: 1_772_000_000,
    model: 'gpt-5.6-terra',
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'A useful answer.' }] }],
    usage: { input_tokens: 40, output_tokens: 12 },
    ...overrides,
  };
}

function sentBody(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): Record<string, unknown> {
  return JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
}

describe('OpenAiProvider', () => {
  it('sends the redacted prompt to the Responses API and normalizes the answer', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(responsesReply(answeredBody()));
    const provider = new OpenAiProvider({ apiKey: 'sk-openai-test', fetcher });

    const response = await provider.send(makeRequest(), 'redacted prompt');

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer sk-openai-test',
          'content-type': 'application/json',
        }),
      }),
    );
    expect(sentBody(fetcher)).toEqual({
      model: 'gpt-5.6-terra',
      instructions: 'Answer factually. Cite sources when possible.',
      input: 'redacted prompt',
      max_output_tokens: 2000,
      store: false,
    });
    expect(response).toMatchObject({
      provider: 'openai',
      apiVersion: 'v1',
      modelId: 'gpt-5.6-terra',
      requestId: 'resp_0001',
      requestIdSource: 'provider',
      createdAt: '2026-02-25T06:13:20.000Z',
      rawText: 'A useful answer.',
      citations: [],
      usage: { inputTokens: 40, outputTokens: 12, totalTokens: 52 },
      usageSource: 'provider',
      finishReason: 'stop',
    });
    expect(validateNormalizedResponse(response)).toEqual([]);
  });

  it('adds the web_search tool and the call cap only for a visibility request', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => responsesReply(answeredBody()));
    const provider = new OpenAiProvider({ apiKey: 'sk-test', fetcher });

    await provider.send(makeRequest({ webSearch: true }), 'prompt');
    await provider.send(makeRequest(), 'prompt');

    const [searching, plain] = fetcher.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    ) as Record<string, unknown>[];
    expect(searching).toMatchObject({
      tools: [{ type: 'web_search' }],
      max_tool_calls: 8,
      reasoning: { effort: 'low' },
      store: false,
      max_output_tokens: 2000,
    });
    expect(plain).not.toHaveProperty('tools');
    expect(plain).not.toHaveProperty('max_tool_calls');
    expect(plain).not.toHaveProperty('reasoning');
  });

  it('asks for low reasoning effort and a strict schema when the request does', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      responsesReply(
        answeredBody({
          output: [
            { type: 'message', content: [{ type: 'output_text', text: '{"questions":[]}' }] },
          ],
        }),
      ),
    );
    const provider = new OpenAiProvider({ apiKey: 'sk-test', fetcher });
    const schema = {
      type: 'object',
      properties: { questions: { type: 'array', items: { type: 'string' } } },
      required: ['questions'],
      additionalProperties: false,
    } as const;

    await provider.send(makeRequest({ reasoningMode: 'disabled', responseSchema: schema }), 'p');

    expect(sentBody(fetcher)).toMatchObject({
      reasoning: { effort: 'low' },
      text: {
        format: { type: 'json_schema', name: 'fluxradar_response', schema, strict: true },
      },
    });
  });

  it('counts search calls and keeps each cited page once, in the order cited', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      responsesReply(
        answeredBody({
          output: [
            { type: 'web_search_call', id: 'ws_1', status: 'completed' },
            { type: 'web_search_call', id: 'ws_2', status: 'completed' },
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'FluxRadar audits public signals.',
                  annotations: [
                    { type: 'url_citation', url: 'https://fluxradar.test/', title: 'Home' },
                    { type: 'url_citation', url: 'https://fluxradar.test/pricing', title: 'Price' },
                    { type: 'url_citation', url: 'https://fluxradar.test/', title: 'Home again' },
                  ],
                },
              ],
            },
          ],
          usage: {
            input_tokens: 9_400,
            output_tokens: 180,
            output_tokens_details: { reasoning_tokens: 64 },
          },
        }),
      ),
    );
    const provider = new OpenAiProvider({ apiKey: 'sk-test', fetcher });

    const response = await provider.send(makeRequest({ webSearch: true }), 'prompt');

    expect(response.citations).toEqual([
      'https://fluxradar.test/',
      'https://fluxradar.test/pricing',
    ]);
    expect(response.usage).toEqual({
      // Provider truth: search content is billed as input and reported as billed.
      inputTokens: 9_400,
      outputTokens: 180,
      totalTokens: 9_580,
      reasoningUnits: 64,
      searchUnits: 2,
    });
    expect(validateNormalizedResponse(response)).toEqual([]);
  });

  it('reads an answer cut off by the output cap as a length finish', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      responsesReply(
        answeredBody({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
        }),
      ),
    );
    const provider = new OpenAiProvider({ apiKey: 'sk-test', fetcher });

    const response = await provider.send(makeRequest(), 'prompt');

    expect(response.finishReason).toBe('length');
    expect(response.rawText).toBe('A useful answer.');
  });

  it('keeps a refusal as the answer and marks it as a safety finish', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      responsesReply(
        answeredBody({
          output: [
            {
              type: 'message',
              content: [{ type: 'refusal', refusal: 'I cannot help with that.' }],
            },
          ],
        }),
      ),
    );
    const provider = new OpenAiProvider({ apiKey: 'sk-test', fetcher });

    const response = await provider.send(makeRequest(), 'prompt');

    expect(response).toMatchObject({
      rawText: 'I cannot help with that.',
      finishReason: 'safety',
    });
  });

  it.each([
    ['throttling', 429, 'OpenAI HTTP 429'],
    ['a server error', 503, 'OpenAI HTTP 503'],
    ['a timeout status', 408, 'OpenAI HTTP 408'],
    // A rejected parameter is a request that never ran, never a weaker one.
    ['a rejected parameter', 400, 'OpenAI rejected the request'],
    ['a bad key', 401, 'OpenAI rejected the request'],
  ])('maps %s to Unavailable', async (_kind, status, reason) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(responsesReply({ error: { message: 'no' } }, status));
    const provider = new OpenAiProvider({ apiKey: 'sk-test', fetcher });

    await expect(provider.send(makeRequest(), 'prompt')).rejects.toMatchObject({
      name: 'UnavailableError',
      reason,
    });
  });

  it.each([
    ['timeout', new DOMException('timed out', 'TimeoutError'), 'OpenAI request timed out'],
    ['abort', new DOMException('aborted', 'AbortError'), 'OpenAI request timed out'],
    ['network failure', new TypeError('fetch failed'), 'OpenAI network request failed'],
  ])('maps %s transport failures to Unavailable', async (_kind, failure, reason) => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(failure);
    const provider = new OpenAiProvider({ apiKey: 'sk-test', fetcher });

    await expect(provider.send(makeRequest(), 'prompt')).rejects.toMatchObject({
      name: 'UnavailableError',
      reason,
    });
  });

  it('treats an answer with no text as Unavailable', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        responsesReply(
          answeredBody({ output: [{ type: 'web_search_call', id: 'ws_1', status: 'completed' }] }),
        ),
      );
    const provider = new OpenAiProvider({ apiKey: 'sk-test', fetcher });

    await expect(provider.send(makeRequest(), 'prompt')).rejects.toBeInstanceOf(UnavailableError);
  });

  it('refuses a request aimed at another provider as a wiring bug', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = new OpenAiProvider({ apiKey: 'sk-test', fetcher });

    await expect(
      provider.send(makeRequest({ provider: 'anthropic' }), 'prompt'),
    ).rejects.toBeInstanceOf(AiModuleError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('allows a bounded 45 second model turn by default', () => {
    const provider = new OpenAiProvider({ apiKey: 'sk-test', fetcher: vi.fn<typeof fetch>() });

    expect(provider.config.timeoutMs).toBe(45_000);
  });
});
