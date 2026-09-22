// OpenAI Responses API adapter (§5 contract, D-233). Raw `fetch`, no SDK, and
// the same normalized shape every other adapter returns, so the GEO module
// cannot tell which provider answered except by `provider`.
//
// The body carries the fewest parameters that do the job: every extra one is
// another thing a model can reject, and a rejected parameter is an unavailable
// provider, never a silently weaker request.

import { AI_REQUEST_CAPS } from '@fluxradar/contracts';

import { requestCaps } from './caps.js';
import { AiModuleError, UnavailableError } from './errors.js';
import { CHARS_PER_TOKEN, estimateTokens, TOKENIZER_VERSION } from './prompt-builder.js';
import type {
  AiProvider,
  AiProviderConfig,
  AiRequest,
  AiRequestCaps,
  NormalizedAiResponse,
} from './types.js';

export interface OpenAiProviderOptions {
  readonly apiKey: string;
  readonly modelId?: string;
  readonly apiVersion?: string;
  readonly timeoutMs?: number;
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
}

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_REQUEST_TIMEOUT_MS = 45_000;

/** A turn that searches spends most of its time waiting on the searches. */
const OPENAI_SEARCH_TIMEOUT_MS = 60_000;

/** Name of the structured-output schema; OpenAI requires one and never shows it. */
const RESPONSE_SCHEMA_NAME = 'fluxradar_response';

interface OpenAiResponsePayload {
  readonly id?: unknown;
  readonly created_at?: unknown;
  readonly model?: unknown;
  readonly status?: unknown;
  readonly incomplete_details?: { readonly reason?: unknown };
  readonly output?: unknown;
  readonly usage?: {
    readonly input_tokens?: unknown;
    readonly output_tokens?: unknown;
    readonly output_tokens_details?: { readonly reasoning_tokens?: unknown };
  };
}

interface ParsedOutput {
  readonly text: string;
  readonly citations: readonly string[];
  readonly searchUnits: number;
  readonly refused: boolean;
}

function transportFailureReason(error: unknown): string {
  if (
    error instanceof DOMException &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return 'OpenAI request timed out';
  }
  return 'OpenAI network request failed';
}

function countOrEstimate(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** `url_citation` annotations of one `output_text` part, in the order cited. */
function citationsOfPart(part: Record<string, unknown>, collected: string[]): void {
  const { annotations } = part;
  if (!Array.isArray(annotations)) return;
  for (const annotation of annotations) {
    if (!isRecord(annotation) || annotation.type !== 'url_citation') continue;
    const url = stringField(annotation, 'url');
    // A page cited twice is one source, and the list is bounded: the contract
    // stores citations, not the model's whole reading history.
    if (url === null || collected.includes(url)) continue;
    if (collected.length >= AI_REQUEST_CAPS.maxCitationUnits) return;
    collected.push(url);
  }
}

/**
 * Walks `output[]`: search calls are counted, message parts become the answer.
 * A `refusal` part is the model's own words for why it will not answer, so it
 * is kept as the answer and marked — losing it would leave an empty response
 * that reads exactly like an outage.
 */
function parseOutput(output: unknown): ParsedOutput {
  if (!Array.isArray(output)) return { text: '', citations: [], searchUnits: 0, refused: false };
  const texts: string[] = [];
  const citations: string[] = [];
  let searchUnits = 0;
  let refused = false;

  for (const item of output) {
    if (!isRecord(item)) continue;
    if (item.type === 'web_search_call') {
      searchUnits += 1;
      continue;
    }
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!isRecord(part)) continue;
      if (part.type === 'output_text') {
        const text = stringField(part, 'text');
        if (text !== null) texts.push(text);
        citationsOfPart(part, citations);
        continue;
      }
      if (part.type === 'refusal') {
        refused = true;
        const refusal = stringField(part, 'refusal');
        if (refusal !== null) texts.push(refusal);
      }
    }
  }
  return { text: texts.join('\n'), citations, searchUnits, refused };
}

function requestBody(
  modelId: string,
  request: AiRequest,
  promptText: string,
  caps: AiRequestCaps,
): string {
  // Reasoning shares the output budget, and a visibility answer needs all of
  // it. `disabled` has no OpenAI equivalent, so the lowest effort stands in.
  const lowEffortReasoning =
    request.reasoningMode === 'disabled' || request.webSearch !== undefined;
  return JSON.stringify({
    model: modelId,
    instructions: request.systemInstructions,
    input: promptText,
    max_output_tokens: caps.maxOutputTokens,
    // The default keeps a copy of every response for 30 days. Nothing this
    // product sends needs to outlive the request that sent it.
    store: false,
    ...(lowEffortReasoning ? { reasoning: { effort: 'low' } } : {}),
    ...(request.webSearch === undefined
      ? {}
      : {
          tools: [{ type: 'web_search' }],
          max_tool_calls: AI_REQUEST_CAPS.maxSearchUnits,
        }),
    ...(request.responseSchema === undefined
      ? {}
      : {
          text: {
            format: {
              type: 'json_schema',
              name: RESPONSE_SCHEMA_NAME,
              schema: request.responseSchema,
              strict: true,
            },
          },
        }),
  });
}

export class OpenAiProvider implements AiProvider {
  readonly config: AiProviderConfig;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  /** Set only when the caller pinned a timeout; otherwise the request picks one. */
  private readonly pinnedTimeoutMs: number | null;

  constructor(options: OpenAiProviderOptions) {
    if (options.apiKey.trim() === '') throw new Error('OpenAI API key is empty');
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.pinnedTimeoutMs = options.timeoutMs ?? null;
    this.config = {
      provider: 'openai',
      apiVersion: options.apiVersion ?? 'v1',
      modelId: options.modelId ?? 'gpt-5.6-terra',
      timeoutMs: options.timeoutMs ?? OPENAI_REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    };
  }

  /** A searching turn waits on the searches as well as on the model. */
  private timeoutFor(request: AiRequest): number {
    if (this.pinnedTimeoutMs !== null) return this.pinnedTimeoutMs;
    return request.webSearch === undefined ? OPENAI_REQUEST_TIMEOUT_MS : OPENAI_SEARCH_TIMEOUT_MS;
  }

  async send(request: AiRequest, promptText: string): Promise<NormalizedAiResponse> {
    if (request.provider !== 'openai') {
      // Routing a request to the wrong adapter is a caller bug, not an outage.
      throw new AiModuleError(`ai: openai adapter received ${request.provider} request`);
    }
    const caps = requestCaps(request);
    let response: Response;
    try {
      response = await this.fetcher(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: requestBody(this.config.modelId, request, promptText, caps),
        signal: AbortSignal.timeout(this.timeoutFor(request)),
      });
    } catch (error) {
      // Deadlines and transport failures are an unavailable external provider,
      // not a platform bug that should fail and refund the whole scan.
      throw new UnavailableError(transportFailureReason(error), { cause: error });
    }
    const payload = (await response.json().catch(() => null)) as OpenAiResponsePayload | null;
    if (!response.ok) {
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new UnavailableError(`OpenAI HTTP ${response.status}`);
      }
      // A 400 usually means a parameter this adapter sent was rejected. That is
      // a request that never ran, not a weaker request that did.
      throw new UnavailableError('OpenAI rejected the request');
    }
    const parsed = parseOutput(payload?.output);
    if (payload === null || parsed.text === '') {
      throw new UnavailableError('OpenAI returned no text content');
    }
    return this.normalize(payload, parsed, promptText, caps);
  }

  private normalize(
    payload: OpenAiResponsePayload,
    parsed: ParsedOutput,
    promptText: string,
    caps: AiRequestCaps,
  ): NormalizedAiResponse {
    const outputChars = caps.maxOutputTokens * CHARS_PER_TOKEN;
    const truncated = parsed.text.length > outputChars;
    // Usage is provider truth: search content is billed as input, so the input
    // count legitimately runs past the prompt cap and is reported as billed.
    const inputTokens = countOrEstimate(payload.usage?.input_tokens, estimateTokens(promptText));
    const outputTokens = truncated
      ? caps.maxOutputTokens
      : Math.min(
          countOrEstimate(payload.usage?.output_tokens, estimateTokens(parsed.text)),
          caps.maxOutputTokens,
        );
    const reasoningUnits = payload.usage?.output_tokens_details?.reasoning_tokens;
    const requestId = typeof payload.id === 'string' && payload.id !== '' ? payload.id : null;
    const createdAt =
      typeof payload.created_at === 'number' && Number.isFinite(payload.created_at)
        ? new Date(payload.created_at * 1000).toISOString()
        : this.now().toISOString();
    return {
      provider: 'openai',
      apiVersion: this.config.apiVersion,
      modelId:
        typeof payload.model === 'string' && payload.model !== ''
          ? payload.model
          : this.config.modelId,
      requestId: requestId ?? `local-${this.now().getTime()}`,
      requestIdSource: requestId === null ? 'local' : 'provider',
      createdAt,
      rawText: truncated ? parsed.text.slice(0, outputChars) : parsed.text,
      citations: parsed.citations,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        ...(typeof reasoningUnits === 'number' &&
        Number.isInteger(reasoningUnits) &&
        reasoningUnits >= 0
          ? { reasoningUnits }
          : {}),
        ...(parsed.searchUnits > 0 ? { searchUnits: parsed.searchUnits } : {}),
      },
      usageSource: payload.usage !== undefined ? 'provider' : 'estimated',
      ...(payload.usage === undefined ? { tokenizerVersion: TOKENIZER_VERSION } : {}),
      finishReason: finishReasonOf(payload, parsed, truncated),
    };
  }
}

function finishReasonOf(
  payload: OpenAiResponsePayload,
  parsed: ParsedOutput,
  truncated: boolean,
): NormalizedAiResponse['finishReason'] {
  if (parsed.refused) return 'safety';
  if (truncated) return 'length';
  if (
    payload.status === 'incomplete' &&
    payload.incomplete_details?.reason === 'max_output_tokens'
  ) {
    return 'length';
  }
  return 'stop';
}
