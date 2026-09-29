// What the two comparison surfaces say, in the same words.
//
// Shared rather than copied because each of these is the claim itself: the panel
// and the printed block must never disagree about whether 70 → 74.5 went up, how
// many decimals a customer is shown, or whether the reader was told the
// difference may be the network rather than their site.

import type { CrawlScopeFacts } from './comparison-api';
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

/**
 * Whether where the two crawls left from can account for part of the difference.
 *
 * True when the locations differ, and true when either is unrecorded: "somewhere
 * unknown" is not evidence of the same place twice, and the earliest scans of
 * this product left from a server in another country with nothing recording it
 * (D-228).
 *
 * Shared by the panel and the printed block for the same reason the score
 * movement is: the two surfaces must not disagree about whether the reader was
 * warned.
 */
export function egressMayExplainDifference(
  current: CrawlScopeFacts,
  previous: CrawlScopeFacts,
): boolean {
  return (
    current.egressLocation === null ||
    previous.egressLocation === null ||
    current.egressLocation !== previous.egressLocation
  );
}
