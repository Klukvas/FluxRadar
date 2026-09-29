// The profile form's competitors field (T7): one comma-separated text input,
// parsed and validated client-side with the exact same rules the API applies
// server-side (packages/contracts' `competitorsListProblem`) — this file is a
// UI-side mirror, not a second source of truth for what "valid" means, kept
// intentionally in lockstep with it and re-checked on the server regardless.

export const COMPETITORS_MAX = 5;
export const COMPETITOR_NAME_MIN_LENGTH = 2;
export const COMPETITOR_NAME_MAX_LENGTH = 64;

/** Splits the raw comma-separated field into trimmed, non-empty names. */
export function parseCompetitorsInput(raw: string): readonly string[] {
  return raw
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

export type CompetitorsInputError =
  | { readonly kind: 'too-many' }
  | { readonly kind: 'too-short'; readonly name: string }
  | { readonly kind: 'too-long'; readonly name: string }
  | { readonly kind: 'duplicate'; readonly name: string }
  | { readonly kind: 'own-brand'; readonly name: string };

/**
 * A competitor name folded for comparison against the profile's own name:
 * trimmed, NFC-normalised, lower-cased.
 */
function normalizeCompetitorName(value: string): string {
  return value.trim().normalize('NFC').toLowerCase();
}

/**
 * A competitor entry or the address field, folded to the bare hostname it
 * would name if read as an address — mirrors `normalizeDomainForComparison`
 * in `@fluxradar/contracts`' `competitorsListProblem` exactly, so this field
 * never disagrees with the server about which competitor collides with the
 * site's own domain (T7-fix F2).
 */
function normalizeDomainForComparison(value: string): string {
  const trimmed = value.trim().normalize('NFC').toLowerCase();
  if (trimmed === '') return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./, '');
  } catch {
    return trimmed.replace(/^www\./, '').replace(/\/+$/, '');
  }
}

/**
 * The first problem with the parsed list, or null. Checked in the same order
 * a reader fixing the field would hit each one: count, then each name's
 * length, then repeats.
 */
export function competitorsError(
  competitors: readonly string[],
  brand: string,
  domain: string,
): CompetitorsInputError | null {
  if (competitors.length > COMPETITORS_MAX) return { kind: 'too-many' };
  for (const name of competitors) {
    if (name.length < COMPETITOR_NAME_MIN_LENGTH) return { kind: 'too-short', name };
    if (name.length > COMPETITOR_NAME_MAX_LENGTH) return { kind: 'too-long', name };
  }
  const normalizedBrand = normalizeCompetitorName(brand);
  const normalizedDomain = normalizeDomainForComparison(domain);
  const seen = new Set<string>();
  for (const name of competitors) {
    const normalized = normalizeCompetitorName(name);
    if (
      normalized === normalizedBrand ||
      (normalizedDomain !== '' && normalizeDomainForComparison(name) === normalizedDomain)
    ) {
      return { kind: 'own-brand', name };
    }
    if (seen.has(normalized)) return { kind: 'duplicate', name };
    seen.add(normalized);
  }
  return null;
}
