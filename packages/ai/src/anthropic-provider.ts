import { requestCaps } from './caps.js';
import { UnavailableError } from './errors.js';
import { CHARS_PER_TOKEN, estimateTokens, TOKENIZER_VERSION } from './prompt-builder.js';
import type {
  AiProvider,
  AiProviderConfig,
  AiRequest,
  AiRequestCaps,
  NormalizedAiResponse,
} from './types.js';

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

const ANTHROPIC_REQUEST_TIMEOUT_MS = 45_000;

/** The beta that accepts `fallbacks: "default"` (server-side refusal fallback). */
export const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

function transportFailureReason(error: unknown): string {
  if (
    error instanceof DOMException &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return 'Anthropic request timed out';
  }
  return 'Anthropic network request failed';
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

function requestHeaders(
  apiKey: string,
  apiVersion: string,
  request: AiRequest,
): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': apiVersion,
    ...(request.refusalFallback === undefined
      ? {}
      : { 'anthropic-beta': SERVER_SIDE_FALLBACK_BETA }),
  };
}

function requestBody(
  modelId: string,
  request: AiRequest,
  promptText: string,
  caps: AiRequestCaps,
): string {
  return JSON.stringify({
    model: modelId,
    max_tokens: caps.maxOutputTokens,
    system: request.systemInstructions,
    messages: [{ role: 'user', content: promptText }],
    ...(request.reasoningMode === undefined ? {} : { thinking: { type: request.reasoningMode } }),
    ...(request.responseSchema === undefined
      ? {}
      : {
          output_config: {
            format: { type: 'json_schema', schema: request.responseSchema },
          },
        }),
    // A declined request is re-run on the model Anthropic recommends for the
    // refusal's category; the answer's `model` then names the one that served it.
    ...(request.refusalFallback === undefined ? {} : { fallbacks: request.refusalFallback }),
  });
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
      // UX evidence requests are materially larger than the short GEO prompts.
      // Keep the request bounded, but allow enough time for a normal model turn.
      timeoutMs: options.timeoutMs ?? ANTHROPIC_REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    };
  }

  async send(request: AiRequest, promptText: string): Promise<NormalizedAiResponse> {
    if (request.provider !== 'anthropic') {
      throw new Error(`ai: anthropic adapter received ${request.provider} request`);
    }
    const caps = requestCaps(request);
    let response: Response;
    try {
      response = await this.fetcher('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: requestHeaders(this.apiKey, this.config.apiVersion, request),
        body: requestBody(this.config.modelId, request, promptText, caps),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      // fetch rejects for deadlines and transport failures. Both are an
      // unavailable external provider, not a platform bug that should fail and
      // refund the whole scan.
      throw new UnavailableError(transportFailureReason(error), { cause: error });
    }
    const payload = (await response.json().catch(() => null)) as AnthropicMessageResponse | null;
    if (!response.ok) {
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new UnavailableError(`Anthropic HTTP ${response.status}`);
      }
      throw new UnavailableError('Anthropic rejected the request');
    }
    const rawText = textFromContent(payload?.content);
    if (payload === null || rawText === '') {
      // A non-streaming answer drops a declined partial, so a refusal nothing
      // rescued arrives without text.
      throw new UnavailableError(
        payload?.stop_reason === 'refusal'
          ? 'Anthropic declined the request'
          : 'Anthropic returned no text content',
      );
    }
    return this.normalize(payload, rawText, promptText, caps);
  }

  private normalize(
    payload: AnthropicMessageResponse,
    rawText: string,
    promptText: string,
    caps: AiRequestCaps,
  ): NormalizedAiResponse {
    const outputChars = caps.maxOutputTokens * CHARS_PER_TOKEN;
    const truncated = rawText.length > outputChars;
    const inputTokens = Math.min(
      countOrEstimate(payload.usage?.input_tokens, estimateTokens(promptText)),
      caps.maxInputTokens,
    );
    const outputTokens = truncated
      ? caps.maxOutputTokens
      : Math.min(
          countOrEstimate(payload.usage?.output_tokens, estimateTokens(rawText)),
          caps.maxOutputTokens,
        );
    const requestId = typeof payload.id === 'string' && payload.id !== '' ? payload.id : null;
    return {
      provider: 'anthropic',
      apiVersion: this.config.apiVersion,
      modelId:
        typeof payload.model === 'string' && payload.model !== ''
          ? payload.model
          : this.config.modelId,
      requestId: requestId ?? `local-${this.now().getTime()}`,
      requestIdSource: requestId === null ? 'local' : 'provider',
      createdAt: this.now().toISOString(),
      rawText: truncated ? rawText.slice(0, outputChars) : rawText,
      citations: [],
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      usageSource: payload.usage !== undefined ? 'provider' : 'estimated',
      ...(payload.usage === undefined ? { tokenizerVersion: TOKENIZER_VERSION } : {}),
      finishReason: truncated ? 'length' : finishReason(payload.stop_reason),
    };
  }
}
