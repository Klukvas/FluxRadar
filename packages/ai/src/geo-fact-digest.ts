// What AI answers say about the business, summed up across every answer and
// every provider: where an answer differs from the site, and in what tone the
// answers describe the business.
//
// The per-answer evaluation already marks each statement an answer made as
// matched, contradicted or unverified against the scan's own evidence — but only
// inside the card of that one answer. The owner's question is the reverse one:
// "what do AI assistants get wrong about us, and where on my site is the right
// version?" This file answers it from the validated claims alone, without a new
// request: contradicted claims grouped by the page or profile field they were
// checked against, repeated statements folded together, each with the providers
// that made it and the two quotes that show the difference.
//
// The site is the source of truth here only because it is the evidence we have.
// It can be the outdated side, so nothing below says that an answer is wrong —
// only that it differs from what the site says.

import type {
  GeoAnswerEvaluation,
  GeoEvaluatedClaim,
  GeoEvaluationPayload,
} from './geo-evaluation.js';
import { evidenceSourceById, geoEvidenceSourceKey } from './geo-evidence.js';
import type { GeoEvidenceSnapshot } from './geo-evidence.js';
import { GEO_TONE_LABELS } from './geo-tone.js';
import type { GeoToneLabel } from './geo-tone.js';
import type { AiRequestOutcome, AiResponseOutcome } from './run-request.js';
import { AI_PROVIDER_NAMES } from './types.js';
import type { AiProviderName } from './types.js';

/** Where on the site the right version lives: a crawled page, or a field of the profile. */
export interface GeoFactSource {
  /** Stable across scans (`geoEvidenceSourceKey`) — the GEO-VIS-009 fingerprint parameter. */
  readonly key: string;
  readonly kind: 'page' | 'profile';
  readonly label: string;
  /** The page address; null for a profile field. */
  readonly url: string | null;
}

/** One statement, however many answers made it. */
export interface GeoFactDifference {
  readonly claim: string;
  /** Providers whose answers made it, in the fixed provider order. */
  readonly providers: readonly AiProviderName[];
  /** The first answer's words, verified to occur in that answer. */
  readonly answerQuote: string;
  /** What the site says instead, verified to occur in the source's excerpt. */
  readonly sourceQuote: string;
}

export interface GeoFactGroup {
  readonly source: GeoFactSource;
  readonly differences: readonly GeoFactDifference[];
}

export interface GeoFactDigest {
  /** Answers whose evaluation completed — what "differs in N places" is out of. */
  readonly answersChecked: number;
  /** Distinct statements across all groups. */
  readonly differenceCount: number;
  readonly groups: readonly GeoFactGroup[];
}

export interface GeoAnswerDigestInput {
  readonly outcomes: readonly AiRequestOutcome[];
  readonly answerEvaluations: ReadonlyMap<string, GeoAnswerEvaluation>;
  /** The snapshot the evaluators read; null when no evaluation ran. */
  readonly evidence: GeoEvidenceSnapshot | null;
}

/** The report languages the advice below is written in. */
export type GeoFactAdviceLanguage = 'en' | 'uk';

/**
 * What to do about a difference, by where the site states the fact.
 *
 * The one source of these words: a GEO-VIS-009 finding carries the English
 * one, the Action Plan row sends the one in the plan's language, and the
 * report shows the same sentences — `apps/web/src/geo-digest-copy.ts` mirrors
 * them (the web bundle has no workspace dependencies) and an API parity test
 * fails when the two drift.
 */
export const GEO_FACT_ADVICE: Readonly<
  Record<GeoFactSource['kind'], Readonly<Record<GeoFactAdviceLanguage, string>>>
> = {
  page: {
    en: 'Make the correct fact explicit on this page, in plain words an assistant can quote. If the page itself is out of date, update it first.',
    uk: 'Напишіть правильний факт на цій сторінці явно, простими словами, які асистент може процитувати. Якщо застаріла сама сторінка, спершу оновіть її.',
  },
  profile: {
    en: 'This was checked against a field of your site profile. If the field is out of date, correct it; if it is right, state the same fact plainly on your site.',
    uk: 'Це звірено з полем профілю вашого сайту. Якщо поле застаріло, виправте його; якщо воно правильне, напишіть той самий факт на сайті.',
  },
};

function responses(input: GeoAnswerDigestInput): readonly AiResponseOutcome[] {
  return input.outcomes.filter(
    (outcome): outcome is AiResponseOutcome => outcome.kind === 'response',
  );
}

function completedPayload(input: GeoAnswerDigestInput, key: string): GeoEvaluationPayload | null {
  const evaluation = input.answerEvaluations.get(key);
  return evaluation?.status === 'Completed' ? evaluation.payload : null;
}

/** The same statement in different spelling — case, spacing, a final full stop. */
function statementKey(claim: string): string {
  return claim
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.!…;,]+$/u, '')
    .trim();
}

interface GroupDraft {
  readonly source: GeoFactSource;
  readonly differences: ReadonlyMap<string, GeoFactDifference>;
}

function withProvider(difference: GeoFactDifference, provider: AiProviderName): GeoFactDifference {
  if (difference.providers.includes(provider)) return difference;
  const providers = AI_PROVIDER_NAMES.filter(
    (name) => name === provider || difference.providers.includes(name),
  );
  return { ...difference, providers };
}

function addClaim(
  groups: ReadonlyMap<string, GroupDraft>,
  claim: GeoEvaluatedClaim,
  provider: AiProviderName,
  evidence: GeoEvidenceSnapshot,
): ReadonlyMap<string, GroupDraft> {
  const source = claim.sourceId === null ? null : evidenceSourceById(evidence, claim.sourceId);
  if (source === null || claim.sourceQuote === null) return groups;
  const key = geoEvidenceSourceKey(source);
  const group: GroupDraft = groups.get(key) ?? {
    source: {
      key,
      kind: source.kind === 'profile' ? 'profile' : 'page',
      label: source.label,
      url: source.url,
    },
    differences: new Map(),
  };
  const statement = statementKey(claim.claim);
  const existing = group.differences.get(statement);
  const difference =
    existing === undefined
      ? {
          claim: claim.claim,
          providers: [provider],
          answerQuote: claim.answerQuote,
          sourceQuote: claim.sourceQuote,
        }
      : withProvider(existing, provider);
  return new Map([
    ...groups,
    [key, { ...group, differences: new Map([...group.differences, [statement, difference]]) }],
  ]);
}

function byWeight(left: GeoFactGroup, right: GeoFactGroup): number {
  return (
    right.differences.length - left.differences.length ||
    left.source.key.localeCompare(right.source.key)
  );
}

/**
 * Every contradicted statement across all answers, grouped by the page or
 * profile field it was checked against.
 *
 * Only `contradicted` claims count: an unverified claim is one the evidence is
 * silent about, and silence is not a difference. A claim whose cited source is
 * not in the snapshot is left out — there would be nothing to show beside it.
 */
export function computeGeoFactDigest(input: GeoAnswerDigestInput): GeoFactDigest {
  const answers = responses(input);
  const checked = answers.filter(
    (outcome) => completedPayload(input, outcome.aiRequestKey) !== null,
  );
  const evidence = input.evidence;
  const drafts =
    evidence === null
      ? new Map<string, GroupDraft>()
      : checked.reduce<ReadonlyMap<string, GroupDraft>>((groups, outcome) => {
          const claims = completedPayload(input, outcome.aiRequestKey)?.claims ?? [];
          return claims
            .filter((claim) => claim.verdict === 'contradicted')
            .reduce(
              (current, claim) => addClaim(current, claim, outcome.request.provider, evidence),
              groups,
            );
        }, new Map());
  const groups = [...drafts.values()]
    .map((draft) => ({
      source: draft.source,
      differences: [...draft.differences.values()].sort(
        (left, right) => right.providers.length - left.providers.length,
      ),
    }))
    .sort(byWeight);
  return {
    answersChecked: checked.length,
    differenceCount: groups.reduce((sum, group) => sum + group.differences.length, 0),
    groups,
  };
}

/** How one provider's answers describe the business. */
export interface GeoProviderTone {
  readonly provider: AiProviderName;
  /** Answers this provider gave. */
  readonly answers: number;
  readonly counts: Readonly<Record<GeoToneLabel, number>>;
  /** Judged, and the answer did not describe the business. */
  readonly noDescription: number;
  /**
   * Judged, but the tone the evaluator offered did not survive validation — a
   * quote that is not in the answer, an unknown label, or no tone beside a
   * description. Nothing is shown for it, and it is not "not evaluated".
   */
  readonly unconfirmed: number;
  /** Not judged: no evaluation, an unavailable one, or one under a notice without tone. */
  readonly notEvaluated: number;
}

export interface GeoNegativeTone {
  readonly provider: AiProviderName;
  readonly question: string;
  /** Verified to occur in the answer. */
  readonly quote: string;
}

export interface GeoToneDigest {
  /** False when no answer of this scan was judged for tone — the report says so instead of "neutral". */
  readonly judged: boolean;
  readonly providers: readonly GeoProviderTone[];
  readonly negativeQuotes: readonly GeoNegativeTone[];
}

const ZERO_COUNTS: Readonly<Record<GeoToneLabel, number>> = Object.fromEntries(
  GEO_TONE_LABELS.map((label) => [label, 0]),
) as Record<GeoToneLabel, number>;

function providerTone(
  provider: AiProviderName,
  answers: readonly AiResponseOutcome[],
  input: GeoAnswerDigestInput,
): GeoProviderTone {
  const own = answers.filter((outcome) => outcome.request.provider === provider);
  return own.reduce<GeoProviderTone>(
    (summary, outcome) => {
      const tone = completedPayload(input, outcome.aiRequestKey)?.tone;
      if (tone === undefined || !tone.judged) {
        return { ...summary, notEvaluated: summary.notEvaluated + 1 };
      }
      if (tone.tone === null && tone.adjusted) {
        return { ...summary, unconfirmed: summary.unconfirmed + 1 };
      }
      if (tone.tone === null) return { ...summary, noDescription: summary.noDescription + 1 };
      const label = tone.tone.label;
      return { ...summary, counts: { ...summary.counts, [label]: summary.counts[label] + 1 } };
    },
    {
      provider,
      answers: own.length,
      counts: ZERO_COUNTS,
      noDescription: 0,
      unconfirmed: 0,
      notEvaluated: 0,
    },
  );
}

/**
 * Tone per provider, and the quotes of every answer judged negative.
 *
 * The provider is the one that gave the answer — the evaluator is always
 * Anthropic, and attributing the tone to it would say nothing about how the
 * other assistants describe the business.
 */
export function computeGeoToneDigest(input: GeoAnswerDigestInput): GeoToneDigest {
  const answers = responses(input);
  const providers = AI_PROVIDER_NAMES.map((provider) =>
    providerTone(provider, answers, input),
  ).filter((summary) => summary.answers > 0);
  const negativeQuotes = answers.flatMap((outcome): GeoNegativeTone[] => {
    const tone = completedPayload(input, outcome.aiRequestKey)?.tone;
    if (tone === undefined || !tone.judged || tone.tone?.label !== 'negative') return [];
    return [
      {
        provider: outcome.request.provider,
        question: outcome.request.question,
        quote: tone.tone.quote,
      },
    ];
  });
  return {
    // Judged when any answer was asked about tone — even if every tone it
    // offered was then refused: that is "not confirmed", not "not evaluated".
    judged: answers.some(
      (outcome) => completedPayload(input, outcome.aiRequestKey)?.tone.judged === true,
    ),
    providers,
    negativeQuotes,
  };
}
