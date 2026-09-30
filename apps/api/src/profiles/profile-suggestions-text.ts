// One place decides what "a bounded piece of someone else's page" means.
//
// Every value profile autofill proposes passes through here: collapsed to single
// spaces, trimmed, dropped when empty, and cut to the caller's ceiling. The cut
// is per value, not only per response, so one enormous heading cannot fill the
// whole proposal.

export function boundedText(
  value: string | null | undefined,
  maxChars: number,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized === '' ? undefined : normalized.slice(0, maxChars);
}

/** The same values, in first-seen order, compared without regard to case. */
export function uniqueText(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
