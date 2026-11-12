// GEO claim text follows the saved question/answer language. Evidence quotes
// remain verbatim; an absent selection preserves historical English prompts.

import type { AiRequestCapsShape } from '@fluxradar/contracts';

/** The languages a GEO answer and its judged claims can be produced in. */
export type GeoAnswerLanguage = 'en' | 'uk' | 'ru';

export const GEO_EVALUATION_UKRAINIAN_INSTRUCTION =
  'Write each `claim` in Ukrainian. `answerQuote`, `sourceQuote` and the tone `quote` are copied ' +
  'verbatim from the answer and the evidence in their original language — never translated, ' +
  'never paraphrased.';

/**
 * Output budget of a Ukrainian judge.
 *
 * Cyrillic tokenizes at roughly 2–3 characters per token against ~4 for
 * English, and every claim carries Ukrainian claim text plus Ukrainian quotes.
 * Eight claims with tone at the English 2,000 tokens can finish `length`, which
 * voids the whole evaluation; twice the budget leaves headroom for the same
 * eight claims rather than cutting how many a reader is shown.
 */
export const GEO_EVALUATION_UKRAINIAN_MAX_OUTPUT_TOKENS = 4_000;

/** Only an absent selection preserves the legacy system prompt. */
export function geoEvaluationSystemInstructionsFor(
  base: string,
  language: GeoAnswerLanguage | undefined,
): string {
  if (language === 'uk') return `${base} ${GEO_EVALUATION_UKRAINIAN_INSTRUCTION}`;
  if (language === undefined) return base;
  const name = language === 'ru' ? 'Russian' : 'English';
  return (
    `${base} Write each ` +
    '`claim`' +
    ` in ${name}. ` +
    '`answerQuote`, `sourceQuote` and the tone `quote` are copied verbatim from the answer and the evidence in their original language — never translated, never paraphrased.'
  );
}

/** The judge's caps for an answer in `language`; English keeps the base object itself. */
export function geoEvaluationCapsFor(
  base: Partial<AiRequestCapsShape>,
  language: GeoAnswerLanguage | undefined,
): Partial<AiRequestCapsShape> {
  return language === 'uk' || language === 'ru'
    ? { ...base, maxOutputTokens: GEO_EVALUATION_UKRAINIAN_MAX_OUTPUT_TOKENS }
    : base;
}
