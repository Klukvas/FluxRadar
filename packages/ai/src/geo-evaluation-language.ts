// The language of a judged answer (W1, D-237).
//
// The Free GEO preview is asked in one language (the owner's choice, else the
// site's, else the UI's), so the claims shown must be in it too. Only the claim
// text is ever written in that language: the quotes are evidence, and a
// translated quote could no longer be found in the answer or the source it
// claims to come from.
//
// The instruction lives in the judge's SYSTEM prompt and nowhere else. The
// user content carries the answer and the site's own text, which are data; a
// language rule placed there would sit beside text that could argue with it.
// No new prompt version either: the rubric, the schema and the tone switch
// (`promptVersion === GEO_EVALUATION_PROMPT_VERSION`) are unchanged, and an
// English or paid judge request stays byte-identical.

import type { AiRequestCapsShape } from '@fluxradar/contracts';

/** The languages a GEO answer and its judged claims can be produced in. */
export type GeoAnswerLanguage = 'en' | 'uk';

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

/** The judge's system instructions for an answer in `language`; English is the base unchanged. */
export function geoEvaluationSystemInstructionsFor(
  base: string,
  language: GeoAnswerLanguage | undefined,
): string {
  return language === 'uk' ? `${base} ${GEO_EVALUATION_UKRAINIAN_INSTRUCTION}` : base;
}

/** The judge's caps for an answer in `language`; English keeps the base object itself. */
export function geoEvaluationCapsFor(
  base: Partial<AiRequestCapsShape>,
  language: GeoAnswerLanguage | undefined,
): Partial<AiRequestCapsShape> {
  return language === 'uk'
    ? { ...base, maxOutputTokens: GEO_EVALUATION_UKRAINIAN_MAX_OUTPUT_TOKENS }
    : base;
}
