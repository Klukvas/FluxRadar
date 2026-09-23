// Anthropic Messages API adapter (raw `fetch`, no SDK).
//
// Verified against https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
// on 2026-09-22: the basic web search tool is `web_search_20250305` with
// `name: "web_search"` and an optional `max_uses`; over the cap the
// `web_search_tool_result` block carries `error_code: "max_uses_exceeded"`
// inside a 200; citations arrive as `web_search_result_location` entries on text
// blocks; the search count is `usage.server_tool_use.web_search_requests`; a long
// search turn can end with `stop_reason: "pause_turn"`.

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

export interface AnthropicProviderOptions {
  readonly apiKey: string;
  readonly modelId?: string;
  readonly apiVersion?: string;
  readonly timeoutMs?: number;
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
}

/**
 * Basic web search only. `web_search_20260209` and later run the search from
 * inside code execution (dynamic filtering), which adds code-execution blocks to
 * the response and is not ZDR-eligible — neither is wanted here.
 */
const WEB_SEARCH_TOOL_TYPE = 'web_search_20250305';

/** Header that enables Anthropic's server-side model fallback on a refusal. */
const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

interface AnthropicMessageResponse {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly stop_reason?: unknown;
  readonly content?: unknown;
  readonly usage?: unknown;
}

function textBlocks(content: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (block): block is Record<string, unknown> =>
      isRecord(block) && block.type === 'text' && typeof block.text === 'string',
  );
}

function textFromContent(content: unknown): string {
  return textBlocks(content)
    .map((block) => block.text as string)
    .join('\n');
}

/**
 * The URLs Claude actually cited inline. A `web_search_tool_result` block lists
 * everything the search returned, which is not the same thing and has no field
 * in the §5 contract.
 */
function citedUrls(content: unknown): readonly string[] {
  return textBlocks(content).flatMap((block) => {
    const citations = block.citations;
    if (!Array.isArray(citations)) return [];
    return citations.flatMap((citation) => {
      if (!isRecord(citation) || citation.type !== 'web_search_result_location') return [];
      const url = nonEmptyString(citation.url);
      return url === undefined ? [] : [url];
    });
  });
}

function searchRequests(usage: unknown): number | undefined {
  if (!isRecord(usage)) return undefined;
  const serverToolUse = usage.server_tool_use;
  return isRecord(serverToolUse) ? positiveCount(serverToolUse.web_search_requests) : undefined;
}

function finishReason(value: unknown): NormalizedAiResponse['finishReason'] {
  if (value === 'max_tokens') return 'length';
  // The API pauses a long search turn rather than failing it. The text received
  // so far is real; a continuation loop is out of scope, so the answer is
  // reported as cut short instead of as a safety stop.
  if (value === 'pause_turn') return 'length';
  if (value === 'end_turn' || value === 'stop_sequence' || value === undefined) return 'stop';
  return 'safety';
}

export class AnthropicProvider implements AiProvider {
  readonly config: AiProviderConfig;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutOverrideMs: number | undefined;

  constructor(options: AnthropicProviderOptions) {
    if (options.apiKey.trim() === '') throw new Error('Anthropic API key is empty');
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? ((): Date => new Date());
    this.timeoutOverrideMs = options.timeoutMs;
    this.config = {
      provider: 'anthropic',
      apiVersion: options.apiVersion ?? '2023-06-01',
      modelId: options.modelId ?? 'claude-sonnet-5',
      // UX evidence requests are materially larger than the short GEO prompts.
      // Keep the request bounded, but allow enough time for a normal model turn.
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
      max_tokens: caps.maxOutputTokens,
      system: request.systemInstructions,
      messages: [{ role: 'user', content: promptText }],
      ...(request.reasoningMode === undefined ? {} : { thinking: { type: request.reasoningMode } }),
      ...(request.webSearch === true
        ? {
            tools: [
              {
                type: WEB_SEARCH_TOOL_TYPE,
                name: 'web_search',
                max_uses: caps.maxSearchUnits,
              },
            ],
          }
        : {}),
      ...(request.allowModelFallback === true ? { fallbacks: 'default' } : {}),
      ...(request.responseSchema === undefined
        ? {}
        : {
            output_config: {
              format: { type: 'json_schema', schema: request.responseSchema },
            },
          }),
    });
  }

  async send(
    request: AiRequest,
    promptText: string,
    signal?: AbortSignal,
  ): Promise<NormalizedAiResponse> {
    if (request.provider !== 'anthropic') {
      throw new Error(`ai: anthropic adapter received ${request.provider} request`);
    }
    const caps = capsFor(request);
    throwIfCancelled(signal);
    let response: Response;
    try {
      response = await this.fetcher('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': this.config.apiVersion,
          ...(request.allowModelFallback === true
            ? { 'anthropic-beta': SERVER_SIDE_FALLBACK_BETA }
            : {}),
        },
        body: this.body(request, promptText, caps),
        signal: requestSignal(this.timeoutFor(request), signal),
      });
    } catch (error) {
      // A caller's cancel and this adapter's deadline both arrive as an abort;
      // only the deadline is an unavailable provider the module may retry.
      throwIfCancelled(signal);
      // fetch rejects for deadlines and transport failures. Both are an
      // unavailable external provider, not a platform bug that should fail and
      // refund the whole scan.
      throw new UnavailableError(transportFailureReason('Anthropic', error), { cause: error });
    }
    const payload = (await readJsonBody(response, signal)) as AnthropicMessageResponse | null;
    if (!response.ok) {
      throw httpFailure('Anthropic', response.status);
    }
    const rawText = textFromContent(payload?.content);
    // A search that errored (`max_uses_exceeded`, `too_many_requests`, …) arrives
    // as an error object inside a 200 and is not fatal: the answer Claude still
    // wrote is what the report shows. Only "no text at all" is unavailable.
    if (payload === null || rawText === '') {
      throw new UnavailableError('Anthropic returned no text content');
    }
    const usage = isRecord(payload.usage) ? payload.usage : undefined;
    // Usage is provider truth, in both directions. The old input clamp hid
    // exactly the spend that web search creates (search results are billed as
    // input tokens), and clamping output hid a provider that overran the cap.
    const output = capOutputText(rawText, caps);
    const inputCount = reportedOrEstimated(usage?.input_tokens, estimateTokens(promptText));
    const outputCount = reportedOrEstimated(usage?.output_tokens, estimateTokens(output.text));
    const usageSource = usageSourceOf([inputCount, outputCount]);
    const searchUnits = searchRequests(usage);
    const citations = boundedCitations(citedUrls(payload.content), caps);
    const providerRequestId = nonEmptyString(payload.id);
    return {
      provider: 'anthropic',
      apiVersion: this.config.apiVersion,
      // The served model, not the requested one: with server-side fallback the
      // two differ, and the ledger must record what actually answered.
      modelId: nonEmptyString(payload.model) ?? this.config.modelId,
      requestId: providerRequestId ?? `local-${this.now().getTime()}`,
      requestIdSource: providerRequestId === undefined ? 'local' : 'provider',
      createdAt: this.now().toISOString(),
      rawText: output.text,
      citations,
      usage: {
        inputTokens: inputCount.value,
        outputTokens: outputCount.value,
        totalTokens: inputCount.value + outputCount.value,
        ...(searchUnits === undefined ? {} : { searchUnits }),
        ...(citations.length === 0 ? {} : { citationUnits: citations.length }),
      },
      usageSource,
      ...(usageSource === 'estimated' ? { tokenizerVersion: TOKENIZER_VERSION } : {}),
      finishReason: output.truncated ? 'length' : finishReason(payload.stop_reason),
    };
  }
}
