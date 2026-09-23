// What the Performance section measured, read for the report's check list.
//
// TWO SHAPES, BECAUSE THERE ARE TWO GENERATIONS OF STORED ROW. A report written
// before the bounded audit carries one flat snapshot: one page, one device, one
// run. A report written by the audit carries the whole thing — a few pages, both
// emulated devices, repeated runs with their medians and their spread, the field
// read, the request budget and the comparison with the previous scan. Both are
// read here, and a row that has only the first still opens.
//
// LAB TBT IS NOT INP. Lighthouse cannot measure Interaction to Next Paint: INP
// needs a real interaction from a real visitor. The old reader looked for an
// `inpMs` lab key, which the provider never filled, and rated a measurement
// nobody had taken. Total Blocking Time is the lab proxy, it has its own
// thresholds, and it is shown under its own name; INP appears only under the
// real-visitor heading, and its absence is stated rather than hidden.
//
// Ratings use Google's published Core Web Vitals boundaries (web.dev/vitals).
// Page weight and request count have no published boundary: they are FluxRadar's
// own budget, and the copy says so rather than presenting them as a standard.

import { asRecord, numberValue } from './module-metadata';

type Metadata = Readonly<Record<string, unknown>> | undefined;

export type MetricName =
  | 'lcp'
  | 'inp'
  | 'cls'
  | 'ttfb'
  | 'tbt'
  /** The whole page transfer, as the audit measures it. */
  | 'weight'
  /** The HTML document alone, which is all a pre-audit row ever measured. */
  | 'htmlWeight'
  | 'requests';
export type MetricUnit = 'ms' | 'score' | 'bytes' | 'count';
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
  /**
   * Spread across the repeated runs, relative to the median; null when a single
   * run cannot say. Shown so a reader can tell a solid figure from an average of
   * two very different ones.
   */
  readonly instability?: number | null;
  /** How many runs produced this metric. 1 for a legacy single-run snapshot. */
  readonly samples?: number;
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
/** Lighthouse's own lab scoring control points for Total Blocking Time. */
const TBT: MetricThresholds = { good: 200, poor: 600 };

/** Spread this wide means the median is not describing a stable page. */
export const INSTABILITY_WARNING_RATIO = 0.4;

interface MetricDefinition {
  /** The key in the stored flat snapshot's `metrics`. */
  readonly key: string;
  readonly source: 'lab' | 'field';
  readonly metric: MetricName;
  readonly unit: MetricUnit;
  readonly thresholds: MetricThresholds | null;
}

const METRICS: readonly MetricDefinition[] = [
  { key: 'lcpMs', source: 'lab', metric: 'lcp', unit: 'ms', thresholds: LCP },
  // No lab `inpMs`. A row written before the audit carries that key with a null
  // in it — Lighthouse has no such audit, so the provider never filled it — and
  // listing it as "no data" invited a reader to expect a figure there one day.
  { key: 'tbtMs', source: 'lab', metric: 'tbt', unit: 'ms', thresholds: TBT },
  { key: 'clsScore', source: 'lab', metric: 'cls', unit: 'score', thresholds: CLS },
  // `cls` is the same measurement under the key a pre-audit row used.
  { key: 'cls', source: 'lab', metric: 'cls', unit: 'score', thresholds: CLS },
  { key: 'ttfbMs', source: 'lab', metric: 'ttfb', unit: 'ms', thresholds: TTFB },
  { key: 'totalBytes', source: 'lab', metric: 'weight', unit: 'bytes', thresholds: null },
  // `htmlBytes` is the pre-audit key and measured the HTML document only. It is
  // shown under its own name rather than as the page's weight: the two differ by
  // about an order of magnitude, and relabelling one as the other would make two
  // reports of the same site look like a collapse in page size.
  { key: 'htmlBytes', source: 'lab', metric: 'htmlWeight', unit: 'bytes', thresholds: null },
  { key: 'requestCount', source: 'lab', metric: 'requests', unit: 'count', thresholds: null },
  { key: 'lcpP75Ms', source: 'field', metric: 'lcp', unit: 'ms', thresholds: LCP },
  { key: 'inpP75Ms', source: 'field', metric: 'inp', unit: 'ms', thresholds: INP },
  { key: 'clsP75', source: 'field', metric: 'cls', unit: 'score', thresholds: CLS },
  { key: 'ttfbP75Ms', source: 'field', metric: 'ttfb', unit: 'ms', thresholds: TTFB },
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
 * The measurements the flat snapshot recorded, split by where they came from.
 *
 * Only metrics the snapshot names are listed: a provider that was never asked
 * leaves its keys out, while one that was asked and had nothing leaves them
 * null, and only the second is "no data".
 */
export function performanceChecksOf(metadata: Metadata): PerformanceChecks | null {
  const metrics = asRecord(metadata?.metrics);
  if (metrics === null) return null;
  const seen = new Set<string>();
  const measurements = METRICS.filter((definition) => {
    // One row per metric: two generations of key can name the same measurement,
    // and the first definition that is present wins.
    if (!(definition.key in metrics) || seen.has(`${definition.source}:${definition.metric}`)) {
      return false;
    }
    seen.add(`${definition.source}:${definition.metric}`);
    return true;
  }).map((definition) => {
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
  });
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

// ── The bounded audit ───────────────────────────────────────────────────────

export type DeviceStrategy = 'mobile' | 'desktop';

export interface DeviceReading {
  readonly strategy: DeviceStrategy;
  readonly requestedSamples: number;
  readonly usableSamples: number;
  readonly measurements: readonly PerformanceMeasurement[];
  /** Why runs produced nothing. Empty when every requested run answered. */
  readonly failures: readonly string[];
}

export interface UrlReading {
  readonly url: string;
  /** The page the section's headline figures came from. */
  readonly primary: boolean;
  readonly devices: readonly DeviceReading[];
}

export type FieldState = 'available' | 'not_configured' | 'no_data' | 'request_failed';

export interface FieldReading {
  readonly state: FieldState;
  readonly measurements: readonly PerformanceMeasurement[];
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
}

export interface RegressionReading {
  readonly url: string;
  readonly strategy: DeviceStrategy;
  readonly metric: string;
  readonly previous: number;
  readonly current: number;
  readonly changeRatio: number;
}

/**
 * Why the previous scan was not compared, as the audit's own code.
 *
 * The sentence beside it is English, written when the scan ran; the code is what
 * lets the panel say the same thing in the reader's language. Null for a report
 * written before the code was stored, which is why the sentence is kept.
 */
export interface IncomparableReading {
  readonly code: string;
  readonly previous: string | null;
  readonly current: string | null;
}

/**
 * What the audit actually did, so the panel's lead describes this run rather than
 * the largest one the product can take. A deployment with no PageSpeed API key
 * measures one page, on one device, once.
 */
export interface SamplingReading {
  /** The distinct emulated devices measured across the pages. */
  readonly devices: readonly DeviceStrategy[];
  /** True when at least one device was measured more than once. */
  readonly repeated: boolean;
}

export interface PerformanceAuditReading {
  readonly urls: readonly UrlReading[];
  readonly field: FieldReading;
  readonly regressions: readonly RegressionReading[];
  /** Why the previous scan was not compared; null when it was, or when none exists. */
  readonly incomparableReason: string | null;
  /** The same fact as a code, when the audit stored one. */
  readonly incomparable: IncomparableReading | null;
  readonly sampling: SamplingReading;
  readonly hasPrevious: boolean;
  readonly budget: { readonly cap: number; readonly used: number; readonly capped: boolean } | null;
  /** The provider versions the numbers were produced by, for the source note. */
  readonly providers: readonly { readonly name: string; readonly version: string | null }[];
}

/** One lab metric of one device, read out of the audit's median series. */
const LAB_SERIES: readonly {
  readonly key: string;
  readonly metric: MetricName;
  readonly unit: MetricUnit;
  readonly thresholds: MetricThresholds | null;
}[] = [
  { key: 'lcpMs', metric: 'lcp', unit: 'ms', thresholds: LCP },
  { key: 'tbtMs', metric: 'tbt', unit: 'ms', thresholds: TBT },
  { key: 'clsScore', metric: 'cls', unit: 'score', thresholds: CLS },
  { key: 'ttfbMs', metric: 'ttfb', unit: 'ms', thresholds: TTFB },
  { key: 'totalBytes', metric: 'weight', unit: 'bytes', thresholds: null },
  { key: 'requestCount', metric: 'requests', unit: 'count', thresholds: null },
];

const FIELD_METRICS: readonly {
  readonly key: string;
  readonly metric: MetricName;
  readonly unit: MetricUnit;
  readonly thresholds: MetricThresholds;
}[] = [
  { key: 'lcpP75Ms', metric: 'lcp', unit: 'ms', thresholds: LCP },
  { key: 'inpP75Ms', metric: 'inp', unit: 'ms', thresholds: INP },
  { key: 'clsP75', metric: 'cls', unit: 'score', thresholds: CLS },
  { key: 'ttfbP75Ms', metric: 'ttfb', unit: 'ms', thresholds: TTFB },
];

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function seriesMeasurement(
  series: Record<string, unknown> | null,
  definition: (typeof LAB_SERIES)[number],
): PerformanceMeasurement {
  const entry = asRecord(series?.[definition.key]);
  const value = numberValue(entry?.median);
  const samples = entry?.samples;
  return {
    metric: definition.metric,
    unit: definition.unit,
    thresholds: definition.thresholds,
    value,
    verdict: metricVerdict(value, definition.thresholds),
    instability: numberValue(entry?.instability),
    samples: Array.isArray(samples) ? samples.length : 0,
  };
}

function deviceReading(value: unknown): DeviceReading | null {
  const record = asRecord(value);
  const strategy = record?.strategy;
  if (strategy !== 'mobile' && strategy !== 'desktop') return null;
  const failures = record?.failures;
  return {
    strategy,
    requestedSamples: numberValue(record?.requestedSamples) ?? 0,
    usableSamples: numberValue(record?.usableSamples) ?? 0,
    measurements: LAB_SERIES.map((definition) =>
      seriesMeasurement(asRecord(record?.metrics), definition),
    ),
    failures: Array.isArray(failures)
      ? failures.filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

function urlReading(value: unknown): UrlReading | null {
  const record = asRecord(value);
  const url = stringValue(record?.url);
  if (url === null) return null;
  const devices = Array.isArray(record?.devices) ? record.devices : [];
  return {
    url,
    primary: record?.primary === true,
    devices: devices.flatMap((device) => {
      const reading = deviceReading(device);
      return reading === null ? [] : [reading];
    }),
  };
}

function fieldReading(value: unknown): FieldReading {
  const record = asRecord(value);
  const state = record?.state;
  const metrics = asRecord(record?.metrics);
  const known: readonly FieldState[] = ['available', 'not_configured', 'no_data', 'request_failed'];
  return {
    state: known.find((candidate) => candidate === state) ?? 'request_failed',
    // A field metric is listed only when CrUX actually reported it; the ones it
    // did not are absent rather than shown as zero.
    measurements:
      metrics === null
        ? []
        : FIELD_METRICS.flatMap((definition) => {
            const figure = numberValue(metrics[definition.key]);
            return figure === null
              ? []
              : [
                  {
                    metric: definition.metric,
                    unit: definition.unit,
                    thresholds: definition.thresholds,
                    value: figure,
                    verdict: metricVerdict(figure, definition.thresholds),
                  },
                ];
          }),
    periodStart: stringValue(metrics?.periodStart),
    periodEnd: stringValue(metrics?.periodEnd),
  };
}

function regressionReading(value: unknown): RegressionReading | null {
  const record = asRecord(value);
  const url = stringValue(record?.url);
  const metric = stringValue(record?.metric);
  const strategy = record?.strategy;
  const previous = numberValue(record?.previous);
  const current = numberValue(record?.current);
  if (
    url === null ||
    metric === null ||
    previous === null ||
    current === null ||
    (strategy !== 'mobile' && strategy !== 'desktop')
  ) {
    return null;
  }
  return {
    url,
    strategy,
    metric,
    previous,
    current,
    changeRatio: numberValue(record?.changeRatio) ?? 0,
  };
}

function incomparableIn(comparison: Record<string, unknown> | null): IncomparableReading | null {
  const record = asRecord(comparison?.incomparable);
  const code = stringValue(record?.code);
  return code === null
    ? null
    : { code, previous: stringValue(record?.previous), current: stringValue(record?.current) };
}

/**
 * What the audit measured, read from the rows themselves rather than assumed.
 *
 * A device counts as measured repeatedly when it asked for more than one run or
 * produced more than one sample; a row that says neither is read as a single run,
 * because understating the work is a missed detail while overstating it is a false
 * statement about the method.
 */
function samplingIn(urls: readonly UrlReading[]): SamplingReading {
  const devices = [
    ...new Set(urls.flatMap((entry) => entry.devices.map((device) => device.strategy))),
  ];
  const repeated = urls.some((entry) =>
    entry.devices.some(
      (device) =>
        device.requestedSamples > 1 ||
        device.measurements.some((measurement) => (measurement.samples ?? 0) > 1),
    ),
  );
  return { devices, repeated };
}

/**
 * The stored audit, or null for a Performance row written before it existed.
 *
 * Everything is narrowed from `unknown`: an older or partly written row renders
 * less rather than throwing inside a report the customer paid for.
 */
export function performanceAuditOf(metadata: Metadata): PerformanceAuditReading | null {
  const audit = asRecord(metadata?.audit);
  if (audit === null || !Array.isArray(audit.urls)) return null;
  const urls = audit.urls.flatMap((entry) => {
    const reading = urlReading(entry);
    return reading === null ? [] : [reading];
  });
  if (urls.length === 0) return null;
  const budget = asRecord(audit.requestBudget);
  const comparison = asRecord(audit.comparison);
  const providers = Array.isArray(audit.providers) ? audit.providers : [];
  const regressions = Array.isArray(audit.regressions) ? audit.regressions : [];
  return {
    urls,
    field: fieldReading(audit.field),
    regressions: regressions.flatMap((entry) => {
      const reading = regressionReading(entry);
      return reading === null ? [] : [reading];
    }),
    incomparableReason: stringValue(comparison?.incomparableReason),
    incomparable: incomparableIn(comparison),
    sampling: samplingIn(urls),
    hasPrevious: comparison !== null,
    budget:
      budget === null
        ? null
        : {
            cap: numberValue(budget.cap) ?? 0,
            used: numberValue(budget.used) ?? 0,
            capped: budget.capped === true,
          },
    providers: providers.flatMap((entry) => {
      const record = asRecord(entry);
      const name = stringValue(record?.name);
      return name === null ? [] : [{ name, version: stringValue(record?.version) }];
    }),
  };
}
