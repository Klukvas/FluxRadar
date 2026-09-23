// MockAiProvider (T-10, D-008/D-172): единственный адаптер v0.1. Фикстуры —
// OpenAI-shaped тела ответов (Responses API: id/created_at/model/status/
// incomplete_details/output_text/usage); мок нормализует их в контракт §5 так же,
// как это делал бы реальный адаптер. Содержимое ответа полностью детерминировано:
// никаких Date.now/Math.random — createdAt берётся из фикстуры или из
// инъектируемых часов с фиксированным дефолтом.

import { createHash } from 'node:crypto';

import type { AiFinishReason, AiRequestCapsShape } from '@fluxradar/contracts';

import { AiModuleError, UnavailableError } from './errors.js';
import { GEMINI_DEFAULT_MODEL } from './gemini-provider.js';
import { OPENAI_DEFAULT_MODEL } from './openai-provider.js';
import { capsFor, CHARS_PER_TOKEN, estimateTokens, TOKENIZER_VERSION } from './prompt-builder.js';
import { throwIfCancelled } from './provider-support.js';
import { RoutingAiProvider } from './routing-provider.js';
import type { AiProvider, AiProviderConfig, AiProviderName, AiRequest } from './types.js';
import type { NormalizedAiResponse } from './types.js';

/** Registry v1 production defaults для OpenAI (план §5 / AI-001). */
export const MOCK_PROVIDER_CONFIG: AiProviderConfig = {
  provider: 'openai',
  apiVersion: 'v1',
  modelId: 'gpt-5-mini',
  timeoutMs: 10_000,
  maxRetries: 1,
};

/** Фиксированный момент «создания» ответа, когда фикстура не задаёт created_at. */
export const MOCK_FIXED_TIME_ISO = '2026-01-01T00:00:00.000Z';

export interface OpenAiShapedUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens?: number;
}

/** Упрощённое OpenAI Responses-shaped тело ответа фикстуры (D-172). */
export interface OpenAiShapedResponse {
  readonly id?: string;
  /** Unix seconds — как в OpenAI API. */
  readonly created_at?: number;
  readonly model?: string;
  readonly status: 'completed' | 'incomplete';
  readonly incomplete_details?: { readonly reason: string };
  readonly output_text: string;
  /** URL-ы источников; у реального OpenAI живут в annotations, мок упрощает. */
  readonly citations?: readonly string[];
  /** Число `web_search_call`-элементов — становится usage.searchUnits. */
  readonly web_search_calls?: number;
  readonly usage?: OpenAiShapedUsage;
}

export interface MockAiFixture {
  /** Критерий выбора: подстрока вопроса; выигрывает первая совпавшая фикстура. */
  readonly questionIncludes: string;
  readonly response?: OpenAiShapedResponse;
  /** Причина недоступности: send бросит UnavailableError (ветка GEO-METHOD-005). */
  readonly unavailable?: string;
}

export interface MockAiProviderOptions {
  /** Часы для createdAt, когда фикстура без created_at; дефолт — фиксированный. */
  readonly now?: () => Date;
  readonly config?: AiProviderConfig;
}

/** Детерминированный локальный request ID (requestIdSource='local', §5/D-173). */
function localRequestId(promptText: string, sequence: number): string {
  const hex = createHash('sha256').update(`${sequence}:${promptText}`, 'utf8').digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

interface CappedOutput {
  readonly text: string;
  readonly finishReason: AiFinishReason;
  readonly truncated: boolean;
}

/** Output cap §5: усечение по границе токена, finish_reason='length'. */
function applyOutputCap(body: OpenAiShapedResponse, caps: AiRequestCapsShape): CappedOutput {
  const capChars = caps.maxOutputTokens * CHARS_PER_TOKEN;
  if (body.output_text.length > capChars) {
    return { text: body.output_text.slice(0, capChars), finishReason: 'length', truncated: true };
  }
  const providerHitCap =
    body.status === 'incomplete' && body.incomplete_details?.reason === 'max_output_tokens';
  return {
    text: body.output_text,
    finishReason: providerHitCap ? 'length' : 'stop',
    truncated: false,
  };
}

export class MockAiProvider implements AiProvider {
  readonly config: AiProviderConfig;
  private readonly fixtures: readonly MockAiFixture[];
  private readonly now: () => Date;

  constructor(fixtures: readonly MockAiFixture[], options: MockAiProviderOptions = {}) {
    this.fixtures = fixtures;
    this.config = options.config ?? MOCK_PROVIDER_CONFIG;
    this.now = options.now ?? ((): Date => new Date(MOCK_FIXED_TIME_ISO));
  }

  // async, чтобы ошибки выбора фикстуры приходили rejection-ом, как у реального адаптера.
  async send(
    request: AiRequest,
    promptText: string,
    signal?: AbortSignal,
  ): Promise<NormalizedAiResponse> {
    // Как у реального адаптера: отменённый прогон не «отвечает» из фикстуры.
    throwIfCancelled(signal);
    if (request.provider !== this.config.provider) {
      // Роутинг запроса не тому адаптеру — баг вызывающего кода, не Unavailable.
      throw new AiModuleError(
        `ai: mock adapter is "${this.config.provider}", request targets "${request.provider}"`,
      );
    }

    const fixture = this.fixtures.find((candidate) =>
      request.question.includes(candidate.questionIncludes),
    );
    if (fixture === undefined) {
      // Несматченный вопрос — «недоступный отдельный запрос» из GEO-METHOD-005.
      throw new UnavailableError(`no mock fixture matches question (sequence ${request.sequence})`);
    }
    if (fixture.unavailable !== undefined || fixture.response === undefined) {
      throw new UnavailableError(fixture.unavailable ?? 'fixture has no response body');
    }

    // `webSearch` is deliberately ignored: the mock has no transport, and the
    // search facts a test wants come from the fixture's `web_search_calls`.
    return this.normalize(fixture.response, promptText, request);
  }

  private normalize(
    body: OpenAiShapedResponse,
    promptText: string,
    request: AiRequest,
  ): NormalizedAiResponse {
    const caps = capsFor(request);
    const output = applyOutputCap(body, caps);
    const hasProviderUsage = body.usage !== undefined;
    const inputTokens = body.usage?.input_tokens ?? estimateTokens(promptText);
    // Усечённый нами output фактически равен cap-у независимо от заявки провайдера.
    const reportedOutput = body.usage?.output_tokens ?? estimateTokens(output.text);
    const outputTokens = output.truncated
      ? caps.maxOutputTokens
      : Math.min(reportedOutput, caps.maxOutputTokens);
    const createdAt =
      body.created_at !== undefined
        ? new Date(body.created_at * 1000).toISOString()
        : this.now().toISOString();
    const citations = (body.citations ?? []).slice(0, caps.maxCitationUnits);

    return {
      provider: this.config.provider,
      apiVersion: this.config.apiVersion,
      modelId: body.model ?? this.config.modelId,
      requestId: body.id ?? localRequestId(promptText, request.sequence),
      requestIdSource: body.id !== undefined ? 'provider' : 'local',
      createdAt,
      rawText: output.text,
      citations,
      usage: {
        inputTokens,
        outputTokens,
        // §5 дословно: total_tokens всегда равен input + output.
        totalTokens: inputTokens + outputTokens,
        ...(body.web_search_calls === undefined ? {} : { searchUnits: body.web_search_calls }),
        ...(citations.length === 0 ? {} : { citationUnits: citations.length }),
      },
      usageSource: hasProviderUsage ? 'provider' : 'estimated',
      ...(hasProviderUsage ? {} : { tokenizerVersion: TOKENIZER_VERSION }),
      finishReason: output.finishReason,
    };
  }
}

/** Registry defaults a mock adapter reports per provider name. */
const MOCK_MODEL_IDS: Readonly<Record<AiProviderName, string>> = {
  anthropic: 'claude-sonnet-5',
  openai: OPENAI_DEFAULT_MODEL,
  google: GEMINI_DEFAULT_MODEL,
  perplexity: 'sonar',
};

const MOCK_API_VERSIONS: Readonly<Record<AiProviderName, string>> = {
  anthropic: '2023-06-01',
  openai: 'v1',
  google: 'v1beta',
  perplexity: 'v1',
};

export interface MockRoutingProviderOptions {
  readonly now?: () => Date;
  /** Per-provider model override; the registry default applies otherwise. */
  readonly modelIds?: Partial<Record<AiProviderName, string>>;
}

/**
 * One mock adapter per provider name, all answering from the same fixtures.
 *
 * It lives here rather than in `testing/` because `apps/api` reaches this
 * package only through `src/index.ts`, and the API's own provider factory needs
 * it to keep tests away from every real transport.
 */
export function mockRoutingProvider(
  fixtures: readonly MockAiFixture[],
  providers: readonly AiProviderName[],
  options: MockRoutingProviderOptions = {},
): RoutingAiProvider {
  return new RoutingAiProvider(
    providers.map(
      (provider) =>
        new MockAiProvider(fixtures, {
          ...(options.now === undefined ? {} : { now: options.now }),
          config: {
            provider,
            apiVersion: MOCK_API_VERSIONS[provider],
            modelId: options.modelIds?.[provider] ?? MOCK_MODEL_IDS[provider],
            timeoutMs: 10_000,
            maxRetries: 1,
          },
        }),
    ),
  );
}

/**
 * Готовый набор фикстур для GEO-тестов: первая — бренд и ссылка присутствуют
 * (provider usage + provider request id), вторая — ни бренда, ни ссылки
 * (estimated usage + local request id). Обе ветки GEO-VIS-003/004 покрыты.
 */
export function geoVisibilityFixtures(brand: string, domain: string): readonly MockAiFixture[] {
  return [
    {
      questionIncludes: 'best',
      response: {
        id: 'resp_mock_0001',
        created_at: 1_767_225_600,
        model: 'gpt-5-mini',
        status: 'completed',
        output_text:
          `${brand} is a solid option for small teams: transparent pricing, ` +
          `deterministic scans and exportable reports. See https://${domain}/pricing ` +
          `for the current tiers.`,
        citations: [`https://${domain}/pricing`],
        usage: { input_tokens: 120, output_tokens: 46, total_tokens: 166 },
      },
    },
    {
      questionIncludes: 'alternatives',
      response: {
        status: 'completed',
        output_text:
          'Popular website audit vendors include Acme Audit, Globex Scanner and ' +
          'Initech SiteCheck. Each offers crawling, SEO checks and scheduled reports.',
      },
    },
  ];
}
