import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Dashboard, Scan, ScanModule } from './api';
import { copy, type Language } from './i18n';
import { ResultsScreen } from './Report';

const IDS = [
  'SEO-ONPAGE-001',
  'SEO-ONPAGE-003',
  'SEO-ONPAGE-002',
  'SEO-TECH-008',
  'SEO-SOCIAL-001',
  'SEO-ONPAGE-005',
];
const SEO: ScanModule = {
  module: 'SEO',
  status: 'Completed',
  statusReason: null,
  coverage: 1,
  score: 40,
  scoreMax: 40,
  applicableChecks: 6,
  completedApplicableChecks: 6,
  usableOutput: true,
  metadata: {
    freeCheck: true,
    checks: IDS.map((ruleId) => ({ ruleId, title: ruleId })),
    ruleChecks: IDS.map((ruleId) => ({
      ruleId,
      title: ruleId,
      targetKind: 'page',
      scoring: 'scored',
      applicableTargets: 1,
      affectedTargets: ruleId === 'SEO-SOCIAL-001' ? 1 : 0,
    })),
  },
};
const SCAN = {
  id: 'free-checks',
  profileId: 'profile-1',
  plan: 'Free',
  domain: 'https://smile.example',
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-v1',
  progress: { completedModules: 1, totalModules: 1 },
  startedAt: '2026-11-07T00:00:00.000Z',
  completedAt: '2026-11-07T00:01:00.000Z',
  createdAt: '2026-11-07T00:00:00.000Z',
  modules: [],
} as unknown as Scan;

async function openReport(
  language: Language = 'en',
  module = SEO,
  plan: Scan['plan'] = 'Free',
  onUpgrade = vi.fn(),
) {
  const scan = { ...SCAN, plan };
  const dashboard = {
    scan,
    modules: [module],
    overall: {
      verdict: 'normal',
      score: 40,
      scoreMax: plan === 'Free' ? 40 : 100,
      weightedCoverage: 1,
      moduleWeights: [],
    },
    geoObservations: [],
  } as Dashboard;
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
      scan={scan}
      language={language}
      onScan={() => {}}
      onIssues={() => {}}
      onOpenProblem={() => {}}
      onReports={() => {}}
      onError={() => {}}
      onUpgrade={onUpgrade}
    />,
  );
  await screen.findByText(copy[language].report.windowTitle);
  const card = document.querySelector('.module-card');
  if (!(card instanceof HTMLElement)) throw new Error('Missing SEO card');
  fireEvent.click(within(card).getByRole('button'));
  return { card, panel: document.getElementById('module-checks-seo') as HTMLElement, onUpgrade };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Free report distinguishes points, performed checks and paid catalog', () => {
  it('labels the score in points and explains rounding while stating the actual six checks', async () => {
    const { card } = await openReport();
    expect(within(card).getByText('Homepage score: 40 / 40 points')).toBeInTheDocument();
    expect(within(card).getByText('Checks in this report: 6')).toBeInTheDocument();
    expect(within(card).getByText('Rounded to a whole number.')).toBeInTheDocument();
    expect(document.querySelector('.free-score')).not.toHaveTextContent(
      '100% of the checks were done',
    );
    expect(document.querySelector('.upsell > p')).toHaveTextContent(/\b6\b/);
  });

  it('puts the recorded issue first, then passes, with separately named groups', async () => {
    const { panel } = await openReport();
    const groups = within(panel).getAllByRole('heading', { level: 4 });
    expect(groups.slice(0, 2).map((el) => el.textContent)).toEqual([
      'Issues found · 1',
      'Passed · 5',
    ]);
    expect(
      within(panel).getByRole('button', { name: /Link preview for social networks/ }),
    ).toBeInTheDocument();
    expect(panel.querySelector('.free-seo-checks__group')?.textContent).toContain('SEO-SOCIAL-001');
  });

  it('offers real unrun checks without result badges or focusable fake results', async () => {
    const { panel, onUpgrade } = await openReport();
    const locked = screen.getByRole('region', { name: 'What Complete adds' });
    expect(
      within(locked).getByText(/These checks were not run in this Free report/),
    ).toBeInTheDocument();
    expect(within(locked).getByText('Sitemap (sitemap.xml)')).toBeInTheDocument();
    expect(within(locked).getByText('Canonical URLs')).toBeInTheDocument();
    expect(within(locked).getByText('Redirect chains and loops')).toBeInTheDocument();
    expect(locked.querySelectorAll('details')).toHaveLength(10);
    expect(within(locked).getByText('TLS certificate validity')).toBeInTheDocument();
    expect(within(locked).getByText('Server response time (lab TTFB)')).toBeInTheDocument();
    expect(locked.querySelectorAll('[data-locked-rule]')).toHaveLength(88);
    expect(panel.querySelector('[data-locked-rule]')).toBeNull();
    expect(locked.querySelector('.module-checks__result')).toBeNull();
    expect(locked.querySelector('[aria-hidden="true"] button')).toBeNull();
    fireEvent.click(within(locked).getByRole('button', { name: 'Run the complete audit' }));
    expect(onUpgrade).toHaveBeenCalledWith(expect.objectContaining({ id: SCAN.id }), 'Complete');
  });

  it('uses the actual historical four rows and does not lock any check already recorded', async () => {
    const historical = {
      ...SEO,
      metadata: {
        ...SEO.metadata,
        ruleChecks: (SEO.metadata?.ruleChecks as unknown[]).slice(0, 3).concat([
          {
            ruleId: 'SEO-TECH-004',
            title: 'canonical',
            applicableTargets: 0,
            affectedTargets: 0,
          },
        ]),
      },
    };
    const { card, panel } = await openReport('en', historical);
    expect(within(card).getByText('Checks in this report: 4')).toBeInTheDocument();
    expect(document.querySelector('[data-locked-rule="SEO-TECH-004"]')).toBeNull();
    expect(within(panel).getByRole('heading', { name: 'Not applicable · 1' })).toBeInTheDocument();
  });

  it('opens a checks-only historical Free report without inventing individual results', async () => {
    const legacy = {
      ...SEO,
      metadata: {
        freeCheck: true,
        checks: [
          { ruleId: 'SEO-ONPAGE-001', title: 'title' },
          { ruleId: 'SEO-TECH-004', title: 'canonical URL' },
        ],
      },
    };
    const { panel, onUpgrade } = await openReport('en', legacy);
    const recorded = within(panel).getByRole('region', { name: 'Recorded check names' });
    expect(within(recorded).getByText('Page title')).toBeInTheDocument();
    expect(within(recorded).getByText('Canonical URL')).toBeInTheDocument();
    expect(recorded).toHaveTextContent(
      'This older report saved check names, but no individual check results.',
    );
    expect(recorded.querySelector('.module-checks__result')).toBeNull();
    expect(recorded.querySelector('button')).toBeNull();
    expect(recorded).not.toHaveTextContent(/passed|issues found|pages checked|not applicable/i);
    expect(document.querySelector('[data-locked-rule="SEO-TECH-004"]')).toBeNull();
    expect(document.querySelectorAll('[data-locked-rule]')).toHaveLength(87);
    fireEvent.click(screen.getByRole('button', { name: 'Run the complete audit' }));
    expect(onUpgrade).toHaveBeenCalledWith(expect.objectContaining({ id: SCAN.id }), 'Complete');
  });

  it.each(['en', 'uk', 'ru'] as const)(
    'uses the historical report’s actual four checks in the %s upgrade lead',
    async (language) => {
      const legacy = {
        ...SEO,
        metadata: {
          freeCheck: true,
          checks: IDS.slice(0, 4).map((ruleId) => ({ ruleId, title: ruleId })),
        },
      };
      await openReport(language, legacy);
      const lead = document.querySelector('.upsell > p');
      expect(lead).toHaveTextContent(/\b4\b/);
      expect(lead).not.toHaveTextContent(/\b6\b/);
    },
  );

  it.each(['en', 'uk', 'ru'] as const)(
    'keeps paid checks and score presentation unchanged in %s',
    async (language) => {
      const { card, panel } = await openReport(
        language,
        { ...SEO, score: 99, scoreMax: 100, metadata: { ...SEO.metadata, freeCheck: false } },
        'Complete',
      );
      expect(card).toHaveTextContent('99.00');
      expect(document.querySelector('.complete-check-catalog')).toBeNull();
      expect(panel.querySelector('[data-locked-rule]')).toBeNull();
      expect(panel.querySelector('.free-seo-checks__group')).toBeNull();
    },
  );
});
