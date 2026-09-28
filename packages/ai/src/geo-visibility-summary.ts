// Per-engine visibility summary (T6): a deterministic read of what a GEO run
// already produced — no new AI calls, no new provider. Three pure functions
// over `GeoModuleResult`'s outcomes and mention signals:
//
//   - computeGeoVisibilitySummaries: one row per provider that answered at
//     least one question — counts, shares, and a 0-100 score.
//   - computeGeoCitedInstead (folded into the summary): for each provider,
//     which other sites its answers cited when ours was not.
//   - computeGeoMentionContexts: the sentence around the first brand mention
//     in each answer that has one, for the report to quote.
//
// The score is informational only (GEO-METHOD-005, GEO_SCORING_REASON) and
// never feeds the overall score — this module computes observations, nothing
// that penalizes.

import { isMeasured } from './geo-measurability.js';
import type { GeoMentionSignals } from './geo-rules.js';
import { redact } from './redaction.js';
import type { RedactionOptions } from './redaction.js';
import type { AiRequestOutcome, AiResponseOutcome } from './run-request.js';
import { AI_PROVIDER_NAMES } from './types.js';
import type { AiProviderName } from './types.js';

/**
 * A provider needs at least this many *measured* answers per signal to earn a
 * score.
 *
 * Measured, not answered: an answer whose question already named the brand —
 * or whose profile has no brand but its hostname — says nothing about
 * visibility (geo-measurability.ts), and the report's own badge for it reads
 * "not measured". Counting such an answer in the denominator would turn a
 * non-measurement into a miss, which is exactly what the badges refuse to do.
 */
export const GEO_VISIBILITY_MIN_MEASURED_FOR_SCORE = 3;
/** Score formula (documented in the report copy too — keep both in sync). */
export const GEO_VISIBILITY_BRAND_WEIGHT = 0.6;
export const GEO_VISIBILITY_DOMAIN_WEIGHT = 0.4;
export const GEO_CITED_INSTEAD_LIMIT = 10;
export const GEO_MENTION_CONTEXT_MAX_CHARS = 240;

/** Mirrors the purpose split the report already uses (geo-module-row.ts). */
export type GeoVisibilityPurpose = 'closed-book' | 'awareness' | 'discovery';

export interface GeoPurposeVisibilityCounts {
  readonly asked: number;
  readonly answered: number;
  /** Answers in which the brand signal could say anything at all. */
  readonly brandMeasured: number;
  /** Answers in which the domain signal could say anything at all. */
  readonly domainMeasured: number;
  readonly brandMentioned: number;
  readonly domainMentioned: number;
}

const EMPTY_PURPOSE_COUNTS: GeoPurposeVisibilityCounts = {
  asked: 0,
  answered: 0,
  brandMeasured: 0,
  domainMeasured: 0,
  brandMentioned: 0,
  domainMentioned: 0,
};

export interface GeoCitedInsteadEntry {
  readonly hostname: string;
  /** Number of distinct answers citing this hostname — never a raw citation count. */
  readonly answerCount: number;
}

/** Why a provider has no score — never "it scored zero". */
export const GEO_SCORE_UNAVAILABLE_REASONS = ['not-measurable', 'not-enough-measured'] as const;
export type GeoScoreUnavailableReason = (typeof GEO_SCORE_UNAVAILABLE_REASONS)[number];

export interface GeoProviderVisibilitySummary {
  readonly provider: AiProviderName;
  readonly questionsAsked: number;
  readonly questionsAnswered: number;
  readonly questionsUnavailable: number;
  /** Answers in which the brand signal was measurable — the share's denominator. */
  readonly brandMeasuredCount: number;
  readonly brandMentionedCount: number;
  /** Share of *measured* answers, 0..1; null when nothing was measurable. */
  readonly brandMentionedShare: number | null;
  /** Answers in which the domain signal was measurable — the share's denominator. */
  readonly domainMeasuredCount: number;
  readonly domainCitedCount: number;
  /** Share of *measured* answers, 0..1; null when nothing was measurable. */
  readonly domainCitedShare: number | null;
  /** 0..100; null unless both signals reached GEO_VISIBILITY_MIN_MEASURED_FOR_SCORE. */
  readonly visibilityScore: number | null;
  /** Set exactly when `visibilityScore` is null, so the report can say which it is. */
  readonly scoreUnavailableReason: GeoScoreUnavailableReason | null;
  readonly byPurpose: Readonly<Record<GeoVisibilityPurpose, GeoPurposeVisibilityCounts>>;
  readonly citedInstead: readonly GeoCitedInsteadEntry[];
}

export interface GeoVisibilitySummaryInput {
  readonly outcomes: readonly AiRequestOutcome[];
  readonly mentions: ReadonlyMap<string, GeoMentionSignals>;
  /** Normalized site domain (lowercase), to exclude our own hostname from "cited instead". */
  readonly siteDomain: string;
}

/** Same rule geo-module-row.ts uses to label a question, kept here so the two never disagree. */
export function geoVisibilityPurposeOf(promptVersion: string): GeoVisibilityPurpose {
  if (promptVersion.endsWith('-discovery')) return 'discovery';
  return promptVersion.endsWith('-closed-book') ? 'closed-book' : 'awareness';
}

/**
 * One spelling per host.
 *
 * The trailing dot of a fully-qualified name (`beta.example.`) is dropped:
 * it addresses the same host as the dotless form, and keeping it would rank
 * one site as two entries in "cited instead".
 */
function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.+$/, '');
}

/**
 * The host a citation points at, or null when it names none.
 *
 * Models cite scheme-less addresses (`acme.example/pricing`) often enough that
 * dropping them silently understated who got cited instead; such a string is
 * re-parsed against a default scheme rather than discarded.
 */
function citationHostname(citation: string): string | null {
  const trimmed = citation.trim();
  if (trimmed === '') return null;
  for (const candidate of [trimmed, `https://${trimmed}`]) {
    try {
      const hostname = normalizeHostname(new URL(candidate).hostname);
      if (hostname !== '') return hostname;
    } catch {
      // Not a URL under this scheme — fall through to the next candidate.
    }
  }
  return null;
}

function isOwnHostname(hostname: string, siteDomain: string): boolean {
  const host = normalizeHostname(hostname);
  const domain = normalizeHostname(siteDomain);
  return host === domain || host.endsWith(`.${domain}`);
}

function citationHostnames(response: AiResponseOutcome, siteDomain: string): readonly string[] {
  const hosts = response.response.citations.flatMap((citation): readonly string[] => {
    const hostname = citationHostname(citation);
    return hostname === null ? [] : [hostname];
  });
  const own = new Set(hosts.filter((host) => isOwnHostname(host, siteDomain)));
  return [...new Set(hosts)].filter((host) => !own.has(host));
}

/**
 * "Who got cited instead" for one provider's answers.
 *
 * Only answers where the domain signal was actually measured and came back
 * `not-mentioned` count: an answer whose question already named the domain
 * proves nothing about who the model reached for instead.
 */
function citedInsteadFor(
  responses: readonly AiResponseOutcome[],
  mentions: ReadonlyMap<string, GeoMentionSignals>,
  siteDomain: string,
): readonly GeoCitedInsteadEntry[] {
  const counts = new Map<string, number>();
  for (const response of responses) {
    const signal = mentions.get(response.aiRequestKey);
    if (signal === undefined || signal.domain !== 'not-mentioned') continue;
    for (const hostname of citationHostnames(response, siteDomain)) {
      counts.set(hostname, (counts.get(hostname) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([hostname, answerCount]) => ({ hostname, answerCount }))
    .sort(
      (left, right) =>
        right.answerCount - left.answerCount || left.hostname.localeCompare(right.hostname),
    )
    .slice(0, GEO_CITED_INSTEAD_LIMIT);
}

function addToPurposeCounts(
  totals: Readonly<Record<GeoVisibilityPurpose, GeoPurposeVisibilityCounts>>,
  purpose: GeoVisibilityPurpose,
  answered: boolean,
  signal: GeoMentionSignals | undefined,
): Readonly<Record<GeoVisibilityPurpose, GeoPurposeVisibilityCounts>> {
  const current = totals[purpose];
  // A signal only counts for an answer that came back; an unavailable request
  // has nothing to measure either way.
  const counted = answered ? signal : undefined;
  const brandMeasured = counted !== undefined && isMeasured(counted.brand);
  const domainMeasured = counted !== undefined && isMeasured(counted.domain);
  return {
    ...totals,
    [purpose]: {
      asked: current.asked + 1,
      answered: current.answered + (answered ? 1 : 0),
      brandMeasured: current.brandMeasured + (brandMeasured ? 1 : 0),
      domainMeasured: current.domainMeasured + (domainMeasured ? 1 : 0),
      brandMentioned: current.brandMentioned + (counted?.brand === 'mentioned' ? 1 : 0),
      domainMentioned: current.domainMentioned + (counted?.domain === 'mentioned' ? 1 : 0),
    },
  };
}

function providerOrder(provider: AiProviderName): number {
  const index = AI_PROVIDER_NAMES.indexOf(provider);
  return index === -1 ? AI_PROVIDER_NAMES.length : index;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function summaryForProvider(
  provider: AiProviderName,
  outcomes: readonly AiRequestOutcome[],
  mentions: ReadonlyMap<string, GeoMentionSignals>,
  siteDomain: string,
): GeoProviderVisibilitySummary {
  let byPurpose: Readonly<Record<GeoVisibilityPurpose, GeoPurposeVisibilityCounts>> = {
    'closed-book': EMPTY_PURPOSE_COUNTS,
    awareness: EMPTY_PURPOSE_COUNTS,
    discovery: EMPTY_PURPOSE_COUNTS,
  };
  let answered = 0;
  let unavailable = 0;
  let brandMeasuredCount = 0;
  let brandMentionedCount = 0;
  let domainMeasuredCount = 0;
  let domainCitedCount = 0;
  const responses: AiResponseOutcome[] = [];

  for (const outcome of outcomes) {
    const purpose = geoVisibilityPurposeOf(outcome.request.promptVersion);
    const isResponse = outcome.kind === 'response';
    const signal = isResponse ? mentions.get(outcome.aiRequestKey) : undefined;
    byPurpose = addToPurposeCounts(byPurpose, purpose, isResponse, signal);
    if (!isResponse) {
      unavailable += 1;
      continue;
    }
    answered += 1;
    responses.push(outcome);
    if (signal === undefined) continue;
    if (isMeasured(signal.brand)) brandMeasuredCount += 1;
    if (isMeasured(signal.domain)) domainMeasuredCount += 1;
    if (signal.brand === 'mentioned') brandMentionedCount += 1;
    if (signal.domain === 'mentioned') domainCitedCount += 1;
  }

  // Exact shares feed the score; the stored share is the same number rounded
  // for display. Scoring off the rounded value made the published formula
  // disagree with the published number (1 of 7 answers scored 8, not 9).
  const exactBrandShare =
    brandMeasuredCount === 0 ? null : brandMentionedCount / brandMeasuredCount;
  const exactDomainShare =
    domainMeasuredCount === 0 ? null : domainCitedCount / domainMeasuredCount;

  return {
    provider,
    questionsAsked: outcomes.length,
    questionsAnswered: answered,
    questionsUnavailable: unavailable,
    brandMeasuredCount,
    brandMentionedCount,
    brandMentionedShare: exactBrandShare === null ? null : round(exactBrandShare),
    domainMeasuredCount,
    domainCitedCount,
    domainCitedShare: exactDomainShare === null ? null : round(exactDomainShare),
    visibilityScore: scoreFor(brandMeasuredCount, domainMeasuredCount, {
      brand: exactBrandShare,
      domain: exactDomainShare,
    }),
    scoreUnavailableReason: scoreUnavailableReasonFor(brandMeasuredCount, domainMeasuredCount),
    byPurpose,
    citedInstead: citedInsteadFor(responses, mentions, siteDomain),
  };
}

/**
 * Why this provider earns no score, or null when it does.
 *
 * Both signals have to be measurable, and measurable often enough: a score
 * built on one measured answer out of ten would read as a fact about the
 * engine when it is a fact about the questions.
 */
function scoreUnavailableReasonFor(
  brandMeasuredCount: number,
  domainMeasuredCount: number,
): GeoScoreUnavailableReason | null {
  if (brandMeasuredCount === 0 || domainMeasuredCount === 0) return 'not-measurable';
  if (
    brandMeasuredCount < GEO_VISIBILITY_MIN_MEASURED_FOR_SCORE ||
    domainMeasuredCount < GEO_VISIBILITY_MIN_MEASURED_FOR_SCORE
  ) {
    return 'not-enough-measured';
  }
  return null;
}

function scoreFor(
  brandMeasuredCount: number,
  domainMeasuredCount: number,
  shares: { readonly brand: number | null; readonly domain: number | null },
): number | null {
  if (scoreUnavailableReasonFor(brandMeasuredCount, domainMeasuredCount) !== null) return null;
  if (shares.brand === null || shares.domain === null) return null;
  return Math.round(
    100 *
      (GEO_VISIBILITY_BRAND_WEIGHT * shares.brand + GEO_VISIBILITY_DOMAIN_WEIGHT * shares.domain),
  );
}

/**
 * One summary row per provider that answered at least one question, in a
 * fixed order (AI_PROVIDER_NAMES) so the report never reorders on rerun.
 *
 * A provider with zero answers is left out entirely: a scan whose consent
 * never named Perplexity never asked it, and showing an empty card for a
 * provider that never ran would look like a check that came back "unavailable"
 * rather than one that never happened.
 *
 * With no site domain there is nothing to summarise: our own hostname could
 * not be excluded from "cited instead", so our own pages would be listed as
 * competitors. Refusing is honest; a half-right summary is not.
 */
export function computeGeoVisibilitySummaries(
  input: GeoVisibilitySummaryInput,
): readonly GeoProviderVisibilitySummary[] {
  if (input.siteDomain.trim() === '') return [];
  const byProvider = new Map<AiProviderName, AiRequestOutcome[]>();
  for (const outcome of input.outcomes) {
    const provider = outcome.request.provider;
    const list = byProvider.get(provider) ?? [];
    list.push(outcome);
    byProvider.set(provider, list);
  }
  const siteDomain = input.siteDomain.trim().toLowerCase();
  return [...byProvider.entries()]
    .filter(([, outcomes]) => outcomes.some((outcome) => outcome.kind === 'response'))
    .sort(([left], [right]) => providerOrder(left) - providerOrder(right))
    .map(([provider, outcomes]) =>
      summaryForProvider(provider, outcomes, input.mentions, siteDomain),
    );
}

/** Cuts on a code-point boundary so a multi-byte character is never split mid-glyph. */
function boundedExcerpt(text: string, maxChars: number): string {
  const codePoints = [...text];
  if (codePoints.length <= maxChars) return text;
  return `${codePoints.slice(0, maxChars - 1).join('')}…`;
}

/**
 * What separates two sentences in a model's answer.
 *
 * Group 1 is terminal punctuation together with any closing quote or bracket
 * that trails it, so `said "hi."` is not cut between the dot and the quote.
 * Group 3 is a line break, which model answers use as a sentence end far more
 * often than a full stop — they are list-heavy. Both sides of the quote read
 * the same pattern, so a break that starts a sentence also ends one.
 */
const SENTENCE_BREAK = String.raw`([.!?]["'”’»)\]]*)(\s+|$)|(\n+)`;

/**
 * Words whose full stop does not end a sentence. A short, fixed list on
 * purpose: a longer one starts guessing, and a wrong guess here only ever
 * shows a customer a quote that begins mid-clause.
 */
const ABBREVIATIONS: readonly string[] = [
  'dr',
  'mr',
  'mrs',
  'ms',
  'st',
  'no',
  'vs',
  'e.g',
  'i.e',
  'etc',
];

/** Whether the text ending at a candidate break ends with one of those words. */
function endsWithAbbreviation(textThroughBreak: string): boolean {
  const word = /([A-Za-z.]+)\.$/.exec(textThroughBreak)?.[1];
  return word !== undefined && ABBREVIATIONS.includes(word.toLowerCase());
}

/** A break is real unless the dot belongs to an abbreviation; a line break always is. */
function isSentenceBreak(text: string, match: RegExpExecArray): boolean {
  if (match[3] !== undefined) return true;
  return !endsWithAbbreviation(text.slice(0, match.index + (match[1]?.length ?? 0)));
}

/** Where the sentence containing `index` starts — after the last break before it. */
function sentenceStart(text: string, index: number): number {
  const pattern = new RegExp(SENTENCE_BREAK, 'g');
  let start = 0;
  let match = pattern.exec(text);
  while (match !== null && match.index < index) {
    const breakEnd = match.index + match[0].length;
    if (breakEnd > index) break;
    if (isSentenceBreak(text, match)) start = breakEnd;
    match = pattern.exec(text);
  }
  return start;
}

/** Where it ends — at the first real break from `index` on, punctuation included. */
function sentenceEnd(text: string, index: number): number {
  const pattern = new RegExp(SENTENCE_BREAK, 'g');
  pattern.lastIndex = index;
  let match = pattern.exec(text);
  while (match !== null) {
    if (isSentenceBreak(text, match)) {
      // A line break is not part of the sentence; terminal punctuation is.
      return match[3] === undefined ? match.index + (match[1]?.length ?? 0) : match.index;
    }
    match = pattern.exec(text);
  }
  return text.length;
}

/** The list marker a bullet line opens with — never part of the sentence quoted. */
const LEADING_LIST_MARKER = /^(?:[-*•‣]|\d+[.)])\s+/;

/** The sentence around `index` in `text` — bounded by the nearest sentence break. */
function sentenceAround(text: string, index: number): string {
  return text
    .slice(sentenceStart(text, index), sentenceEnd(text, index))
    .trim()
    .replace(LEADING_LIST_MARKER, '');
}

/**
 * The sentence containing the first brand mention in each answer that has
 * one — a quote, not a classification. Redacted through the same pipeline
 * `geo-evidence.ts` uses, so a mention context can never leak what an evidence
 * excerpt is not allowed to either.
 */
export function computeGeoMentionContexts(input: {
  readonly outcomes: readonly AiRequestOutcome[];
  readonly mentions: ReadonlyMap<string, GeoMentionSignals>;
  readonly brand: string;
  readonly redaction?: RedactionOptions;
}): ReadonlyMap<string, string> {
  const brand = input.brand.trim().toLowerCase();
  if (brand === '') return new Map();
  const contexts = new Map<string, string>();
  for (const outcome of input.outcomes) {
    if (outcome.kind !== 'response') continue;
    const signal = input.mentions.get(outcome.aiRequestKey);
    if (signal === undefined || signal.brand !== 'mentioned') continue;
    const rawText = outcome.response.rawText;
    const index = rawText.toLowerCase().indexOf(brand);
    if (index === -1) continue;
    const sentence = sentenceAround(rawText, index);
    if (sentence === '') continue;
    const bounded = boundedExcerpt(sentence, GEO_MENTION_CONTEXT_MAX_CHARS);
    contexts.set(outcome.aiRequestKey, redact(bounded, input.redaction).text);
  }
  return contexts;
}
