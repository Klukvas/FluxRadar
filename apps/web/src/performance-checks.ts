// What the Performance section measured, read for the report's check list.
//
// The section stores the external provider's snapshot as it arrived: a lab run
// from PageSpeed Insights, real-visitor percentiles from the Chrome UX Report,
// or both. The card showed only the overall score, so an owner could not see
// which measurement pulled it down. Ratings use Google's published Core Web
// Vitals boundaries (web.dev/vitals). Page weight has no such boundary, so it is
// shown as a measurement and never as a pass or a fail.

import { asRecord, numberValue } from './module-metadata';

type Metadata = Readonly<Record<string, unknown>> | undefined;

export type MetricName = 'lcp' | 'inp' | 'cls' | 'ttfb' | 'weight';
export type MetricUnit = 'ms' | 'score' | 'bytes';
export type MetricVerdict = 'good' | 'needsImprovement' | 'poor' | 'measured' | 'noData';

/** The largest "good" value and the largest "needs improvement" value. */
export interface MetricThresholds {
  readonly good: number;
  readonly poor: number;
}

export interface PerformanceMeasurement {
  readonly metric: MetricName;
  readonly unit: MetricUnit;
  readonly thresholds: MetricThresholds | null;
  readonly value: number | null;
  readonly verdict: MetricVerdict;
}

export interface PerformanceChecks {
  readonly strategy: 'desktop' | 'mobile' | null;
  readonly lab: readonly PerformanceMeasurement[];
  readonly field: readonly PerformanceMeasurement[];
}

const LCP: MetricThresholds = { good: 2500, poor: 4000 };
const INP: MetricThresholds = { good: 200, poor: 500 };
const CLS: MetricThresholds = { good: 0.1, poor: 0.25 };
const TTFB: MetricThresholds = { good: 800, poor: 1800 };

interface MetricDefinition {
  /** The key in the stored snapshot's `metrics`; see `integrations/performance.ts`. */
  readonly key: string;
  readonly source: 'lab' | 'field';
  readonly metric: MetricName;
  readonly unit: MetricUnit;
  readonly thresholds: MetricThresholds | null;
}

const METRICS: readonly MetricDefinition[] = [
  { key: 'lcpMs', source: 'lab', metric: 'lcp', unit: 'ms', thresholds: LCP },
  { key: 'inpMs', source: 'lab', metric: 'inp', unit: 'ms', thresholds: INP },
  { key: 'cls', source: 'lab', metric: 'cls', unit: 'score', thresholds: CLS },
  { key: 'ttfbMs', source: 'lab', metric: 'ttfb', unit: 'ms', thresholds: TTFB },
  { key: 'htmlBytes', source: 'lab', metric: 'weight', unit: 'bytes', thresholds: null },
  { key: 'lcpP75Ms', source: 'field', metric: 'lcp', unit: 'ms', thresholds: LCP },
  { key: 'inpP75Ms', source: 'field', metric: 'inp', unit: 'ms', thresholds: INP },
  { key: 'clsP75', source: 'field', metric: 'cls', unit: 'score', thresholds: CLS },
];

export function metricVerdict(
  value: number | null,
  thresholds: MetricThresholds | null,
): MetricVerdict {
  if (value === null) return 'noData';
  if (thresholds === null) return 'measured';
  if (value <= thresholds.good) return 'good';
  return value <= thresholds.poor ? 'needsImprovement' : 'poor';
}

/**
 * The measurements a Performance row recorded, split by where they came from.
 *
 * Only metrics the snapshot names are listed: a provider that was never asked
 * leaves its keys out, while one that was asked and had nothing leaves them
 * null, and only the second is "no data".
 */
export function performanceChecksOf(metadata: Metadata): PerformanceChecks | null {
  const metrics = asRecord(metadata?.metrics);
  if (metrics === null) return null;
  const measurements = METRICS.filter((definition) => definition.key in metrics).map(
    (definition) => {
      const value = numberValue(metrics[definition.key]);
      return {
        source: definition.source,
        measurement: {
          metric: definition.metric,
          unit: definition.unit,
          thresholds: definition.thresholds,
          value,
          verdict: metricVerdict(value, definition.thresholds),
        },
      };
    },
  );
  if (measurements.length === 0) return null;
  const strategy = metadata?.strategy;
  return {
    strategy: strategy === 'desktop' || strategy === 'mobile' ? strategy : null,
    lab: measurements.filter((entry) => entry.source === 'lab').map((entry) => entry.measurement),
    field: measurements
      .filter((entry) => entry.source === 'field')
      .map((entry) => entry.measurement),
  };
}
