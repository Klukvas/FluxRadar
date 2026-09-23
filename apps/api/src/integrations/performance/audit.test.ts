// The Performance audit end to end, over a fake transport.
//
// No test in this file reaches PageSpeed Insights or the Chrome UX Report. Both
// are billable and rate-limited, and a suite that called them would be measuring
// Google's afternoon rather than this code.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runPerformanceAudit } from './audit.ts';
import { createDefaultPerformanceRunner, legacySnapshotOf } from './index.ts';
import { selectAuditUrls } from './url-selection.ts';
import { instabilityOf, median } from './sampling.ts';

const ORIGIN = 'https://example.com/';

interface LabValues {
  readonly score?: number;
  readonly ttfb?: number;
  readonly lcp?: number;
  readonly cls?: number;
  readonly tbt?: number;
  readonly totalBytes?: number;
  readonly requests?: number;
}

function lighthouseBody(values: LabValues): unknown {
  return {
    lighthouseResult: {
      lighthouseVersion: '12.0.0',
      analysisUTCTimestamp: '2026-09-22T11:59:00.000Z',
      categories: { performance: { score: (values.score ?? 80) / 100 } },
      audits: {
        'server-response-time': { numericValue: values.ttfb ?? 200 },
        'first-contentful-paint': { numericValue: 1_100 },
        'largest-contentful-paint': { numericValue: values.lcp ?? 2_000 },
        'cumulative-layout-shift': { numericValue: values.cls ?? 0.02 },
        'total-blocking-time': { numericValue: values.tbt ?? 120 },
        'speed-index': { numericValue: 1_800 },
        'total-byte-weight': { numericValue: values.totalBytes ?? 900_000 },
        'resource-summary': {
          details: { items: [{ resourceType: 'total', requestCount: values.requests ?? 40 }] },
        },
        'unused-javascript': { numericValue: 12, details: { overallSavingsBytes: 50_000 } },
        'render-blocking-resources': { numericValue: 80, details: { overallSavingsMs: 80 } },
      },
    },
  };
}

function cruxBody(): unknown {
  return {
    record: {
      metrics: {
        largest_contentful_paint: { percentiles: { p75: 2_300 } },
        interaction_to_next_paint: { percentiles: { p75: 90 } },
        cumulative_layout_shift: { percentiles: { p75: '0.05' } },
        experimental_time_to_first_byte: { percentiles: { p75: 540 } },
      },
      collectionPeriod: {
        firstDate: { year: 2026, month: 8, day: 26 },
        lastDate: { year: 2026, month: 9, day: 22 },
      },
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Routes PageSpeed and CrUX by host, so ordering never decides the assertion. */
function transport(options: {
  readonly lab?: (call: number) => Response;
  readonly crux?: Response;
}) {
  let labCalls = 0;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    if (String(input).includes('chromeuxreport')) {
      return options.crux ?? json(cruxBody());
    }
    labCalls += 1;
    return options.lab === undefined ? json(lighthouseBody({})) : options.lab(labCalls);
  });
  return { fetcher, labCallCount: () => labCalls };
}

describe('selectAuditUrls', () => {
  it('always measures the entry page first, and bounds the rest', () => {
    const selected = selectAuditUrls(
      ORIGIN,
      [
        'https://example.com/blog/2026/09/deep/post',
        'https://example.com/pricing',
        'https://example.com/about',
        'https://example.com/',
      ],
      3,
    );
    expect(selected).toEqual([
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/pricing',
    ]);
  });

  it('is stable across runs, so two scans compare the same pages', () => {
    const candidates = ['https://example.com/b', 'https://example.com/a', 'https://example.com/c'];
    expect(selectAuditUrls(ORIGIN, candidates)).toEqual(
      selectAuditUrls(ORIGIN, [...candidates].reverse()),
    );
  });

  it('leaves out other origins and things that are not pages', () => {
    const selected = selectAuditUrls(ORIGIN, [
      'https://other.example/page',
      'https://example.com/report.pdf',
      'https://example.com/real',
    ]);
    expect(selected).toEqual(['https://example.com/', 'https://example.com/real']);
  });
});

describe('sampling', () => {
  it('takes the middle value, not the mean, so one bad run cannot drag it', () => {
    expect(median([1_000, 1_100, 9_000])).toBe(1_100);
  });

  it('states the spread rather than smoothing it away', () => {
    expect(instabilityOf([1_000, 3_000], 2_000)).toBe(1);
    expect(instabilityOf([2_000], 2_000)).toBeNull();
  });
});

describe('runPerformanceAudit', () => {
  it('measures each selected page on both devices, repeatedly', async () => {
    const { fetcher, labCallCount } = transport({});
    const audit = await runPerformanceAudit(
      { origin: ORIGIN, candidateUrls: [ORIGIN, 'https://example.com/pricing'] },
      { fetcher, samplesPerTarget: 2, maxUrls: 2, cruxApiKey: 'crux-key' },
    );

    expect(audit.urls.map((entry) => entry.url)).toEqual([ORIGIN, 'https://example.com/pricing']);
    expect(audit.urls[0]?.devices.map((device) => device.strategy)).toEqual(['mobile', 'desktop']);
    // 2 pages × 2 devices × 2 samples.
    expect(labCallCount()).toBe(8);
    expect(audit.urls[0]?.devices[0]?.usableSamples).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(9);
  });

  it('reports a median and its instability, with the raw samples kept', async () => {
    const { fetcher } = transport({
      lab: (call) => json(lighthouseBody({ lcp: call === 1 ? 1_000 : 3_000 })),
    });
    const audit = await runPerformanceAudit(
      { origin: ORIGIN, candidateUrls: [], strategies: ['mobile'] },
      { fetcher, samplesPerTarget: 2, cruxApiKey: 'crux-key' },
    );

    const lcp = audit.urls[0]?.devices[0]?.metrics.lcpMs;
    expect(lcp?.samples).toEqual([1_000, 3_000]);
    expect(lcp?.median).toBe(2_000);
    expect(lcp?.instability).toBe(1);
  });

  it('keeps each measurement’s URL, device, provider version and timestamps', async () => {
    const { fetcher } = transport({});
    const audit = await runPerformanceAudit(
      { origin: ORIGIN, candidateUrls: [], strategies: ['mobile'] },
      { fetcher, samplesPerTarget: 1, now: () => new Date('2026-09-22T12:00:00.000Z') },
    );

    expect(audit.fetchedAt).toBe('2026-09-22T12:00:00.000Z');
    expect(audit.urls[0]?.url).toBe(ORIGIN);
    expect(audit.urls[0]?.devices[0]?.strategy).toBe('mobile');
    expect(audit.providers).toContainEqual({
      name: 'pagespeed',
      version: '12.0.0',
      requests: 1,
      failures: 0,
    });
    expect(audit.version).toBe('performance-audit-v1');
  });

  it('stops at the request cap and says that it did', async () => {
    const { fetcher, labCallCount } = transport({});
    const audit = await runPerformanceAudit(
      {
        origin: ORIGIN,
        candidateUrls: ['https://example.com/a', 'https://example.com/b'],
      },
      { fetcher, samplesPerTarget: 2, maxUrls: 3, maxRequests: 3 },
    );

    expect(labCallCount()).toBe(3);
    expect(audit.requestBudget).toEqual({ cap: 3, used: 3, capped: true });
    const reasons = audit.urls.flatMap((entry) =>
      entry.devices.flatMap((device) => device.failures),
    );
    expect(reasons).toContain('request budget reached before this sample was taken');
  });

  it('records a provider failure as a device with no usable samples, not as a throw', async () => {
    const { fetcher } = transport({ lab: () => json({}, 503) });
    const audit = await runPerformanceAudit(
      { origin: ORIGIN, candidateUrls: [], strategies: ['mobile'] },
      { fetcher, samplesPerTarget: 1 },
    );

    expect(audit.urls[0]?.devices[0]?.usableSamples).toBe(0);
    expect(audit.urls[0]?.devices[0]?.failures).toEqual(['PageSpeed Insights answered HTTP 503']);
    expect(audit.score).toBeNull();
    expect(audit.coverage.completedApplicableChecks).toBe(0);
  });

  it('sends no API key when none is configured', async () => {
    const { fetcher } = transport({});
    await runPerformanceAudit(
      { origin: ORIGIN, candidateUrls: [], strategies: ['mobile'] },
      { fetcher, samplesPerTarget: 1 },
    );
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain('key=');
  });

  it('does not ask the Chrome UX Report at all without its key', async () => {
    const { fetcher } = transport({});
    const audit = await runPerformanceAudit(
      { origin: ORIGIN, candidateUrls: [], strategies: ['mobile'] },
      { fetcher, samplesPerTarget: 1 },
    );

    expect(fetcher.mock.calls.every((call) => !String(call[0]).includes('chromeuxreport'))).toBe(
      true,
    );
    expect(audit.field.state).toBe('not_configured');
    expect(audit.field.metrics).toBeNull();
  });

  it('reads the field percentiles, including the CLS decimal string', async () => {
    const { fetcher } = transport({});
    const audit = await runPerformanceAudit(
      { origin: ORIGIN, candidateUrls: [], strategies: ['mobile'] },
      { fetcher, samplesPerTarget: 1, cruxApiKey: 'crux-key' },
    );

    expect(audit.field.state).toBe('available');
    expect(audit.field.metrics).toEqual({
      lcpP75Ms: 2_300,
      inpP75Ms: 90,
      clsP75: 0.05,
      ttfbP75Ms: 540,
      periodStart: '2026-08-26',
      periodEnd: '2026-09-22',
    });
  });

  it('reports no field data rather than substituting the lab run', async () => {
    const { fetcher } = transport({ crux: json({}, 404) });
    const audit = await runPerformanceAudit(
      { origin: ORIGIN, candidateUrls: [], strategies: ['mobile'] },
      { fetcher, samplesPerTarget: 1, cruxApiKey: 'crux-key' },
    );

    expect(audit.field.state).toBe('no_data');
    expect(audit.field.metrics).toBeNull();
    expect(audit.field.detail).toContain('Interaction to Next Paint');
  });

  it('never claims coverage of a PERF rule it does not implement', async () => {
    const { fetcher } = transport({});
    const audit = await runPerformanceAudit(
      { origin: ORIGIN, candidateUrls: [], strategies: ['mobile'] },
      { fetcher, samplesPerTarget: 1 },
    );
    for (const ruleId of audit.coverage.implementedRuleIds) {
      expect(ruleId.startsWith('PERF-')).toBe(true);
    }
    expect(
      audit.findings.every((finding) => audit.coverage.implementedRuleIds.includes(finding.ruleId)),
    ).toBe(true);
  });

  it('counts only the lab runs as applicable checks, so a quiet site is not Partial', async () => {
    const { fetcher } = transport({ crux: json({}, 404) });
    const audit = await runPerformanceAudit(
      { origin: ORIGIN, candidateUrls: [], strategies: ['mobile', 'desktop'] },
      { fetcher, samplesPerTarget: 1, cruxApiKey: 'crux-key' },
    );

    expect(audit.coverage).toMatchObject({
      applicableChecks: 2,
      completedApplicableChecks: 2,
    });
  });
});

describe('legacySnapshotOf', () => {
  it('states TBT under its own name and never as a lab INP', async () => {
    const { fetcher } = transport({});
    const audit = await runPerformanceAudit(
      { origin: ORIGIN, candidateUrls: [], strategies: ['mobile'] },
      { fetcher, samplesPerTarget: 1, cruxApiKey: 'crux-key' },
    );
    const snapshot = legacySnapshotOf(audit);

    expect(snapshot?.metrics).toMatchObject({ tbtMs: 120, inpP75Ms: 90 });
    expect(snapshot?.metrics).not.toHaveProperty('inpMs');
    expect(snapshot?.source).toBe('pagespeed+crux');
    expect(snapshot?.strategy).toBe('mobile');
  });

  it('is null when nothing at all was measured', async () => {
    const { fetcher } = transport({ lab: () => json({}, 500), crux: json({}, 404) });
    const audit = await runPerformanceAudit(
      { origin: ORIGIN, candidateUrls: [], strategies: ['mobile'] },
      { fetcher, samplesPerTarget: 1, cruxApiKey: 'crux-key' },
    );
    expect(legacySnapshotOf(audit)).toBeNull();
  });
});

// What a deployment actually spends per scan, which is not the same question as
// what the audit is capable of. Google throttles keyless callers rather than
// giving them a quota, so the full twelve-request audit on a deployment without
// a key would spend the next scan's requests as well — and a 429 is recorded as
// a failed check, i.e. a Partial section on a paid scan.
describe('createDefaultPerformanceRunner', () => {
  const OTHER_PAGES = ['https://example.com/pricing', 'https://example.com/about'];

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('measures one page on one device, once, without a key', async () => {
    vi.stubEnv('PAGESPEED_API_KEY', '');
    const { fetcher, labCallCount } = transport({});

    const audit = await createDefaultPerformanceRunner({ fetcher })({
      origin: ORIGIN,
      candidateUrls: OTHER_PAGES,
    });

    expect(labCallCount()).toBe(1);
    expect(audit.urls).toHaveLength(1);
    expect(audit.urls[0]?.url).toBe(ORIGIN);
    expect(audit.urls[0]?.devices.map((device) => device.strategy)).toEqual(['mobile']);
    // Honest, not flattering: the one run it asked for is the one it closed, so
    // the reduced audit completes instead of reporting a larger one it never ran.
    expect(audit.coverage).toMatchObject({ applicableChecks: 1, completedApplicableChecks: 1 });
    expect(audit.requestBudget).toMatchObject({ cap: 1, used: 1, capped: false });
  });

  it('keeps the device the caller asked for when it has to pick one', async () => {
    vi.stubEnv('PAGESPEED_API_KEY', '');
    const { fetcher } = transport({});

    const audit = await createDefaultPerformanceRunner({ fetcher })({
      origin: ORIGIN,
      candidateUrls: [],
      strategies: ['desktop'],
    });

    expect(audit.urls[0]?.devices.map((device) => device.strategy)).toEqual(['desktop']);
  });

  // The scan states a preference, not a single device: the orchestrator hands
  // over `devicePreferenceFor(scope.device)`, which is always both devices with
  // the profile's own first. Dropping the wrong one here is how a site profiled
  // for desktop would be measured on mobile and never say so — so the drop is
  // asserted through the runner the API actually builds, over a fake transport.
  it('drops the second device, not the first, when the caller states a preference', async () => {
    vi.stubEnv('PAGESPEED_API_KEY', '');
    const { fetcher, labCallCount } = transport({});

    const audit = await createDefaultPerformanceRunner({ fetcher })({
      origin: ORIGIN,
      candidateUrls: OTHER_PAGES,
      strategies: ['desktop', 'mobile'],
    });

    expect(audit.urls[0]?.devices.map((device) => device.strategy)).toEqual(['desktop']);
    expect(labCallCount()).toBe(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('strategy=DESKTOP');
  });

  it('measures every page on both devices, repeatedly, once a key is configured', async () => {
    vi.stubEnv('PAGESPEED_API_KEY', 'pagespeed-key');
    const { fetcher, labCallCount } = transport({});

    const audit = await createDefaultPerformanceRunner({ fetcher })({
      origin: ORIGIN,
      candidateUrls: OTHER_PAGES,
    });

    // Three pages, both devices, two samples each.
    expect(labCallCount()).toBe(12);
    expect(audit.urls).toHaveLength(3);
    expect(audit.coverage).toMatchObject({ applicableChecks: 6, completedApplicableChecks: 6 });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('key=pagespeed-key');
  });
});
