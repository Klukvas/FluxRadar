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
  const normalizedBrand = brand.trim().toLowerCase();
  const normalizedDomain = domain.trim().toLowerCase();
  const seen = new Set<string>();
  for (const name of competitors) {
    const normalized = name.toLowerCase();
    if (normalized === normalizedBrand || normalized === normalizedDomain) {
      return { kind: 'own-brand', name };
    }
    if (seen.has(normalized)) return { kind: 'duplicate', name };
    seen.add(normalized);
  }
  return null;
}
