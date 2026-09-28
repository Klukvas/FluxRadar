// The word-boundary matcher T7's competitor signal needs (T7-fix F1).
//
// `questionNames`/`brandSignal` in geo-measurability.ts stay exactly as they
// are — bare, case-insensitive `String.includes`, deliberately, because the
// brand only ever spends that laxity on itself. A competitor is a different
// string picked by the profile owner, and `includes` false-matches it inside
// ordinary words ("GE" inside "managing", "AI" inside "said") and inside the
// brand's own name ("Acme" inside "Acme Dental"). Both kinds of false match
// feed the competitor's mention count, which is a denominator shared with the
// brand's own share — so a false match here does not just mislabel one cell,
// it fabricates part of the brand's own reported share.

const COMBINING_DOT_ABOVE = /\u0307/g;

/**
 * Unicode-aware case fold: NFC first (so a precomposed and a decomposed
 * spelling of the same character compare equal), then `toLowerCase`, then
 * strip the combining dot above that `toLowerCase` leaves behind when it
 * folds İ (U+0130, LATIN CAPITAL LETTER I WITH DOT ABOVE) to "i" + ̇ —
 * without that last step "İmplant" and "implant" fold to two different
 * strings instead of the same one.
 */
export function foldForMatching(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(COMBINING_DOT_ABOVE, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The `[start, end)` offset of every non-overlapping, Unicode-word-bounded
 * occurrence of `needle` in `haystack`. Both arguments are expected already
 * folded with `foldForMatching`; matching is therefore exact, not
 * case-insensitive — the fold already did that work, and re-folding here
 * would double-apply it for no benefit.
 *
 * `\p{L}\p{N}` on both sides of the needle (not `\b`, which only knows ASCII
 * word characters) is what keeps "Acme" from matching inside "Acmeville" and
 * "GE" from matching inside "managing" — while still matching "Acme" at the
 * start or end of a sentence, or next to punctuation.
 */
function matchSpans(haystack: string, needle: string): readonly (readonly [number, number])[] {
  if (needle === '') return [];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'gu');
  const spans: Array<[number, number]> = [];
  let match = pattern.exec(haystack);
  while (match !== null) {
    spans.push([match.index, match.index + match[0].length]);
    match = pattern.exec(haystack);
  }
  return spans;
}

function isWithinAnySpan(
  span: readonly [number, number],
  spans: readonly (readonly [number, number])[],
): boolean {
  const [start, end] = span;
  return spans.some(([spanStart, spanEnd]) => start >= spanStart && end <= spanEnd);
}

/**
 * Whether `haystack` names `needle` on a Unicode word boundary, after folding
 * both. Used for the measurability check — "did the question already name
 * this competitor" — where there is no brand span to exclude.
 */
export function textNames(haystack: string, needle: string): boolean {
  const foldedNeedle = foldForMatching(needle.trim());
  if (foldedNeedle === '') return false;
  return matchSpans(foldForMatching(haystack), foldedNeedle).length > 0;
}

/**
 * Whether `answer` mentions `competitor` on a Unicode word boundary, other
 * than an occurrence that falls entirely inside a span where `brand` itself
 * matched — so a competitor name that is a substring of the brand ("Acme" in
 * "Acme Dental") is not counted as a competitor mention just because the
 * brand was named.
 */
export function competitorMentioned(input: {
  readonly answer: string;
  readonly competitor: string;
  readonly brand: string;
}): boolean {
  const foldedCompetitor = foldForMatching(input.competitor.trim());
  if (foldedCompetitor === '') return false;
  const foldedAnswer = foldForMatching(input.answer);
  const competitorSpans = matchSpans(foldedAnswer, foldedCompetitor);
  if (competitorSpans.length === 0) return false;
  const foldedBrand = foldForMatching(input.brand.trim());
  const brandSpans = foldedBrand === '' ? [] : matchSpans(foldedAnswer, foldedBrand);
  return competitorSpans.some((span) => !isWithinAnySpan(span, brandSpans));
}
