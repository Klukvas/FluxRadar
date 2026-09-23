// Deterministic Performance data for tests.
//
// Everything here is injected — no test in this repository is allowed to make a
// real PageSpeed or CrUX request. Those calls are billable, rate-limited and
// slow, and a suite that made them would fail for reasons that have nothing to
// do with the code under test.

import {
  LAB_METRIC_NAMES,
  PERFORMANCE_AUDIT_VERSION,
  type DeviceResult,
  type DeviceStrategy,
  type FieldResult,
  type LabMetricName,
  type LabMetrics,
  type MetricSeries,
  type MetricSeriesByName,
  type PerformanceAudit,
  type PerformanceComparison,
  type PerformanceRunner,
  type ProviderInfo,
  type UrlAudit,
} from '../integrations/performance/index.ts';

/** Every lab metric null, so a fixture only states what it means to state. */
export const EMPTY_LAB_METRICS: LabMetrics = Object.fromEntries(
  LAB_METRIC_NAMES.map((name): [LabMetricName, number | null] => [name, null]),
) as LabMetrics;

/** A metric series with one sample, which is what most fixtures want. */
export function seriesOf(values: Partial<Record<LabMetricName, number>>): MetricSeriesByName {
  const entries = LAB_METRIC_NAMES.map((name): [LabMetricName, MetricSeries] => {
    const value = values[name];
    return [
      name,
      value === undefined
        ? { median: null, samples: [], instability: null }
        : { median: value, samples: [value], instability: null },
    ];
  });
  return Object.fromEntries(entries) as MetricSeriesByName;
}

export function deviceResult(
  strategy: DeviceStrategy,
  values: Partial<Record<LabMetricName, number>>,
  overrides: Partial<DeviceResult> = {},
): DeviceResult {
  return {
    strategy,
    requestedSamples: 1,
    usableSamples: 1,
    metrics: seriesOf(values),
    failures: [],
    ...overrides,
  };
}

export const NO_FIELD_DATA: FieldResult = {
  state: 'no_data',
  scope: 'origin',
  detail: 'The Chrome UX Report has no record for this origin.',
  metrics: null,
};

export interface AuditFixtureOptions {
  readonly origin?: string;
  readonly urls?: readonly UrlAudit[];
  readonly field?: FieldResult;
  readonly score?: number | null;
  readonly fetchedAt?: string;
  readonly comparison?: PerformanceComparison | null;
  /** Overrides the provider list, e.g. to state a different Lighthouse version. */
  readonly providers?: readonly ProviderInfo[];
}

/** A complete, valid audit with one measured page on both devices. */
export function fakePerformanceAudit(options: AuditFixtureOptions = {}): PerformanceAudit {
  const origin = options.origin ?? 'https://example.com/';
  const urls = options.urls ?? [
    {
      url: origin,
      primary: true,
      devices: [
        deviceResult('mobile', { performanceScore: 71, lcpMs: 2_400, ttfbMs: 320, clsScore: 0.03 }),
        deviceResult('desktop', {
          performanceScore: 88,
          lcpMs: 1_500,
          ttfbMs: 260,
          clsScore: 0.01,
        }),
      ],
    },
  ];
  const field = options.field ?? NO_FIELD_DATA;
  const pairs = urls.flatMap((entry) => entry.devices);
  return {
    version: PERFORMANCE_AUDIT_VERSION,
    origin,
    fetchedAt: options.fetchedAt ?? '2026-09-22T12:00:00.000Z',
    providers: options.providers ?? [
      { name: 'pagespeed', version: '12.0.0', requests: pairs.length, failures: 0 },
      {
        name: 'crux',
        version: null,
        requests: field.state === 'not_configured' ? 0 : 1,
        failures: 0,
      },
    ],
    urls,
    field,
    requestBudget: { cap: 14, used: pairs.length, capped: false },
    findings: [],
    regressions: [],
    comparison: options.comparison ?? null,
    coverage: {
      applicableChecks: pairs.length,
      completedApplicableChecks: pairs.filter((device) => device.usableSamples > 0).length,
      implementedRuleIds: [],
    },
    score: options.score === undefined ? 79 : options.score,
  };
}

/** A runner that answers with a fixture and never touches the network. */
export function fakePerformanceRunner(options: AuditFixtureOptions = {}): PerformanceRunner {
  return async (request) => fakePerformanceAudit({ origin: request.origin, ...options });
}
