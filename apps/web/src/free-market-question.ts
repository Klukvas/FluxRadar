// The market question a Free report shows as an example of what Basic asks.
//
// A paid check generates its market questions with an AI model from the
// profile's offerings, industry and region (apps/api orchestrator/geo.ts). A
// Free report asks no such question, but it can show the reader the kind of
// thing their customers type, built from the same profile fields as this
// scan saw them — no AI call, and nothing the paid check would not use.
//
// It is labelled as an example on screen: the paid check writes its own.

import type { GeoEvidence } from './api';

/** The labels the API gives the owner's profile fields (packages/ai geo-evidence). */
export const PROFILE_EVIDENCE_LABELS = {
  brand: 'Brand name',
  offerings: 'Services or products',
  industry: 'Industry or site type',
  region: 'Operating region',
} as const;

/** Longer than this, a first item is a sentence rather than a search phrase. */
const MAX_PHRASE_LENGTH = 60;

/** A saved profile field from this scan's evidence, or null when blank or absent. */
export function profileEvidenceValue(evidence: GeoEvidence | null, label: string): string | null {
  const source = evidence?.sources.find(
    (entry) => entry.kind === 'profile' && entry.label === label,
  );
  const value = source?.excerpt.trim() ?? '';
  return value === '' ? null : value;
}

/** The first item of a list the owner typed ("implants, cleanings" → "implants"). */
function firstPhrase(text: string | null): string | null {
  if (text === null) return null;
  const [first = ''] = text.split(/[,;·|\n]/);
  const phrase = first.replace(/[.…]+$/, '').trim();
  return phrase === '' || phrase.length > MAX_PHRASE_LENGTH ? null : phrase;
}

/**
 * "Dental implants, Kyiv" — the first service (or the industry when no service
 * was saved) and the first place — or null when the profile names neither a
 * service nor an industry, which is also when a paid check asks no market
 * question at all.
 */
export function marketQuestionExample(evidence: GeoEvidence | null): string | null {
  const topic =
    firstPhrase(profileEvidenceValue(evidence, PROFILE_EVIDENCE_LABELS.offerings)) ??
    firstPhrase(profileEvidenceValue(evidence, PROFILE_EVIDENCE_LABELS.industry));
  if (topic === null) return null;
  const region = firstPhrase(profileEvidenceValue(evidence, PROFILE_EVIDENCE_LABELS.region));
  return region === null ? topic : `${topic}, ${region}`;
}
