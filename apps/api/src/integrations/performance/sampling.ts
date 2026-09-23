// Turning repeated Lighthouse runs into one number, plus an honest statement of
// how much that number can be trusted.
//
// A single PageSpeed run is noisy: the same page measured twice a minute apart
// routinely differs by a third, because the runner competes for a shared machine.
// Reporting one run as "the" LCP is what makes a report argue with the owner's
// own browser. So each URL/device pair is measured more than once and the median
// is reported — the middle value, not the mean, because one catastrophic run
// would drag a mean and cannot drag a median.
//
// Instability is reported beside it rather than hidden: (max − min) / median.
// It is what lets a reader tell "this page takes 3.1 s" from "this page took
// 1.4 s and then 4.8 s", and the findings use it to mark a verdict provisional.

import { LAB_METRIC_NAMES, type LabMetricName, type LabSample } from './types.ts';
import type { MetricSeries, MetricSeriesByName } from './types.ts';

/** The middle value of a sorted list; the lower-middle average for an even count. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (upper === undefined) return null;
  return sorted.length % 2 === 1 || lower === undefined ? upper : (lower + upper) / 2;
}

/**
 * Spread relative to the median, or null when the samples cannot say — one
 * sample has no spread to report, and a median of zero has no scale to state it
 * against.
 */
export function instabilityOf(values: readonly number[], middle: number | null): number | null {
  if (values.length < 2 || middle === null || middle === 0) return null;
  const spread = Math.max(...values) - Math.min(...values);
  return Number((spread / Math.abs(middle)).toFixed(4));
}

function seriesFrom(values: readonly number[]): MetricSeries {
  const middle = median(values);
  return {
    median: middle === null ? null : Number(middle.toFixed(4)),
    samples: values,
    instability: instabilityOf(values, middle),
  };
}

const EMPTY_SERIES: MetricSeries = { median: null, samples: [], instability: null };

/**
 * One series per metric across the usable samples of a URL/device pair.
 *
 * A metric a run did not report is skipped for that run rather than counted as
 * zero: three runs where only two measured LCP give a median of those two, and
 * `samples.length` says so.
 */
export function seriesByMetric(samples: readonly LabSample[]): MetricSeriesByName {
  const entries = LAB_METRIC_NAMES.map((name: LabMetricName): [LabMetricName, MetricSeries] => {
    const values = samples.flatMap((sample) => {
      const value = sample.metrics[name];
      return value === null ? [] : [value];
    });
    return [name, values.length === 0 ? EMPTY_SERIES : seriesFrom(values)];
  });
  return Object.fromEntries(entries) as MetricSeriesByName;
}
