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
  mentions: { brand: true, domain: false },
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
