// Google Gemini adapter (raw `fetch`, no SDK) — OPT-IN ONLY.
//
// Nothing selects `google` on its own. A scan reaches this adapter only when it
// explicitly names the provider and the stored notice covers it (consent.ts),
// which is why this file ships even though the default paid scan never uses it.
//
// Verified 2026-09-23 against https://ai.google.dev/api/generate-content,
// https://ai.google.dev/gemini-api/docs/generate-content/google-search and
// https://ai.google.dev/gemini-api/docs/models:
//   • POST {base}/v1beta/models/{model}:generateContent, key in `x-goog-api-key`
//     (the reference also documents a `?key=` query parameter; the header keeps
//     the secret out of URLs and logs);
//   • request: `contents[]`, `systemInstruction`, `generationConfig`
//     (`maxOutputTokens`, `thinkingConfig`), `tools[]`;
//   • grounding: a `googleSearch` tool entry; response
//     `candidates[].groundingMetadata` with `webSearchQueries[]`,
//     `groundingChunks[].web.uri/.title` and `groundingSupports[]`, each support
//     carrying a `segment` and the `groundingChunkIndices` that back it;
//   • usage: `usageMetadata.promptTokenCount` / `.candidatesTokenCount` /
//     `.thoughtsTokenCount`; identity: `responseId`, `modelVersion`.
//
// Documented constraints this adapter does not paper over:
//   1. The request has NO parameter that limits how many Google searches run.
//      `caps.maxSearchUnits` therefore cannot be *prevented* here — it is only
//      detected afterwards, from `webSearchQueries`, and an answer over the cap
//      fails the §5 contract and is treated as unavailable (response-contract.ts).
//      The searches have already happened and already cost money by then. This
//      is one of the reasons the provider is opt-in rather than default.
//   2. Google is moving search grounding to a newer `/v1beta/interactions`
//      surface with a different request and response shape (`google_search_call`
//      items, `url_citation` annotations). That is a different contract, not a
//      different host, so no base-URL setting can reach it: it needs an adapter.
//      This one speaks `generateContent`, and its endpoint is a constant so that
//      no configuration value can point customer context at another host.

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

export interface GeminiProviderOptions {
  readonly apiKey: string;
  readonly modelId?: string;
  /** One of `GEMINI_API_VERSIONS`; anything else is refused. */
  readonly apiVersion?: string;
  readonly timeoutMs?: number;
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
}

/** Constant, not configurable: see constraint 2 in the file header. */
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
export const GEMINI_DEFAULT_API_VERSION = 'v1beta';

/**
 * The API versions this adapter speaks. The reference documents `v1beta` alone
 * for `generateContent` (checked 2026-09-23), and the grounding parsing below
 * follows that surface's `groundingMetadata` shape.
 *
 * An allowlist rather than a free-form setting, for the same reason as the
 * Perplexity endpoint: a typo would otherwise boot happily and turn every opt-in
 * request into a 404 that reaches the customer as an unavailable provider.
 */
export const GEMINI_API_VERSIONS: readonly string[] = [GEMINI_DEFAULT_API_VERSION];
/**
 * Documented stable model, recommended for new projects on the official model
 * page (checked 2026-09-23). Flash rather than Pro: the visibility questions are
 * short recall turns, and this provider is opt-in.
 */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';

interface GeminiResponseBody {
  readonly candidates?: unknown;
  readonly usageMetadata?: unknown;
  readonly responseId?: unknown;
  readonly modelVersion?: unknown;
  readonly promptFeedback?: unknown;
}

interface ParsedCandidate {
  readonly rawText: string;
  readonly citationUrls: readonly string[];
  readonly searchUnits: number | undefined;
  readonly finishReason: unknown;
}

function firstCandidate(candidates: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(candidates)) return undefined;
  const candidate = candidates[0];
  return isRecord(candidate) ? candidate : undefined;
}

function textOf(candidate: Record<string, unknown> | undefined): string {
  const content = candidate?.content;
  if (!isRecord(content) || !Array.isArray(content.parts)) return '';
  return content.parts
    .flatMap((part) => (isRecord(part) && typeof part.text === 'string' ? [part.text] : []))
    .join('\n');
}

function chunkUri(chunks: readonly unknown[], index: unknown): string | undefined {
  // Documented known issue: `groundingSupports` can reference indices while
  // `groundingChunks` comes back empty or short. An out-of-range index is
  // skipped, never turned into a made-up source.
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return undefined;
  const chunk = chunks[index];
  if (!isRecord(chunk) || !isRecord(chunk.web)) return undefined;
  return nonEmptyString(chunk.web.uri);
}

/**
 * The sources the answer actually cites.
 *
 * `groundingChunks` is everything the search retrieved; `groundingSupports` is
 * what the model's sentences are attributed to. Citations must be the second:
 * listing every retrieved page would credit the answer with sources it never
 * used, and the citation cap would then be spent on them.
 */
function groundingOf(candidate: Record<string, unknown> | undefined): {
  readonly urls: readonly string[];
  readonly searchUnits: number | undefined;
} {
  const grounding = candidate?.groundingMetadata;
  if (!isRecord(grounding)) return { urls: [], searchUnits: undefined };
  const chunks = Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks : [];
  const supports = Array.isArray(grounding.groundingSupports) ? grounding.groundingSupports : [];
  const urls = supports.flatMap((support) => {
    if (!isRecord(support) || !Array.isArray(support.groundingChunkIndices)) return [];
    return support.groundingChunkIndices.flatMap((index) => {
      const uri = chunkUri(chunks, index);
      return uri === undefined ? [] : [uri];
    });
  });
  const queries = grounding.webSearchQueries;
  return {
    urls,
    // One search per query Google reports it ran; absent means the tool never
    // fired, which is a legitimate zero rather than unknown.
    searchUnits: Array.isArray(queries) ? queries.length : undefined,
  };
}

function parseCandidate(candidates: unknown): ParsedCandidate {
  const candidate = firstCandidate(candidates);
  const grounding = groundingOf(candidate);
  return {
    rawText: textOf(candidate),
    citationUrls: grounding.urls,
    searchUnits: grounding.searchUnits,
    finishReason: candidate?.finishReason,
  };
}

function finishReason(value: unknown): NormalizedAiResponse['finishReason'] {
  if (value === 'MAX_TOKENS') return 'length';
  if (value === 'STOP' || value === undefined || value === 'FINISH_REASON_UNSPECIFIED') {
    return 'stop';
  }
  // SAFETY, RECITATION, BLOCKLIST, PROHIBITED_CONTENT, SPII, … all mean the
  // provider stopped the answer for policy reasons.
  return 'safety';
}

export class GeminiProvider implements AiProvider {
  readonly config: AiProviderConfig;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutOverrideMs: number | undefined;

  constructor(options: GeminiProviderOptions) {
    if (options.apiKey.trim() === '') throw new Error('Google API key is empty');
    const apiVersion = options.apiVersion ?? GEMINI_DEFAULT_API_VERSION;
    if (!GEMINI_API_VERSIONS.includes(apiVersion)) {
      throw new Error(
        `Google API version "${apiVersion}" is not one of the documented versions ` +
          `(${GEMINI_API_VERSIONS.join(', ')})`,
      );
    }
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? ((): Date => new Date());
    this.timeoutOverrideMs = options.timeoutMs;
    this.config = {
      provider: 'google',
      apiVersion,
      modelId: options.modelId ?? GEMINI_DEFAULT_MODEL,
      timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    };
  }

  /**
   * Host and shape are fixed; only the API version and the model name vary, and
   * both are escaped so a configured value stays one path segment.
   */
  private endpoint(): string {
    const apiVersion = encodeURIComponent(this.config.apiVersion);
    const model = encodeURIComponent(this.config.modelId);
    return `${GEMINI_BASE_URL}/${apiVersion}/models/${model}:generateContent`;
  }

  private timeoutFor(request: AiRequest): number {
    if (this.timeoutOverrideMs !== undefined) return this.timeoutOverrideMs;
    return request.webSearch === true ? SEARCH_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private body(request: AiRequest, promptText: string, caps: AiRequestCapsShape): string {
    return JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: promptText }] }],
      systemInstruction: { parts: [{ text: request.systemInstructions }] },
      generationConfig: {
        maxOutputTokens: caps.maxOutputTokens,
        ...(request.reasoningMode === 'disabled' || request.webSearch === true
          ? { thinkingConfig: { thinkingBudget: 0 } }
          : {}),
      },
      ...(request.webSearch === true ? { tools: [{ googleSearch: {} }] } : {}),
    });
  }

  async send(
    request: AiRequest,
    promptText: string,
    signal?: AbortSignal,
  ): Promise<NormalizedAiResponse> {
    if (request.provider !== 'google') {
      throw new Error(`ai: google adapter received ${request.provider} request`);
    }
    if (request.responseSchema !== undefined) {
      // Constrained JSON output exists on this API but its exact field could not
      // be confirmed from the official reference for this release. Refusing is
      // honest; guessing would make a malformed request look like a model that
      // answered badly.
      throw new UnavailableError('Google adapter does not support constrained JSON output');
    }
    const caps = capsFor(request);
    throwIfCancelled(signal);
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: this.body(request, promptText, caps),
        signal: requestSignal(this.timeoutFor(request), signal),
      });
    } catch (error) {
      throwIfCancelled(signal);
      throw new UnavailableError(transportFailureReason('Google', error), { cause: error });
    }
    const payload = (await readJsonBody(response, signal)) as GeminiResponseBody | null;
    if (!response.ok) {
      throw httpFailure('Google', response.status);
    }
    if (payload === null) {
      throw new UnavailableError('Google returned no readable body');
    }
    const parsed = parseCandidate(payload.candidates);
    if (parsed.rawText === '') {
      throw new UnavailableError('Google returned no text content');
    }
    const usage = isRecord(payload.usageMetadata) ? payload.usageMetadata : undefined;
    const output = capOutputText(parsed.rawText, caps);
    const inputCount = reportedOrEstimated(usage?.promptTokenCount, estimateTokens(promptText));
    const outputCount = reportedOrEstimated(
      usage?.candidatesTokenCount,
      estimateTokens(output.text),
    );
    const usageSource = usageSourceOf([inputCount, outputCount]);
    const citations = boundedCitations(parsed.citationUrls, caps);
    const reasoning = positiveCount(usage?.thoughtsTokenCount);
    const providerRequestId = nonEmptyString(payload.responseId);
    return {
      provider: 'google',
      apiVersion: this.config.apiVersion,
      modelId: nonEmptyString(payload.modelVersion) ?? this.config.modelId,
      requestId: providerRequestId ?? `local-${this.now().getTime()}`,
      requestIdSource: providerRequestId === undefined ? 'local' : 'provider',
      createdAt: this.now().toISOString(),
      rawText: output.text,
      citations,
      usage: {
        inputTokens: inputCount.value,
        outputTokens: outputCount.value,
        totalTokens: inputCount.value + outputCount.value,
        ...(reasoning === undefined ? {} : { reasoningUnits: reasoning }),
        ...(parsed.searchUnits === undefined ? {} : { searchUnits: parsed.searchUnits }),
        ...(citations.length === 0 ? {} : { citationUnits: citations.length }),
      },
      usageSource,
      ...(usageSource === 'estimated' ? { tokenizerVersion: TOKENIZER_VERSION } : {}),
      finishReason: output.truncated ? 'length' : finishReason(parsed.finishReason),
    };
  }
}
