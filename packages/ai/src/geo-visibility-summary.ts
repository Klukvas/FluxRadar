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
 * A signal needs at least this many *measured* answers to count toward a
 * score — brand and domain judged independently, never as a pair.
 *
 * Measured, not answered: an answer whose question already named the brand —
 * or whose profile has no brand but its hostname — says nothing about
 * visibility (geo-measurability.ts), and the report's own badge for it reads
 * "not measured". Counting such an answer in the denominator would turn a
 * non-measurement into a miss, which is exactly what the badges refuse to do.
 *
 * Set to the query generator's own floor of discovery questions
 * (`parseGeneratedQuestions` in geo.ts accepts 2 to 4): a threshold this scan
 * can never reach would make every real scan score-less, which is a report
 * defect, not a caution.
 */
export const GEO_VISIBILITY_MIN_MEASURED_FOR_SIGNAL = 2;
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

/**
 * Which signal(s) a score is built from.
 *
 * A score never requires both: a provider whose questions happened to name
 * the domain every time but never the brand can still earn `brand-only`. The
 * report names the basis so a partial score is never read as the full formula.
 */
export const GEO_SCORE_BASES = ['brand-and-domain', 'brand-only', 'domain-only'] as const;
export type GeoScoreBasis = (typeof GEO_SCORE_BASES)[number];

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
  /** 0..100; null unless at least one signal reached GEO_VISIBILITY_MIN_MEASURED_FOR_SIGNAL. */
  readonly visibilityScore: number | null;
  /** Set exactly when `visibilityScore` is null, so the report can say which it is. */
  readonly scoreUnavailableReason: GeoScoreUnavailableReason | null;
  /** Set exactly when `visibilityScore` is a number, so the report can say what it counts. */
  readonly scoreBasis: GeoScoreBasis | null;
  readonly byPurpose: Readonly<Record<GeoVisibilityPurpose, GeoPurposeVisibilityCounts>>;
  readonly citedInstead: readonly GeoCitedInsteadEntry[];
}

export interface GeoVisibilitySummaryInput {
  readonly outcomes: readonly AiRequestOutcome[];
  readonly mentions: ReadonlyMap<string, GeoMentionSignals>;
  /** Normalized site domain (lowercase), to exclude our own hostname from "cited instead". */
  readonly siteDomain: string;
  /** The profile's brand name — required for the same reason siteDomain is. */
  readonly brand: string;
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

const IPV4_OCTETS = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Loopback, private, and link-local IPv4 ranges — never a citable public source. */
function isNonPublicIpv4(hostname: string): boolean {
  const match = IPV4_OCTETS.exec(hostname);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/**
 * Whether a parsed hostname is plausibly a real, public citation host rather
 * than an artifact of forcing a bare word through `new URL('https://' + word)`
 * or an address that can never be a customer-facing source.
 *
 * `new URL('https://unknown').hostname` is `"unknown"` — a single label with
 * no dot is never an internet hostname, which also rules out every IPv6
 * literal (`new URL` renders those bracketed and dotless, e.g. `[::1]`).
 * `localhost` is a real hostname that is never a citation; loopback and
 * private/link-local IPv4 addresses are the same kind of non-citation, just
 * spelled as a number instead of a name.
 */
function isPlausibleHostname(hostname: string): boolean {
  if (hostname === '' || hostname === 'localhost' || !hostname.includes('.')) return false;
  return !isNonPublicIpv4(hostname);
}

/**
 * The host a citation points at, or null when it names none.
 *
 * Models cite scheme-less addresses (`acme.example/pricing`) often enough that
 * dropping them silently understated who got cited instead; such a string is
 * re-parsed against a default scheme rather than discarded. But the same
 * fallback turns free text models write instead of a source — `"unknown"`,
 * `"see above"`, `"Wikipedia"` — into fake single-label hostnames. An `@` in
 * a scheme-less candidate means it was never a bare host to begin with (an
 * email address, a handle); that check does not apply once a citation has
 * already parsed as an absolute URL, where `@` is ordinary userinfo syntax
 * (`user:pass@host`) or part of the path (`medium.com/@author`). Only
 * `http(s)` URLs are treated as citations — `ftp:`, `tel:`, `data:` and the
 * like are not sources a reader can click through to.
 */
function citationHostname(citation: string): string | null {
  const trimmed = citation.trim();
  if (trimmed === '') return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const hostname = normalizeHostname(url.hostname);
      if (isPlausibleHostname(hostname)) return hostname;
    }
  } catch {
    // Not an absolute URL — fall through to the scheme-less candidate.
  }
  if (trimmed.includes('@')) return null;
  try {
    const hostname = normalizeHostname(new URL(`https://${trimmed}`).hostname);
    if (isPlausibleHostname(hostname)) return hostname;
  } catch {
    // Not a URL under the default scheme either.
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

interface ProviderCounts {
  readonly byPurpose: Readonly<Record<GeoVisibilityPurpose, GeoPurposeVisibilityCounts>>;
  readonly answered: number;
  readonly unavailable: number;
  readonly brandMeasuredCount: number;
  readonly brandMentionedCount: number;
  readonly domainMeasuredCount: number;
  readonly domainCitedCount: number;
  readonly responses: readonly AiResponseOutcome[];
}

const EMPTY_PROVIDER_COUNTS: ProviderCounts = {
  byPurpose: {
    'closed-book': EMPTY_PURPOSE_COUNTS,
    awareness: EMPTY_PURPOSE_COUNTS,
    discovery: EMPTY_PURPOSE_COUNTS,
  },
  answered: 0,
  unavailable: 0,
  brandMeasuredCount: 0,
  brandMentionedCount: 0,
  domainMeasuredCount: 0,
  domainCitedCount: 0,
  responses: [],
};

/** Folds one outcome into a provider's running counts; see `summaryForProvider` for the rules. */
function addOutcomeToCounts(
  totals: ProviderCounts,
  outcome: AiRequestOutcome,
  mentions: ReadonlyMap<string, GeoMentionSignals>,
): ProviderCounts {
  const purpose = geoVisibilityPurposeOf(outcome.request.promptVersion);
  const isResponse = outcome.kind === 'response';
  const signal = isResponse ? mentions.get(outcome.aiRequestKey) : undefined;
  const byPurpose = addToPurposeCounts(totals.byPurpose, purpose, isResponse, signal);
  if (!isResponse) {
    return { ...totals, byPurpose, unavailable: totals.unavailable + 1 };
  }
  const answered = { ...totals, byPurpose, answered: totals.answered + 1 };
  const responses = [...totals.responses, outcome];
  // A closed-book answer's badge pair is never shown (GeoObservationCard
  // hides it for that purpose, replaced there by the claim evaluation) —
  // counting it here would make a denominator the reader cannot reconcile
  // with the cards below it.
  if (signal === undefined || purpose === 'closed-book') return { ...answered, responses };
  return {
    ...answered,
    responses,
    brandMeasuredCount: answered.brandMeasuredCount + (isMeasured(signal.brand) ? 1 : 0),
    domainMeasuredCount: answered.domainMeasuredCount + (isMeasured(signal.domain) ? 1 : 0),
    brandMentionedCount: answered.brandMentionedCount + (signal.brand === 'mentioned' ? 1 : 0),
    domainCitedCount: answered.domainCitedCount + (signal.domain === 'mentioned' ? 1 : 0),
  };
}

function summaryForProvider(
  provider: AiProviderName,
  outcomes: readonly AiRequestOutcome[],
  mentions: ReadonlyMap<string, GeoMentionSignals>,
  siteDomain: string,
): GeoProviderVisibilitySummary {
  const counts = outcomes.reduce<ProviderCounts>(
    (totals, outcome) => addOutcomeToCounts(totals, outcome, mentions),
    EMPTY_PROVIDER_COUNTS,
  );

  // Exact shares feed the score; the stored share is the same number rounded
  // for display. Scoring off the rounded value made the published formula
  // disagree with the published number (1 of 7 answers scored 8, not 9).
  const exactBrandShare =
    counts.brandMeasuredCount === 0 ? null : counts.brandMentionedCount / counts.brandMeasuredCount;
  const exactDomainShare =
    counts.domainMeasuredCount === 0 ? null : counts.domainCitedCount / counts.domainMeasuredCount;
  const basis = scoreBasisFor(counts.brandMeasuredCount, counts.domainMeasuredCount);

  return {
    provider,
    questionsAsked: outcomes.length,
    questionsAnswered: counts.answered,
    questionsUnavailable: counts.unavailable,
    brandMeasuredCount: counts.brandMeasuredCount,
    brandMentionedCount: counts.brandMentionedCount,
    brandMentionedShare: exactBrandShare === null ? null : round(exactBrandShare),
    domainMeasuredCount: counts.domainMeasuredCount,
    domainCitedCount: counts.domainCitedCount,
    domainCitedShare: exactDomainShare === null ? null : round(exactDomainShare),
    visibilityScore: scoreFor(basis, { brand: exactBrandShare, domain: exactDomainShare }),
    scoreUnavailableReason:
      basis === null
        ? scoreUnavailableReasonFor(counts.brandMeasuredCount, counts.domainMeasuredCount)
        : null,
    scoreBasis: basis,
    byPurpose: counts.byPurpose,
    citedInstead: citedInsteadFor(counts.responses, mentions, siteDomain),
  };
}

function reachedMinimum(measuredCount: number): boolean {
  return measuredCount >= GEO_VISIBILITY_MIN_MEASURED_FOR_SIGNAL;
}

/**
 * Which signal(s) a score can be built from, or null when neither reached the
 * minimum.
 *
 * A signal is scored on its own merits: a provider whose questions always
 * named the brand but never the domain can still earn `domain-only`, with its
 * weight renormalised to the whole score rather than losing the signal it did
 * measure to a partner that was never askable.
 */
function scoreBasisFor(
  brandMeasuredCount: number,
  domainMeasuredCount: number,
): GeoScoreBasis | null {
  const brandReady = reachedMinimum(brandMeasuredCount);
  const domainReady = reachedMinimum(domainMeasuredCount);
  if (brandReady && domainReady) return 'brand-and-domain';
  if (brandReady) return 'brand-only';
  if (domainReady) return 'domain-only';
  return null;
}

/** Why this provider earns no score — only reached when neither signal has a basis. */
function scoreUnavailableReasonFor(
  brandMeasuredCount: number,
  domainMeasuredCount: number,
): GeoScoreUnavailableReason {
  return brandMeasuredCount === 0 && domainMeasuredCount === 0
    ? 'not-measurable'
    : 'not-enough-measured';
}

function scoreFor(
  basis: GeoScoreBasis | null,
  shares: { readonly brand: number | null; readonly domain: number | null },
): number | null {
  if (basis === 'brand-and-domain') {
    if (shares.brand === null || shares.domain === null) return null;
    return Math.round(
      100 *
        (GEO_VISIBILITY_BRAND_WEIGHT * shares.brand + GEO_VISIBILITY_DOMAIN_WEIGHT * shares.domain),
    );
  }
  if (basis === 'brand-only') return shares.brand === null ? null : Math.round(100 * shares.brand);
  if (basis === 'domain-only') {
    return shares.domain === null ? null : Math.round(100 * shares.domain);
  }
  return null;
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
 * competitors. With no brand name, the brand signal cannot tell "not
 * mentioned" from "there was nothing to mention" — every answer would measure
 * as a miss and score a real profile 0/100 for a brand that does not exist.
 * Refusing either way is honest; a half-right summary is not.
 */
export function computeGeoVisibilitySummaries(
  input: GeoVisibilitySummaryInput,
): readonly GeoProviderVisibilitySummary[] {
  if (input.siteDomain.trim() === '' || input.brand.trim() === '') return [];
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
const ABBREVIATIONS: readonly string[] = ['dr', 'mr', 'mrs', 'ms', 'st', 'vs', 'e.g', 'i.e', 'etc'];

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
 *
 * Redaction runs before the char bound, not after: bounding first can cut a
 * placeholder's source in half — `johndoe@examplec…` — leaving a fragment no
 * redaction pattern recognises. Redacting the full sentence first replaces
 * the whole address with its placeholder before the bound is applied, so no
 * PII fragment can survive the cut; the bound can still land inside the
 * placeholder text itself (`[REDACTE…`), which is harmless since a
 * placeholder carries no PII to begin with.
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
    const redacted = redact(sentence, input.redaction).text;
    contexts.set(outcome.aiRequestKey, boundedExcerpt(redacted, GEO_MENTION_CONTEXT_MAX_CHARS));
  }
  return contexts;
}
