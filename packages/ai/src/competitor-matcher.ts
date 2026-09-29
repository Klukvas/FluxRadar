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

// Only the dot `toLowerCase` appends directly after an "i" — the İ (U+0130)
// case below — is stripped. An unrelated combining dot above some other
// letter (Ṫ, Q̇, …) is real diacritical information and must survive the
// fold (T7-fix2 N6): the lookbehind is what tells the two apart.
const COMBINING_DOT_AFTER_I = /(?<=i)\u0307/g;

/**
 * Unicode-aware case fold: NFC first (so a precomposed and a decomposed
 * spelling of the same character compare equal), then `toLowerCase`, then
 * strip the combining dot above that `toLowerCase` leaves behind when it
 * folds İ (U+0130, LATIN CAPITAL LETTER I WITH DOT ABOVE) to "i" + ̇ —
 * without that last step "İmplant" and "implant" fold to two different
 * strings instead of the same one.
 */
export function foldForMatching(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(COMBINING_DOT_AFTER_I, '');
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

type Span = readonly [number, number];

function isWithinAnySpan(span: Span, spans: readonly Span[]): boolean {
  const [start, end] = span;
  return spans.some(([spanStart, spanEnd]) => start >= spanStart && end <= spanEnd);
}

function spanLength(span: Span): number {
  return span[1] - span[0];
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
 * `competitor`'s spans in `answer`, on a Unicode word boundary, minus any
 * span that falls entirely inside a span where `brand` itself matched — so a
 * competitor name that is a substring of the brand ("Acme" in "Acme Dental")
 * is not counted as a competitor mention just because the brand was named.
 * Shared by `competitorMentioned` (single-name check) and
 * `shareOfVoiceMentions` (T7-fix2 N1/N2, which needs every competitor's spans
 * together to resolve overlaps between them).
 */
function competitorSpansExcludingBrand(input: {
  readonly answer: string;
  readonly competitor: string;
  readonly brand: string;
}): readonly Span[] {
  const foldedCompetitor = foldForMatching(input.competitor.trim());
  if (foldedCompetitor === '') return [];
  const foldedAnswer = foldForMatching(input.answer);
  const competitorSpans = matchSpans(foldedAnswer, foldedCompetitor);
  if (competitorSpans.length === 0) return [];
  const foldedBrand = foldForMatching(input.brand.trim());
  const brandSpans = foldedBrand === '' ? [] : matchSpans(foldedAnswer, foldedBrand);
  return competitorSpans.filter((span) => !isWithinAnySpan(span, brandSpans));
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
  return competitorSpansExcludingBrand(input).length > 0;
}

export interface ShareOfVoiceMentions {
  /**
   * Whether the brand itself was mentioned at a span not entirely covered by
   * a competitor's (longest-match-resolved) span in the same answer.
   */
  readonly brandMentioned: boolean;
  /** Which of the input `competitors` were mentioned, overlaps resolved. */
  readonly competitorsMentioned: ReadonlySet<string>;
}

/**
 * Share-of-voice mention resolution for one answer, across the brand and
 * every competitor together (T7-fix2 N1/N2). `competitorMentioned`/
 * `textNames` decide one name in isolation; a fair share-of-voice count needs
 * two more rules that only make sense with every name in view at once:
 *
 *  - N1: a brand "mention" that exists only because it is a substring of a
 *    matched competitor name ("Bolt" inside "Bolt Food") must not inflate the
 *    brand's own share — the mirror, in the other direction, of the
 *    brand-inside-competitor exclusion `competitorSpansExcludingBrand`
 *    already applies.
 *  - N2: when two competitor names overlap in the same answer ("Acme" inside
 *    "Acme Corp"), only the longest match counts — otherwise one real mention
 *    is double-counted as two competitors' mentions, which also corrupts the
 *    shared denominator.
 *
 * `competitors` is expected to already exclude any name the question itself
 * named — measurability is the caller's concern, not this function's.
 */
export function shareOfVoiceMentions(input: {
  readonly answer: string;
  readonly brand: string;
  readonly competitors: readonly string[];
}): ShareOfVoiceMentions {
  const foldedAnswer = foldForMatching(input.answer);
  const foldedBrand = foldForMatching(input.brand.trim());
  const brandSpans = foldedBrand === '' ? [] : matchSpans(foldedAnswer, foldedBrand);

  const perCompetitorSpans = input.competitors.map((name) => ({
    name,
    spans: competitorSpansExcludingBrand({
      answer: input.answer,
      competitor: name,
      brand: input.brand,
    }),
  }));
  const allSpans = perCompetitorSpans.flatMap(({ name, spans }) =>
    spans.map((span) => ({ name, span })),
  );
  // N2: drop a span that sits entirely inside a strictly longer span from a
  // *different* competitor — the longer match is the real mention.
  const survivingSpans = allSpans.filter(
    (candidate) =>
      !allSpans.some(
        (other) =>
          other.name !== candidate.name &&
          spanLength(other.span) > spanLength(candidate.span) &&
          isWithinAnySpan(candidate.span, [other.span]),
      ),
  );

  const competitorsMentioned = new Set(
    perCompetitorSpans
      .filter(({ name }) => survivingSpans.some((entry) => entry.name === name))
      .map(({ name }) => name),
  );
  // N1: the brand only counts where it is not covered by a surviving
  // competitor span — "Bolt" inside "Bolt Food" is not a mention of "Bolt".
  const survivingCompetitorSpans = survivingSpans.map((entry) => entry.span);
  const brandMentioned = brandSpans.some(
    (span) => !isWithinAnySpan(span, survivingCompetitorSpans),
  );

  return { brandMentioned, competitorsMentioned };
}
