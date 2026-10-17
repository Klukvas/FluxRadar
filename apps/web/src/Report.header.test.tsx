// The top and the foot of a report, as a small-business owner reads them.
//
// Four persona reviews of a Free report stopped on the same things: internal
// ids in the header, English check names in Ukrainian copy, an empty score dial
// that "looks broken", and a "How to read" block standing before the problems.
// These pin what replaced them: site / plan / date up top, a plain Free result
// panel counting from the same summary "Fix these first" uses, localized check
// names, and the ids and the explainer folded.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResultsScreen } from './Report';
import type { EgressLocation, IssueRuleGroup, IssueSummary, Scan, ScanModule } from './api';
import type { Language } from './i18n';

const FREE_RULES = ['SEO-ONPAGE-001', 'SEO-ONPAGE-003', 'SEO-ONPAGE-002', 'SEO-TECH-008'];
const STORED_TITLES = ['title', 'H1-H6 structure', 'meta description', 'index/noindex'];
const KYIV: EgressLocation = {
  id: 'ua',
  countryCode: 'UA',
  city: 'Kyiv',
  label: { en: 'Ukraine, Kyiv', uk: 'Україна, Київ' },
};

function scanOf(plan: Scan['plan'], overrides: Partial<Scan> = {}): Scan {
  return {
    id: 'scan-header-1',
    profileId: 'profile-1',
    plan,
    domain: 'https://salon.example',
    status: 'Completed',
    statusReason: null,
    scope: { includeSubdomains: false },
    profileConfigVersion: 3,
    rulesetVersion: 'rules-mvp-0.1',
    egressLocation: KYIV,
    progress: { completedModules: 1, totalModules: 1 },
    startedAt: '2026-09-06T11:00:00.000Z',
    completedAt: '2026-09-06T12:00:00.000Z',
    createdAt: '2026-09-06T10:00:00.000Z',
    modules: [],
    ...overrides,
  } as Scan;
}

/** The Free SEO row as the API writes it: real rule ids, registry titles. */
function freeSeoModule(completed = 4): ScanModule {
  return {
    module: 'SEO',
    status: 'Completed',
    statusReason: null,
    coverage: 1,
    score: null,
    applicableChecks: completed,
    completedApplicableChecks: completed,
    usableOutput: true,
    metadata: {
      freeCheck: true,
      scope: 'homepage only',
      scoring: 'NotScoredOnFreePlan',
      checks: FREE_RULES.map((ruleId, index) => ({ ruleId, title: STORED_TITLES[index] })),
    },
  };
}

function freeDashboard(scan: Scan, modules: readonly ScanModule[] = [freeSeoModule()]) {
  return {
    scan,
    overall: { verdict: 'insufficient_data', score: null, weightedCoverage: 0, moduleWeights: [] },
    modules,
  };
}

function paidDashboard(scan: Scan) {
  return {
    scan,
    overall: {
      verdict: 'normal',
      score: 74,
      weightedCoverage: 0.9,
      moduleWeights: [{ module: 'SEO', tariffWeight: 1, effectiveWeight: 1 }],
    },
    modules: [],
  };
}

/** `count` open problems, one per rule, plus one settled rule that must not count. */
function summaryWith(count: number): IssueSummary {
  const open: IssueRuleGroup[] = Array.from({ length: count }, (_, index) => ({
    ruleId: `SEO-ONPAGE-00${index + 1}`,
    module: 'SEO',
    severity: 'High',
    issues: 2,
    openIssues: 2,
  }));
  const settled: IssueRuleGroup = {
    ruleId: 'SEO-TECH-001',
    module: 'SEO',
    severity: 'Medium',
    issues: 1,
    openIssues: 0,
  };
  const groups = [...open, settled];
  return { total: groups.length * 2, open: count * 2, bySeverity: {}, groups };
}

function envelope(data: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ success: true, data, error: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

/**
 * Answers the dashboard and the issue summary — or never answers the summary
 * when it is `'pending'` — and everything else with an empty payload. Returns
 * the request paths so a test can count them.
 */
function stubApi(dashboard: unknown, summary: IssueSummary | 'pending'): string[] {
  const paths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const { pathname } = new URL(String(input), 'http://localhost');
      paths.push(pathname);
      if (pathname.endsWith('/dashboard')) return envelope(dashboard);
      if (pathname.endsWith('/issues/summary')) {
        return summary === 'pending' ? new Promise<Response>(() => {}) : envelope(summary);
      }
      return envelope(null);
    }),
  );
  return paths;
}

function renderReport(scan: Scan, language: Language = 'en') {
  render(
    <ResultsScreen
      scan={scan}
      language={language}
      onScan={() => {}}
      onIssues={() => {}}
      onReports={() => {}}
      onError={() => {}}
    />,
  );
}

async function freeStatus(name: string): Promise<HTMLElement> {
  return screen.findByRole('status', { name });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the Free result panel', () => {
  it.each([
    [1, '1 thing checked on your homepage'],
    [2, '2 things checked on your homepage'],
    [4, '4 things checked on your homepage'],
    [5, '5 things checked on your homepage'],
  ])('says how many things were checked: %i (en)', async (count, headline) => {
    const scan = scanOf('Free');
    stubApi(freeDashboard(scan, [freeSeoModule(count)]), summaryWith(0));
    renderReport(scan);

    expect(await freeStatus('Free check result')).toHaveTextContent(headline);
  });

  it.each([
    [1, 'Перевірено 1 річ на головній'],
    [2, 'Перевірено 2 речі на головній'],
    [4, 'Перевірено 4 речі на головній'],
    [5, 'Перевірено 5 речей на головній'],
    [11, 'Перевірено 11 речей на головній'],
    [21, 'Перевірено 21 річ на головній'],
  ])('says how many things were checked: %i (uk)', async (count, headline) => {
    const scan = scanOf('Free');
    stubApi(freeDashboard(scan, [freeSeoModule(count)]), summaryWith(0));
    renderReport(scan, 'uk');

    expect(await freeStatus('Результат перевірки Free')).toHaveTextContent(headline);
  });

  it.each([
    [0, 'No problems found', 'Проблем не знайдено'],
    [1, '1 problem found', 'Знайдено 1 проблему'],
    [3, '3 problems found', 'Знайдено 3 проблеми'],
    [5, '5 problems found', 'Знайдено 5 проблем'],
  ])('counts %i open problems from the summary', async (count, en, uk) => {
    const scan = scanOf('Free');
    stubApi(freeDashboard(scan), summaryWith(count));
    renderReport(scan);
    const panel = await freeStatus('Free check result');
    expect(await within(panel).findByText(en)).toBeInTheDocument();
    cleanup();

    stubApi(freeDashboard(scan), summaryWith(count));
    renderReport(scan, 'uk');
    const ukPanel = await freeStatus('Результат перевірки Free');
    expect(await within(ukPanel).findByText(uk)).toBeInTheDocument();
  });

  it('shows the headline without a count while the summary loads, and no dash dial', async () => {
    const scan = scanOf('Free');
    stubApi(freeDashboard(scan), 'pending');
    renderReport(scan);

    const panel = await freeStatus('Free check result');
    expect(panel).toHaveTextContent('4 things checked on your homepage');
    expect(within(panel).queryByText(/problems? found/)).toBeNull();
    expect(panel).not.toHaveTextContent('—');
    expect(document.querySelector('.score-dial')).toBeNull();
    expect(screen.queryByText('Insufficient data')).toBeNull();
    expect(screen.queryByText(/insufficient/i)).toBeNull();
  });

  it('asks for the issue summary once, for the panel and the next-step blocks together', async () => {
    const scan = scanOf('Free');
    const paths = stubApi(freeDashboard(scan), summaryWith(3));
    renderReport(scan);

    const panel = await freeStatus('Free check result');
    await within(panel).findByText('3 problems found');
    // The same three problems reach the upsell, from the same request.
    expect(await screen.findByText(/found 3 problems on the homepage/)).toBeInTheDocument();
    await waitFor(() => expect(paths.some((path) => path.endsWith('/dashboard'))).toBe(true));
    expect(paths.filter((path) => path.endsWith('/issues/summary'))).toEqual([
      '/scans/scan-header-1/issues/summary',
    ]);
  });

  it('asks for the issue summary once on a paid report too', async () => {
    const scan = scanOf('Basic');
    const paths = stubApi(paidDashboard(scan), summaryWith(2));
    renderReport(scan);

    await screen.findByLabelText('Score 74.00');
    await screen.findByRole('heading', { name: /fix these first/i });
    expect(paths.filter((path) => path.endsWith('/issues/summary'))).toHaveLength(1);
  });
});

describe('a Free report of a site that could not be read', () => {
  // Production ends such a scan as Failed (blocked-site.test.ts in apps/api).
  function unreadFreeScan(): { scan: Scan; dashboard: unknown } {
    const scan = scanOf('Free', { status: 'Failed', statusReason: 'TargetsUnreachable' });
    const unread: ScanModule = {
      ...freeSeoModule(),
      status: 'Unavailable',
      statusReason: 'TargetsUnreachable',
      coverage: 0,
      completedApplicableChecks: 0,
      usableOutput: false,
    };
    return { scan, dashboard: freeDashboard(scan, [unread]) };
  }

  it('shows the Free panel, not the paid "Unavailable" dial', async () => {
    const { scan, dashboard } = unreadFreeScan();
    stubApi(dashboard, summaryWith(0));
    renderReport(scan);

    const panel = await freeStatus('Free check result');
    expect(panel).toHaveTextContent('Your homepage could not be read');
    expect(within(panel).queryByText(/problems? found/)).toBeNull();
    expect(document.querySelector('.score-dial')).toBeNull();
    expect(screen.queryByRole('status', { name: 'Unavailable' })).toBeNull();
    expect(screen.queryByText(/insufficient/i)).toBeNull();
  });

  it('still counts the checks of a Free scan that failed for a platform reason', async () => {
    const scan = scanOf('Free', { status: 'Failed', statusReason: 'InternalError' });
    stubApi(freeDashboard(scan), summaryWith(1));
    renderReport(scan);

    const panel = await freeStatus('Free check result');
    expect(panel).toHaveTextContent('4 things checked on your homepage');
    expect(await within(panel).findByText('1 problem found')).toBeInTheDocument();
    expect(document.querySelector('.score-dial')).toBeNull();
  });

  it('agrees with the report details when a section ran but completed no check', async () => {
    const scan = scanOf('Free');
    stubApi(freeDashboard(scan, [freeSeoModule(0)]), summaryWith(0));
    renderReport(scan);

    const panel = await freeStatus('Free check result');
    expect(panel).toHaveTextContent('0 things checked on your homepage');
    // Nothing measured, so no "No problems found" either.
    expect(within(panel).queryByText(/problems? found/)).toBeNull();
    const fold = screen.getByText('Report details').closest('details');
    expect(fold).toHaveTextContent('0/0 checks completed');
    expect(fold).not.toHaveTextContent('could not be read');
  });
});

describe('the paid score area', () => {
  it('keeps the score dial and its verdict, and no Free panel', async () => {
    const scan = scanOf('Basic');
    stubApi(paidDashboard(scan), summaryWith(1));
    renderReport(scan);

    expect(await screen.findByLabelText('Score 74.00')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Free check result' })).toBeNull();
    expect(screen.queryByText(/things? checked on your homepage/)).toBeNull();
  });

  it('keeps the unavailable dial for a failed paid scan', async () => {
    const scan = scanOf('Basic', { status: 'Failed' });
    stubApi(paidDashboard(scan), summaryWith(0));
    renderReport(scan);

    const dial = await screen.findByRole('status', { name: 'Unavailable' });
    expect(dial).toHaveClass('score-dial');
    expect(dial).toHaveTextContent('—');
  });
});

describe('the report header and its details fold', () => {
  it('shows site, plan and the check date, and none of the internal ids', async () => {
    const scan = scanOf('Free');
    stubApi(freeDashboard(scan), summaryWith(0));
    renderReport(scan);

    const header = await screen.findByRole('group', { name: 'About this report' });
    expect(header).toHaveTextContent('salon.example');
    expect(header).toHaveTextContent('Free');
    expect(within(header).getByText('Checked on')).toBeInTheDocument();
    expect(header).toHaveTextContent('6 September 2026');
    // A machine-readable date, and terms rather than "·"-joined spans, so a
    // wrapped line on a phone never opens on a separator.
    expect(header.querySelector('time')).toHaveAttribute('datetime', '2026-09-06T12:00:00.000Z');
    expect(within(header).getAllByRole('term')).toHaveLength(3);
    expect(header).not.toHaveTextContent('·');
    expect(header).not.toHaveTextContent('scan-header-1');
    expect(header).not.toHaveTextContent('rules-mvp-0.1');
    expect(header).not.toHaveTextContent('v3');
    expect(header).not.toHaveTextContent('Ukraine');
  });

  it('falls back to the start date when the scan has no completion date', async () => {
    const scan = scanOf('Free', { completedAt: null, startedAt: '2026-09-05T12:00:00.000Z' });
    stubApi(freeDashboard(scan), summaryWith(0));
    renderReport(scan, 'uk');

    const header = await screen.findByRole('group', { name: 'Про цей звіт' });
    expect(within(header).getByText('Дата перевірки')).toBeInTheDocument();
    expect(header).toHaveTextContent('5 вересня 2026');
  });

  it('folds the id, ruleset, configuration version and country, closed', async () => {
    const scan = scanOf('Free');
    stubApi(freeDashboard(scan), summaryWith(0));
    renderReport(scan);

    const summary = await screen.findByText('Report details');
    const fold = summary.closest('details');
    expect(fold).not.toBeNull();
    expect(fold).not.toHaveAttribute('open');
    expect(fold).toHaveTextContent('scan-header-1');
    expect(fold).toHaveTextContent('rules-mvp-0.1');
    expect(fold).toHaveTextContent('v3');
    expect(fold).toHaveTextContent('Checked from');
    expect(fold).toHaveTextContent('Ukraine, Kyiv');
    expect(fold).toHaveTextContent('4/4 checks completed');
    expect(screen.getByText('scan-header-1')).not.toBeVisible();
    // Identifiers wear the technical face; the prose values do not.
    expect(screen.getByText('scan-header-1')).toHaveClass('report-tech__value--technical');
    expect(screen.getByText('rules-mvp-0.1')).toHaveClass('report-tech__value--technical');
    expect(screen.getByText('Ukraine, Kyiv')).not.toHaveClass('report-tech__value--technical');
    expect(screen.getByText('4/4 checks completed')).not.toHaveClass(
      'report-tech__value--technical',
    );
  });

  it('names the Ukrainian fold, and states an unrecorded country plainly', async () => {
    const scan = scanOf('Basic', { egressLocation: null });
    stubApi(paidDashboard(scan), summaryWith(0));
    renderReport(scan, 'uk');

    const fold = (await screen.findByText('Технічні дані звіту')).closest('details');
    expect(fold).toHaveTextContent('Не зафіксовано');
    expect(fold).toHaveTextContent('виконано 90% перевірок');
  });
});

describe('check names and the reading guide', () => {
  it('names the Free checks in Ukrainian, not in the registry’s English', async () => {
    const scan = scanOf('Free');
    stubApi(freeDashboard(scan), summaryWith(0));
    renderReport(scan, 'uk');

    // The section card's line, word for word; the scope footnote repeats it.
    expect(
      await screen.findByText(
        'Заголовок сторінки (title) · Структура заголовків (H1–H6) · Опис сторінки для пошуку (meta description) · Чи може пошуковик показувати сторінку (noindex)',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/H1-H6 structure/)).toBeNull();
    expect(screen.queryByText(/index\/noindex/)).toBeNull();
  });

  it('names the Free checks in plain English', async () => {
    const scan = scanOf('Free');
    stubApi(freeDashboard(scan), summaryWith(0));
    renderReport(scan);

    expect(
      await screen.findByText(
        'Page title · Heading structure (H1–H6) · Page description for search (meta description) · Whether search engines may list the page (noindex)',
      ),
    ).toBeInTheDocument();
  });

  it('folds "How to read this report" with all of its content, after the problems', async () => {
    const scan = scanOf('Free');
    stubApi(freeDashboard(scan), summaryWith(1));
    renderReport(scan);

    const help = await screen.findByRole('group', { name: 'How to read this report' });
    expect(help.tagName).toBe('DETAILS');
    expect(help).not.toHaveAttribute('open');
    for (const term of ['Score', 'Checks done', 'Findings']) {
      expect(within(help).getByText(term)).toBeInTheDocument();
    }
    expect(help).toHaveTextContent(/0–100 rating is part of the Basic and Complete scans/);
    expect(help).toHaveTextContent(/How many of that area’s checks/);
    expect(help).toHaveTextContent(/Specific issues we detected/);
    const fixFirst = await screen.findByRole('heading', { name: /fix these first/i });
    // DOCUMENT_POSITION_FOLLOWING: the guide comes after the problems.
    expect(fixFirst.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
