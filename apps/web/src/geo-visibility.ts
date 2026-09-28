// Per-engine visibility summary (T6): defensive shape check on
// `Dashboard.geoVisibilitySummary`, the same way every other API payload here
// is re-validated rather than trusted from its TypeScript type alone. The
// server already validates the stored shape (packages/contracts' zod schema)
// before it ever reaches this response; this is the second, independent read
// that keeps a malformed or unexpected payload from throwing mid-render.

import {
  GEO_SCORE_UNAVAILABLE_REASONS,
  GEO_VISIBILITY_PURPOSES,
  type GeoCitedInsteadEntry,
  type GeoProviderVisibility,
  type GeoPurposeVisibilityCounts,
  type GeoScoreUnavailableReason,
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
  const byPurpose = byPurposeOf(record.byPurpose);
  const citedInstead = citedInsteadOf(record.citedInstead);
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
    byPurpose === null ||
    citedInstead === null
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
    byPurpose,
    citedInstead,
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
