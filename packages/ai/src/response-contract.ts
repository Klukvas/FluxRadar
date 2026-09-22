// Валидатор нормализованного ответа провайдера (план §5, оракул GEO-PROVIDER-001).
// Это платформенный инвариант: ai_response record создаётся только для ответа,
// прошедшего этот контракт; ответ с нарушениями трактуется как Unavailable
// адаптера, а не как fail-open данные (D-175).

import {
  AI_FINISH_REASONS,
  AI_REQUEST_CAPS,
  REQUEST_ID_SOURCES,
  USAGE_SOURCES,
} from '@fluxradar/contracts';

import { DEFAULT_AI_REQUEST_CAPS } from './caps.js';
import { AI_PROVIDER_NAMES } from './types.js';
import type { AiRequestCaps, NormalizedAiResponse } from './types.js';

// createdAt обязан быть ISO-8601 UTC с суффиксом Z (§5: момент в UTC).
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCountValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isMemberOf(values: readonly string[], value: unknown): boolean {
  return typeof value === 'string' && values.includes(value);
}

/**
 * Возвращает список нарушений контракта §5 (пустой — ответ валиден).
 * Проверяются runtime-значения, а не только типы: negative-ветки строят
 * заведомо битые объекты, и валидатор обязан их отклонить. Usage сверяется с
 * caps запроса (по умолчанию общие AI_REQUEST_CAPS).
 */
export function validateNormalizedResponse(
  response: NormalizedAiResponse,
  caps: AiRequestCaps = DEFAULT_AI_REQUEST_CAPS,
): readonly string[] {
  const violations: string[] = [];

  if (!isMemberOf(AI_PROVIDER_NAMES, response.provider)) {
    violations.push(`provider "${String(response.provider)}" is not a registered adapter`);
  }
  if (!isNonEmptyString(response.apiVersion)) violations.push('apiVersion is empty');
  if (!isNonEmptyString(response.modelId)) violations.push('modelId is empty');
  if (!isNonEmptyString(response.requestId)) violations.push('requestId is empty');
  if (!isMemberOf(REQUEST_ID_SOURCES, response.requestIdSource)) {
    violations.push(`requestIdSource "${String(response.requestIdSource)}" is invalid`);
  }
  if (!isNonEmptyString(response.createdAt) || !ISO_UTC_PATTERN.test(response.createdAt)) {
    violations.push('createdAt is not an ISO-8601 UTC timestamp with Z suffix');
  }
  if (typeof response.rawText !== 'string') violations.push('rawText is not a string');
  if (
    !Array.isArray(response.citations) ||
    response.citations.some((citation) => !isNonEmptyString(citation))
  ) {
    violations.push('citations is not an array of non-empty strings');
  }
  if (!isMemberOf(AI_FINISH_REASONS, response.finishReason)) {
    violations.push(`finishReason "${String(response.finishReason)}" is invalid`);
  }

  violations.push(...validateUsage(response, caps));
  return violations;
}

/**
 * Optional per-unit counters of §5. A count above its cap means the adapter
 * ignored the bound we sent the provider, which is a contract violation and not
 * data to record.
 */
function validateUnitCounts(response: NormalizedAiResponse): readonly string[] {
  const violations: string[] = [];
  const { searchUnits, citationUnits, reasoningUnits } = response.usage;
  const bounded = [
    ['searchUnits', searchUnits, AI_REQUEST_CAPS.maxSearchUnits],
    ['citationUnits', citationUnits, AI_REQUEST_CAPS.maxCitationUnits],
    ['reasoningUnits', reasoningUnits, AI_REQUEST_CAPS.maxReasoningUnits],
  ] as const;
  for (const [name, value, cap] of bounded) {
    if (value === undefined) continue;
    if (!isCountValue(value)) {
      violations.push(`usage.${name} is not a non-negative integer`);
      continue;
    }
    if (value > cap) violations.push(`usage.${name} ${value} exceeds cap ${cap}`);
  }
  const citationCount = Array.isArray(response.citations) ? response.citations.length : 0;
  if (citationCount > AI_REQUEST_CAPS.maxCitationUnits) {
    violations.push(`citations ${citationCount} exceeds cap ${AI_REQUEST_CAPS.maxCitationUnits}`);
  }
  return violations;
}

function validateUsage(response: NormalizedAiResponse, caps: AiRequestCaps): readonly string[] {
  const violations: string[] = [];
  const usage: unknown = response.usage;
  if (usage === null || typeof usage !== 'object') {
    return ['usage is missing'];
  }

  const { inputTokens, outputTokens, totalTokens } = response.usage;
  if (!isCountValue(inputTokens)) violations.push('usage.inputTokens is not a non-negative integer');
  if (!isCountValue(outputTokens)) {
    violations.push('usage.outputTokens is not a non-negative integer');
  }
  if (!isCountValue(totalTokens)) violations.push('usage.totalTokens is not a non-negative integer');

  // Ядро GEO-PROVIDER-001: total всегда input + output (§5, дословно).
  if (
    isCountValue(inputTokens) &&
    isCountValue(outputTokens) &&
    totalTokens !== inputTokens + outputTokens
  ) {
    violations.push(
      `usage.totalTokens ${String(totalTokens)} != inputTokens + outputTokens ` +
        `(${inputTokens} + ${outputTokens})`,
    );
  }

  // Provider web search arrives as input tokens the prompt cap never covered.
  // Usage is provider truth — it is reported as billed, never clamped — so the
  // cap grows by the search content the searches this answer actually ran are
  // allowed to add, and a search-free answer is held to the prompt cap exactly
  // as before.
  const searchUnits = isCountValue(response.usage.searchUnits) ? response.usage.searchUnits : 0;
  const inputCap = caps.maxInputTokens + searchUnits * AI_REQUEST_CAPS.maxSearchContentTokens;
  if (isCountValue(inputTokens) && inputTokens > inputCap) {
    violations.push(`usage.inputTokens ${inputTokens} exceeds cap ${inputCap}`);
  }
  if (isCountValue(outputTokens) && outputTokens > caps.maxOutputTokens) {
    violations.push(`usage.outputTokens ${outputTokens} exceeds cap ${caps.maxOutputTokens}`);
  }
  violations.push(...validateUnitCounts(response));

  if (!isMemberOf(USAGE_SOURCES, response.usageSource)) {
    violations.push(`usageSource "${String(response.usageSource)}" is invalid`);
  }
  // §5: локальная оценка usage обязана сообщать версию pinned tokenizer-а.
  if (response.usageSource === 'estimated' && !isNonEmptyString(response.tokenizerVersion)) {
    violations.push('usageSource=estimated requires a non-empty tokenizerVersion');
  }
  return violations;
}
