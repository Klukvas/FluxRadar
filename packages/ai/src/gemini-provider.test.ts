import { describe, expect, it, vi } from 'vitest';

import { GEMINI_DEFAULT_MODEL, GeminiProvider } from './gemini-provider.js';
import { validateNormalizedResponse } from './response-contract.js';
import { makeRequest } from './testing/harness.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function candidate(text: string, grounding?: unknown): unknown {
  return {
    content: { role: 'model', parts: [{ text }] },
    finishReason: 'STOP',
    ...(grounding === undefined ? {} : { groundingMetadata: grounding }),
  };
}

describe('GeminiProvider', () => {
  it('posts generateContent with the key in a header and normalizes the candidate', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        candidates: [candidate('A useful answer.')],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 14, totalTokenCount: 64 },
        responseId: 'resp-google-1',
        modelVersion: 'gemini-3-flash-001',
      }),
    );
    const provider = new GeminiProvider({
      apiKey: 'goog-key',
      fetcher,
      now: () => new Date('2026-09-22T10:00:00.000Z'),
    });

    const response = await provider.send(makeRequest({ provider: 'google' }), 'redacted prompt');

    expect(fetcher).toHaveBeenCalledWith(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DEFAULT_MODEL}:generateContent`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goog-api-key': 'goog-key' }),
      }),
    );
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      contents: [{ role: 'user', parts: [{ text: 'redacted prompt' }] }],
      systemInstruction: { parts: [{ text: 'Answer factually. Cite sources when possible.' }] },
      generationConfig: { maxOutputTokens: 2000 },
    });
    expect(body).not.toHaveProperty('tools');
    expect(response).toMatchObject({
      provider: 'google',
      modelId: 'gemini-3-flash-001',
      requestId: 'resp-google-1',
      requestIdSource: 'provider',
      rawText: 'A useful answer.',
      usage: { inputTokens: 50, outputTokens: 14, totalTokens: 64 },
      finishReason: 'stop',
    });
    expect(validateNormalizedResponse(response)).toEqual([]);
  });

  it('enables Google Search grounding and reads citations and search count from it', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        candidates: [
          candidate('FluxRadar publishes pricing openly.', {
            webSearchQueries: ['fluxradar pricing', 'fluxradar audit'],
            groundingChunks: [
              { web: { uri: 'https://fluxradar.test/pricing', title: 'Pricing' } },
              { web: { uri: 'https://fluxradar.test/docs', title: 'Docs' } },
              // Retrieved by the search but backing no sentence — not a citation.
              { web: { uri: 'https://unrelated.test/blog', title: 'Blog' } },
            ],
            groundingSupports: [
              { segment: { startIndex: 0, endIndex: 20 }, groundingChunkIndices: [0] },
              { segment: { startIndex: 21, endIndex: 40 }, groundingChunkIndices: [1, 0] },
            ],
          }),
        ],
        usageMetadata: {
          promptTokenCount: 18_000,
          candidatesTokenCount: 120,
          thoughtsTokenCount: 40,
        },
        modelVersion: 'gemini-3-flash-001',
      }),
    );
    const provider = new GeminiProvider({ apiKey: 'goog-key', fetcher });

    const response = await provider.send(
      makeRequest({ provider: 'google', webSearch: true }),
      'prompt',
    );

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      tools: [{ googleSearch: {} }],
      generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
    });
    expect(response.citations).toEqual([
      'https://fluxradar.test/pricing',
      'https://fluxradar.test/docs',
    ]);
    expect(response.usage).toMatchObject({
      searchUnits: 2,
      reasoningUnits: 40,
      inputTokens: 18_000,
    });
    expect(validateNormalizedResponse(response)).toEqual([]);
  });

  it('fails the contract when the answer searched more than the cap allows', async () => {
    // Google documents no request parameter that caps the search count, so the
    // cap can only be enforced on what came back.
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        candidates: [
          candidate('Answer.', {
            webSearchQueries: Array.from({ length: 12 }, (_value, index) => `query ${index}`),
            groundingChunks: [],
          }),
        ],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
      }),
    );
    const provider = new GeminiProvider({ apiKey: 'goog-key', fetcher });

    const response = await provider.send(
      makeRequest({ provider: 'google', webSearch: true }),
      'prompt',
    );

    expect(response.usage.searchUnits).toBe(12);
    expect(validateNormalizedResponse(response)).toEqual(['usage.searchUnits 12 exceeds cap 8']);
  });

  it('refuses a constrained-JSON request instead of guessing the field', async () => {
    const provider = new GeminiProvider({ apiKey: 'goog-key', fetcher: vi.fn<typeof fetch>() });

    await expect(
      provider.send(
        makeRequest({ provider: 'google', responseSchema: { type: 'object' } }),
        'prompt',
      ),
    ).rejects.toMatchObject({
      reason: 'Google adapter does not support constrained JSON output',
    });
  });

  it.each([
    [429, 'Google HTTP 429'],
    [400, 'Google rejected the request'],
  ])('maps HTTP %s to Unavailable', async (status, reason) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status }));
    const provider = new GeminiProvider({ apiKey: 'goog-key', fetcher });

    await expect(
      provider.send(makeRequest({ provider: 'google' }), 'prompt'),
    ).rejects.toMatchObject({ name: 'UnavailableError', reason });
  });

  it('maps a blocked candidate to a safety finish and an empty one to Unavailable', async () => {
    const blocked = new GeminiProvider({
      apiKey: 'goog-key',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          candidates: [
            {
              content: { parts: [{ text: 'Partial.' }] },
              finishReason: 'SAFETY',
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
        }),
      ),
    });
    await expect(
      blocked.send(makeRequest({ provider: 'google' }), 'prompt'),
    ).resolves.toMatchObject({ finishReason: 'safety' });

    const empty = new GeminiProvider({
      apiKey: 'goog-key',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ candidates: [] })),
    });
    await expect(empty.send(makeRequest({ provider: 'google' }), 'prompt')).rejects.toMatchObject({
      reason: 'Google returned no text content',
    });
  });

  it('ignores grounding chunks the answer does not cite and sources it cannot be trusted with', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        candidates: [
          candidate('Answer.', {
            webSearchQueries: ['fluxradar'],
            groundingChunks: [
              { web: { uri: 'javascript:alert(1)' } },
              { web: { uri: 'https://admin:secret@fluxradar.test/private' } },
              { web: { uri: 'http://169.254.169.254/latest/meta-data' } },
              { web: { uri: 'https://fluxradar.test/pricing' } },
            ],
            groundingSupports: [
              { groundingChunkIndices: [0, 1, 2, 3] },
              // Known Google issue: a support can point past the chunk list.
              { groundingChunkIndices: [9, -1, 'two'] },
            ],
          }),
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
      }),
    );
    const provider = new GeminiProvider({ apiKey: 'goog-key', fetcher });

    const response = await provider.send(
      makeRequest({ provider: 'google', webSearch: true }),
      'prompt',
    );

    expect(response.citations).toEqual(['https://fluxradar.test/pricing']);
  });

  it('keeps the documented host and escapes a configured model into one path segment', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        candidates: [candidate('Answer.')],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
      }),
    );
    const provider = new GeminiProvider({
      apiKey: 'goog-key',
      modelId: '../../gemini-custom',
      fetcher,
    });

    await provider.send(makeRequest({ provider: 'google' }), 'prompt');

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/' +
        '..%2F..%2Fgemini-custom:generateContent',
    );
  });

  it('refuses to be built on an API version it does not speak', () => {
    // `v1` exists on the host but the reference documents generateContent —
    // grounding metadata and all — only under v1beta. Building the adapter
    // anyway would move the failure to the first paid scan that opted in.
    expect(() => new GeminiProvider({ apiKey: 'goog-key', apiVersion: 'v1' })).toThrow(
      'not one of the documented versions',
    );
    expect(() => new GeminiProvider({ apiKey: 'goog-key', apiVersion: 'v1beta' })).not.toThrow();
  });
});
