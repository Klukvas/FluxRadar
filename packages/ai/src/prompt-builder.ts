// Сборка prompt и приближённый tokenizer 'approx-v2' (T-10, план §5).
// Порядок секций = порядок приоритета при truncation: system instructions →
// вопрос → факты бренда → заголовки страниц; хвост режется по границе токена
// с явным маркером [TRUNCATED]. Всё детерминировано.

import { AI_REQUEST_CAPS } from '@fluxradar/contracts';
import type { AiRequestCapsShape } from '@fluxradar/contracts';

import type { AiRequest } from './types.js';

/** The caps this request runs under: its own overrides over the §5 module caps. */
export function capsFor(request: Pick<AiRequest, 'caps'>): AiRequestCapsShape {
  return { ...AI_REQUEST_CAPS, ...request.caps };
}

export const TOKENIZER_VERSION = 'approx-v2';
export const TRUNCATION_MARKER = '[TRUNCATED]';

/**
 * approx-v2: консервативно считаем один токен на два символа. Sonnet 5
 * использует более плотный tokenizer, а prompt содержит смешанный Unicode.
 */
// Экспортируется для mock-провайдера: output cap режется по той же границе,
// что и input truncation.
export const CHARS_PER_TOKEN = 2;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface BuiltPrompt {
  readonly promptText: string;
  readonly inputTokens: number;
  readonly truncated: boolean;
  readonly tokenizerVersion: string;
}

export interface CappedText {
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * Усекает текст до input cap 8000 tokens по границе токена approx-v1 с маркером
 * [TRUNCATED] (маркер и его перевод строки входят в бюджет; итог никогда не
 * превышает cap). Используется дважды: при сборке prompt-а и повторно после
 * redaction — маркеры `[REDACTED:<type>]` длиннее заменённых значений и могут
 * вытолкнуть уже усечённый prompt за cap (D-177).
 */
export function enforceInputCap(
  text: string,
  caps: Partial<AiRequestCapsShape> = {},
): CappedText {
  const charBudget = (caps.maxInputTokens ?? AI_REQUEST_CAPS.maxInputTokens) * CHARS_PER_TOKEN;
  if (text.length <= charBudget) return { text, truncated: false };

  const markerChars = TRUNCATION_MARKER.length + 1;
  const keepChars = Math.floor((charBudget - markerChars) / CHARS_PER_TOKEN) * CHARS_PER_TOKEN;
  return { text: `${text.slice(0, keepChars)}\n${TRUNCATION_MARKER}`, truncated: true };
}

function listSection(header: string, items: readonly string[]): readonly string[] {
  if (items.length === 0) return [];
  const bullets = items.map((item) => `- ${item}`).join('\n');
  return [`[${header}]\n${bullets}`];
}

/**
 * Собирает prompt из секций в §5-приоритете и применяет input cap 8000 tokens.
 * Конкатенация в приоритетном порядке гарантирует: при превышении лимита
 * первыми выживают system и вопрос, последними режутся заголовки страниц.
 */
export function buildPrompt(request: AiRequest): BuiltPrompt {
  const sections = [
    `[system]\n${request.systemInstructions}`,
    `[question]\n${request.question}`,
    ...listSection('brand-facts', request.brandFacts),
    ...listSection('page-titles', request.pageTitles),
  ];
  const capped = enforceInputCap(sections.join('\n\n'), capsFor(request));
  return {
    promptText: capped.text,
    inputTokens: estimateTokens(capped.text),
    truncated: capped.truncated,
    tokenizerVersion: TOKENIZER_VERSION,
  };
}
