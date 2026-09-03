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
  /** Обязателен, когда usage оценивается локально; мок сообщает 'approx-v1'. */
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
  readonly question: string;
  readonly brandFacts: readonly string[];
  readonly pageTitles: readonly string[];
  readonly systemInstructions: string;
}

/**
 * Adapter-интерфейс. Реальный адаптер обязан отправлять провайдеру только
 * promptText (уже прошедший redaction) — request используется как метаданные.
 */
export interface AiProvider {
  readonly config: AiProviderConfig;
  send(request: AiRequest, promptText: string): Promise<NormalizedAiResponse>;
}
