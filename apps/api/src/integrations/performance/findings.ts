// What the Performance measurements conclude, as findings an owner can act on.
//
// THE LIST BELOW IS THE WHOLE LIST. `IMPLEMENTED_PERF_RULE_IDS` is stored with
// every audit and rendered in the report, because a section that lists rules it
// does not run is worse than one that lists fewer: the first is wrong, the
// second is small. Nothing here claims coverage of a PERF rule that has no code
// in this file.
//
// Two rules the findings follow:
//
//   * A finding is only raised where the data supports it. A metric the provider
//     did not measure produces no finding at all — not a passing one and not a
//     failing one.
//   * A finding never changes the score. The module's score is Lighthouse's own
//     performance score, which already accounts for these metrics; subtracting
//     again for the same slow LCP would penalise it twice. Findings say what to
//     do about the score, they do not restate it.

import {
  CLS_THRESHOLDS,
  INSTABILITY_WARNING_RATIO,
  INP_THRESHOLDS,
  LCP_THRESHOLDS,
  MIN_REPORTABLE_BLOCKING_MS,
  MIN_REPORTABLE_SAVINGS_BYTES,
  PAGE_WEIGHT_BUDGET_BYTES,
  REQUEST_COUNT_BUDGET,
  TBT_THRESHOLDS,
  TTFB_THRESHOLDS,
  verdictFor,
  type MetricThresholds,
} from './thresholds.ts';
import type {
  DeviceResult,
  FieldResult,
  FindingSeverity,
  LabMetricName,
  PerformanceFinding,
  UrlAudit,
} from './types.ts';

/**
 * Every PERF rule this module implements. The report shows exactly these and
 * says nothing about any other PERF-* identifier.
 */
export const IMPLEMENTED_PERF_RULE_IDS = [
  'PERF-LAB-TTFB',
  'PERF-LAB-LCP',
  'PERF-LAB-CLS',
  'PERF-LAB-TBT',
  'PERF-FIELD-INP',
  'PERF-FIELD-LCP',
  'PERF-RES-WEIGHT',
  'PERF-RES-REQUESTS',
  'PERF-RES-UNUSED-JS',
  'PERF-RES-COMPRESSION',
  'PERF-RES-IMAGES',
  'PERF-CACHE-TTL',
  'PERF-RENDER-BLOCKING',
  'PERF-MEASUREMENT-UNSTABLE',
] as const;

function bytes(value: number): string {
  return value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)} MB`
    : `${Math.round(value / 1000)} kB`;
}

function ms(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

interface Measured {
  readonly url: string;
  readonly strategy: DeviceResult['strategy'];
  readonly device: DeviceResult;
}

function measuredPairs(urls: readonly UrlAudit[]): readonly Measured[] {
  return urls.flatMap((entry) =>
    entry.devices
      .filter((device) => device.usableSamples > 0)
      .map((device) => ({ url: entry.url, strategy: device.strategy, device })),
  );
}

function value(measured: Measured, metric: LabMetricName): number | null {
  return measured.device.metrics[metric].median;
}

function severityFromVerdict(verdict: string): FindingSeverity | null {
  if (verdict === 'poor') return 'high';
  return verdict === 'needsImprovement' ? 'medium' : null;
}

interface MetricRule {
  readonly ruleId: string;
  readonly metric: LabMetricName;
  readonly thresholds: MetricThresholds;
  readonly label: string;
  readonly format: (value: number) => string;
  readonly recommendation: string;
}

const METRIC_RULES: readonly MetricRule[] = [
  {
    ruleId: 'PERF-LAB-TTFB',
    metric: 'ttfbMs',
    thresholds: TTFB_THRESHOLDS,
    label: 'Time to First Byte',
    format: ms,
    recommendation:
      'The server spends this long before it sends the first byte. Cache the HTML response, move ' +
      'work out of the request path, or put a CDN in front of the origin — nothing on the page ' +
      'can start before this finishes.',
  },
  {
    ruleId: 'PERF-LAB-LCP',
    metric: 'lcpMs',
    thresholds: LCP_THRESHOLDS,
    label: 'Largest Contentful Paint',
    format: ms,
    recommendation:
      'Find the element Lighthouse names as the largest paint and make it arrive sooner: preload ' +
      'its image or font, serve it at the size it is displayed, and remove anything that blocks ' +
      'rendering before it.',
  },
  {
    ruleId: 'PERF-LAB-CLS',
    metric: 'clsScore',
    thresholds: CLS_THRESHOLDS,
    label: 'Cumulative Layout Shift',
    format: (input) => input.toFixed(3),
    recommendation:
      'Content moves while the page loads. Give images and embeds explicit width and height, ' +
      'reserve space for anything injected after load, and avoid inserting banners above content ' +
      'that is already visible.',
  },
  {
    ruleId: 'PERF-LAB-TBT',
    metric: 'tbtMs',
    thresholds: TBT_THRESHOLDS,
    label: 'Total Blocking Time',
    format: ms,
    recommendation:
      'The main thread is busy this long during load, so taps and clicks in that window feel ' +
      'stuck. Split or defer the largest scripts and move work off the main thread. This is a lab ' +
      'measurement, not Interaction to Next Paint — it predicts responsiveness rather than ' +
      'measuring it.',
  },
];

function metricFindings(measured: Measured): readonly PerformanceFinding[] {
  return METRIC_RULES.flatMap((rule) => {
    const median = value(measured, rule.metric);
    const severity = severityFromVerdict(verdictFor(median, rule.thresholds));
    if (median === null || severity === null) return [];
    const series = measured.device.metrics[rule.metric];
    return [
      {
        ruleId: rule.ruleId,
        severity,
        url: measured.url,
        strategy: measured.strategy,
        summary: `${rule.label} is ${rule.format(median)} on ${measured.strategy} (good is under ${rule.format(rule.thresholds.good)}).`,
        recommendation: rule.recommendation,
        evidence: {
          median,
          samples: series.samples.length,
          instability: series.instability,
          good: rule.thresholds.good,
          poor: rule.thresholds.poor,
          url: measured.url,
          strategy: measured.strategy,
          source: 'pagespeed-lab',
        },
      },
    ];
  });
}

interface SavingsRule {
  readonly ruleId: string;
  readonly metric: LabMetricName;
  readonly summary: (amount: string) => string;
  readonly recommendation: string;
}

const SAVINGS_RULES: readonly SavingsRule[] = [
  {
    ruleId: 'PERF-RES-UNUSED-JS',
    metric: 'unusedJavaScriptBytes',
    summary: (amount) => `${amount} of JavaScript is downloaded and never used on this page.`,
    recommendation:
      'Split the bundle so each page ships only the code it runs, and load the rest on demand. ' +
      'Unused JavaScript costs download time and parse time on every visit.',
  },
  {
    ruleId: 'PERF-RES-COMPRESSION',
    metric: 'uncompressedBytes',
    summary: (amount) => `${amount} of text is served without compression.`,
    recommendation:
      'Enable gzip or Brotli for HTML, CSS, JavaScript and SVG at the server or CDN. It is a ' +
      'configuration change with no effect on the content itself.',
  },
  {
    ruleId: 'PERF-RES-IMAGES',
    metric: 'unoptimisedImageBytes',
    summary: (amount) => `${amount} could be saved by serving images in a modern format.`,
    recommendation:
      'Serve WebP or AVIF with a fallback, and size each image for the box it is displayed in.',
  },
  {
    ruleId: 'PERF-CACHE-TTL',
    metric: 'uncachedBytes',
    summary: (amount) =>
      `${amount} of static assets are served with a short or missing cache life.`,
    recommendation:
      'Give fingerprinted static assets a long max-age with immutable, so a returning visitor ' +
      'downloads them once instead of on every visit.',
  },
];

function savingsFindings(measured: Measured): readonly PerformanceFinding[] {
  return SAVINGS_RULES.flatMap((rule) => {
    const saving = value(measured, rule.metric);
    if (saving === null || saving < MIN_REPORTABLE_SAVINGS_BYTES) return [];
    return [
      {
        ruleId: rule.ruleId,
        severity: 'medium' as const,
        url: measured.url,
        strategy: measured.strategy,
        summary: rule.summary(bytes(saving)),
        recommendation: rule.recommendation,
        evidence: {
          savingsBytes: saving,
          threshold: MIN_REPORTABLE_SAVINGS_BYTES,
          url: measured.url,
          strategy: measured.strategy,
          source: 'pagespeed-lab',
        },
      },
    ];
  });
}

function budgetFindings(measured: Measured): readonly PerformanceFinding[] {
  const findings: PerformanceFinding[] = [];
  const weight = value(measured, 'totalBytes');
  if (weight !== null && weight > PAGE_WEIGHT_BUDGET_BYTES) {
    findings.push({
      ruleId: 'PERF-RES-WEIGHT',
      severity: 'medium',
      url: measured.url,
      strategy: measured.strategy,
      summary: `The page transfers ${bytes(weight)}, over the ${bytes(PAGE_WEIGHT_BUDGET_BYTES)} budget.`,
      recommendation:
        'Find the largest few responses and deal with those first — usually one hero image, one ' +
        'font family or one third-party script accounts for most of the excess.',
      evidence: {
        totalBytes: weight,
        budgetBytes: PAGE_WEIGHT_BUDGET_BYTES,
        url: measured.url,
        strategy: measured.strategy,
        source: 'pagespeed-lab',
      },
    });
  }
  const requests = value(measured, 'requestCount');
  if (requests !== null && requests > REQUEST_COUNT_BUDGET) {
    findings.push({
      ruleId: 'PERF-RES-REQUESTS',
      severity: 'low',
      url: measured.url,
      strategy: measured.strategy,
      summary: `The page makes ${Math.round(requests)} requests, over the ${REQUEST_COUNT_BUDGET} budget.`,
      recommendation:
        'Bundle what is yours and audit what is not: third-party tags are the usual reason a ' +
        'request count climbs without the page gaining anything.',
      evidence: {
        requestCount: requests,
        budget: REQUEST_COUNT_BUDGET,
        url: measured.url,
        strategy: measured.strategy,
        source: 'pagespeed-lab',
      },
    });
  }
  const blocking = value(measured, 'renderBlockingMs');
  if (blocking !== null && blocking >= MIN_REPORTABLE_BLOCKING_MS) {
    findings.push({
      ruleId: 'PERF-RENDER-BLOCKING',
      severity: 'medium',
      url: measured.url,
      strategy: measured.strategy,
      summary: `Render-blocking resources delay first paint by about ${ms(blocking)}.`,
      recommendation:
        'Inline the styles the first screen needs and load the rest asynchronously; mark scripts ' +
        'that are not needed for first paint as defer.',
      evidence: {
        blockingMs: blocking,
        threshold: MIN_REPORTABLE_BLOCKING_MS,
        url: measured.url,
        strategy: measured.strategy,
        source: 'pagespeed-lab',
      },
    });
  }
  return findings;
}

/**
 * A page whose repeated runs disagree with each other. Reported so the verdicts
 * above are read as provisional rather than as a measurement of the site.
 */
function instabilityFindings(measured: Measured): readonly PerformanceFinding[] {
  const unstable = (['lcpMs', 'ttfbMs', 'tbtMs'] as const).filter((metric) => {
    const instability = measured.device.metrics[metric].instability;
    return instability !== null && instability >= INSTABILITY_WARNING_RATIO;
  });
  if (unstable.length === 0) return [];
  return [
    {
      ruleId: 'PERF-MEASUREMENT-UNSTABLE',
      severity: 'info',
      url: measured.url,
      strategy: measured.strategy,
      summary: `Repeated runs of this page disagreed on ${unstable.join(', ')}; the medians below are provisional.`,
      recommendation:
        'Measure again when the site is not under load before acting on these numbers. Spread ' +
        'this wide usually means a shared host, a cold cache, or a third party that is sometimes ' +
        'slow.',
      evidence: Object.fromEntries([
        ['url', measured.url],
        ['strategy', measured.strategy],
        ['threshold', INSTABILITY_WARNING_RATIO],
        ...unstable.map((metric) => [metric, measured.device.metrics[metric].instability] as const),
      ]),
    },
  ];
}

/**
 * Field findings, from real visitors.
 *
 * INP is here and only here. When CrUX has no record the absence is reported as
 * an `info` finding rather than passed over, because "we could not measure how
 * this site responds to a tap" is itself something the reader needs to know.
 */
function fieldFindings(origin: string, field: FieldResult): readonly PerformanceFinding[] {
  if (field.state !== 'available' || field.metrics === null) {
    return [
      {
        ruleId: 'PERF-FIELD-INP',
        severity: 'info',
        url: origin,
        strategy: null,
        summary: 'Interaction to Next Paint could not be measured for this site.',
        recommendation: field.detail,
        evidence: { fieldState: field.state, scope: field.scope, source: 'crux' },
      },
    ];
  }
  const findings: PerformanceFinding[] = [];
  const { inpP75Ms, lcpP75Ms, periodStart, periodEnd } = field.metrics;
  const provenance = {
    url: origin,
    scope: field.scope,
    periodStart,
    periodEnd,
    source: 'crux',
  } as const;
  const inpSeverity = severityFromVerdict(verdictFor(inpP75Ms, INP_THRESHOLDS));
  if (inpP75Ms !== null && inpSeverity !== null) {
    findings.push({
      ruleId: 'PERF-FIELD-INP',
      severity: inpSeverity,
      url: origin,
      strategy: null,
      summary: `Real visitors' Interaction to Next Paint is ${ms(inpP75Ms)} at the 75th percentile (good is under ${ms(INP_THRESHOLDS.good)}).`,
      recommendation:
        'Something on the page takes too long to respond to a tap or a click. Break up long tasks, ' +
        'defer work triggered by input, and check third-party scripts that run on interaction.',
      evidence: {
        p75: inpP75Ms,
        good: INP_THRESHOLDS.good,
        poor: INP_THRESHOLDS.poor,
        ...provenance,
      },
    });
  }
  const lcpSeverity = severityFromVerdict(verdictFor(lcpP75Ms, LCP_THRESHOLDS));
  if (lcpP75Ms !== null && lcpSeverity !== null) {
    findings.push({
      ruleId: 'PERF-FIELD-LCP',
      severity: lcpSeverity,
      url: origin,
      strategy: null,
      summary: `Real visitors' Largest Contentful Paint is ${ms(lcpP75Ms)} at the 75th percentile.`,
      recommendation:
        'This is what visitors actually experienced, across their own devices and connections. ' +
        'It outranks the lab number above when the two disagree.',
      evidence: {
        p75: lcpP75Ms,
        good: LCP_THRESHOLDS.good,
        poor: LCP_THRESHOLDS.poor,
        ...provenance,
      },
    });
  }
  return findings;
}

const SEVERITY_ORDER: Readonly<Record<FindingSeverity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/** Every finding the measurements support, worst first. */
export function performanceFindings(
  origin: string,
  urls: readonly UrlAudit[],
  field: FieldResult,
): readonly PerformanceFinding[] {
  const measured = measuredPairs(urls);
  const findings = [
    ...measured.flatMap((entry) => [
      ...metricFindings(entry),
      ...savingsFindings(entry),
      ...budgetFindings(entry),
      ...instabilityFindings(entry),
    ]),
    ...fieldFindings(origin, field),
  ];
  return [...findings].sort(
    (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
  );
}
