// The tone in which one AI answer describes the business — judged by the same
// evaluator request that checks the answer's claims, never by a request of its
// own.
//
// A tone is worth showing only under the rules the claims already follow: the
// model has to quote the span of the answer that carries the tone, the quote has
// to be in the answer, and an answer that describes nothing has no tone at all.
// What the model hands back is validated here and downgraded rather than
// trusted — a bad tone costs the tone, never the claims judged beside it.
//
// Three outcomes stay apart all the way to the report: the tone was not judged
// in this scan (an older notice, an older release, an evaluator that did not
// run), the answer was judged and had no tone to give (it does not describe the
// business), and a tone with its quote. "Not judged" is never "neutral".

import { quoteOccursIn } from './quote-match.js';

export type GeoToneLabel = 'positive' | 'neutral' | 'negative' | 'mixed';

export const GEO_TONE_LABELS: readonly GeoToneLabel[] = [
  'positive',
  'neutral',
  'negative',
  'mixed',
];

export interface GeoAnswerTone {
  readonly label: GeoToneLabel;
  /** Verified to occur in the judged (redacted) answer. */
  readonly quote: string;
}

/**
 * What the evaluator said about tone, after validation.
 *
 * `adjusted` is true when the answer describes the business and the model's
 * tone did not survive the checks — a quote that is not in the answer, an
 * unknown label, a null tone, or no tone field at all — and `tone` was set to
 * null in its place. An answer that describes nothing has no tone and is never
 * adjusted: whatever the model offered for it is dropped as "no description".
 */
export type GeoToneVerdict =
  | { readonly judged: false }
  | { readonly judged: true; readonly tone: GeoAnswerTone | null; readonly adjusted: boolean };

/** The verdict for an evaluation that was not asked about tone. */
export const GEO_TONE_NOT_JUDGED: GeoToneVerdict = { judged: false };

/**
 * The JSON-schema fragment for `tone`: an object, or null when nothing was
 * described. Structured outputs accept `anyOf` with a `null` branch; the quote
 * length is stated in the contract text, because string-length constraints are
 * not part of the supported schema subset.
 */
export const GEO_TONE_RESPONSE_SCHEMA: Readonly<Record<string, unknown>> = {
  anyOf: [
    {
      type: 'object',
      properties: {
        label: { type: 'string', enum: [...GEO_TONE_LABELS] },
        quote: { type: 'string' },
      },
      required: ['label', 'quote'],
      additionalProperties: false,
    },
    { type: 'null' },
  ],
};

/**
 * The tone rubric the evaluator reads.
 *
 * About the business, not the question: a neutral question answered with a
 * warning is a negative description, and a glowing answer about a competitor
 * says nothing about this business.
 */
export function geoToneRubric(siteDomain: string): string {
  return (
    `Also judge the tone in which the answer describes the business behind ${siteDomain} — ` +
    'not the tone of the question, and not what it says about anyone else. ' +
    'Use "positive" when it recommends or praises the business, "neutral" when it only states ' +
    'facts about it, "negative" when it criticises the business, warns against it or advises ' +
    'not to use it, and "mixed" when it does both. Quote the shortest verbatim span of the ' +
    'answer that carries that tone. If the answer does not describe this business, or only says ' +
    'it has no information about it, set tone to null.'
  );
}

/** The part of the output contract that names the tone field. */
export function geoToneContract(maxQuoteChars: number): string {
  return (
    'Add "tone": {"label":"positive|neutral|negative|mixed","quote":"..."} to that object, or ' +
    `"tone": null when the answer does not describe the business. The tone quote must stay under ` +
    `${maxQuoteChars} characters.`
  );
}

function isToneLabel(value: unknown): value is GeoToneLabel {
  return typeof value === 'string' && (GEO_TONE_LABELS as readonly string[]).includes(value);
}

/** A tone the model offered, or null when it fails any check. */
function validTone(value: unknown, answer: string, maxQuoteChars: number): GeoAnswerTone | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isToneLabel(record.label) || typeof record.quote !== 'string') return null;
  const quote = record.quote.replace(/\s+/g, ' ').trim();
  if (quote === '' || [...quote].length > maxQuoteChars) return null;
  return quoteOccursIn(answer, quote) ? { label: record.label, quote } : null;
}

/**
 * Reads the `tone` field of an evaluator response that was asked for one.
 *
 * Never throws: the claims in the same response were validated on their own
 * terms, and a tone the checks refuse is replaced by null and marked
 * `adjusted`, the way a claim-contradicting overall verdict is.
 */
export function parseGeoTone(
  record: Readonly<Record<string, unknown>>,
  answer: string,
  describesSubject: boolean,
  maxQuoteChars: number,
): GeoToneVerdict {
  // An answer that describes nothing has no tone, whatever the model offered or
  // left out: that is the "did not describe you" outcome, not a refused tone.
  if (!describesSubject) return { judged: true, tone: null, adjusted: false };
  // From here on the answer describes the business, so a missing or null tone
  // is the model contradicting itself: nothing is shown, and it is not "no
  // description" either.
  if (!('tone' in record) || record.tone === null) {
    return { judged: true, tone: null, adjusted: true };
  }
  const tone = validTone(record.tone, answer, maxQuoteChars);
  return tone === null
    ? { judged: true, tone: null, adjusted: true }
    : { judged: true, tone, adjusted: false };
}
