import type { Severity } from './enums.js';

// Score penalty weights per §15: Critical −25, High −10, Medium −3, Low −1.
export const SEVERITY_WEIGHTS: Readonly<Record<Severity, number>> = {
  Critical: 25,
  High: 10,
  Medium: 3,
  Low: 1,
};
