import { AI_REQUEST_CAPS } from '@fluxradar/contracts';

import { UnavailableError } from './errors.js';
import { CHARS_PER_TOKEN, estimateTokens, TOKENIZER_VERSION } from './prompt-builder.js';
import type { AiProvider, AiProviderConfig, AiRequest, NormalizedAiResponse } from './types.js';

export interface AnthropicProviderOptions {
  readonly apiKey: string;
  readonly modelId?: string;
  readonly apiVersion?: string;
  readonly timeoutMs?: number;
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
}

interface AnthropicMessageResponse {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly stop_reason?: unknown;
  readonly content?: unknown;
  readonly usage?: { readonly input_tokens?: unknown; readonly output_tokens?: unknown };
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { readonly type: 'text'; readonly text: string } => {
      return (
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
      );
    })
    .map((block) => block.text)
    .join('\n');
}

function countOrEstimate(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function finishReason(value: unknown): NormalizedAiResponse['finishReason'] {
  if (value === 'max_tokens') return 'length';
  if (value === 'end_turn' || value === 'stop_sequence' || value === undefined) return 'stop';
  return 'safety';
}

export class AnthropicProvider implements AiProvider {
  readonly config: AiProviderConfig;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;

  constructor(options: AnthropicProviderOptions) {
    if (options.apiKey.trim() === '') throw new Error('Anthropic API key is empty');
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.config = {
      provider: 'anthropic',
      apiVersion: options.apiVersion ?? '2023-06-01',
      modelId: options.modelId ?? 'claude-sonnet-5',
      timeoutMs: options.timeoutMs ?? 15_000,
      maxRetries: 1,
    };
  }

  async send(request: AiRequest, promptText: string): Promise<NormalizedAiResponse> {
    if (request.provider !== 'anthropic') {
      throw new Error(`ai: anthropic adapter received ${request.provider} request`);
    }
    const response = await this.fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.config.apiVersion,
      },
      body: JSON.stringify({
        model: this.config.modelId,
        max_tokens: AI_REQUEST_CAPS.maxOutputTokens,
        system: request.systemInstructions,
        messages: [{ role: 'user', content: promptText }],
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const payload = (await response.json().catch(() => null)) as AnthropicMessageResponse | null;
    if (!response.ok) {
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new UnavailableError(`Anthropic HTTP ${response.status}`);
      }
      throw new UnavailableError('Anthropic rejected the request');
    }
    const rawText = textFromContent(payload?.content);
    if (payload === null || rawText === '') {
      throw new UnavailableError('Anthropic returned no text content');
    }
    const inputTokens = countOrEstimate(payload?.usage?.input_tokens, estimateTokens(promptText));
    const reportedOutputTokens = countOrEstimate(
      payload?.usage?.output_tokens,
      estimateTokens(rawText),
    );
    const outputTokens = Math.min(reportedOutputTokens, AI_REQUEST_CAPS.maxOutputTokens);
    const cappedText =
      rawText.length > AI_REQUEST_CAPS.maxOutputTokens * CHARS_PER_TOKEN
        ? rawText.slice(0, AI_REQUEST_CAPS.maxOutputTokens * CHARS_PER_TOKEN)
        : rawText;
    return {
      provider: 'anthropic',
      apiVersion: this.config.apiVersion,
      modelId:
        typeof payload.model === 'string' && payload.model !== ''
          ? payload.model
          : this.config.modelId,
      requestId:
        typeof payload.id === 'string' && payload.id !== ''
          ? payload.id
          : `local-${this.now().getTime()}`,
      requestIdSource: typeof payload.id === 'string' && payload.id !== '' ? 'provider' : 'local',
      createdAt: this.now().toISOString(),
      rawText: cappedText,
      citations: [],
      usage: {
        inputTokens: Math.min(inputTokens, AI_REQUEST_CAPS.maxInputTokens),
        outputTokens:
          cappedText.length < rawText.length ? AI_REQUEST_CAPS.maxOutputTokens : outputTokens,
        totalTokens:
          Math.min(inputTokens, AI_REQUEST_CAPS.maxInputTokens) +
          (cappedText.length < rawText.length ? AI_REQUEST_CAPS.maxOutputTokens : outputTokens),
      },
      usageSource: payload?.usage !== undefined ? 'provider' : 'estimated',
      ...(payload?.usage === undefined ? { tokenizerVersion: TOKENIZER_VERSION } : {}),
      finishReason:
        cappedText.length < rawText.length ? 'length' : finishReason(payload.stop_reason),
    };
  }
}
