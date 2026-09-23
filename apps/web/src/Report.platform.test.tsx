// The three report surfaces the platform lane added: the bounded Performance
// audit, the Bing section, and the server-rendered PDF download.
//
// Every case here is about a sentence the screen must not say. A median from runs
// that disagreed by half is not "3.1 s"; a Bing read that failed is not "0
// clicks"; a comparison that could not be made is not "nothing got worse"; and a
// refused download is not a silent no-op with the printable page still promising
// a complete report.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Dashboard, Scan, ScanModule } from './api';
import { copy, fillCopy, type Language } from './i18n';
import { ResultsScreen } from './Report';

const SCAN: Scan = {
  id: 'scan-platform-1',
  profileId: 'profile-1',
  plan: 'Complete',
  domain: 'https://smile.example',
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-mvp-0.1',
  progress: { completedModules: 1, totalModules: 1 },
  startedAt: '2026-09-14T00:00:00.000Z',
  completedAt: '2026-09-14T00:01:00.000Z',
  createdAt: '2026-09-14T00:00:00.000Z',
  modules: [],
};

function moduleOf(overrides: Partial<ScanModule>): ScanModule {
  return {
    module: 'SEO',
    status: 'Completed',
    statusReason: null,
    coverage: 1,
    score: 90,
    applicableChecks: 4,
    completedApplicableChecks: 4,
    usableOutput: true,
    metadata: {},
    ...overrides,
  };
}

function series(median: number | null, samples: readonly number[], instability: number | null) {
  return { median, samples, instability };
}

/** A device entry of the stored audit, with the metrics the panel reads. */
function device(
  strategy: 'mobile' | 'desktop',
  overrides: Readonly<Record<string, unknown>> = {},
  usableSamples = 2,
) {
  return {
    strategy,
    requestedSamples: 2,
    usableSamples,
    failures: [],
    metrics: {
      performanceScore: series(70, [68, 72], 0.05),
      lcpMs: series(3_100, [3_000, 3_200], 0.06),
      tbtMs: series(420, [400, 440], 0.1),
      clsScore: series(0.04, [0.03, 0.05], 0.5),
      ttfbMs: series(120, [110, 130], 0.16),
      totalBytes: series(1_460_000, [1_400_000, 1_520_000], 0.08),
      requestCount: series(64, [62, 66], 0.06),
      ...overrides,
    },
  };
}

function auditModule(audit: Readonly<Record<string, unknown>>): ScanModule {
  return moduleOf({
    module: 'Performance',
    metadata: {
      // The flat snapshot the report has always stored stays at the top level.
      source: 'pagespeed',
      origin: 'https://smile.example/',
      strategy: 'mobile',
      performanceScore: 70,
      metrics: { lcpMs: 3_100, ttfbMs: 120, clsScore: 0.04, tbtMs: 420, htmlBytes: 1_460_000 },
      fetchedAt: '2026-09-14T00:01:00.000Z',
      audit,
    },
  });
}

function fullAudit(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    version: 'performance-audit-v1',
    origin: 'https://smile.example/',
    fetchedAt: '2026-09-14T00:01:00.000Z',
    providers: [
      { name: 'pagespeed', version: '12.0.0', requests: 4, failures: 0 },
      { name: 'crux', version: null, requests: 1, failures: 0 },
    ],
    urls: [
      {
        url: 'https://smile.example/',
        primary: true,
        devices: [device('mobile'), device('desktop')],
      },
      { url: 'https://smile.example/pricing', primary: false, devices: [device('mobile')] },
    ],
    field: { state: 'no_data', scope: 'origin', detail: 'no record', metrics: null },
    requestBudget: { cap: 14, used: 6, capped: false },
    findings: [],
    regressions: [],
    comparison: null,
    coverage: { applicableChecks: 3, completedApplicableChecks: 3, implementedRuleIds: [] },
    score: 70,
    ...overrides,
  };
}

function bingModule(section: Readonly<Record<string, unknown>>): ScanModule {
  return moduleOf({
    module: 'Analytics',
    metadata: {
      source: 'google',
      readOnly: true,
      fetchedAt: '2026-09-14T00:01:00.000Z',
      dateRange: { startDate: '2026-08-18', endDate: '2026-09-14' },
      searchConsole: { state: 'not_connected', detail: 'not connected', data: null },
      analytics: { state: 'not_connected', detail: 'not connected', data: null },
      bing: section,
    },
  });
}

function bingSection(
  webmaster: Readonly<Record<string, unknown>>,
  findings: readonly Readonly<Record<string, unknown>>[] = [],
) {
  return {
    snapshot: {
      source: 'bing',
      readOnly: true,
      fetchedAt: '2026-09-14T00:01:00.000Z',
      dateRange: { startDate: '2026-08-18', endDate: '2026-09-14' },
      webmaster,
    },
    findings,
  };
}

function dashboardOf(modules: readonly ScanModule[], scan: Scan = SCAN): Dashboard {
  return {
    scan: { ...scan, modules: [] },
    overall: { verdict: 'ok', score: 90, weightedCoverage: 1, moduleWeights: [] },
    modules,
    geoObservations: [],
  };
}

interface Fetched {
  readonly urls: string[];
}

/**
 * Renders the report screen. `pdf` decides what the PDF route answers, so the
 * download path can be exercised without a server.
 */
async function openReport(
  dashboard: Dashboard,
  options: {
    readonly pdf?: Response;
    readonly onError?: (value: string) => void;
    readonly language?: Language;
  } = {},
): Promise<Fetched> {
  const language = options.language ?? 'en';
  const fetched: Fetched = { urls: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      fetched.urls.push(url);
      if (url.includes('report.pdf')) {
        return Promise.resolve(options.pdf ?? new Response('%PDF-1.7', { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, data: dashboard, error: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  render(
    <ResultsScreen
      scan={dashboard.scan}
      language={language}
      onScan={() => {}}
      onIssues={() => {}}
      onReports={() => {}}
      onError={options.onError ?? (() => {})}
    />,
  );
  await screen.findByText(copy[language].report.signalHeading);
  return fetched;
}

/** Opens the section's checks window, in whichever language the report is in. */
function checksRegion(module: string, language: Language = 'en'): HTMLElement {
  const t = copy[language].report.checks;
  fireEvent.click(screen.getByRole('button', { name: t.show }));
  return screen.getByRole('region', {
    name: fillCopy(t.heading, { module }),
  });
}

function performanceRegion(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Show checks' }));
  return screen.getByRole('region', { name: 'Performance · checks performed' });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the Performance card with a bounded audit', () => {
  it('lists every page it measured, on both devices, with the run count', async () => {
    await openReport(dashboardOf([auditModule(fullAudit())]));
    const region = performanceRegion();

    expect(within(region).getByText('https://smile.example/')).toBeInTheDocument();
    expect(within(region).getByText('https://smile.example/pricing')).toBeInTheDocument();
    // Two devices for the headline page, one for the second: three device groups.
    expect(within(region).getAllByText(/2 of 2 runs usable/)).toHaveLength(3);
    expect(within(region).getByText(/Lighthouse 12\.0\.0/)).toBeInTheDocument();
    expect(within(region).getByText(/6 of 14 provider requests used/)).toBeInTheDocument();
  });

  it('marks a median its runs disagreed about, instead of presenting it as the figure', async () => {
    await openReport(dashboardOf([auditModule(fullAudit())]));
    const region = performanceRegion();
    // clsScore was measured twice with a spread of half the median.
    expect(
      within(region).getAllByText(/unstable: the runs differed by 50%/).length,
    ).toBeGreaterThan(0);
  });

  it('shows Total Blocking Time under its own name and no lab INP at all', async () => {
    await openReport(dashboardOf([auditModule(fullAudit())]));
    const region = performanceRegion();

    expect(within(region).getAllByText(/Total Blocking Time \(TBT, lab proxy\)/).length).toBe(3);
    // The only INP on the screen is the sentence saying it was not measured.
    expect(
      within(region).getByText(/Interaction to Next Paint needs real visitors/),
    ).toBeInTheDocument();
  });

  it('says a device produced nothing rather than showing it as zero', async () => {
    const audit = fullAudit({
      urls: [
        {
          url: 'https://smile.example/',
          primary: true,
          devices: [
            device('mobile'),
            {
              strategy: 'desktop',
              requestedSamples: 2,
              usableSamples: 0,
              failures: ['PageSpeed Insights answered HTTP 429'],
              metrics: {},
            },
          ],
        },
      ],
    });
    await openReport(dashboardOf([auditModule(audit)]));
    const region = performanceRegion();
    expect(
      within(region).getByText(/None of the 2 runs produced a measurement for this device/),
    ).toBeInTheDocument();
  });

  it('says the request budget was reached when it was', async () => {
    const audit = fullAudit({ requestBudget: { cap: 6, used: 6, capped: true } });
    await openReport(dashboardOf([auditModule(audit)]));
    expect(within(performanceRegion()).getByText(/request budget was reached/)).toBeInTheDocument();
  });

  // A deployment with no PageSpeed API key measures one page, on one device,
  // once. The panel used to open by describing both devices and repeated runs
  // directly above a row reading "1 of 1 runs usable".
  it('opens with the method this audit used, not the one a keyed deployment runs', async () => {
    const reduced = fullAudit({
      urls: [
        {
          url: 'https://smile.example/',
          primary: true,
          devices: [
            {
              strategy: 'mobile',
              requestedSamples: 1,
              usableSamples: 1,
              failures: [],
              metrics: {
                performanceScore: series(70, [70], null),
                lcpMs: series(3_100, [3_100], null),
                ttfbMs: series(120, [120], null),
              },
            },
          ],
        },
      ],
      requestBudget: { cap: 1, used: 1, capped: false },
    });
    await openReport(dashboardOf([auditModule(reduced)]));
    const region = performanceRegion();

    expect(
      within(region).getByText(/measured on one emulated device \(mobile\), once/),
    ).toBeInTheDocument();
    expect(within(region).queryByText(/on both emulated devices/)).toBeNull();
    expect(within(region).queryByText(/more than once/)).toBeNull();
  });

  it('says both devices and repeated runs when that is what it did', async () => {
    await openReport(dashboardOf([auditModule(fullAudit())]));

    expect(
      within(performanceRegion()).getByText(/on both emulated devices, more than once/),
    ).toBeInTheDocument();
  });

  it('states why the previous scan was not compared, instead of implying nothing changed', async () => {
    const audit = fullAudit({
      comparison: {
        previousScanId: 'scan-0',
        previousObservedAt: '2026-09-01T00:00:00.000Z',
        incomparableReason: 'Lighthouse 11 measured the previous scan and Lighthouse 12 this one',
      },
    });
    await openReport(dashboardOf([auditModule(audit)]));
    const region = performanceRegion();
    expect(within(region).getByText(/Not compared with the previous scan/)).toBeInTheDocument();
    expect(within(region).queryByText(/Nothing measured here got materially worse/)).toBeNull();
  });

  // The reason used to be the API's English clause inside a Ukrainian frame.
  it('says why the comparison was refused in the reader’s language', async () => {
    const audit = fullAudit({
      comparison: {
        previousScanId: 'scan-0',
        previousObservedAt: '2026-09-01T00:00:00.000Z',
        incomparableReason: 'Lighthouse 11 measured the previous scan and Lighthouse 12 this one',
        incomparable: { code: 'LighthouseMajorChanged', previous: '11', current: '12' },
      },
    });
    await openReport(dashboardOf([auditModule(audit)]), { language: 'uk' });
    const region = checksRegion('Performance', 'uk');

    expect(
      within(region).getByText(/попереднє сканування виміряв Lighthouse 11, а це — Lighthouse 12/),
    ).toBeInTheDocument();
    expect(within(region).queryByText(/measured the previous scan/)).toBeNull();
  });

  it('keeps the stored sentence for a comparison written before the code existed', async () => {
    const audit = fullAudit({
      comparison: {
        previousScanId: 'scan-0',
        previousObservedAt: '2026-09-01T00:00:00.000Z',
        incomparableReason: 'one of the two scans did not record a single Lighthouse version',
      },
    });
    await openReport(dashboardOf([auditModule(audit)]), { language: 'uk' });

    expect(
      within(checksRegion('Performance', 'uk')).getByText(
        /did not record a single Lighthouse version/,
      ),
    ).toBeInTheDocument();
  });

  it('lists a regression when the two scans were comparable', async () => {
    const audit = fullAudit({
      comparison: {
        previousScanId: 'scan-0',
        previousObservedAt: '2026-09-01T00:00:00.000Z',
        incomparableReason: null,
      },
      regressions: [
        {
          url: 'https://smile.example/',
          strategy: 'mobile',
          metric: 'lcpMs',
          previous: 2_000,
          current: 3_100,
          changeRatio: 0.55,
        },
      ],
    });
    await openReport(dashboardOf([auditModule(audit)]));
    const region = performanceRegion();
    expect(within(region).getByText(/2000 → 3100/)).toBeInTheDocument();
  });

  it('falls back to the single flat reading a pre-audit report stored', async () => {
    const legacy = moduleOf({
      module: 'Performance',
      metadata: {
        source: 'pagespeed',
        strategy: 'mobile',
        metrics: { lcpMs: 3_100, cls: 0.3, ttfbMs: 120, htmlBytes: 1_460_000, inpMs: null },
      },
    });
    await openReport(dashboardOf([legacy]));
    const region = performanceRegion();
    expect(
      within(region).getByRole('heading', { name: 'Lab test · PageSpeed Insights · mobile' }),
    ).toBeInTheDocument();
  });

  it('shows a pre-audit byte count as the HTML size it was, not as page weight', async () => {
    // `htmlBytes` measured the document alone; the audit's `totalBytes` measures
    // the whole transfer. Showing the old key under the new name would make one
    // scan look ten times heavier than the next for no reason anybody changed.
    const legacy = moduleOf({
      module: 'Performance',
      metadata: {
        source: 'pagespeed',
        strategy: 'mobile',
        metrics: { lcpMs: 3_100, ttfbMs: 120, htmlBytes: 142_000 },
      },
    });
    await openReport(dashboardOf([legacy]));
    const region = performanceRegion();

    expect(within(region).getByText('HTML document size')).toBeInTheDocument();
    expect(within(region).queryByText('Total page weight')).toBeNull();
  });

  it('shows the audit’s own byte count as the page’s total weight', async () => {
    await openReport(dashboardOf([auditModule(fullAudit())]));
    const region = performanceRegion();

    expect(within(region).getAllByText('Total page weight').length).toBeGreaterThan(0);
  });
});

describe('the Bing section of the Analytics card', () => {
  it('shows Bing’s own totals, days reported and queries', async () => {
    const section = bingSection({
      state: 'connected',
      detail: 'Bing returned data for this period.',
      data: {
        siteUrl: 'https://smile.example/',
        totals: { clicks: 120, impressions: 4_000, ctr: 0.03, days: 21 },
        previousTotals: { clicks: 90, impressions: 3_000, ctr: 0.03, days: 28 },
        topQueries: [
          {
            query: 'dental implants kyiv',
            clicks: 40,
            impressions: 900,
            ctr: 0.044,
            avgImpressionPosition: 7.4,
            avgClickPosition: 4.1,
            // A period total, summed from the days Bing reported it on.
            days: 12,
          },
        ],
        dailyTraffic: [],
        unavailableReads: [],
      },
    });
    await openReport(dashboardOf([bingModule(section)]));
    fireEvent.click(screen.getByRole('button', { name: 'Show checks' }));
    const region = screen.getByRole('region', { name: 'Analytics · checks performed' });

    expect(within(region).getByText('Bing data')).toBeInTheDocument();
    expect(within(region).getByText('120')).toBeInTheDocument();
    expect(within(region).getByText('21')).toBeInTheDocument();
    expect(within(region).getByText('dental implants kyiv')).toBeInTheDocument();
    // Bing's position is stated as Bing's own, never differenced against Google's.
    expect(
      within(region).getByText(/not comparable with the position Search Console/),
    ).toBeInTheDocument();
  });

  it('names the half Bing did not answer instead of printing zeroes', async () => {
    const section = bingSection(
      {
        state: 'connected',
        detail: 'Bing answered part of this section.',
        data: {
          siteUrl: 'https://smile.example/',
          totals: null,
          previousTotals: null,
          topQueries: [],
          dailyTraffic: [],
          unavailableReads: ['traffic'],
        },
      },
      [
        {
          code: 'BING-READ-UNAVAILABLE',
          severity: 'info',
          summary: 'Bing did not return daily clicks and impressions for this period.',
          recommendation: 'Nothing on the site caused this.',
        },
      ],
    );
    await openReport(dashboardOf([bingModule(section)]));
    fireEvent.click(screen.getByRole('button', { name: 'Show checks' }));
    const region = screen.getByRole('region', { name: 'Analytics · checks performed' });

    // Twice, deliberately: the panel states it where the totals would have been,
    // and the finding list repeats it as a note.
    expect(
      within(region).getAllByText(/Bing did not return daily clicks and impressions/),
    ).toHaveLength(2);
    expect(within(region).queryByText('0')).toBeNull();
  });

  // The API builds the finding's sentence in English at scan time. The report is
  // read in either language, so the sentence on screen is rebuilt from the code
  // and the evidence numbers rather than printed as stored.
  it('states a finding in the reader’s language, with the API’s own numbers', async () => {
    const section = bingSection(
      {
        state: 'connected',
        detail: 'Bing returned data for this period.',
        data: {
          siteUrl: 'https://smile.example/',
          totals: { clicks: 55, impressions: 4_000, ctr: 0.0138, days: 28 },
          previousTotals: { clicks: 100, impressions: 5_000, ctr: 0.02, days: 28 },
          topQueries: [],
          dailyTraffic: [],
          unavailableReads: [],
        },
      },
      [
        {
          code: 'BING-TRAFFIC-DROP',
          severity: 'attention',
          summary: 'Bing clicks fell 45.0% against the previous period.',
          recommendation: 'Check Bing Webmaster Tools for crawl or indexing changes.',
          evidence: { clicks: 55, previousClicks: 100, changeRatio: -0.45 },
        },
      ],
    );

    await openReport(dashboardOf([bingModule(section)]), { language: 'uk' });
    const region = checksRegion('Analytics', 'uk');

    expect(
      within(region).getByText('Кліки з Bing впали на 45.0% порівняно з попереднім періодом.'),
    ).toBeInTheDocument();
    expect(within(region).queryByText(/Bing clicks fell/)).toBeNull();
    // The code stays: it is the identifier an owner quotes to support.
    expect(within(region).getByText(/BING-TRAFFIC-DROP · Перевірте/)).toBeInTheDocument();
  });

  // A stored finding this build has no copy for still has to reach the reader.
  it('falls back to the API’s sentence for a code it does not know', async () => {
    const section = bingSection(
      {
        state: 'connected',
        detail: 'Bing returned data for this period.',
        data: {
          siteUrl: 'https://smile.example/',
          totals: { clicks: 55, impressions: 4_000, ctr: 0.0138, days: 28 },
          previousTotals: null,
          topQueries: [],
          dailyTraffic: [],
          unavailableReads: [],
        },
      },
      [
        {
          code: 'BING-SOMETHING-LATER',
          severity: 'info',
          summary: 'A finding this build has never seen.',
          recommendation: 'Do the thing it says.',
          evidence: {},
        },
      ],
    );

    await openReport(dashboardOf([bingModule(section)]), { language: 'uk' });
    const region = checksRegion('Analytics', 'uk');

    expect(within(region).getByText('A finding this build has never seen.')).toBeInTheDocument();
  });

  it('explains an unavailable section in the reader’s language, not the API’s', async () => {
    const section = bingSection({
      state: 'no_property_selected',
      detail: 'No Bing site is linked to this profile yet.',
      data: null,
    });
    await openReport(dashboardOf([bingModule(section)]));
    fireEvent.click(screen.getByRole('button', { name: 'Show checks' }));
    const region = screen.getByRole('region', { name: 'Analytics · checks performed' });
    expect(within(region).getByText('No Bing site linked')).toBeInTheDocument();
  });
});

describe('the PDF download', () => {
  it('asks the server for the report in the reader’s language', async () => {
    const fetched = await openReport(dashboardOf([moduleOf({})]));
    fireEvent.click(screen.getByRole('button', { name: 'Download full report (PDF)' }));

    await waitFor(() =>
      expect(fetched.urls.some((url) => url.includes('/report.pdf?language=en'))).toBe(true),
    );
  });

  it('keeps the printable page beside it as the fallback', async () => {
    await openReport(dashboardOf([moduleOf({})]));
    expect(screen.getByRole('button', { name: 'Download full report (PDF)' })).toBeInTheDocument();
    expect(
      screen.getByText(/Rendered on the server with every finding of this scan/),
    ).toBeInTheDocument();
  });

  it('reports a refused download in words, naming the exports that hold everything', async () => {
    const errors: string[] = [];
    await openReport(dashboardOf([moduleOf({})]), {
      onError: (value) => errors.push(value),
      pdf: new Response(
        JSON.stringify({
          success: false,
          data: null,
          error: { code: 'PDF_TOO_LARGE', message: 'too many findings' },
        }),
        { status: 413, headers: { 'content-type': 'application/json' } },
      ),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download full report (PDF)' }));

    await waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toContain('JSON and CSV exports');
  });

  it('is not offered for the Free check, which has the printable page', async () => {
    const free = { ...SCAN, plan: 'Free' as const };
    await openReport(dashboardOf([moduleOf({})], free));
    expect(screen.queryByRole('button', { name: 'Download full report (PDF)' })).toBeNull();
  });
});
