// What the Performance measurements conclude, and — just as important — what
// they refuse to conclude.

import { describe, expect, it } from 'vitest';

import { compareWithPrevious, performanceRegressions } from './comparison.ts';
import { performanceFindings, IMPLEMENTED_PERF_RULE_IDS } from './findings.ts';
import { fakePerformanceAudit } from '../../test-utils/performance-fixtures.ts';
import {
  LAB_METRIC_NAMES,
  type DeviceStrategy,
  type FieldResult,
  type LabMetricName,
  type MetricSeries,
  type MetricSeriesByName,
  type PerformanceAudit,
  type UrlAudit,
} from './types.ts';

const ORIGIN = 'https://example.com/';

function series(values: Partial<Record<LabMetricName, number | MetricSeries>>): MetricSeriesByName {
  const entries = LAB_METRIC_NAMES.map((name): [LabMetricName, MetricSeries] => {
    const value = values[name];
    if (value === undefined) return [name, { median: null, samples: [], instability: null }];
    return typeof value === 'number'
      ? [name, { median: value, samples: [value], instability: null }]
      : [name, value];
  });
  return Object.fromEntries(entries) as MetricSeriesByName;
}

function pageOn(
  strategy: DeviceStrategy,
  values: Partial<Record<LabMetricName, number | MetricSeries>>,
  url = ORIGIN,
): UrlAudit {
  return {
    url,
    primary: true,
    devices: [
      {
        strategy,
        requestedSamples: 2,
        usableSamples: 2,
        metrics: series(values),
        failures: [],
      },
    ],
  };
}

const NO_FIELD: FieldResult = {
  state: 'no_data',
  scope: 'origin',
  detail: 'The Chrome UX Report has no record for this origin.',
  metrics: null,
};

function fieldWith(metrics: Partial<FieldResult['metrics'] & object>): FieldResult {
  return {
    state: 'available',
    scope: 'origin',
    detail: 'Real-visitor percentiles.',
    metrics: {
      lcpP75Ms: null,
      inpP75Ms: null,
      clsP75: null,
      ttfbP75Ms: null,
      periodStart: '2026-08-26',
      periodEnd: '2026-09-22',
      ...metrics,
    },
  };
}

function codesOf(urls: readonly UrlAudit[], field: FieldResult = NO_FIELD): readonly string[] {
  return performanceFindings(ORIGIN, urls, field).map((finding) => finding.ruleId);
}

describe('lab findings', () => {
  it('names a slow first byte with the page and device it was measured on', () => {
    const findings = performanceFindings(ORIGIN, [pageOn('mobile', { ttfbMs: 2_400 })], NO_FIELD);
    const ttfb = findings.find((finding) => finding.ruleId === 'PERF-LAB-TTFB');

    expect(ttfb?.severity).toBe('high');
    expect(ttfb?.url).toBe(ORIGIN);
    expect(ttfb?.strategy).toBe('mobile');
    expect(ttfb?.evidence).toMatchObject({ median: 2_400, source: 'pagespeed-lab' });
  });

  it('says nothing about a metric the provider did not measure', () => {
    expect(codesOf([pageOn('mobile', {})])).not.toContain('PERF-LAB-LCP');
  });

  it('says nothing about a metric that is inside the good band', () => {
    expect(
      codesOf([pageOn('mobile', { lcpMs: 1_200, ttfbMs: 100, clsScore: 0.01, tbtMs: 50 })]),
    ).not.toContain('PERF-LAB-LCP');
  });

  it('calls Total Blocking Time by its own name and never INP', () => {
    const findings = performanceFindings(ORIGIN, [pageOn('mobile', { tbtMs: 900 })], NO_FIELD);
    const tbt = findings.find((finding) => finding.ruleId === 'PERF-LAB-TBT');

    expect(tbt?.summary).toContain('Total Blocking Time');
    expect(tbt?.summary).not.toContain('Interaction to Next Paint');
    expect(tbt?.recommendation).toContain('not Interaction to Next Paint');
    expect(findings.map((finding) => finding.ruleId)).not.toContain('PERF-FIELD-INP-FROM-LAB');
  });

  it('reports the absence of field INP explicitly instead of passing over it', () => {
    const findings = performanceFindings(ORIGIN, [pageOn('mobile', { tbtMs: 900 })], NO_FIELD);
    const inp = findings.find((finding) => finding.ruleId === 'PERF-FIELD-INP');

    expect(inp?.severity).toBe('info');
    expect(inp?.summary).toContain('could not be measured');
    expect(inp?.evidence).toMatchObject({ fieldState: 'no_data', source: 'crux' });
  });

  it('rates INP only from real visitors', () => {
    const findings = performanceFindings(
      ORIGIN,
      [pageOn('mobile', {})],
      fieldWith({ inpP75Ms: 620 }),
    );
    const inp = findings.find((finding) => finding.ruleId === 'PERF-FIELD-INP');

    expect(inp?.severity).toBe('high');
    expect(inp?.evidence).toMatchObject({ p75: 620, scope: 'origin', periodEnd: '2026-09-22' });
  });
});

describe('resource, cache and budget findings', () => {
  it('names unused JavaScript worth acting on', () => {
    expect(codesOf([pageOn('mobile', { unusedJavaScriptBytes: 400_000 })])).toContain(
      'PERF-RES-UNUSED-JS',
    );
  });

  it('ignores a saving too small to be worth an afternoon', () => {
    expect(codesOf([pageOn('mobile', { unusedJavaScriptBytes: 20_000 })])).not.toContain(
      'PERF-RES-UNUSED-JS',
    );
  });

  it('names a short cache life on static assets', () => {
    expect(codesOf([pageOn('mobile', { uncachedBytes: 800_000 })])).toContain('PERF-CACHE-TTL');
  });

  it('names uncompressed text', () => {
    expect(codesOf([pageOn('mobile', { uncompressedBytes: 300_000 })])).toContain(
      'PERF-RES-COMPRESSION',
    );
  });

  it('states the page-weight budget it is measuring against', () => {
    const findings = performanceFindings(
      ORIGIN,
      [pageOn('mobile', { totalBytes: 5_000_000 })],
      NO_FIELD,
    );
    const weight = findings.find((finding) => finding.ruleId === 'PERF-RES-WEIGHT');
    expect(weight?.summary).toContain('budget');
    expect(weight?.evidence).toMatchObject({ budgetBytes: 2_000_000 });
  });

  it('names a request count over budget', () => {
    expect(codesOf([pageOn('mobile', { requestCount: 200 })])).toContain('PERF-RES-REQUESTS');
  });

  it('names render-blocking resources once the delay is outside noise', () => {
    expect(codesOf([pageOn('mobile', { renderBlockingMs: 900 })])).toContain(
      'PERF-RENDER-BLOCKING',
    );
    expect(codesOf([pageOn('mobile', { renderBlockingMs: 50 })])).not.toContain(
      'PERF-RENDER-BLOCKING',
    );
  });

  it('marks its own verdicts provisional when the runs disagreed', () => {
    const unstable = pageOn('mobile', {
      lcpMs: { median: 4_500, samples: [1_000, 8_000], instability: 1.5 },
    });
    const findings = performanceFindings(ORIGIN, [unstable], NO_FIELD);
    const warning = findings.find((finding) => finding.ruleId === 'PERF-MEASUREMENT-UNSTABLE');

    expect(warning?.severity).toBe('info');
    expect(warning?.summary).toContain('provisional');
  });

  it('only ever raises rules it declares', () => {
    const findings = performanceFindings(
      ORIGIN,
      [
        pageOn('mobile', {
          ttfbMs: 3_000,
          lcpMs: 6_000,
          clsScore: 0.4,
          tbtMs: 900,
          totalBytes: 5_000_000,
          requestCount: 200,
          unusedJavaScriptBytes: 400_000,
          uncompressedBytes: 400_000,
          unoptimisedImageBytes: 400_000,
          uncachedBytes: 400_000,
          renderBlockingMs: 900,
        }),
      ],
      fieldWith({ inpP75Ms: 620, lcpP75Ms: 5_000 }),
    );
    const declared: readonly string[] = IMPLEMENTED_PERF_RULE_IDS;
    expect(findings.every((finding) => declared.includes(finding.ruleId))).toBe(true);
    expect(findings[0]?.severity).toBe('high');
  });
});

describe('performanceRegressions', () => {
  function auditWith(urls: readonly UrlAudit[]): PerformanceAudit {
    return {
      version: 'performance-audit-v1',
      origin: ORIGIN,
      fetchedAt: '2026-09-01T00:00:00.000Z',
      providers: [],
      urls,
      field: NO_FIELD,
      requestBudget: { cap: 14, used: 2, capped: false },
      findings: [],
      regressions: [],
      comparison: null,
      coverage: { applicableChecks: 1, completedApplicableChecks: 1, implementedRuleIds: [] },
      score: 80,
    };
  }

  const previous = {
    scanId: 'scan-previous',
    observedAt: '2026-09-01T00:00:00.000Z',
    audit: auditWith([pageOn('mobile', { lcpMs: 2_000, ttfbMs: 200, performanceScore: 90 })]),
  };

  it('has nothing to say without a previous scan', () => {
    expect(performanceRegressions([pageOn('mobile', { lcpMs: 9_000 })], null)).toEqual([]);
  });

  it('names a metric that got materially worse, with both readings', () => {
    const regressions = performanceRegressions([pageOn('mobile', { lcpMs: 4_000 })], previous);
    expect(regressions).toEqual([
      {
        url: ORIGIN,
        strategy: 'mobile',
        metric: 'lcpMs',
        previous: 2_000,
        current: 4_000,
        changeRatio: 1,
        previousScanId: 'scan-previous',
        previousObservedAt: '2026-09-01T00:00:00.000Z',
      },
    ]);
  });

  it('ignores a large ratio over a tiny absolute change', () => {
    // 200 ms -> 260 ms is +30%, and 60 ms is inside measurement noise.
    expect(performanceRegressions([pageOn('mobile', { ttfbMs: 260 })], previous)).toEqual([]);
  });

  it('reports a fallen Lighthouse score as the size of the fall', () => {
    const regressions = performanceRegressions(
      [pageOn('mobile', { performanceScore: 40 })],
      previous,
    );
    expect(regressions).toContainEqual(
      expect.objectContaining({ metric: 'performanceScore', previous: 90, current: 40 }),
    );
  });

  it('refuses to compare a different page or a different device', () => {
    const otherPage = performanceRegressions(
      [pageOn('mobile', { lcpMs: 9_000 }, 'https://example.com/other')],
      previous,
    );
    const otherDevice = performanceRegressions([pageOn('desktop', { lcpMs: 9_000 })], previous);
    expect(otherPage).toEqual([]);
    expect(otherDevice).toEqual([]);
  });

  it('does not touch the score: regressions are context, not a second penalty', () => {
    const current = auditWith([pageOn('mobile', { lcpMs: 9_000, performanceScore: 30 })]);
    const withRegressions = {
      ...current,
      regressions: performanceRegressions(current.urls, previous),
    };
    expect(withRegressions.regressions.length).toBeGreaterThan(0);
    expect(withRegressions.score).toBe(current.score);
  });
});

describe('compareWithPrevious', () => {
  const previousUrls = [pageOn('mobile', { lcpMs: 2_000, performanceScore: 90 })];
  const currentUrls = [pageOn('mobile', { lcpMs: 6_000, performanceScore: 40 })];

  function audit(urls: readonly UrlAudit[], lighthouseVersion: string | null): PerformanceAudit {
    return fakePerformanceAudit({
      origin: ORIGIN,
      urls,
      providers: [
        { name: 'pagespeed', version: lighthouseVersion, requests: 1, failures: 0 },
        { name: 'crux', version: null, requests: 0, failures: 0 },
      ],
    });
  }

  function previousScan(urls: readonly UrlAudit[], lighthouseVersion: string | null) {
    return {
      scanId: 'scan-previous',
      observedAt: '2026-09-01T00:00:00.000Z',
      audit: audit(urls, lighthouseVersion),
    };
  }

  it('says there is no comparison at all for a first scan', () => {
    expect(compareWithPrevious(audit(currentUrls, '12.0.0'), null)).toEqual({
      regressions: [],
      comparison: null,
    });
  });

  it('compares two runs of the same audit and the same Lighthouse major', () => {
    const result = compareWithPrevious(
      audit(currentUrls, '12.0.1'),
      previousScan(previousUrls, '12.0.0'),
    );
    expect(result.regressions.length).toBeGreaterThan(0);
    expect(result.comparison).toEqual({
      previousScanId: 'scan-previous',
      previousObservedAt: '2026-09-01T00:00:00.000Z',
      incomparableReason: null,
      incomparable: null,
    });
  });

  it('refuses to compare across a Lighthouse major, and says why', () => {
    const result = compareWithPrevious(
      audit(currentUrls, '12.0.0'),
      previousScan(previousUrls, '11.7.1'),
    );
    // A major release changes the scoring curve: this "regression" would be the
    // provider's, not the site's.
    expect(result.regressions).toEqual([]);
    expect(result.comparison?.incomparableReason).toContain('Lighthouse 11');
    // The code is what each reader's side phrases; the sentence beside it is the
    // English one an older client, and an unknown code, still fall back to.
    expect(result.comparison?.incomparable).toEqual({
      code: 'LighthouseMajorChanged',
      previous: '11',
      current: '12',
    });
  });

  it('refuses to compare when either side did not state a single Lighthouse version', () => {
    const unrecorded = compareWithPrevious(
      audit(currentUrls, null),
      previousScan(previousUrls, '12.0.0'),
    );
    expect(unrecorded.comparison?.incomparable?.code).toBe('LighthouseVersionUnrecorded');
    expect(
      compareWithPrevious(audit(currentUrls, null), previousScan(previousUrls, '12.0.0')).comparison
        ?.incomparableReason,
    ).toContain('did not record');
    expect(
      compareWithPrevious(
        audit(currentUrls, '12.0.0, 11.7.1'),
        previousScan(previousUrls, '12.0.0'),
      ).comparison?.incomparableReason,
    ).toContain('did not record');
  });

  it('refuses to compare across audit versions', () => {
    const older = previousScan(previousUrls, '12.0.0');
    const result = compareWithPrevious(audit(currentUrls, '12.0.0'), {
      ...older,
      audit: { ...older.audit, version: 'performance-audit-v0' as typeof older.audit.version },
    });
    expect(result.regressions).toEqual([]);
    expect(result.comparison?.incomparableReason).toContain('performance-audit-v0');
    expect(result.comparison?.incomparable).toEqual({
      code: 'AuditVersionChanged',
      previous: 'performance-audit-v0',
      current: 'performance-audit-v1',
    });
  });
});
