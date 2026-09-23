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
import type { AiRequestCapsShape } from '@fluxradar/contracts';

import { AI_PROVIDER_NAMES } from './types.js';
import type { NormalizedAiResponse } from './types.js';

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
 * заведомо битые объекты, и валидатор обязан их отклонить.
 */
export function validateNormalizedResponse(
  response: NormalizedAiResponse,
  caps: AiRequestCapsShape = AI_REQUEST_CAPS,
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
  } else if (response.citations.length > caps.maxCitationUnits) {
    violations.push(`citations ${response.citations.length} exceeds cap ${caps.maxCitationUnits}`);
  }
  if (!isMemberOf(AI_FINISH_REASONS, response.finishReason)) {
    violations.push(`finishReason "${String(response.finishReason)}" is invalid`);
  }

  violations.push(...validateUsage(response, caps));
  return violations;
}

function validateUsage(
  response: NormalizedAiResponse,
  caps: AiRequestCapsShape,
): readonly string[] {
  const violations: string[] = [];
  const usage: unknown = response.usage;
  if (usage === null || typeof usage !== 'object') {
    return ['usage is missing'];
  }

  const { inputTokens, outputTokens, totalTokens, searchUnits } = response.usage;
  if (!isCountValue(inputTokens))
    violations.push('usage.inputTokens is not a non-negative integer');
  if (!isCountValue(outputTokens)) {
    violations.push('usage.outputTokens is not a non-negative integer');
  }
  if (!isCountValue(totalTokens))
    violations.push('usage.totalTokens is not a non-negative integer');

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

  if (searchUnits !== undefined && !isCountValue(searchUnits)) {
    violations.push('usage.searchUnits is not a non-negative integer');
  } else if (isCountValue(searchUnits) && searchUnits > caps.maxSearchUnits) {
    // Two providers (Google, Perplexity) document no request parameter that
    // caps the search count, so the cap can only be enforced on what came back.
    // Over the cap the answer is refused rather than accepted and re-labelled.
    violations.push(`usage.searchUnits ${searchUnits} exceeds cap ${caps.maxSearchUnits}`);
  }

  // Provider web search bills its result pages as input tokens, so a
  // search-enabled answer may legitimately report far more input than the
  // prompt contained. The allowance is what lets the adapters report provider
  // truth instead of clamping the number and under-reporting spend.
  const searchAllowance =
    (isCountValue(searchUnits) ? searchUnits : 0) * caps.maxSearchContentTokens;
  const inputAllowance = caps.maxInputTokens + searchAllowance;
  if (isCountValue(inputTokens) && inputTokens > inputAllowance) {
    violations.push(`usage.inputTokens ${inputTokens} exceeds cap ${inputAllowance}`);
  }
  if (isCountValue(outputTokens) && outputTokens > caps.maxOutputTokens) {
    violations.push(`usage.outputTokens ${outputTokens} exceeds cap ${caps.maxOutputTokens}`);
  }

  if (!isMemberOf(USAGE_SOURCES, response.usageSource)) {
    violations.push(`usageSource "${String(response.usageSource)}" is invalid`);
  }
  // §5: локальная оценка usage обязана сообщать версию pinned tokenizer-а.
  if (response.usageSource === 'estimated' && !isNonEmptyString(response.tokenizerVersion)) {
    violations.push('usageSource=estimated requires a non-empty tokenizerVersion');
  }
  return violations;
}
