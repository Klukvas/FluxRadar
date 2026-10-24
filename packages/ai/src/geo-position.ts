// Where the brand sits in a discovery answer — computed, never asked of a model.
//
// A discovery answer names providers for someone who did not name one. Being
// mentioned at all is the visibility signal; being mentioned *first*, or fifth
// in a list of five, or only after three competitors, is what this file adds.
// It is a metric only: no finding is built from it, and nothing here feeds a
// score.
//
// Only discovery answers that mention the brand are placed. A closed-book
// question names the business itself, so "where in the answer" measures the
// question, not the model; and an answer that does not mention the brand has no
// place to report. The brand is found the way `brandSignal` finds it — a
// case-insensitive substring, so "Fyno's" and "FYNO" count — after the same
// Unicode fold the competitor matcher uses, so the brand's place and the
// competitors' places are measured in one text.

import { competitorFirstOffset, foldForMatching, textNames } from './competitor-matcher.js';
import { isTableLineAt, listsOf } from './geo-answer-lists.js';
import type { AnswerList } from './geo-answer-lists.js';
import type { GeoMentionSignals } from './geo-rules.js';
import { sentenceStarts } from './geo-sentences.js';
import {
  GEO_VISIBILITY_MIN_MEASURED_FOR_SIGNAL,
  geoVisibilityPurposeOf,
} from './geo-visibility-summary.js';
import type { AiRequestOutcome, AiResponseOutcome } from './run-request.js';
import { AI_PROVIDER_NAMES } from './types.js';
import type { AiProviderName } from './types.js';

/** Where in running text the brand first appears, by sentence. */
export type GeoProsePosition = 'first-sentence' | 'early' | 'late';

export const GEO_PROSE_POSITIONS: readonly GeoProsePosition[] = ['first-sentence', 'early', 'late'];

export type GeoAnswerPosition =
  | {
      readonly kind: 'list';
      /** 1-based number of the first list item that names the brand. */
      readonly rank: number;
      readonly listSize: number;
      /** Profile competitors named before the brand's item. */
      readonly competitorsBefore: number;
    }
  | {
      readonly kind: 'prose';
      readonly bucket: GeoProsePosition;
      /** Profile competitors named before the brand's first mention. */
      readonly competitorsBefore: number;
    };

function occurrences(text: string, needle: string): readonly number[] {
  const found: number[] = [];
  let index = text.indexOf(needle);
  while (index !== -1) {
    found.push(index);
    index = text.indexOf(needle, index + needle.length);
  }
  return found;
}

interface ListHit {
  readonly offset: number;
  readonly rank: number;
  readonly size: number;
}

/** The list item that holds `offset` most tightly: a bullet under a numbered heading wins. */
function innermostHit(lists: readonly AnswerList[], offset: number): ListHit | null {
  const hits = lists.flatMap((items) => {
    const index = items.findIndex((item) => offset >= item.start && offset < item.end);
    const item = items[index];
    return item === undefined
      ? []
      : [{ offset, rank: index + 1, size: items.length, width: item.end - item.start }];
  });
  const [innermost] = [...hits].sort((left, right) => left.width - right.width);
  return innermost === undefined
    ? null
    : { offset: innermost.offset, rank: innermost.rank, size: innermost.size };
}

/** The earliest brand mention that sits inside a list item, with that item's number. */
function firstListHit(lists: readonly AnswerList[], offsets: readonly number[]): ListHit | null {
  for (const offset of offsets) {
    const hit = innermostHit(lists, offset);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * Which part of the running text `anchor` is in. Table rows are table syntax,
 * not sentences, so they are not counted when the brand is outside the table.
 */
function proseBucket(text: string, anchor: number): GeoProsePosition {
  const starts = sentenceStarts(text).filter((start) => !isTableLineAt(text, start));
  const index = starts.reduce((found, start, position) => (start <= anchor ? position : found), 0);
  if (index === 0) return 'first-sentence';
  return index < starts.length / 2 ? 'early' : 'late';
}

/**
 * How many profile competitors are named before `anchor`.
 *
 * A competitor the question itself named is left out, the way share of voice
 * leaves it out: its presence in the answer may only echo the question.
 */
function competitorsBefore(input: GeoAnswerPositionInput, anchor: number): number {
  const names = [
    ...new Map(
      (input.competitors ?? [])
        .map((name) => name.trim())
        .filter((name) => name !== '' && !textNames(input.question ?? '', name))
        .map((name) => [foldForMatching(name), name] as const),
    ).values(),
  ];
  return names.filter((competitor) => {
    const offset = competitorFirstOffset({ answer: input.answer, competitor, brand: input.brand });
    return offset !== null && offset < anchor;
  }).length;
}

export interface GeoAnswerPositionInput {
  readonly answer: string;
  readonly brand: string;
  readonly question?: string;
  /** The profile's competitor names; matched locally, never sent anywhere. */
  readonly competitors?: readonly string[];
}

/**
 * The brand's place in one answer, or null when the answer does not name it.
 *
 * In a list (two or more items, numbered or bulleted) the place is the number
 * of the first item that names the brand — even when an introduction above the
 * list named it already. Otherwise it is the sentence of the first mention:
 * the first sentence, the first half of the answer, or the second half.
 */
export function geoAnswerPosition(input: GeoAnswerPositionInput): GeoAnswerPosition | null {
  const text = foldForMatching(input.answer);
  const brand = foldForMatching(input.brand.trim());
  if (brand === '') return null;
  const offsets = occurrences(text, brand);
  const first = offsets[0];
  if (first === undefined) return null;
  const hit = firstListHit(listsOf(text, input.answer.normalize('NFC')), offsets);
  if (hit !== null) {
    return {
      kind: 'list',
      rank: hit.rank,
      listSize: hit.size,
      competitorsBefore: competitorsBefore(input, hit.offset),
    };
  }
  return {
    kind: 'prose',
    bucket: proseBucket(text, first),
    competitorsBefore: competitorsBefore(input, first),
  };
}

/** Whether a place reads as "named first": top of a list, or the opening sentence with no rival before it. */
export function isFirstPlace(position: GeoAnswerPosition): boolean {
  return position.kind === 'list'
    ? position.rank === 1
    : position.bucket === 'first-sentence' && position.competitorsBefore === 0;
}

export interface GeoPositionInput {
  readonly outcomes: readonly AiRequestOutcome[];
  readonly mentions: ReadonlyMap<string, GeoMentionSignals>;
  readonly brand: string;
  readonly competitors?: readonly string[];
}

function placedAnswers(input: GeoPositionInput): readonly AiResponseOutcome[] {
  return input.outcomes.filter(
    (outcome): outcome is AiResponseOutcome =>
      outcome.kind === 'response' &&
      geoVisibilityPurposeOf(outcome.request.promptVersion) === 'discovery' &&
      input.mentions.get(outcome.aiRequestKey)?.brand === 'mentioned',
  );
}

/** Each discovery answer that mentions the brand, keyed by its `aiRequestKey`. */
export function computeGeoAnswerPositions(
  input: GeoPositionInput,
): ReadonlyMap<string, GeoAnswerPosition> {
  return new Map(
    placedAnswers(input).flatMap((outcome) => {
      const position = geoAnswerPosition({
        answer: outcome.response.rawText,
        brand: input.brand,
        question: outcome.request.question,
        competitors: input.competitors ?? [],
      });
      return position === null ? [] : [[outcome.aiRequestKey, position] as const];
    }),
  );
}

export interface GeoProviderPositionSummary {
  readonly provider: AiProviderName;
  /** Discovery questions this provider answered. */
  readonly discoveryAnswers: number;
  /** Of those, the answers that mention the brand and were placed — the "M" of "N of M". */
  readonly placedAnswers: number;
  readonly firstPlace: number;
  /** Placed answers where the brand is an item of a list. */
  readonly inList: number;
  /** Null below the measurability threshold: one list is not a median. */
  readonly medianListRank: number | null;
  /** Placed answers that named at least one profile competitor before the brand. */
  readonly afterCompetitors: number;
}

export interface GeoPositionSummary {
  /** False when the profile names no competitors: "after competitors" was not measured. */
  readonly competitorsConfigured: boolean;
  /** The fewest list placements a median is shown for (the visibility summary's own floor). */
  readonly minListAnswersForMedian: number;
  readonly providers: readonly GeoProviderPositionSummary[];
}

function median(values: readonly number[]): number | null {
  if (values.length < GEO_VISIBILITY_MIN_MEASURED_FOR_SIGNAL) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
}

function providerSummary(
  provider: AiProviderName,
  outcomes: readonly AiRequestOutcome[],
  positions: ReadonlyMap<string, GeoAnswerPosition>,
): GeoProviderPositionSummary {
  const answered = outcomes.filter(
    (outcome): outcome is AiResponseOutcome =>
      outcome.kind === 'response' &&
      outcome.request.provider === provider &&
      geoVisibilityPurposeOf(outcome.request.promptVersion) === 'discovery',
  );
  const placed = answered.flatMap((outcome) => {
    const position = positions.get(outcome.aiRequestKey);
    return position === undefined ? [] : [position];
  });
  const ranks = placed.flatMap((position) => (position.kind === 'list' ? [position.rank] : []));
  return {
    provider,
    discoveryAnswers: answered.length,
    placedAnswers: placed.length,
    firstPlace: placed.filter(isFirstPlace).length,
    inList: ranks.length,
    medianListRank: median(ranks),
    afterCompetitors: placed.filter((position) => position.competitorsBefore > 0).length,
  };
}

/**
 * Per provider that answered a discovery question, in the fixed provider order,
 * how often the brand was placed and where. Counts only — "first in N of M" —
 * because a share of two answers is not a measurement worth a percentage.
 */
export function summarizeGeoPositions(
  input: GeoPositionInput,
  positions: ReadonlyMap<string, GeoAnswerPosition>,
): GeoPositionSummary {
  const providers = AI_PROVIDER_NAMES.map((provider) =>
    providerSummary(provider, input.outcomes, positions),
  ).filter((summary) => summary.discoveryAnswers > 0);
  return {
    competitorsConfigured: (input.competitors ?? []).some((name) => name.trim() !== ''),
    minListAnswersForMedian: GEO_VISIBILITY_MIN_MEASURED_FOR_SIGNAL,
    providers,
  };
}
