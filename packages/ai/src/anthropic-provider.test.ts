import { describe, expect, it, vi } from 'vitest';

import { AnthropicProvider } from './anthropic-provider.js';
import { UnavailableError } from './errors.js';
import { makeRequest } from './testing/harness.js';

describe('AnthropicProvider', () => {
  it('sends the redacted prompt and normalizes a Messages API response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_123',
          model: 'claude-sonnet-5',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'A useful answer.' }],
          usage: { input_tokens: 40, output_tokens: 12 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
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
    expect(response).toMatchObject({
      provider: 'anthropic',
      requestId: 'msg_123',
      requestIdSource: 'provider',
      createdAt: '2026-09-03T12:00:00.000Z',
      rawText: 'A useful answer.',
      usage: { inputTokens: 40, outputTokens: 12, totalTokens: 52 },
      finishReason: 'stop',
    });
  });

  it('maps provider throttling/server errors to Unavailable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 429 }));
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetcher });
    await expect(
      provider.send(makeRequest({ provider: 'anthropic' }), 'prompt'),
    ).rejects.toBeInstanceOf(UnavailableError);
  });
});
