// Opening a section card to see what it checked.
//
// The Accessibility card said "Completed · 98.80 · coverage 100%" and nothing
// about which checks produced that. A card that recorded its checks now opens
// to the list. The AI SEO / GEO card opens to its crawler and page readiness and
// to the questions it asked the AI provider — which used to be a block of its
// own, beside a query-ideas table that was generated for the reader instead of
// being asked.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Dashboard, GeoObservation, Scan, ScanModule } from './api';
import type { Language } from './i18n';
import { ResultsScreen } from './Report';

const SCAN: Scan = {
  id: 'scan-1',
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

const ACCESSIBILITY_CHECKS = [
  {
    ruleId: 'A11Y-001',
    title: 'text contrast',
    targetKind: 'page',
    scoring: 'scored',
    applicableTargets: 5,
    affectedTargets: 0,
  },
  {
    ruleId: 'A11Y-002',
    title: 'alt text',
    targetKind: 'page',
    scoring: 'scored',
    applicableTargets: 5,
    affectedTargets: 2,
  },
  {
    ruleId: 'A11Y-004',
    title: 'form labels',
    targetKind: 'page',
    scoring: 'scored',
    applicableTargets: 0,
    affectedTargets: 0,
  },
];

const DISCOVERY: GeoObservation = {
  purpose: 'discovery',
  question: 'Which dental clinics offer implants in Kyiv?',
  status: 'answered',
  reason: null,
  provider: 'anthropic',
  modelId: 'claude-sonnet-5',
  answer: 'Smile Clinic offers implants in Kyiv.',
  citations: [],
  mentions: { brand: 'mentioned', domain: 'not-mentioned' },
};

function moduleOf(overrides: Partial<ScanModule>): ScanModule {
  return {
    module: 'SEO',
    status: 'Completed',
    statusReason: null,
    coverage: 1,
    score: 98.8,
    applicableChecks: 11,
    completedApplicableChecks: 11,
    usableOutput: true,
    metadata: {},
    ...overrides,
  };
}

function accessibilityModule(): ScanModule {
  return moduleOf({ module: 'Accessibility', metadata: { ruleChecks: ACCESSIBILITY_CHECKS } });
}

function dashboardOf(
  modules: readonly ScanModule[],
  geoObservations: readonly GeoObservation[] = [],
): Dashboard {
  return {
    scan: SCAN,
    overall: {
      verdict: 'ok',
      score: 90,
      weightedCoverage: 1,
      moduleWeights: [{ module: 'Accessibility', tariffWeight: 1, effectiveWeight: 1 }],
    },
    modules,
    geoObservations,
  };
}

async function openReport(dashboard: Dashboard, language: Language = 'en'): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, data: dashboard, error: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
  render(
    <ResultsScreen
      scan={dashboard.scan}
      language={language}
      onScan={() => {}}
      onIssues={() => {}}
      onReports={() => {}}
      onError={() => {}}
    />,
  );
  await screen.findByText(language === 'uk' ? 'Звіт аудиту сайту' : 'Site audit report');
}

/** The card by its section name, scoped to the grid: the plan disclosure repeats the names. */
function card(name: string): HTMLElement {
  const grid = document.querySelector('.module-grid') as HTMLElement;
  return within(grid).getByText(name).closest('.module-card') as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * A rendered page is not automatically a complete one.
 *
 * The crawler already recorded which requests it refused, and nothing read it:
 * a page whose main bundle the byte budget could not pay for was counted beside
 * the complete ones, and the card said the markup had been "read after the
 * page's scripts ran". That sentence was a claim about a DOM that was never
 * built, which is the difference between a limitation and a false result.
 */
describe('a card whose pages rendered without their own resources', () => {
  it('names the pages and why, beside the ones that rendered whole', async () => {
    await openReport(
      dashboardOf([
        moduleOf({
          module: 'Accessibility',
          metadata: {
            ruleChecks: ACCESSIBILITY_CHECKS,
            javascriptRendering: 'Rendered',
            renderEngine: 'chromium 140',
            renderedPages: 5,
            unrenderedPages: 0,
            incompletelyRenderedPages: 2,
            incompleteRenderReasons: ['budget', 'robots-disallowed'],
          },
        }),
      ]),
    );
    fireEvent.click(card('Accessibility'));

    const region = screen.getByRole('region', { name: 'Accessibility · checks performed' });
    expect(region).toHaveTextContent('rendered: 5');
    expect(region).toHaveTextContent('On 2 of them the page asked for resources');
    expect(region).toHaveTextContent('budget, robots-disallowed');
  });

  it('says nothing extra when every rendered page got what it asked for', async () => {
    await openReport(
      dashboardOf([
        moduleOf({
          module: 'Accessibility',
          metadata: {
            ruleChecks: ACCESSIBILITY_CHECKS,
            javascriptRendering: 'Rendered',
            renderEngine: 'chromium 140',
            renderedPages: 5,
            unrenderedPages: 0,
            incompletelyRenderedPages: 0,
            incompleteRenderReasons: [],
          },
        }),
      ]),
    );
    fireEvent.click(card('Accessibility'));

    const region = screen.getByRole('region', { name: 'Accessibility · checks performed' });
    expect(region).toHaveTextContent('rendered: 5');
    expect(region).not.toHaveTextContent('asked for resources');
  });
});

describe('a section card that recorded its checks', () => {
  it('opens to every check and what it found when the card is clicked', async () => {
    await openReport(dashboardOf([accessibilityModule()]));
    expect(screen.queryByRole('region', { name: 'Accessibility · checks performed' })).toBeNull();

    fireEvent.click(card('Accessibility'));

    const region = screen.getByRole('region', { name: 'Accessibility · checks performed' });
    const rows = within(region).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Passed');
    expect(rows[0]).toHaveTextContent('Text contrast');
    expect(rows[0]).toHaveTextContent('No issues · pages checked: 5');
    expect(rows[1]).toHaveTextContent('Issues found');
    expect(rows[1]).toHaveTextContent('Pages with issues: 2 of 5');
    // A form-label check on a site with no forms did not pass; it had nothing to look at.
    expect(rows[2]).toHaveTextContent('Not applicable');
  });

  it('toggles from its own button too, and says whether the list is open', async () => {
    await openReport(dashboardOf([accessibilityModule()]));

    const show = screen.getByRole('button', { name: 'Show checks' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(show);

    // The button sits inside the clickable card: one press must toggle once, not twice.
    const hide = screen.getByRole('button', { name: 'Hide checks' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Accessibility · checks performed' })).toBeTruthy();

    fireEvent.click(hide);
    expect(screen.queryByRole('region', { name: 'Accessibility · checks performed' })).toBeNull();
  });

  it('names the checks in the reader’s language', async () => {
    await openReport(dashboardOf([accessibilityModule()]), 'uk');

    fireEvent.click(card('Accessibility'));

    const region = screen.getByRole('region', { name: 'Accessibility · виконані перевірки' });
    const first = within(region).getByText('Контраст тексту').closest('li') as HTMLElement;
    expect(first).toHaveTextContent('Пройдено');
  });

  it('has nothing to open on a scan that recorded no checks', async () => {
    await openReport(dashboardOf([moduleOf({ module: 'Security', metadata: {} })]));

    expect(screen.queryByRole('button', { name: 'Show checks' })).toBeNull();
    expect(card('Security')).not.toHaveClass('module-card--expandable');
  });

  it('does not arrive open on another report with a section of the same name', async () => {
    const first = dashboardOf([accessibilityModule()]);
    const second: Dashboard = { ...first, scan: { ...SCAN, id: 'scan-2' } };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: input.includes('/scans/scan-2/') ? second : first,
              error: null,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      ),
    );
    const screenFor = (dashboard: Dashboard) => (
      <ResultsScreen
        scan={dashboard.scan}
        language="en"
        onScan={() => {}}
        onIssues={() => {}}
        onReports={() => {}}
        onError={() => {}}
      />
    );
    const view = render(screenFor(first));
    await screen.findByText('Site audit report');
    fireEvent.click(card('Accessibility'));
    expect(screen.getByRole('region', { name: 'Accessibility · checks performed' })).toBeTruthy();

    // The same component instance, handed a different report: nothing unmounts
    // to reset the open section for free.
    view.rerender(screenFor(second));

    expect(await screen.findByRole('button', { name: 'Show checks' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Accessibility · checks performed' })).toBeNull();
  });
});

// The two silences of an API check. One endpoint was never part of this audit;
// the other was checked, answered nothing, and is what lowered the section's own
// coverage. Calling the second "not applicable" tells the owner the opposite of
// what the score already said.
describe('the configured API endpoints a section lists', () => {
  const ANSWERED = {
    method: 'GET',
    url: 'https://smile.example/api/health',
    expectedStatus: [200],
    status: 200,
    timingMs: 12,
    applicable: true,
  };
  const TIMED_OUT = {
    method: 'GET',
    url: 'https://smile.example/api/slow',
    expectedStatus: [],
    status: null,
    timingMs: null,
    applicable: true,
    skippedReason: 'TimeoutError',
  };
  const OFF_SITE = {
    method: 'GET',
    url: 'https://elsewhere.example/api',
    expectedStatus: [],
    status: null,
    timingMs: null,
    applicable: false,
    skippedReason: 'OutsideScannedSite',
  };

  function reliabilityModule(apiChecks: readonly Record<string, unknown>[]): ScanModule {
    return moduleOf({ module: 'Reliability', metadata: { apiChecks } });
  }

  async function apiRows(apiChecks: readonly Record<string, unknown>[]): Promise<HTMLElement[]> {
    await openReport(dashboardOf([reliabilityModule(apiChecks)]));
    fireEvent.click(card('Reliability'));
    const region = screen.getByRole('region', { name: 'Reliability · checks performed' });
    return within(region).getAllByRole('listitem');
  }

  it('says "not checked" about an endpoint it could not reach, not "not applicable"', async () => {
    const rows = await apiRows([ANSWERED, TIMED_OUT, OFF_SITE]);

    expect(rows[0]).toHaveTextContent('Passed');
    expect(rows[1]).toHaveTextContent('Not checked');
    expect(rows[1]).not.toHaveTextContent('Not applicable');
    expect(rows[1]).toHaveTextContent('No response was recorded (TimeoutError).');
    // An endpoint on somebody else's site really was not part of this audit.
    expect(rows[2]).toHaveTextContent('Not applicable');
  });

  /** The same row as a scan stored before the flag was recorded. */
  function withoutTheFlag(check: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(check).filter(([key]) => key !== 'applicable'));
  }

  it('reads a scan recorded before the flag from the reason it stored', async () => {
    const rows = await apiRows([withoutTheFlag(TIMED_OUT), withoutTheFlag(OFF_SITE)]);

    expect(rows[0]).toHaveTextContent('Not checked');
    expect(rows[1]).toHaveTextContent('Not applicable');
  });
});

describe('the report around the cards', () => {
  it('no longer carries a separate accessibility scope banner', async () => {
    await openReport(dashboardOf([accessibilityModule()]));

    expect(screen.queryByText(/Automated DOM\/CSS checks are shown/)).toBeNull();
    expect(screen.queryByText('Accessibility · WCAG 2.2 AA')).toBeNull();
  });

  it('offers no query-idea generator of its own', async () => {
    await openReport(dashboardOf([accessibilityModule()]));

    expect(screen.queryByText('AI query ideas')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Generate ideas' })).toBeNull();
  });
});

describe('the AI SEO / GEO card', () => {
  it('opens to crawler access, page readiness and the questions it asked', async () => {
    const geo = moduleOf({
      module: 'AI SEO / GEO',
      score: 100,
      metadata: {
        robots: {
          status: 'available',
          agents: [
            { userAgent: 'GPTBot', status: 'allowed' },
            { userAgent: 'ClaudeBot', status: 'blocked' },
          ],
        },
        pages: {
          checked: 4,
          extractableContent: 4,
          structuredData: 1,
          socialPreview: 0,
          checks: [],
        },
        providerVisibility: {
          queryGeneration: {
            status: 'Completed',
            generatedQuestions: [DISCOVERY.question, 'Which family dentists work in Kyiv?'],
          },
        },
      },
    });
    await openReport(dashboardOf([geo], [DISCOVERY]));
    // Not a block of its own any more: the observations are part of what the section checked.
    expect(screen.queryByRole('region', { name: 'AI visibility observations' })).toBeNull();

    fireEvent.click(card('AI SEO / GEO'));

    const region = screen.getByRole('region', { name: 'AI SEO / GEO · checks performed' });
    const row = (text: string): HTMLElement =>
      within(region).getByText(text).closest('li') as HTMLElement;
    expect(row('GPTBot')).toHaveTextContent('Allowed');
    expect(row('ClaudeBot')).toHaveTextContent('Blocked');
    expect(row('Readable text content with headings')).toHaveTextContent('Pages: 4 of 4');
    expect(row('Readable text content with headings')).toHaveTextContent('Passed');
    expect(row('Complete structured data (JSON-LD)')).toHaveTextContent('Partial');
    expect(row('Social preview metadata')).toHaveTextContent('Missing');
    expect(
      within(region).getByText(/^2 search questions were written from your saved profile context/),
    ).toBeInTheDocument();
    expect(within(region).getByText(DISCOVERY.question)).toBeInTheDocument();
    expect(within(region).getByText('Smile Clinic offers implants in Kyiv.')).toBeInTheDocument();
    expect(within(region).getByText('Brand mentioned')).toBeInTheDocument();
  });

  it('shows one group per assistant, OpenAI first, with its own mention counts', async () => {
    const chatgptAnswered: GeoObservation = {
      ...DISCOVERY,
      provider: 'openai',
      modelId: 'gpt-5.6-terra',
      question: 'Which dental clinics offer implants in Kyiv?',
      answer: 'ChatGPT names Smile Clinic among Kyiv implant clinics.',
      citations: ['https://smile.example/implants'],
      mentions: { brand: 'mentioned', domain: 'mentioned' },
    };
    const chatgptUnavailable: GeoObservation = {
      purpose: 'awareness',
      question: 'What is Smile Clinic?',
      status: 'unavailable',
      reason: 'ProviderUnavailable',
      provider: 'openai',
      modelId: null,
      answer: null,
      citations: [],
      mentions: null,
    };
    const geo = moduleOf({ module: 'AI SEO / GEO', score: 100, metadata: {} });

    await openReport(dashboardOf([geo], [DISCOVERY, chatgptAnswered, chatgptUnavailable]));
    fireEvent.click(card('AI SEO / GEO'));

    const region = screen.getByRole('region', { name: 'AI SEO / GEO · checks performed' });
    const headings = within(region)
      .getAllByRole('heading', { level: 5 })
      .map((heading) => heading.textContent);
    // OpenAI first: it is the assistant customers ask about.
    expect(headings).toEqual([
      'ChatGPT · OpenAI · gpt-5.6-terra',
      'Claude · Anthropic · claude-sonnet-5',
    ]);
    // The unanswered OpenAI question sits under OpenAI's own heading, not
    // Anthropic's and not in a group of its own.
    const openAiGroup = within(region)
      .getByText('ChatGPT · OpenAI · gpt-5.6-terra')
      .closest('.module-checks__group') as HTMLElement;
    expect(within(openAiGroup).getByText('What is Smile Clinic?')).toBeInTheDocument();
    expect(
      within(openAiGroup).getByText(
        'Brand mentioned in 1 of 1 answers · Official domain referenced in 1 of 1',
      ),
    ).toBeInTheDocument();
    const anthropicGroup = within(region)
      .getByText('Claude · Anthropic · claude-sonnet-5')
      .closest('.module-checks__group') as HTMLElement;
    expect(within(anthropicGroup).getByText(/Official domain referenced in 0 of 1/)).toBeTruthy();
  });

  it('still renders an observation written before the provider was recorded', async () => {
    const preRelease: GeoObservation = { ...DISCOVERY, provider: null, modelId: null };
    const geo = moduleOf({ module: 'AI SEO / GEO', score: 100, metadata: {} });

    await openReport(dashboardOf([geo], [preRelease]));
    fireEvent.click(card('AI SEO / GEO'));

    const region = screen.getByRole('region', { name: 'AI SEO / GEO · checks performed' });
    expect(within(region).getByText('Provider not recorded')).toBeInTheDocument();
    expect(within(region).getByText(preRelease.question)).toBeInTheDocument();
  });

  it('explains an unreadable robots.txt instead of listing every crawler as unknown', async () => {
    const geo = moduleOf({
      module: 'AI SEO / GEO',
      status: 'Unavailable',
      usableOutput: false,
      coverage: null,
      score: null,
      metadata: {
        robots: { status: 'unavailable', agents: [{ userAgent: 'GPTBot', status: 'unknown' }] },
        pages: { checked: 0, extractableContent: 0, structuredData: 0, socialPreview: 0 },
      },
    });
    await openReport(dashboardOf([geo]));

    fireEvent.click(card('AI SEO / GEO'));

    const region = screen.getByRole('region', { name: 'AI SEO / GEO · checks performed' });
    expect(within(region).getByText(/robots\.txt was not found or could not be read/)).toBeTruthy();
    expect(within(region).queryByText('GPTBot')).toBeNull();
    expect(
      within(region).getByText('No page could be read, so page readiness was not checked.'),
    ).toBeTruthy();
    expect(within(region).getByText(/^No questions were asked of the AI provider/)).toBeTruthy();
  });
});

describe('the Performance card', () => {
  const performance = moduleOf({
    module: 'Performance',
    score: 91,
    metadata: {
      source: 'pagespeed+crux',
      origin: 'https://smile.example',
      strategy: 'mobile',
      performanceScore: 91,
      metrics: {
        ttfbMs: 120,
        lcpMs: 3100,
        inpMs: null,
        cls: 0.3,
        htmlBytes: 1_460_000,
        lcpP75Ms: 2300,
        inpP75Ms: 90,
        clsP75: 0.05,
      },
      fetchedAt: '2026-09-14T00:01:00.000Z',
    },
  });

  it('opens to each measurement rated against its threshold', async () => {
    await openReport(dashboardOf([performance]));

    fireEvent.click(screen.getByRole('button', { name: 'Show checks' }));

    const region = screen.getByRole('region', { name: 'Performance · checks performed' });
    const lab = within(region)
      .getByRole('heading', { name: 'Lab test · PageSpeed Insights · mobile' })
      .closest('.module-checks__group') as HTMLElement;
    const rows = within(lab).getAllByRole('listitem');
    // Four lab rows, not five: the old `inpMs` key is not listed at all.
    // Lighthouse cannot measure Interaction to Next Paint, so that key was always
    // null, and rating it as "no data" implied a figure might appear there.
    expect(rows).toHaveLength(4);
    expect(within(lab).queryByText(/Interaction to Next Paint/)).toBeNull();
    expect(rows[0]).toHaveTextContent('Needs improvement');
    expect(rows[0]).toHaveTextContent('3.1 s · good ≤ 2.5 s, poor > 4 s');
    expect(rows[1]).toHaveTextContent('Poor');
    expect(rows[2]).toHaveTextContent('Good');
    expect(rows[2]).toHaveTextContent('120 ms · good ≤ 800 ms, poor > 1.8 s');
    // Page weight has no published boundary, so it is never rated.
    expect(rows[3]).toHaveTextContent('Measured');
    expect(rows[3]).toHaveTextContent('1.5 MB');

    const field = within(region)
      .getByRole('heading', { name: 'Real visitors · Chrome UX Report, 75th percentile' })
      .closest('.module-checks__group') as HTMLElement;
    expect(within(field).getAllByRole('listitem')).toHaveLength(3);
  });

  it('has nothing to open when the measurement service never answered', async () => {
    await openReport(
      dashboardOf([
        moduleOf({
          module: 'Performance',
          status: 'Unavailable',
          statusReason: 'PerformanceProviderUnavailable',
          score: null,
          coverage: 0,
          usableOutput: false,
          metadata: {},
        }),
      ]),
    );

    expect(screen.queryByRole('button', { name: 'Show checks' })).toBeNull();
  });
});

describe('the UX/Conversion card', () => {
  const signals = {
    pagesAnalyzed: 4,
    pagesWithActions: 4,
    pagesWithForms: 1,
    pagesWithContactSignals: 2,
    pagesWithHeadings: 3,
  };

  it('opens to its checks, what the page HTML showed and the AI review', async () => {
    const ux = moduleOf({
      module: 'UX/Conversion',
      score: null,
      metadata: {
        staticSignals: signals,
        ai: { status: 'Completed', findings: 2, provider: 'anthropic', modelId: 'claude-sonnet-5' },
        ruleChecks: [
          {
            ruleId: 'UX-CONV-STATIC-001',
            title: 'entry-page primary heading',
            targetKind: 'page',
            scoring: 'informational',
            applicableTargets: 1,
            affectedTargets: 1,
          },
          {
            ruleId: 'UX-CONV-AI-002',
            title: 'primary action clarity',
            targetKind: 'page',
            scoring: 'informational',
            applicableTargets: 4,
            affectedTargets: 0,
          },
        ],
      },
    });
    await openReport(dashboardOf([ux]));

    fireEvent.click(card('UX/Conversion'));

    const region = screen.getByRole('region', { name: 'UX/Conversion · checks performed' });
    const heading = within(region).getByText('Main heading on the entry page').closest('li');
    expect(heading).toHaveTextContent('Noted');
    expect(
      within(region).getByText('Clear primary action · AI review').closest('li'),
    ).toHaveTextContent('Passed');
    expect(within(region).getByText('Pages with forms').closest('li')).toHaveTextContent('1 / 4');
    expect(
      within(region).getByText(/^anthropic · claude-sonnet-5 reviewed the pages/),
    ).toHaveTextContent('Findings: 2');
  });

  it('opens a report written before the per-rule list to its signals and AI review', async () => {
    const ux = moduleOf({
      module: 'UX/Conversion',
      status: 'Partial',
      statusReason: 'UxAiConsentMissing',
      score: null,
      metadata: {
        staticSignals: signals,
        ai: { status: 'Unavailable', statusReason: 'UxAiConsentMissing', findings: 0 },
      },
    });
    await openReport(dashboardOf([ux]));

    fireEvent.click(screen.getByRole('button', { name: 'Show checks' }));

    const region = screen.getByRole('region', { name: 'UX/Conversion · checks performed' });
    expect(within(region).getByText('Pages with headings').closest('li')).toHaveTextContent(
      '3 / 4',
    );
    expect(within(region).getByText(/^The AI review did not run in this scan/)).toBeTruthy();
  });
});

// D-218/D-219: UX/Conversion and Analytics used to read "No score" beside
// findings, and the Google data sat in a block of its own below every card.
// Both now score their findings outside the overall score, and the Google data
// opens inside the Analytics card, under the checks that read it.

describe('the side-score cards', () => {
  it('say their score is separate from the overall score', async () => {
    const ux = moduleOf({ module: 'UX/Conversion', score: 97.5 });
    await openReport(dashboardOf([ux]));

    expect(card('UX/Conversion')).toHaveTextContent('97.50');
    expect(card('UX/Conversion')).toHaveTextContent(
      'Separate score, not part of the overall score',
    );
  });

  it('lists a scored UX finding as an issue, not a neutral note', async () => {
    const ux = moduleOf({
      module: 'UX/Conversion',
      score: 97,
      metadata: {
        ruleChecks: [
          {
            ruleId: 'UX-CONV-AI-003',
            title: 'conversion friction and trust',
            targetKind: 'page',
            scoring: 'scored',
            applicableTargets: 12,
            affectedTargets: 3,
          },
        ],
      },
    });
    await openReport(dashboardOf([ux]));

    fireEvent.click(card('UX/Conversion'));

    expect(
      screen.getByText('Conversion friction and trust · AI review').closest('li'),
    ).toHaveTextContent('Issues found');
  });
});

describe('the Analytics card', () => {
  const snapshot = {
    source: 'google',
    readOnly: true,
    fetchedAt: '2026-09-17T22:35:00.000Z',
    dateRange: { startDate: '2026-08-18', endDate: '2026-09-14' },
    searchConsole: {
      state: 'connected',
      detail: 'ok',
      data: {
        siteUrl: 'sc-domain:smile.example',
        totals: { clicks: 0, impressions: 130, ctr: 0, position: 22.6 },
        topQueries: [{ key: 'jobber ai', clicks: 0, impressions: 13, ctr: 0, position: 21.3 }],
        topPages: [],
      },
    },
    analytics: {
      state: 'connected',
      detail: 'ok',
      data: {
        propertyId: '1',
        propertyName: 'Smile GA4',
        users: 7,
        sessions: 9,
        pageViews: 26,
        events: 46,
        keyEvents: null,
      },
    },
  };

  const checks = [
    {
      ruleId: 'ANALYTICS-SC-001',
      title: 'organic search trend',
      targetKind: 'site',
      scoring: 'scored',
      applicableTargets: 1,
      affectedTargets: 1,
    },
    {
      ruleId: 'ANALYTICS-SC-003',
      title: 'queries close to the top results',
      targetKind: 'site',
      scoring: 'informational',
      applicableTargets: 1,
      affectedTargets: 1,
    },
  ];

  const analysis = {
    trend: { metric: 'impressions', previous: 400, current: 130 },
    nearTop: [{ query: 'job cover', impressions: 90, position: 18.5 }],
    topPages: [
      {
        url: 'https://smile.example/',
        impressions: 37,
        clicks: 0,
        findings: 4,
        highestSeverity: 'High',
        ruleIds: ['SEO-TECH-004', 'A11Y-002'],
      },
    ],
  };

  function analyticsModule(overrides: Partial<ScanModule> = {}): ScanModule {
    return moduleOf({
      module: 'Analytics',
      score: 90,
      applicableChecks: 7,
      completedApplicableChecks: 7,
      metadata: { ...snapshot, ruleChecks: checks, analysis },
      ...overrides,
    });
  }

  it('keeps the Google data inside the card instead of a block of its own', async () => {
    await openReport(dashboardOf([analyticsModule()]));

    expect(screen.queryByText('Search Console')).toBeNull();

    fireEvent.click(card('Analytics'));

    const region = screen.getByRole('region', { name: 'Analytics · checks performed' });
    expect(within(region).getByText('Google data')).toBeTruthy();
    expect(within(region).getByText('Search Console')).toBeTruthy();
    expect(within(region).getByText('Smile GA4')).toBeTruthy();
  });

  it('opens to its checks and what they concluded', async () => {
    await openReport(dashboardOf([analyticsModule()]));

    fireEvent.click(card('Analytics'));

    const region = screen.getByRole('region', { name: 'Analytics · checks performed' });
    expect(within(region).getByText('Organic search trend').closest('li')).toHaveTextContent(
      'Issues found',
    );
    expect(
      within(region)
        .getByText('Queries close to the top results', { selector: 'li *' })
        .closest('li'),
    ).toHaveTextContent('Noted');
    expect(within(region).getByText('Impressions: 400 → 130 (−68%)')).toBeTruthy();
    expect(within(region).getByText('job cover').closest('tr')).toHaveTextContent('18.5');
    const topPage = within(region).getByText('https://smile.example/').closest('tr');
    expect(topPage).toHaveTextContent('High');
    // Which checks found them, by the id the Issue Center searches by.
    expect(topPage).toHaveTextContent('SEO-TECH-004 · A11Y-002');
  });

  it('names why a Google check could not judge, instead of blaming the pages', async () => {
    await openReport(
      dashboardOf([
        analyticsModule({
          metadata: {
            ...snapshot,
            analysis,
            ruleChecks: [
              {
                ruleId: 'ANALYTICS-GA-001',
                title: 'key events recorded',
                targetKind: 'site',
                scoring: 'scored',
                applicableTargets: 0,
                affectedTargets: 0,
              },
            ],
          },
        }),
      ]),
    );

    fireEvent.click(card('Analytics'));

    const row = screen.getByText('Key events recorded in GA4').closest('li');
    expect(row).toHaveTextContent('Not applicable');
    expect(row).toHaveTextContent('No sessions in the period');
    expect(row).not.toHaveTextContent('Nothing on the pages read');
  });

  it('says when the checks of a Google service without data did not run', async () => {
    await openReport(
      dashboardOf([
        analyticsModule({
          status: 'Partial',
          statusReason: 'AnalyticsPropertyNotSelected',
          completedApplicableChecks: 5,
        }),
      ]),
    );

    fireEvent.click(card('Analytics'));

    expect(
      screen.getByText(/Checks that need a Google service this scan got no data from/),
    ).toBeTruthy();
  });

  it('opens a report from before the checks to its Google data alone', async () => {
    await openReport(
      dashboardOf([analyticsModule({ score: null, applicableChecks: 2, metadata: snapshot })]),
    );

    fireEvent.click(card('Analytics'));

    const region = screen.getByRole('region', { name: 'Analytics · checks performed' });
    expect(within(region).getByText('Search Console')).toBeTruthy();
    expect(within(region).queryByText('Organic search trend')).toBeNull();
  });

  it('names its checks and conclusions in Ukrainian', async () => {
    await openReport(dashboardOf([analyticsModule()]), 'uk');

    fireEvent.click(card('Analytics'));

    expect(screen.getByText('Динаміка органічного пошуку')).toBeTruthy();
    expect(screen.getByText('Покази: 400 → 130 (−68%)')).toBeTruthy();
    expect(screen.getByText('Дані Google')).toBeTruthy();
  });
});
