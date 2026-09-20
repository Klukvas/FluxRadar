import { SEVERITIES, type Severity } from './enums.js';

// Score penalty weights per §15: Critical −25, High −10, Medium −3, Low −1.
export const SEVERITY_WEIGHTS: Readonly<Record<Severity, number>> = {
  Critical: 25,
  High: 10,
  Medium: 3,
  Low: 1,
};

/**
 * Urgency order of a severity: 0 for Critical up to 3 for Low, and one past Low
 * for anything that is not a known severity.
 *
 * Severity is stored as text, and text sorts alphabetically — Critical, High,
 * Low, Medium — which put Low findings above Medium ones in the Issue Center
 * right under a legend promising the opposite. Every list that orders findings
 * by urgency sorts by this number instead.
 */
export function severityRank(severity: string | null): number {
  const index = SEVERITIES.indexOf(severity as Severity);
  return index === -1 ? SEVERITIES.length : index;
}
