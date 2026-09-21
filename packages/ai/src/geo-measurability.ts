// When is a mention in an answer actually evidence of anything?
//
// The awareness questions used to read:
//
//   "What is example.com, what does its official website https://example.com
//    offer, and who is it for?"
//
// and the brand of an auto-created profile is its hostname, so the question
// contained both the things the answer was then checked for. A model that
// repeats the subject of the question — which is what a model does — scored
// "brand mentioned" and "official domain cited", every time, on every site. The
// badges were green because we had said the words ourselves.
//
// A signal is therefore measurable only when the thing being looked for is NOT
// already in the question. When it is, the honest answer is "not measured", and
// nothing downstream may turn that into a pass.

/** Every value a `MentionSignal` may take, for parsing a stored record. */
export const MENTION_SIGNALS = [
  'mentioned',
  'not-mentioned',
  'named-in-question',
  'brand-is-hostname',
] as const;

/** What one answer can tell us about one signal. */
export type MentionSignal =
  /** The answer contained it, and the question did not. */
  | 'mentioned'
  /** The question did not contain it, and neither did the answer. */
  | 'not-mentioned'
  /** The question already named it, so the answer proves nothing. */
  | 'named-in-question'
  /**
   * The brand is the hostname, so "did it name the brand" and "did it cite the
   * domain" are the same question asked twice. Brand awareness has no separate
   * meaning for such a profile until its owner gives it a real name.
   */
  | 'brand-is-hostname';

/** Whether a signal was actually measured — the only value that may read as a pass. */
export function isMeasured(signal: MentionSignal): boolean {
  return signal === 'mentioned' || signal === 'not-mentioned';
}

/**
 * Whether a profile has no brand name — only its domain in the brand field.
 *
 * `siteProfileNameFor` names an auto-created profile after its hostname, so a
 * paid scan of a site whose owner never typed a name arrives with
 * brand === "ukrdentclub.ua". Asking "did the answer mention ukrdentclub.ua"
 * is then the domain question asked twice, and reporting it as a second green
 * badge doubles the same non-measurement.
 *
 * Strict equality with the hostname, deliberately. A real brand that shares a
 * label with its domain — "Nike" on nike.com — is a name a model may or may not
 * know, and that is exactly what this rule is for.
 */
export function brandIsHostname(brand: string, hostname: string): boolean {
  const normalizedBrand = brand
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  const normalizedHost = hostname
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  return normalizedBrand !== '' && normalizedBrand === normalizedHost;
}

/** Case-insensitive containment, the same test the brand rule applies to answers. */
export function questionNames(question: string, needle: string): boolean {
  const trimmed = needle.trim().toLowerCase();
  if (trimmed === '') return false;
  return question.toLowerCase().includes(trimmed);
}

/**
 * The brand signal for one answer.
 *
 * Order matters: a profile whose brand is its hostname has nothing to measure
 * whatever the question said, and a question that named the brand cannot be
 * evidence whatever the answer said. Only what survives both is a measurement.
 */
export function brandSignal(input: {
  readonly question: string;
  readonly answer: string;
  readonly brand: string;
  readonly hostname: string;
}): MentionSignal {
  if (brandIsHostname(input.brand, input.hostname)) return 'brand-is-hostname';
  if (questionNames(input.question, input.brand)) return 'named-in-question';
  return questionNames(input.answer, input.brand) ? 'mentioned' : 'not-mentioned';
}

/**
 * The domain signal for one answer.
 *
 * `mentionsDomain` is passed in rather than reimplemented: the domain rule
 * matches on a hostname boundary and also reads the response's citations
 * (D-178), and a second, looser copy here would disagree with it.
 */
export function domainSignal(input: {
  readonly question: string;
  readonly domain: string;
  readonly mentionsDomain: boolean;
}): MentionSignal {
  if (questionNames(input.question, input.domain)) return 'named-in-question';
  return input.mentionsDomain ? 'mentioned' : 'not-mentioned';
}
