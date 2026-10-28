// Pure helpers behind the report's drawing vocabulary (document.ts): colour
// contrast for the agency accent, and the severity marks every chart and card
// shares. Nothing here touches PDFKit, so each rule can be tested on its own.

import { contrastRatio } from '../../branding/schema.ts';

/** The WCAG contrast the agency accent needs against white to carry structure. */
const STRUCTURE_MIN_CONTRAST = 3;

/** How many of the four severity pips are filled; greyscale-safe by count. */
export const SEVERITY_LEVEL: Readonly<Record<string, number>> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

/** The palette key each scored severity is drawn in. */
export const SEVERITY_COLOUR = {
  Critical: 'critical',
  High: 'high',
  Medium: 'medium',
  Low: 'low',
} as const;

export type ScoredSeverity = keyof typeof SEVERITY_COLOUR;

export const SCORED_SEVERITIES: readonly ScoredSeverity[] = ['Critical', 'High', 'Medium', 'Low'];

export function isScoredSeverity(value: string): value is ScoredSeverity {
  return (SCORED_SEVERITIES as readonly string[]).includes(value);
}

/**
 * The colour bars, the ring and the numbered circles are drawn in.
 *
 * An agency accent too pale to read against white (a pastel yellow, say) would
 * make a score bar look empty, so those marks fall back to the text colour and
 * the accent keeps only the thin cover rule and the heading bars.
 */
export function structureColour(brand: string, fallback: string): string {
  // The upload schema's own measure; a value it cannot read measures NaN and
  // falls back like a pale one.
  return contrastRatio(brand) >= STRUCTURE_MIN_CONTRAST ? brand : fallback;
}
