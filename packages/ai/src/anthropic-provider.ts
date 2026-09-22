import { AI_REQUEST_CAPS } from '@fluxradar/contracts';

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
  readonly usage?: {
    readonly input_tokens?: unknown;
    readonly output_tokens?: unknown;
    readonly server_tool_use?: { readonly web_search_requests?: unknown };
  };
}

const ANTHROPIC_REQUEST_TIMEOUT_MS = 45_000;

/** A turn that searches spends most of its time waiting on the searches. */
const ANTHROPIC_SEARCH_TIMEOUT_MS = 60_000;

/**
 * The basic server-side web search tool. Deliberately not `web_search_20260209`
 * or later: dynamic filtering runs the search through code execution, which adds
 * block types this adapter does not parse and is not ZDR-eligible.
 */
const WEB_SEARCH_TOOL_TYPE = 'web_search_20250305';

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

interface AnthropicTextBlock {
  readonly type: 'text';
  readonly text: string;
  readonly citations?: unknown;
}

function textBlocks(content: unknown): readonly AnthropicTextBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter((block): block is AnthropicTextBlock => {
    return (
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    );
  });
}

function textFromContent(content: unknown): string {
  return textBlocks(content)
    .map((block) => block.text)
    .join('\n');
}

/**
 * The pages the answer actually cited, in the order they were first cited and
 * without repeats. A `web_search_tool_result` block also carries the full result
 * list, but a result the model read and did not use is not a citation.
 */
function citationsFromContent(content: unknown): readonly string[] {
  const urls: string[] = [];
  for (const block of textBlocks(content)) {
    if (!Array.isArray(block.citations)) continue;
    for (const citation of block.citations) {
      if (typeof citation !== 'object' || citation === null) continue;
      const { type, url } = citation as { type?: unknown; url?: unknown };
      if (type !== 'web_search_result_location') continue;
      if (typeof url !== 'string' || url === '') continue;
      if (urls.includes(url)) continue;
      urls.push(url);
      if (urls.length === AI_REQUEST_CAPS.maxCitationUnits) return urls;
    }
  }
  return urls;
}

/**
 * A search that failed (`max_uses_exceeded`, `too_many_requests`, …) arrives as
 * an error object inside a 200, not as a thrown status. The model still answers
 * from what it has, so the answer is kept and the failure is only reported.
 */
function searchToolErrorCodes(content: unknown): readonly string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (typeof block !== 'object' || block === null) return [];
    const { type, content: result } = block as { type?: unknown; content?: unknown };
    if (type !== 'web_search_tool_result') return [];
    if (Array.isArray(result) || typeof result !== 'object' || result === null) return [];
    const { error_code: errorCode } = result as { error_code?: unknown };
    return typeof errorCode === 'string' ? [errorCode] : [];
  });
}

function countOrEstimate(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function finishReason(value: unknown): NormalizedAiResponse['finishReason'] {
  // `pause_turn` ends a long search turn mid-answer and invites a continuation
  // request. We do not continue (out of scope), so the text received is all
  // there is — which is exactly what 'length' means to every reader of it.
  if (value === 'max_tokens' || value === 'pause_turn') return 'length';
  if (value === 'end_turn' || value === 'stop_sequence' || value === undefined) return 'stop';
  return 'safety';
}

/**
 * A searching turn can come back degraded inside a 200: a search that failed, or
 * a `pause_turn` that invites a continuation this adapter does not send. Neither
 * loses the answer, so neither fails the request — but both change how much the
 * answer is worth, so neither stays silent either.
 */
function reportDegradedSearch(payload: AnthropicMessageResponse, request: AiRequest): void {
  const errorCodes = searchToolErrorCodes(payload.content);
  if (errorCodes.length > 0) {
    console.warn(
      `[ai] anthropic web search failed (sequence ${request.sequence}): ${errorCodes.join(', ')}`,
    );
  }
  if (payload.stop_reason === 'pause_turn') {
    console.warn(`[ai] anthropic paused the turn (sequence ${request.sequence}); answer kept`);
  }
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
    ...(request.webSearch === undefined
      ? {}
      : {
          tools: [
            {
              type: WEB_SEARCH_TOOL_TYPE,
              name: 'web_search',
              max_uses: AI_REQUEST_CAPS.maxSearchUnits,
            },
          ],
        }),
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
  /** Set only when the caller pinned a timeout; otherwise the request picks one. */
  private readonly pinnedTimeoutMs: number | null;

  constructor(options: AnthropicProviderOptions) {
    if (options.apiKey.trim() === '') throw new Error('Anthropic API key is empty');
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.pinnedTimeoutMs = options.timeoutMs ?? null;
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

  /** A searching turn waits on the searches as well as on the model. */
  private timeoutFor(request: AiRequest): number {
    if (this.pinnedTimeoutMs !== null) return this.pinnedTimeoutMs;
    return request.webSearch === undefined
      ? ANTHROPIC_REQUEST_TIMEOUT_MS
      : ANTHROPIC_SEARCH_TIMEOUT_MS;
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
        signal: AbortSignal.timeout(this.timeoutFor(request)),
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
    if (payload !== null) reportDegradedSearch(payload, request);
    const rawText = textFromContent(payload?.content);
    // A non-streaming answer drops a declined partial, so a refusal nothing
    // rescued arrives without text. A request that opted into the fallback gets
    // it back as a `safety` finish, so its caller can tell a refusal from an
    // outage; for every other request it stays Unavailable, as before.
    if (payload?.stop_reason === 'refusal' && request.refusalFallback !== undefined) {
      return this.normalize(payload, rawText, promptText, caps);
    }
    if (payload === null || rawText === '') {
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
    // Usage is provider truth. Clamping the input to the prompt cap used to
    // hide what a request actually cost — and a search turn bills its search
    // content as input, so the clamp would now hide most of the spend.
    const inputTokens = countOrEstimate(payload.usage?.input_tokens, estimateTokens(promptText));
    const outputTokens = truncated
      ? caps.maxOutputTokens
      : Math.min(
          countOrEstimate(payload.usage?.output_tokens, estimateTokens(rawText)),
          caps.maxOutputTokens,
        );
    const requestId = typeof payload.id === 'string' && payload.id !== '' ? payload.id : null;
    const searchUnits = payload.usage?.server_tool_use?.web_search_requests;
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
      citations: citationsFromContent(payload.content),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        ...(typeof searchUnits === 'number' && Number.isInteger(searchUnits) && searchUnits >= 0
          ? { searchUnits }
          : {}),
      },
      usageSource: payload.usage !== undefined ? 'provider' : 'estimated',
      ...(payload.usage === undefined ? { tokenizerVersion: TOKENIZER_VERSION } : {}),
      finishReason: truncated ? 'length' : finishReason(payload.stop_reason),
    };
  }
}
