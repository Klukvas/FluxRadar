// The one place a stored score becomes the score a report shows (D-237).
//
// A Free check is shown out of 40 — a quick check of a few light homepage
// checks; a paid one is shown as stored, out of 100. The stored rows keep their
// true 0–100 values — the penalties, the usable-output and Partial decisions and
// the scan outcome were all made from those, and none of them moves. Both the
// dashboard's overall score and each module DTO carry the denominator
// (`scoreMax`), so no renderer has to assume it.

import {
  FULL_SCORE_MAX,
  freeDisplayScore,
  readStoredPlan,
  scoreMaxFor,
  storedPlanScoreWeights,
} from '@fluxradar/contracts';
import type { ScoreMax } from '@fluxradar/contracts';

/** The modules the Free score is made of — its tariff weights, never restated. */
const FREE_SCORED_MODULES: readonly string[] = Object.keys(storedPlanScoreWeights('Free', []));

export interface ScoreView {
  readonly score: number | null;
  readonly scoreMax: ScoreMax;
}

function isFreeScale(plan: string): boolean {
  return scoreMaxFor(readStoredPlan(plan)) !== FULL_SCORE_MAX;
}

function freeView(score: number | null): ScoreView {
  const shown = freeDisplayScore(score);
  return { score: shown.value, scoreMax: shown.max };
}

/**
 * The overall score of a stored scan as its report shows it. A paid payload is
 * the stored one plus `scoreMax: 100`; a Free one is scaled to 0–40, `scoreMax: 40`.
 */
export function overallScoreView<T extends { readonly score: number | null }>(
  plan: string,
  overall: T,
): T & ScoreView {
  if (!isFreeScale(plan)) {
    return { ...overall, scoreMax: FULL_SCORE_MAX };
  }
  return { ...overall, ...freeView(overall.score) };
}

/** One module's score as its report shows it. */
export function moduleScoreView(plan: string, module: string, score: number | null): ScoreView {
  if (!isFreeScale(plan) || !FREE_SCORED_MODULES.includes(module)) {
    return { score, scoreMax: FULL_SCORE_MAX };
  }
  return freeView(score);
}
