// Perplexity adapter (raw `fetch`, no SDK) — OPT-IN ONLY.
//
// Like the Google adapter, nothing selects `perplexity` on its own: a scan
// reaches it only by naming the provider with a notice that covers it.
//
// Verified 2026-09-23 against
// https://docs.perplexity.ai/api-reference/chat-completions-post:
//   • `Authorization: Bearer <key>`, an OpenAI-shaped chat-completions body;
//   • request: `model`, `messages[]`, `max_tokens`, `disable_search`,
//     `web_search_options.search_context_size`;
//   • response: `id`, `model`, `created`, `choices[].message.content`,
//     `choices[].finish_reason` (`stop` | `length`), `search_results[]`
//     (`title`, `url`, `date`, `last_updated`, `snippet`, `source`) and
//     `citations[]`;
//   • usage: `prompt_tokens`, `completion_tokens`, `total_tokens`,
//     `num_search_queries`, `reasoning_tokens`, `citation_tokens`.
//
// Documented constraints this adapter does not paper over:
//   1. The request has NO parameter that limits how many searches Perplexity
//      runs — `web_search_options.search_context_size` sizes the context, it
//      does not cap the count. So `caps.maxSearchUnits` cannot be *prevented*
//      here, only detected: `usage.num_search_queries` comes back and an answer
//      over the cap fails the §5 contract and is treated as unavailable. That
//      is refusal after the fact, not prevention, and the spend has already
//      happened — which is part of why this provider is opt-in.
//   2. The reference prints the POST path as `/v1/sonar` (verified 2026-09-23)
//      while Perplexity's migration notes still describe `/chat/completions`.
//      Both documented paths are allowed; nothing else is, so no configuration
//      value can point customer context at an arbitrary host.
//   3. This surface is on its way out. The docs say, verbatim: "Sonar Chat
//      Completions is now Agent API. Sonar will be supported until September 27,
//      2026." After that date this adapter stops working and the opt-in provider
//      needs an Agent API adapter — a different request and response shape, so
//      again not something a setting can bridge. Until then the behaviour is
//      honest: an unreachable or rejecting endpoint is reported as Unavailable,
//      never as a provider that had nothing to say.

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

export interface PerplexityProviderOptions {
  readonly apiKey: string;
  readonly modelId?: string;
  readonly apiVersion?: string;
  /** One of `PERPLEXITY_ENDPOINTS`; anything else is refused. */
  readonly endpointUrl?: string;
  readonly timeoutMs?: number;
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
}

export const PERPLEXITY_DEFAULT_ENDPOINT = 'https://api.perplexity.ai/v1/sonar';

/**
 * The only URLs this adapter will post to: the path the API reference prints
 * today and the one the migration notes still describe.
 *
 * An allowlist rather than a free-form setting, because the value decides where
 * customer context is sent. A typo, a stale value or a tampered environment
 * cannot redirect a request to somewhere nobody documented.
 */
export const PERPLEXITY_ENDPOINTS: readonly string[] = [
  PERPLEXITY_DEFAULT_ENDPOINT,
  'https://api.perplexity.ai/chat/completions',
];

export const PERPLEXITY_DEFAULT_MODEL = 'sonar';

interface PerplexityResponseBody {
  readonly id?: unknown;
  readonly created?: unknown;
  readonly model?: unknown;
  readonly choices?: unknown;
  readonly citations?: unknown;
  readonly search_results?: unknown;
  readonly usage?: unknown;
}

function firstChoice(choices: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(choices)) return undefined;
  const choice = choices[0];
  return isRecord(choice) ? choice : undefined;
}

function contentOf(choice: Record<string, unknown> | undefined): string {
  const message = choice?.message;
  if (!isRecord(message)) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  // The schema also allows a structured content array; keep only its text parts.
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((part) => (isRecord(part) && typeof part.text === 'string' ? [part.text] : []))
    .join('\n');
}

/**
 * The sources the answer was grounded in. `citations` is the flat URL list and
 * `search_results` the structured one; both describe the same set, so whichever
 * the deployment returns is read and de-duplicated downstream.
 */
function sourceUrls(payload: PerplexityResponseBody): readonly string[] {
  const flat = Array.isArray(payload.citations)
    ? payload.citations.flatMap((entry) => {
        const url = nonEmptyString(entry);
        return url === undefined ? [] : [url];
      })
    : [];
  const structured = Array.isArray(payload.search_results)
    ? payload.search_results.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const url = nonEmptyString(entry.url);
        return url === undefined ? [] : [url];
      })
    : [];
  return [...flat, ...structured];
}

function finishReason(value: unknown): NormalizedAiResponse['finishReason'] {
  if (value === 'length') return 'length';
  if (value === 'stop' || value === undefined) return 'stop';
  return 'safety';
}

function providerCreatedAt(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export class PerplexityProvider implements AiProvider {
  readonly config: AiProviderConfig;
  private readonly apiKey: string;
  private readonly endpointUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutOverrideMs: number | undefined;

  constructor(options: PerplexityProviderOptions) {
    if (options.apiKey.trim() === '') throw new Error('Perplexity API key is empty');
    const endpointUrl = options.endpointUrl ?? PERPLEXITY_DEFAULT_ENDPOINT;
    if (!PERPLEXITY_ENDPOINTS.includes(endpointUrl)) {
      throw new Error(
        `Perplexity endpoint "${endpointUrl}" is not one of the documented endpoints ` +
          `(${PERPLEXITY_ENDPOINTS.join(', ')})`,
      );
    }
    this.apiKey = options.apiKey;
    this.endpointUrl = endpointUrl;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? ((): Date => new Date());
    this.timeoutOverrideMs = options.timeoutMs;
    this.config = {
      provider: 'perplexity',
      apiVersion: options.apiVersion ?? 'v1',
      modelId: options.modelId ?? PERPLEXITY_DEFAULT_MODEL,
      timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    };
  }

  private timeoutFor(request: AiRequest): number {
    if (this.timeoutOverrideMs !== undefined) return this.timeoutOverrideMs;
    return request.webSearch === true ? SEARCH_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private body(request: AiRequest, promptText: string, caps: AiRequestCapsShape): string {
    return JSON.stringify({
      model: this.config.modelId,
      messages: [
        { role: 'system', content: request.systemInstructions },
        { role: 'user', content: promptText },
      ],
      max_tokens: caps.maxOutputTokens,
      // A request without the web-search flag must stay recall-only, exactly as
      // it does at the other providers.
      ...(request.webSearch === true
        ? { web_search_options: { search_context_size: 'low' } }
        : { disable_search: true }),
    });
  }

  async send(
    request: AiRequest,
    promptText: string,
    signal?: AbortSignal,
  ): Promise<NormalizedAiResponse> {
    if (request.provider !== 'perplexity') {
      throw new Error(`ai: perplexity adapter received ${request.provider} request`);
    }
    if (request.responseSchema !== undefined) {
      // `response_format` exists but its exact shape could not be confirmed from
      // the official reference for this release; refusing beats guessing.
      throw new UnavailableError('Perplexity adapter does not support constrained JSON output');
    }
    const caps = capsFor(request);
    throwIfCancelled(signal);
    let response: Response;
    try {
      response = await this.fetcher(this.endpointUrl, {
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
      throw new UnavailableError(transportFailureReason('Perplexity', error), { cause: error });
    }
    const payload = (await readJsonBody(response, signal)) as PerplexityResponseBody | null;
    if (!response.ok) {
      throw httpFailure('Perplexity', response.status);
    }
    if (payload === null) {
      throw new UnavailableError('Perplexity returned no readable body');
    }
    const choice = firstChoice(payload.choices);
    const rawText = contentOf(choice);
    if (rawText === '') {
      throw new UnavailableError('Perplexity returned no text content');
    }
    const usage = isRecord(payload.usage) ? payload.usage : undefined;
    const output = capOutputText(rawText, caps);
    const inputCount = reportedOrEstimated(usage?.prompt_tokens, estimateTokens(promptText));
    const outputCount = reportedOrEstimated(usage?.completion_tokens, estimateTokens(output.text));
    const usageSource = usageSourceOf([inputCount, outputCount]);
    const citations = boundedCitations(sourceUrls(payload), caps);
    const reasoning = positiveCount(usage?.reasoning_tokens);
    const searchUnits = positiveCount(usage?.num_search_queries);
    const providerRequestId = nonEmptyString(payload.id);
    return {
      provider: 'perplexity',
      apiVersion: this.config.apiVersion,
      modelId: nonEmptyString(payload.model) ?? this.config.modelId,
      requestId: providerRequestId ?? `local-${this.now().getTime()}`,
      requestIdSource: providerRequestId === undefined ? 'local' : 'provider',
      createdAt: providerCreatedAt(payload.created) ?? this.now().toISOString(),
      rawText: output.text,
      citations,
      usage: {
        inputTokens: inputCount.value,
        outputTokens: outputCount.value,
        totalTokens: inputCount.value + outputCount.value,
        ...(reasoning === undefined ? {} : { reasoningUnits: reasoning }),
        ...(searchUnits === undefined ? {} : { searchUnits }),
        ...(citations.length === 0 ? {} : { citationUnits: citations.length }),
      },
      usageSource,
      ...(usageSource === 'estimated' ? { tokenizerVersion: TOKENIZER_VERSION } : {}),
      finishReason: output.truncated ? 'length' : finishReason(choice?.finish_reason),
    };
  }
}
