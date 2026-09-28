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

import type { GeoMentionSignals } from './geo-rules.js';
import { redact } from './redaction.js';
import type { RedactionOptions } from './redaction.js';
import type { AiRequestOutcome, AiResponseOutcome } from './run-request.js';
import { AI_PROVIDER_NAMES } from './types.js';
import type { AiProviderName } from './types.js';

/** A provider needs at least this many answered questions to earn a score. */
export const GEO_VISIBILITY_MIN_ANSWERED_FOR_SCORE = 3;
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
  readonly brandMentioned: number;
  readonly domainMentioned: number;
}

const EMPTY_PURPOSE_COUNTS: GeoPurposeVisibilityCounts = {
  asked: 0,
  answered: 0,
  brandMentioned: 0,
  domainMentioned: 0,
};

export interface GeoCitedInsteadEntry {
  readonly hostname: string;
  /** Number of distinct answers citing this hostname — never a raw citation count. */
  readonly answerCount: number;
}

export interface GeoProviderVisibilitySummary {
  readonly provider: AiProviderName;
  readonly questionsAsked: number;
  readonly questionsAnswered: number;
  readonly questionsUnavailable: number;
  readonly brandMentionedCount: number;
  /** Share of answered questions, 0..1. */
  readonly brandMentionedShare: number;
  readonly domainCitedCount: number;
  /** Share of answered questions, 0..1. */
  readonly domainCitedShare: number;
  /** 0..100, or null when fewer than GEO_VISIBILITY_MIN_ANSWERED_FOR_SCORE answers came back. */
  readonly visibilityScore: number | null;
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

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
}

function isOwnHostname(hostname: string, siteDomain: string): boolean {
  const host = normalizeHostname(hostname);
  const domain = normalizeHostname(siteDomain);
  return host === domain || host.endsWith(`.${domain}`);
}

function citationHostnames(response: AiResponseOutcome, siteDomain: string): readonly string[] {
  const hosts = response.response.citations.flatMap((citation): readonly string[] => {
    try {
      return [normalizeHostname(new URL(citation).hostname)];
    } catch {
      return [];
    }
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
  const brandMentioned = answered && signal !== undefined && signal.brand === 'mentioned';
  const domainMentioned = answered && signal !== undefined && signal.domain === 'mentioned';
  return {
    ...totals,
    [purpose]: {
      asked: current.asked + 1,
      answered: current.answered + (answered ? 1 : 0),
      brandMentioned: current.brandMentioned + (brandMentioned ? 1 : 0),
      domainMentioned: current.domainMentioned + (domainMentioned ? 1 : 0),
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
  let brandMentionedCount = 0;
  let domainCitedCount = 0;
  const responses: AiResponseOutcome[] = [];

  for (const outcome of outcomes) {
    const purpose = geoVisibilityPurposeOf(outcome.request.promptVersion);
    const isResponse = outcome.kind === 'response';
    const signal = isResponse ? mentions.get(outcome.aiRequestKey) : undefined;
    byPurpose = addToPurposeCounts(byPurpose, purpose, isResponse, signal);
    if (isResponse) {
      answered += 1;
      responses.push(outcome);
      if (signal !== undefined && signal.brand === 'mentioned') brandMentionedCount += 1;
      if (signal !== undefined && signal.domain === 'mentioned') domainCitedCount += 1;
    } else {
      unavailable += 1;
    }
  }

  const brandMentionedShare = answered === 0 ? 0 : round(brandMentionedCount / answered);
  const domainCitedShare = answered === 0 ? 0 : round(domainCitedCount / answered);
  const visibilityScore =
    answered < GEO_VISIBILITY_MIN_ANSWERED_FOR_SCORE
      ? null
      : Math.round(
          100 *
            (GEO_VISIBILITY_BRAND_WEIGHT * brandMentionedShare +
              GEO_VISIBILITY_DOMAIN_WEIGHT * domainCitedShare),
        );

  return {
    provider,
    questionsAsked: outcomes.length,
    questionsAnswered: answered,
    questionsUnavailable: unavailable,
    brandMentionedCount,
    brandMentionedShare,
    domainCitedCount,
    domainCitedShare,
    visibilityScore,
    byPurpose,
    citedInstead: citedInsteadFor(responses, mentions, siteDomain),
  };
}

/**
 * One summary row per provider that answered at least one question, in a
 * fixed order (AI_PROVIDER_NAMES) so the report never reorders on rerun.
 *
 * A provider with zero answers is left out entirely: a scan whose consent
 * never named Perplexity never asked it, and showing an empty card for a
 * provider that never ran would look like a check that came back "unavailable"
 * rather than one that never happened.
 */
export function computeGeoVisibilitySummaries(
  input: GeoVisibilitySummaryInput,
): readonly GeoProviderVisibilitySummary[] {
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

const SENTENCE_END = /[.!?](\s|$)/;

/** The sentence around `index` in `text` — bounded by the nearest sentence punctuation. */
function sentenceAround(text: string, index: number): string {
  const before = text.slice(0, index);
  const lastEnd = Math.max(
    before.lastIndexOf('. '),
    before.lastIndexOf('! '),
    before.lastIndexOf('? '),
    before.lastIndexOf('\n'),
  );
  const start = lastEnd === -1 ? 0 : lastEnd + 2;
  const after = text.slice(index);
  const relativeEnd = after.search(SENTENCE_END);
  const end = relativeEnd === -1 ? text.length : index + relativeEnd + 1;
  return text.slice(start, end).trim();
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
