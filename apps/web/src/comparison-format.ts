// How a score movement is written, for the two surfaces that write one.
//
// Shared rather than copied because the direction is the claim: the panel and the
// printed block must never disagree about whether 70 → 74.5 went up, or about how
// many decimals a customer is being shown.

import { copy, fillCopy, type Language } from './i18n';

export type ComparisonCopy = (typeof copy)[Language]['report']['comparison'];

/** A score, or the words for "there is none" — never a bare zero. */
export function scoreText(value: number | null, t: ComparisonCopy): string {
  return value === null ? t.scoreNone : value.toFixed(2);
}

/**
 * The direction in words; colour is never the only carrier of it.
 *
 * Null means there is no direction to state — the two scores are not comparable —
 * and the caller then shows the reason instead.
 */
export function movement(delta: number | null, t: ComparisonCopy): string | null {
  if (delta === null) return null;
  if (delta === 0) return t.scoreSame;
  const amount = Math.abs(delta).toFixed(2);
  return delta > 0
    ? fillCopy(t.scoreUp, { delta: amount })
    : fillCopy(t.scoreDown, { delta: amount });
}
