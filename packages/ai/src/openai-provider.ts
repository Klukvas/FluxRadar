// OpenAI Responses API adapter (raw `fetch`, no SDK).
//
// Verified 2026-09-22 against
// https://developers.openai.com/api/docs/guides/tools-web-search: the tool type
// for new integrations is `web_search` (`web_search_preview` is the legacy
// name), `output[]` carries `web_search_call` and `message` items, and citations
// arrive as `url_citation` annotations on `output_text` parts with `url`,
// `title`, `start_index` and `end_index`. `max_tool_calls` is a Responses API
// request parameter (documented in the deep-research guide); OpenAI's own
// community reports it being ignored on some models, so the count that comes
// back is checked against the cap as well — see response-contract.ts.

import type { AiRequestCapsShape } from '@fluxradar/contracts';

import { UnavailableError } from './errors.js';
import { capsFor, estimateTokens, TOKENIZER_VERSION } from './prompt-builder.js';
import {
  boundedCitations,
  capOutputText,
  DEFAULT_REQUEST_TIMEOUT_MS,
  httpFailure,
  isRecord,
  nonEmptyString,
  positiveCount,
  readJsonBody,
  reportedOrEstimated,
  requestSignal,
  SEARCH_REQUEST_TIMEOUT_MS,
  throwIfCancelled,
  transportFailureReason,
  usageSourceOf,
} from './provider-support.js';
import type { AiProvider, AiProviderConfig, AiRequest, NormalizedAiResponse } from './types.js';

export interface OpenAiProviderOptions {
  readonly apiKey: string;
  readonly modelId?: string;
  readonly apiVersion?: string;
  readonly timeoutMs?: number;
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
}

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

/**
 * The model this adapter is written against.
 *
 * `gpt-5.6-luna` is the owner's recorded choice for this release
 * (`docs/PLAN_GEO_PROVIDERS.md`, "Model registry v2" and Open decisions §1,
 * 2026-09-22): the cheapest OpenAI model that supports the `web_search` tool,
 * chosen because a GEO request's cost is dominated by the per-search charge
 * rather than by tokens. Its model page (checked read-only 2026-09-23) lists
 * `v1/responses` as Supported and `web_search` under both Features and
 * Supported tools, which is exactly what this adapter sends.
 *
 * Changing it is a product decision, not a refactor — `gpt-6-luna` is likewise
 * documented and costs half as much per token, but it is not among the
 * alternatives the owner recorded. `OPENAI_MODEL` overrides this without a code
 * change (`apps/api/src/integrations/openai-config.ts`).
 *
 * Exported because `apps/api` must not re-declare it: two copies of a model
 * identifier drift, and the drift only shows up as a provider that rejects every
 * request.
 */
export const OPENAI_DEFAULT_MODEL = 'gpt-5.6-luna';

interface OpenAiResponseBody {
  readonly id?: unknown;
  readonly created_at?: unknown;
  readonly model?: unknown;
  readonly status?: unknown;
  readonly incomplete_details?: unknown;
  readonly output?: unknown;
  readonly usage?: unknown;
}

interface ParsedOutput {
  readonly rawText: string;
  readonly citationUrls: readonly string[];
  readonly searchUnits: number;
  readonly refused: boolean;
}

function parseOutput(output: unknown): ParsedOutput {
  if (!Array.isArray(output)) {
    return { rawText: '', citationUrls: [], searchUnits: 0, refused: false };
  }
  const texts: string[] = [];
  const citationUrls: string[] = [];
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
      if (part.type === 'refusal') {
        refused = true;
        continue;
      }
      if (part.type !== 'output_text' || typeof part.text !== 'string') continue;
      texts.push(part.text);
      if (!Array.isArray(part.annotations)) continue;
      for (const annotation of part.annotations) {
        if (!isRecord(annotation) || annotation.type !== 'url_citation') continue;
        const url = nonEmptyString(annotation.url);
        if (url !== undefined) citationUrls.push(url);
      }
    }
  }
  return { rawText: texts.join('\n'), citationUrls, searchUnits, refused };
}

function incompleteReason(details: unknown): string | undefined {
  return isRecord(details) ? nonEmptyString(details.reason) : undefined;
}

function reasoningUnits(usage: Record<string, unknown> | undefined): number | undefined {
  const details = usage?.output_tokens_details;
  return isRecord(details) ? positiveCount(details.reasoning_tokens) : undefined;
}

/** Unix seconds from the provider, when it sent a usable one. */
function providerCreatedAt(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export class OpenAiProvider implements AiProvider {
  readonly config: AiProviderConfig;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutOverrideMs: number | undefined;

  constructor(options: OpenAiProviderOptions) {
    if (options.apiKey.trim() === '') throw new Error('OpenAI API key is empty');
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? ((): Date => new Date());
    this.timeoutOverrideMs = options.timeoutMs;
    this.config = {
      provider: 'openai',
      apiVersion: options.apiVersion ?? 'v1',
      modelId: options.modelId ?? OPENAI_DEFAULT_MODEL,
      timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    };
  }

  private timeoutFor(request: AiRequest): number {
    if (this.timeoutOverrideMs !== undefined) return this.timeoutOverrideMs;
    return request.webSearch === true ? SEARCH_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private body(request: AiRequest, promptText: string, caps: AiRequestCapsShape): string {
    // Deliberately minimal: no search_context_size, include, tool_choice,
    // temperature or user. Every extra parameter is another way for a model to
    // reject the whole request, and a rejection is an unavailable provider.
    return JSON.stringify({
      model: this.config.modelId,
      instructions: request.systemInstructions,
      input: promptText,
      max_output_tokens: caps.maxOutputTokens,
      // The default is 30-day response storage; visibility questions carry
      // customer context and must not be retained for us to read back.
      store: false,
      ...(request.reasoningMode === 'disabled' || request.webSearch === true
        ? { reasoning: { effort: 'low' } }
        : {}),
      ...(request.webSearch === true
        ? { tools: [{ type: 'web_search' }], max_tool_calls: caps.maxSearchUnits }
        : {}),
      ...(request.responseSchema === undefined
        ? {}
        : {
            text: {
              format: {
                type: 'json_schema',
                name: 'fluxradar_response',
                schema: request.responseSchema,
                strict: true,
              },
            },
          }),
    });
  }

  async send(
    request: AiRequest,
    promptText: string,
    signal?: AbortSignal,
  ): Promise<NormalizedAiResponse> {
    if (request.provider !== 'openai') {
      throw new Error(`ai: openai adapter received ${request.provider} request`);
    }
    const caps = capsFor(request);
    throwIfCancelled(signal);
    let response: Response;
    try {
      response = await this.fetcher(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: this.body(request, promptText, caps),
        signal: requestSignal(this.timeoutFor(request), signal),
      });
    } catch (error) {
      throwIfCancelled(signal);
      throw new UnavailableError(transportFailureReason('OpenAI', error), { cause: error });
    }
    const payload = (await readJsonBody(response, signal)) as OpenAiResponseBody | null;
    if (!response.ok) {
      throw httpFailure('OpenAI', response.status);
    }
    if (payload === null) {
      throw new UnavailableError('OpenAI returned no readable body');
    }
    const parsed = parseOutput(payload.output);
    if (parsed.rawText === '') {
      throw new UnavailableError('OpenAI returned no text content');
    }
    const usage = isRecord(payload.usage) ? payload.usage : undefined;
    const output = capOutputText(parsed.rawText, caps);
    // What the provider billed, not what we hoped it would bill: the text is cut
    // to the cap locally, the token counts describe the answer OpenAI generated.
    const inputCount = reportedOrEstimated(usage?.input_tokens, estimateTokens(promptText));
    const outputCount = reportedOrEstimated(usage?.output_tokens, estimateTokens(output.text));
    const usageSource = usageSourceOf([inputCount, outputCount]);
    const citations = boundedCitations(parsed.citationUrls, caps);
    const reasoning = reasoningUnits(usage);
    const providerRequestId = nonEmptyString(payload.id);
    const hitOutputCap =
      payload.status === 'incomplete' &&
      incompleteReason(payload.incomplete_details) === 'max_output_tokens';
    return {
      provider: 'openai',
      apiVersion: this.config.apiVersion,
      modelId: nonEmptyString(payload.model) ?? this.config.modelId,
      requestId: providerRequestId ?? `local-${this.now().getTime()}`,
      requestIdSource: providerRequestId === undefined ? 'local' : 'provider',
      createdAt: providerCreatedAt(payload.created_at) ?? this.now().toISOString(),
      rawText: output.text,
      citations,
      usage: {
        inputTokens: inputCount.value,
        outputTokens: outputCount.value,
        totalTokens: inputCount.value + outputCount.value,
        ...(reasoning === undefined ? {} : { reasoningUnits: reasoning }),
        ...(request.webSearch === true ? { searchUnits: parsed.searchUnits } : {}),
        ...(citations.length === 0 ? {} : { citationUnits: citations.length }),
      },
      usageSource,
      ...(usageSource === 'estimated' ? { tokenizerVersion: TOKENIZER_VERSION } : {}),
      finishReason: parsed.refused
        ? 'safety'
        : output.truncated || hitOutputCap
          ? 'length'
          : 'stop',
    };
  }
}
