// What the report says about the plan it was run on.
//
// Two defects, one screen. A finished section looked like a running one: its
// coverage was drawn with the design system's progress zebra and its percentage
// carried no word saying what had been measured, so "Completed · 100%" read as a
// bar still filling. And a section the plan never runs sends no module row at
// all, so a Free report showed four SEO checks and said nothing whatsoever about
// security or accessibility — an absence a reader has no reason to notice.
//
// The disclosure below the cards answers both halves of "what did I get": what
// ran, from the module rows themselves, and what this plan does not reach, from
// the tariff matrix (pinned in plan-modules.test.ts).

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResultsScreen } from './Report';
import type { Language } from './i18n';
import type { Dashboard, Scan, ScanModule } from './api';

const FREE_CHECK_TITLES = ['title', 'H1-H6 structure', 'meta description', 'index/noindex'];

function scanOf(plan: Scan['plan']): Scan {
  return {
    id: 'scan-1',
    profileId: 'profile-1',
    plan,
    domain: 'https://jobber-app.com',
    status: 'Completed',
    statusReason: null,
    scope: { includeSubdomains: false },
    rulesetVersion: 'rules-v1',
    progress: { completedModules: 1, totalModules: 1 },
    startedAt: '2026-09-06T00:00:00.000Z',
    completedAt: '2026-09-06T00:01:00.000Z',
    createdAt: '2026-09-06T00:00:00.000Z',
    modules: [],
  } as unknown as Scan;
}

function moduleOf(overrides: Partial<ScanModule> = {}): ScanModule {
  return {
    module: 'SEO',
    status: 'Completed',
    statusReason: null,
    coverage: 1,
    score: 82.5,
    applicableChecks: 12,
    completedApplicableChecks: 12,
    usableOutput: true,
    metadata: {},
    ...overrides,
  };
}

function freeSeoModule(): ScanModule {
  return moduleOf({
    score: null,
    applicableChecks: 4,
    completedApplicableChecks: 4,
    metadata: {
      freeCheck: true,
      scope: 'homepage only',
      scoring: 'NotScoredOnFreePlan',
      checks: FREE_CHECK_TITLES.map((title, index) => ({ ruleId: `RULE-${index}`, title })),
    },
  });
}

function dashboardOf(plan: Scan['plan'], modules: readonly ScanModule[]): Dashboard {
  const scan = scanOf(plan);
  const scored = plan !== 'Free';
  return {
    scan,
    overall: {
      verdict: scored ? 'ok' : 'insufficient_data',
      score: scored ? 74 : null,
      weightedCoverage: scored ? 0.9 : 0,
      moduleWeights: scored ? [{ module: 'SEO', tariffWeight: 1, effectiveWeight: 1 }] : [],
    },
    modules,
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

/**
 * The disclosure element.
 *
 * By class rather than by role: `<details>` maps to the `group` role, which
 * happy-dom's accessibility tree does not expose, and the point of the test is
 * the element's own open state.
 */
function scopeSection(): HTMLDetailsElement {
  const element = document.querySelector('.plan-scope');
  if (element === null) throw new Error('the report rendered no plan-scope disclosure');
  return element as HTMLDetailsElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the plan-scope disclosure', () => {
  it('is closed until it is asked for, and opens without script of ours', async () => {
    await openReport(dashboardOf('Free', [freeSeoModule()]));

    const scope = scopeSection();
    expect(scope.open).toBe(false);
    // The lists are in the DOM either way; what a closed disclosure owes the
    // reader is that they are not shown, and not announced.
    expect(screen.getByText('Ran in this report')).not.toBeVisible();

    fireEvent.click(within(scope).getByText('What the Free check covered'));

    expect(scope.open).toBe(true);
    expect(screen.getByText('Ran in this report')).toBeVisible();
    expect(screen.getByText('Only on paid plans')).toBeVisible();
  });

  it('names the checks the Free run actually completed', async () => {
    await openReport(dashboardOf('Free', [freeSeoModule()]));

    const completed = screen.getByRole('region', { name: 'Ran in this report' });
    const line = within(completed).getByRole('listitem').textContent ?? '';
    expect(line).toContain('SEO');
    expect(line).toContain('4 of 4 checks');
    for (const title of FREE_CHECK_TITLES) expect(line).toContain(title);
  });

  it('names what a Free report did not cover, and the plan that adds it', async () => {
    await openReport(dashboardOf('Free', [freeSeoModule()]));

    const locked = screen.getByRole('region', { name: 'Only on paid plans' });
    const entries = within(locked)
      .getAllByRole('listitem')
      .map((item) => item.textContent);

    expect(entries).toEqual([
      'AI SEO / GEOIncluded in Basic',
      'SecurityIncluded in Complete',
      'PerformanceIncluded in Complete',
      'AccessibilityIncluded in Complete',
      'ReliabilityIncluded in Complete',
      'Content QualityIncluded in Complete',
      'PrivacyIncluded in Complete',
      'UX/ConversionIncluded in Complete',
      'AnalyticsIncluded in Complete',
    ]);
  });

  it('does not offer a Basic reader what Basic already ran', async () => {
    await openReport(
      dashboardOf('Basic', [
        moduleOf(),
        moduleOf({ module: 'AI SEO / GEO', coverage: 0.5, status: 'Partial' }),
      ]),
    );

    const locked = within(screen.getByRole('region', { name: 'Only on paid plans' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent);

    expect(locked.join(' ')).not.toContain('AI SEO / GEO');
    expect(locked).toContain('SecurityIncluded in Complete');
    // A partial section is still a section that ran, and says how it ended.
    const completed = within(screen.getByRole('region', { name: 'Ran in this report' }));
    expect(completed.getByText(/AI SEO \/ GEO/)).toBeTruthy();
  });

  it('tells a Complete reader there is nothing left to buy', async () => {
    await openReport(dashboardOf('Complete', [moduleOf()]));

    const locked = screen.getByRole('region', { name: 'Only on paid plans' });
    expect(within(locked).queryAllByRole('listitem')).toEqual([]);
    expect(
      within(locked).getByText('This plan runs every audit section FluxRadar offers.'),
    ).toBeTruthy();
  });

  it('is written in the reader’s language', async () => {
    await openReport(dashboardOf('Free', [freeSeoModule()]), 'uk');

    expect(screen.getByText('Що охопила перевірка Free')).toBeTruthy();
    expect(
      screen.getByText(
        'Кожен розділ аудиту нижче або виконувався в цьому звіті, або він належить до тарифу, за яким цю перевірку не запускали.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Виконувалося в цьому звіті')).toBeTruthy();
    expect(screen.getByText('Лише в платних тарифах')).toBeTruthy();
    expect(screen.getByText(/перевірок: 4 з 4/)).toBeTruthy();
    // The plan names are catalogue literals and stay in English in both locales.
    expect(screen.getByText('Входить у тариф Basic')).toBeTruthy();
    expect(screen.queryByText('Included in Basic')).toBeNull();
  });
});

describe('a section that has finished', () => {
  it('does not present a platform-failed scan as a completed score', async () => {
    const dashboard = dashboardOf('Complete', [moduleOf()]);
    await openReport({
      ...dashboard,
      scan: {
        ...dashboard.scan,
        status: 'Failed',
        statusReason: 'PlatformFailure',
      },
      overall: {
        ...dashboard.overall,
        verdict: 'normal',
        score: 74,
      },
    });

    const dial = screen.getByRole('status', { name: 'Unavailable' });
    expect(within(dial).getByText('Unavailable')).toBeInTheDocument();
    expect(within(dial).queryByText('74.00')).toBeNull();
    expect(within(dial).queryByText('Completed')).toBeNull();
  });

  it('says the number is coverage instead of leaving a bare percentage', async () => {
    await openReport(dashboardOf('Free', [freeSeoModule()]));

    const meter = screen.getByRole('meter', { name: 'SEO coverage' });
    expect(meter.textContent).toBe('Coverage100%');
    // The zebra is the progress texture; a finished measurement is not progress.
    expect(meter).toHaveClass('progress--result');
  });

  it('is announced as a measurement rather than as a task still running', async () => {
    await openReport(dashboardOf('Free', [freeSeoModule()]));

    const meter = screen.getByRole('meter', { name: 'SEO coverage' });
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '100%');
    // A finished report has nothing left in progress for a reader to wait on.
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('wears its own result on the card, not only in the chip', async () => {
    await openReport(
      dashboardOf('Complete', [
        moduleOf(),
        moduleOf({ module: 'Security', status: 'Partial', coverage: 0.4, score: 40 }),
        moduleOf({
          module: 'Analytics',
          status: 'Unavailable',
          statusReason: 'NotConfigured',
          usableOutput: false,
          coverage: null,
          score: null,
        }),
      ]),
    );

    // Scoped to the grid: the disclosure below it names the same sections.
    const grid = document.querySelector('.module-grid') as HTMLElement;
    const cardFor = (name: string): Element | null =>
      within(grid).getByText(name).closest('.module-card');
    expect(cardFor('SEO')).toHaveClass('module-card--ok');
    expect(cardFor('Security')).toHaveClass('module-card--warning');
    expect(cardFor('Analytics')).toHaveClass('module-card--error');
  });

  it('keeps the coverage-unavailable line for a section with nothing to measure', async () => {
    await openReport(
      dashboardOf('Complete', [
        moduleOf({
          module: 'Analytics',
          status: 'Unavailable',
          statusReason: 'NotConfigured',
          usableOutput: false,
          coverage: null,
          score: null,
        }),
      ]),
    );

    // Neither role: there is no measurement to show and nothing is running.
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText(/coverage unavailable/)).toBeTruthy();
  });

  it('opens the GEO card to the actual questions, answers, and mention result', async () => {
    const dashboard = {
      ...dashboardOf('Complete', [moduleOf({ module: 'AI SEO / GEO' })]),
      geoObservations: [
        {
          purpose: 'discovery' as const,
          question: 'Which dental clinics offer emergency appointments in Kyiv?',
          status: 'answered' as const,
          reason: null,
          provider: 'anthropic',
          modelId: 'claude-sonnet-5',
          answer: 'Smile Clinic offers emergency appointments in Kyiv.',
          citations: ['https://smile.example/emergency'],
          mentions: { brand: true, domain: true },
        },
      ],
    };
    await openReport(dashboard);

    // No separate block any more: what the model answered is part of what the
    // section checked, so it opens from the section's own card.
    expect(screen.queryByRole('region', { name: 'AI visibility observations' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show checks' }));

    const region = screen.getByRole('region', { name: 'AI SEO / GEO · checks performed' });
    expect(within(region).getByText('Domain discovery question')).toBeInTheDocument();
    expect(
      within(region).getByText('Which dental clinics offer emergency appointments in Kyiv?'),
    ).toBeInTheDocument();
    expect(
      within(region).getByText('Smile Clinic offers emergency appointments in Kyiv.'),
    ).toBeInTheDocument();
    expect(within(region).getByText('Brand mentioned')).toBeInTheDocument();
    expect(within(region).getByText('Official domain referenced')).toBeInTheDocument();
    expect(
      within(region).getByRole('link', { name: 'https://smile.example/emergency' }),
    ).toHaveAttribute('href', 'https://smile.example/emergency');
  });
});
