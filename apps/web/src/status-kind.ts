// Which of the design system's five status colours a machine status wears.
//
// Every status the API sends — a scan status, a module status, a severity, a
// score verdict — is matched here and nowhere else. It was inlined in
// `StatusChip`, which was fine while a chip was the only thing that coloured
// itself by status; the reports list now draws a status accent on the card
// itself, and two copies of this ladder would be two places to disagree about
// what "Partial" means.
//
// The English keywords are the API's own vocabulary, never the owner's: a
// translated label changes what is read, never what the colour means.
// The palette each kind maps to lives in styles/base.css, on the
// `status-chip--<kind>` classes the components build from these values.

export type StatusKind = 'ok' | 'high' | 'warning' | 'error' | 'info' | 'neutral';

/**
 * The colour family for one status string.
 *
 * Order is the meaning: `Failed` is an error before it is anything else, and a
 * severity of `High` is its own step between error and warning.
 */
export function statusKind(status: string): StatusKind {
  if (/failed|critical|error/i.test(status)) return 'error';
  if (/high/i.test(status)) return 'high';
  if (/partial|warning|medium|provisional/i.test(status)) return 'warning';
  if (/completed|pass|ok|low/i.test(status)) return 'ok';
  if (/running|queued|info/i.test(status)) return 'info';
  return 'neutral';
}
