// The boundaries every Performance verdict is taken against, in one place, with
// the source of each one written down.
//
// Core Web Vitals boundaries are Google's published ones (web.dev/vitals): a
// value at or below `good` is good, at or below `poor` is "needs improvement",
// above it is poor. TTFB uses the same three-band shape from the same source.
//
// Total Blocking Time has NO published field boundary, because it is not a field
// metric at all. The numbers here are Lighthouse's own lab scoring curve control
// points, and they are used to describe a lab run — never to stand in for INP.
//
// The byte and request numbers are FluxRadar's own budget, not anyone's
// standard. They are stated as a budget in the finding text so a reader knows it
// is a choice, and they are deliberately generous: a budget that fires on most
// sites teaches its reader to ignore it.

export interface MetricThresholds {
  readonly good: number;
  readonly poor: number;
}

/** web.dev/vitals — Largest Contentful Paint, milliseconds. */
export const LCP_THRESHOLDS: MetricThresholds = { good: 2_500, poor: 4_000 };
/** web.dev/vitals — Interaction to Next Paint, milliseconds. Field only. */
export const INP_THRESHOLDS: MetricThresholds = { good: 200, poor: 500 };
/** web.dev/vitals — Cumulative Layout Shift, unitless. */
export const CLS_THRESHOLDS: MetricThresholds = { good: 0.1, poor: 0.25 };
/** web.dev/vitals — Time to First Byte, milliseconds. */
export const TTFB_THRESHOLDS: MetricThresholds = { good: 800, poor: 1_800 };
/** Lighthouse lab scoring — Total Blocking Time, milliseconds. NOT INP. */
export const TBT_THRESHOLDS: MetricThresholds = { good: 200, poor: 600 };

/** FluxRadar page-weight budget, bytes transferred for one page load. */
export const PAGE_WEIGHT_BUDGET_BYTES = 2_000_000;
/** FluxRadar request budget, requests for one page load. */
export const REQUEST_COUNT_BUDGET = 80;
/** Below this, a savings opportunity is not worth an owner's afternoon. */
export const MIN_REPORTABLE_SAVINGS_BYTES = 150_000;
/** Below this, a render-blocking saving is inside measurement noise. */
export const MIN_REPORTABLE_BLOCKING_MS = 300;

/**
 * Spread this wide across repeated runs means the median is not describing a
 * stable page, and every verdict taken from it is reported as provisional.
 */
export const INSTABILITY_WARNING_RATIO = 0.4;

/** A metric this much worse than the previous scan is called a regression. */
export const REGRESSION_RATIO = 0.25;
/** Below this absolute change, a ratio is noise however large it looks. */
export const REGRESSION_MIN_ABSOLUTE: Readonly<Record<string, number>> = {
  ttfbMs: 100,
  fcpMs: 200,
  lcpMs: 250,
  tbtMs: 100,
  speedIndexMs: 300,
  clsScore: 0.05,
  totalBytes: 200_000,
  requestCount: 10,
  performanceScore: 5,
};

export type Verdict = 'good' | 'needsImprovement' | 'poor' | 'measured' | 'noData';

export function verdictFor(value: number | null, thresholds: MetricThresholds | null): Verdict {
  if (value === null) return 'noData';
  if (thresholds === null) return 'measured';
  if (value <= thresholds.good) return 'good';
  return value <= thresholds.poor ? 'needsImprovement' : 'poor';
}
