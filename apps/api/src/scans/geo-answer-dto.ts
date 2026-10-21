// The tone and the brand's place in one stored GEO answer, read back for the
// report.
//
// Both were computed at scan time and stored beside the answer; neither is
// recomputed here. They are re-checked the way the claims beside them are: a
// stored tone is shown only if its quote is still in the answer this report
// prints, and a stored position only if it has the shape one was written with.
// Anything else reads as "not evaluated" — never as a neutral tone or a place.

import {
  GEO_PROSE_POSITIONS,
  GEO_TONE_LABELS,
  quoteOccursIn,
  type GeoAnswerPosition,
  type GeoProsePosition,
  type GeoToneLabel,
} from '@fluxradar/ai';

export interface GeoToneDto {
  /** False for a verdict that was not asked about tone — an older scan or notice. */
  readonly toneEvaluated: boolean;
  readonly tone: { readonly label: GeoToneLabel; readonly quote: string } | null;
  /** The evaluator offered a tone that did not survive validation. */
  readonly toneAdjusted: boolean;
}

export const TONE_NOT_EVALUATED: GeoToneDto = {
  toneEvaluated: false,
  tone: null,
  toneAdjusted: false,
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isCount(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum;
}

/**
 * The tone of a completed stored verdict.
 *
 * The `tone` key exists only on verdicts that were asked about tone, so its
 * absence is "not evaluated". A stored tone whose quote is not in the answer
 * shown beside it, or attached to an answer that describes nothing, is dropped
 * and marked adjusted rather than shown.
 */
export function storedToneFrom(
  record: Readonly<Record<string, unknown>>,
  answer: string,
  describesSubject: boolean,
): GeoToneDto {
  if (!('tone' in record)) return TONE_NOT_EVALUATED;
  // An answer that describes nothing has no tone to show, and that is the
  // ordinary "did not describe you" outcome rather than a refused tone.
  if (!describesSubject) return { toneEvaluated: true, tone: null, toneAdjusted: false };
  const adjusted = record.toneAdjusted === true;
  if (record.tone === null) return { toneEvaluated: true, tone: null, toneAdjusted: adjusted };
  const tone = recordValue(record.tone);
  const label = tone?.label;
  const quote = tone?.quote;
  const valid =
    typeof label === 'string' &&
    (GEO_TONE_LABELS as readonly string[]).includes(label) &&
    typeof quote === 'string' &&
    quoteOccursIn(answer, quote);
  return valid
    ? { toneEvaluated: true, tone: { label: label as GeoToneLabel, quote }, toneAdjusted: adjusted }
    : { toneEvaluated: true, tone: null, toneAdjusted: true };
}

/** A stored place in the answer, or null for an answer that has none or a malformed one. */
export function storedPositionFrom(value: unknown): GeoAnswerPosition | null {
  const record = recordValue(value);
  if (record === null || !isCount(record.competitorsBefore, 0)) return null;
  const competitorsBefore = record.competitorsBefore;
  if (record.kind === 'list') {
    const { rank, listSize } = record;
    return isCount(rank, 1) && isCount(listSize, 2) && rank <= listSize
      ? { kind: 'list', rank, listSize, competitorsBefore }
      : null;
  }
  if (
    record.kind === 'prose' &&
    typeof record.bucket === 'string' &&
    (GEO_PROSE_POSITIONS as readonly string[]).includes(record.bucket)
  ) {
    return { kind: 'prose', bucket: record.bucket as GeoProsePosition, competitorsBefore };
  }
  return null;
}
