// Версионированный adapter-контракт AI-провайдеров (T-10, план §5, D-008).
// В v0.1 существует только MockAiProvider; реальные HTTP-адаптеры появляются
// отдельной версией registry после AI-001 sign-off.

import type {
  AiFinishReason,
  AiRequestCapsShape,
  RequestIdSource,
  UsageSource,
} from '@fluxradar/contracts';

export const AI_PROVIDER_NAMES = ['anthropic', 'openai', 'google', 'perplexity'] as const;
export type AiProviderName = (typeof AI_PROVIDER_NAMES)[number];

/**
 * The providers a paid scan asks by default. Google (Gemini) and Perplexity are
 * adapters this release ships but never selects on its own: they receive data
 * only when a scan explicitly names them AND the stored notice covers them
 * (see consent.ts).
 */
export const DEFAULT_VISIBILITY_PROVIDERS = ['anthropic', 'openai'] as const;
export const OPT_IN_VISIBILITY_PROVIDERS = ['google', 'perplexity'] as const;

export function isOptInProvider(provider: AiProviderName): boolean {
  return (OPT_IN_VISIBILITY_PROVIDERS as readonly AiProviderName[]).includes(provider);
}

export type ProviderMode = 'mock' | 'real';

export interface AiProviderConfig {
  readonly provider: AiProviderName;
  readonly apiVersion: string;
  readonly modelId: string;
  readonly timeoutMs: number;
  /** §18: module_retry_count <= 1 — ровно один retry, и тот с прежним ai_request_key. */
  readonly maxRetries: 1;
}

export interface NormalizedAiUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Инвариант §5: всегда inputTokens + outputTokens (проверяется GEO-PROVIDER-001). */
  readonly totalTokens: number;
  readonly reasoningUnits?: number;
  readonly searchUnits?: number;
  readonly citationUnits?: number;
}

/** Нормализованный ответ провайдера — единый контракт §5 для всех адаптеров. */
export interface NormalizedAiResponse {
  readonly provider: AiProviderName;
  readonly apiVersion: string;
  readonly modelId: string;
  readonly requestId: string;
  /** 'local' — провайдер не вернул request ID и сохранён локальный UUID (§5). */
  readonly requestIdSource: RequestIdSource;
  /** ISO-8601 UTC момент создания ответа. */
  readonly createdAt: string;
  readonly rawText: string;
  readonly citations: readonly string[];
  readonly usage: NormalizedAiUsage;
  /** 'estimated' — usage посчитан pinned tokenizer-ом, а не провайдером (§5). */
  readonly usageSource: UsageSource;
  /** Обязателен, когда usage оценивается локально; мок сообщает pinned approximation. */
  readonly tokenizerVersion?: string;
  readonly finishReason: AiFinishReason;
}

/** Мета-данные одного AI-запроса; текст запроса собирает prompt-builder. */
export interface AiRequest {
  readonly scanId: string;
  readonly provider: AiProviderName;
  readonly promptVersion: string;
  /** 1-based порядковый номер вопроса внутри прогона (входит в ai_request_key, D-015). */
  readonly sequence: number;
  /**
   * What this request is about, when provider, sequence and prompt text do not
   * say it on their own. Folded into `ai_request_key` and never sent to the
   * provider (see `aiRequestKey`); absent for every request whose prompt is
   * already its own identity.
   */
  readonly keyIdentity?: string;
  readonly question: string;
  readonly brandFacts: readonly string[];
  readonly pageTitles: readonly string[];
  readonly systemInstructions: string;
  /** Disable provider-side reasoning for deterministic extraction/classification requests. */
  readonly reasoningMode?: 'disabled';
  /** Optional JSON Schema used by providers that support constrained structured output. */
  readonly responseSchema?: Readonly<Record<string, unknown>>;
  /**
   * Provider web search. Only the GEO visibility questions set it: generation
   * and the UX review must stay recall-only, so they never carry tools.
   */
  readonly webSearch?: true;
  /**
   * Per-request caps. Absent means the §5 module caps (`AI_REQUEST_CAPS`); the
   * Action Plan overrides them because adaptive thinking does not fit in 2,000
   * output tokens (D-232). A request names only the caps it means to move, and
   * every other one stays the shared §5 value.
   */
  readonly caps?: Partial<AiRequestCapsShape>;
  /**
   * Ask the provider to serve a fallback model rather than refuse. Anthropic
   * calls this server-side fallback; adapters that have no equivalent ignore it.
   */
  readonly allowModelFallback?: true;
}

/**
 * Adapter-интерфейс. Реальный адаптер обязан отправлять провайдеру только
 * promptText (уже прошедший redaction) — request используется как метаданные.
 *
 * `signal` is the caller's cancellation — a cancelled scan, a closed request,
 * a shutting-down worker. An adapter that receives an already-aborted signal
 * must not call the provider at all, and a cancel that arrives mid-flight is
 * rethrown rather than reported as an unavailable provider: the difference
 * decides whether the module retries and spends a second paid call. An adapter
 * that needs none of this (the mock) simply does not declare the parameter.
 */
export interface AiProvider {
  readonly config: AiProviderConfig;
  send(request: AiRequest, promptText: string, signal?: AbortSignal): Promise<NormalizedAiResponse>;
}
