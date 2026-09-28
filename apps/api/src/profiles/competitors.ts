// SiteProfile.competitorsJson (T7): up to 5 competitor brand names, stored as
// a JSON array of strings. Parsed in one place so the routes' read path and
// the orchestrator's read-at-scan-time path can never disagree about what a
// malformed or absent value means.

/**
 * Parses `SiteProfile.competitorsJson` back into a name list, or null.
 *
 * Null both for a profile with no competitors configured and for a stored
 * value that no longer parses as a non-empty string array — the same
 * "unreadable data degrades to absent, never to a thrown error" rule the
 * profile's scan-config JSON follows.
 */
export function competitorsFromJson(value: string | null): readonly string[] | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
      return null;
    }
    return parsed.length === 0 ? null : parsed;
  } catch {
    return null;
  }
}
