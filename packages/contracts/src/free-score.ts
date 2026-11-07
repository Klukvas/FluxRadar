// How a report shows a score (D-237).
//
// Every rules module stores its score on 0–100: `round2(max(0, 100 − Σ penalty))`
// over the registry's penalties, and nothing here changes that. A Free check is
// a quick check of a few light homepage checks, so its report shows it on its
// own scale, out of 40 (owner decision); a paid report reads the whole site and
// shows its score out of 100. The conversion happens once, where the API reads a
// stored scan for a report — the stored number, its penalties and every
// decision made from it stay as they are.

import type { StoredPlan } from './stored-plan.js';

/** The scale a paid report shows its score on: "{value} / 100". */
export const FULL_SCORE_MAX = 100;

/** The scale a Free report shows its score on: "{value} / 40". */
export const FREE_SCORE_MAX = 40;

export type ScoreMax = typeof FULL_SCORE_MAX | typeof FREE_SCORE_MAX;

export interface DisplayScore {
  /** null when the stored score is null (nothing to score, legacy unscored rows). */
  readonly value: number | null;
  readonly max: typeof FREE_SCORE_MAX;
}

/** The denominator a stored scan's report prints its score over: 40 for Free, else 100. */
export function scoreMaxFor(plan: StoredPlan): ScoreMax {
  return plan === 'Free' ? FREE_SCORE_MAX : FULL_SCORE_MAX;
}

/**
 * A stored 0–100 score as a Free report shows it: an integer from 0 to 40, out
 * of 40.
 *
 * The stored value is clamped to 0–100 first, so a malformed row can never show
 * more than 40 or less than zero.
 */
export function freeDisplayScore(score100: number | null): DisplayScore {
  // A non-finite stored score (NaN, ±Infinity) is no score: shown like null.
  if (score100 === null || !Number.isFinite(score100)) {
    return { value: null, max: FREE_SCORE_MAX };
  }
  const clamped = Math.min(FULL_SCORE_MAX, Math.max(0, score100));
  return {
    value: Math.round((clamped * FREE_SCORE_MAX) / FULL_SCORE_MAX),
    max: FREE_SCORE_MAX,
  };
}
