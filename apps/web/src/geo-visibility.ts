// Per-engine visibility summary (T6): defensive shape check on
// `Dashboard.geoVisibilitySummary`, the same way every other API payload here
// is re-validated rather than trusted from its TypeScript type alone. The
// server already validates the stored shape (packages/contracts' zod schema)
// before it ever reaches this response; this is the second, independent read
// that keeps a malformed or unexpected payload from throwing mid-render.

import {
  GEO_SCORE_BASES,
  GEO_SCORE_UNAVAILABLE_REASONS,
  GEO_VISIBILITY_PURPOSES,
  type GeoCitedInsteadEntry,
  type GeoCompetitorVisibility,
  type GeoProviderVisibility,
  type GeoPurposeVisibilityCounts,
  type GeoScoreBasis,
  type GeoScoreUnavailableReason,
  type GeoShareOfVoice,
  type GeoVisibilityPurpose,
  type GeoVisibilitySummary,
} from './api';
import { asRecord, numberValue } from './module-metadata';

/** null is a valid share (nothing was measurable); undefined marks a failed check. */
function shareValue(value: unknown): number | null | undefined {
  if (value === null) return null;
  const number = numberValue(value);
  return number !== null && number >= 0 && number <= 1 ? number : undefined;
}

/** null is a valid reason (the provider has a score); undefined marks a failed check. */
function scoreReasonValue(value: unknown): GeoScoreUnavailableReason | null | undefined {
  if (value === null) return null;
  const known = GEO_SCORE_UNAVAILABLE_REASONS.find((reason) => reason === value);
  return known ?? undefined;
}

/** null is a valid basis (the provider has no score); undefined marks a failed check. */
function scoreBasisValue(value: unknown): GeoScoreBasis | null | undefined {
  if (value === null) return null;
  const known = GEO_SCORE_BASES.find((basis) => basis === value);
  return known ?? undefined;
}

/** null is a valid score (none earned); undefined marks a value that failed the check. */
function scoreValue(value: unknown): number | null | undefined {
  if (value === null) return null;
  const number = numberValue(value);
  return number !== null && number >= 0 && number <= 100 ? number : undefined;
}

function purposeCountsOf(value: unknown): GeoPurposeVisibilityCounts | null {
  const record = asRecord(value);
  const asked = numberValue(record?.asked);
  const answered = numberValue(record?.answered);
  const brandMeasured = numberValue(record?.brandMeasured);
  const domainMeasured = numberValue(record?.domainMeasured);
  const brandMentioned = numberValue(record?.brandMentioned);
  const domainMentioned = numberValue(record?.domainMentioned);
  if (
    asked === null ||
    answered === null ||
    brandMeasured === null ||
    domainMeasured === null ||
    brandMentioned === null ||
    domainMentioned === null
  ) {
    return null;
  }
  return { asked, answered, brandMeasured, domainMeasured, brandMentioned, domainMentioned };
}

function byPurposeOf(
  value: unknown,
): Readonly<Record<GeoVisibilityPurpose, GeoPurposeVisibilityCounts>> | null {
  const record = asRecord(value);
  if (record === null) return null;
  const entries: Array<[GeoVisibilityPurpose, GeoPurposeVisibilityCounts]> = [];
  for (const purpose of GEO_VISIBILITY_PURPOSES) {
    const counts = purposeCountsOf(record[purpose]);
    if (counts === null) return null;
    entries.push([purpose, counts]);
  }
  return Object.fromEntries(entries) as Record<GeoVisibilityPurpose, GeoPurposeVisibilityCounts>;
}

function citedInsteadOf(value: unknown): readonly GeoCitedInsteadEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: GeoCitedInsteadEntry[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const answerCount = numberValue(record?.answerCount);
    if (record === null || typeof record.hostname !== 'string' || answerCount === null) {
      return null;
    }
    entries.push({ hostname: record.hostname, answerCount });
  }
  return entries;
}

function competitorVisibilityOf(value: unknown): GeoCompetitorVisibility | null {
  const record = asRecord(value);
  if (record === null || typeof record.name !== 'string') return null;
  const mentionedCount = numberValue(record.mentionedCount);
  const share = shareValue(record.share);
  if (mentionedCount === null || share === undefined) return null;
  return { name: record.name, mentionedCount, share };
}

/**
 * Share of voice (T7), or `null` — absent from an older stored record, absent
 * because no competitors were configured for that scan, or malformed.
 * `undefined` is never returned: a `shareOfVoice` field that is present but
 * fails its own shape check fails the whole provider, the same as any other
 * field here (`providerVisibilityOf` below), so a caller only ever sees the
 * field present-and-valid or the provider not rendered at all.
 */
function shareOfVoiceOf(value: unknown): GeoShareOfVoice | null | undefined {
  if (value === undefined || value === null) return null;
  const record = asRecord(value);
  if (record === null) return undefined;
  const denominator = numberValue(record.denominator);
  const brandMentionsInScope = numberValue(record.brandMentionsInScope);
  const brandShare = shareValue(record.brandShare);
  if (
    denominator === null ||
    brandMentionsInScope === null ||
    brandShare === undefined ||
    !Array.isArray(record.competitors)
  ) {
    return undefined;
  }
  const competitors: GeoCompetitorVisibility[] = [];
  for (const entry of record.competitors) {
    const competitor = competitorVisibilityOf(entry);
    if (competitor === null) return undefined;
    competitors.push(competitor);
  }
  return { denominator, brandMentionsInScope, brandShare, competitors };
}

function providerVisibilityOf(value: unknown): GeoProviderVisibility | null {
  const record = asRecord(value);
  if (record === null || typeof record.provider !== 'string' || typeof record.label !== 'string') {
    return null;
  }
  const questionsAsked = numberValue(record.questionsAsked);
  const questionsAnswered = numberValue(record.questionsAnswered);
  const questionsUnavailable = numberValue(record.questionsUnavailable);
  const brandMeasuredCount = numberValue(record.brandMeasuredCount);
  const brandMentionedCount = numberValue(record.brandMentionedCount);
  const brandMentionedShare = shareValue(record.brandMentionedShare);
  const domainMeasuredCount = numberValue(record.domainMeasuredCount);
  const domainCitedCount = numberValue(record.domainCitedCount);
  const domainCitedShare = shareValue(record.domainCitedShare);
  const visibilityScore = scoreValue(record.visibilityScore);
  const scoreUnavailableReason = scoreReasonValue(record.scoreUnavailableReason);
  const scoreBasis = scoreBasisValue(record.scoreBasis);
  const byPurpose = byPurposeOf(record.byPurpose);
  const citedInstead = citedInsteadOf(record.citedInstead);
  const shareOfVoice = shareOfVoiceOf(record.shareOfVoice);
  if (
    questionsAsked === null ||
    questionsAnswered === null ||
    questionsUnavailable === null ||
    brandMeasuredCount === null ||
    brandMentionedCount === null ||
    brandMentionedShare === undefined ||
    domainMeasuredCount === null ||
    domainCitedCount === null ||
    domainCitedShare === undefined ||
    visibilityScore === undefined ||
    scoreUnavailableReason === undefined ||
    scoreBasis === undefined ||
    // A score and its "why not" are mutually exclusive, and a basis exists
    // exactly when a score does — a record that disagrees with itself is
    // treated as malformed rather than rendered half-right.
    (visibilityScore === null) !== (scoreUnavailableReason !== null) ||
    (visibilityScore === null) !== (scoreBasis === null) ||
    byPurpose === null ||
    citedInstead === null ||
    shareOfVoice === undefined
  ) {
    return null;
  }
  return {
    provider: record.provider,
    label: record.label,
    questionsAsked,
    questionsAnswered,
    questionsUnavailable,
    brandMeasuredCount,
    brandMentionedCount,
    brandMentionedShare,
    domainMeasuredCount,
    domainCitedCount,
    domainCitedShare,
    visibilityScore,
    scoreUnavailableReason,
    scoreBasis,
    byPurpose,
    citedInstead,
    shareOfVoice,
  };
}

/**
 * Validates a `Dashboard.geoVisibilitySummary` value before it is rendered.
 *
 * Null for anything that does not fully match the shape — including an
 * `undefined`/`null` field on an older response, and a stored record that
 * became unreadable for any reason. Either way the report shows the same
 * honest "not available for this scan" sentence, never a partially-rendered
 * card built from data that failed its own check.
 */
export function geoVisibilitySummaryOf(value: unknown): GeoVisibilitySummary | null {
  const record = asRecord(value);
  if (record === null) return null;
  const minMeasuredForScore = numberValue(record.minMeasuredForScore);
  const weightBrand = numberValue(record.weightBrand);
  const weightDomain = numberValue(record.weightDomain);
  if (
    minMeasuredForScore === null ||
    weightBrand === null ||
    weightDomain === null ||
    !Array.isArray(record.providers)
  ) {
    return null;
  }
  const providers: GeoProviderVisibility[] = [];
  for (const entry of record.providers) {
    const provider = providerVisibilityOf(entry);
    if (provider === null) return null;
    providers.push(provider);
  }
  return { minMeasuredForScore, weightBrand, weightDomain, providers };
}
