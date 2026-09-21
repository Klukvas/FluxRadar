// Версионированный adapter-контракт AI-провайдеров (T-10, план §5, D-008).
// В v0.1 существует только MockAiProvider; реальные HTTP-адаптеры появляются
// отдельной версией registry после AI-001 sign-off.

import type { AiFinishReason, RequestIdSource, UsageSource } from '@fluxradar/contracts';

export const AI_PROVIDER_NAMES = ['anthropic', 'openai', 'google', 'perplexity'] as const;
export type AiProviderName = (typeof AI_PROVIDER_NAMES)[number];

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

/** Token caps одного запроса (§5); по умолчанию — общие AI_REQUEST_CAPS. */
export interface AiRequestCaps {
  readonly maxInputTokens: number;
  /** Уходит провайдеру как max_tokens: у думающей модели thinking и ответ делят этот бюджет. */
  readonly maxOutputTokens: number;
}

/** Мета-данные одного AI-запроса; текст запроса собирает prompt-builder. */
export interface AiRequest {
  readonly scanId: string;
  readonly provider: AiProviderName;
  readonly promptVersion: string;
  /** 1-based порядковый номер вопроса внутри прогона (входит в ai_request_key, D-015). */
  readonly sequence: number;
  readonly question: string;
  readonly brandFacts: readonly string[];
  readonly pageTitles: readonly string[];
  readonly systemInstructions: string;
  /** Disable provider-side reasoning for deterministic extraction/classification requests. */
  readonly reasoningMode?: 'disabled';
  /** Optional JSON Schema used by providers that support constrained structured output. */
  readonly responseSchema?: Readonly<Record<string, unknown>>;
  /**
   * Caps for this request instead of the shared AI_REQUEST_CAPS, for a request
   * whose input or answer does not fit them. Honoured wherever a cap is enforced.
   */
  readonly caps?: AiRequestCaps;
  /**
   * Ask Anthropic to re-run a declined request on the fallback model it
   * recommends for the refusal's category, instead of returning the refusal.
   * Providers without server-side fallback ignore it.
   */
  readonly refusalFallback?: 'default';
}

/**
 * Adapter-интерфейс. Реальный адаптер обязан отправлять провайдеру только
 * promptText (уже прошедший redaction) — request используется как метаданные.
 */
export interface AiProvider {
  readonly config: AiProviderConfig;
  send(request: AiRequest, promptText: string): Promise<NormalizedAiResponse>;
}
