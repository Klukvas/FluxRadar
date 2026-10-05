// A finished report whose site could not be read.
//
// The report for a salon's site ended with a dash, eight "Unavailable" cards,
// the raw reason `SiteReturnedNoReadablePage` on each, and "No open problems —
// nothing in this report is waiting for a fix". The owner read it as a clean
// result. These tests pin the replacement: one block saying the site could not
// be opened and what to do, no raw code outside a small technical line, and no
// sentence anywhere that calls an unchecked site clean.

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CrawlSummary, Dashboard, IssueSummary, Scan, ScanModule } from './api';
import { desktopCopy } from './desktop-copy';
import type { Language } from './i18n';
import { newScanCopy } from './new-scan-copy';
import { ResultsScreen } from './Report';

const MODULE_NAMES = [
  'SEO',
  'Accessibility',
  'Security',
  'Privacy',
  'Performance',
  'AI SEO / GEO',
  'UX/Conversion',
  'Analytics',
] as const;

const REASON = 'SiteReturnedNoReadablePage';

const UNREAD_CRAWL: CrawlSummary = {
  reach: 'bad-response',
  startStatus: 500,
  accessControlSignals: [],
  pagesRead: 0,
  pagesFetched: 1,
  urlsDiscovered: 0,
  urlsOverLimit: 0,
  urlsBlockedByRobots: 0,
  limitedBy: null,
  maxPages: 100,
};

const SCAN: Scan = {
  id: 'scan-unread',
  profileId: 'profile-1',
  plan: 'Complete',
  domain: 'https://evagrace.example',
  status: 'Failed',
  statusReason: REASON,
  crawlSummary: UNREAD_CRAWL,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-mvp-0.1',
  progress: { completedModules: 8, totalModules: 8 },
  startedAt: '2026-10-01T00:00:00.000Z',
  completedAt: '2026-10-01T00:01:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  modules: [],
};

function unreadModule(module: string, statusReason: string = REASON): ScanModule {
  return {
    module,
    status: 'Unavailable',
    statusReason,
    coverage: 0,
    score: null,
    applicableChecks: 1,
    completedApplicableChecks: 0,
    usableOutput: false,
    metadata: {},
  };
}

function dashboardOf(scan: Scan, reason: string = REASON): Dashboard {
  return {
    scan,
    overall: {
      verdict: 'unavailable',
      score: null,
      weightedCoverage: 0,
      moduleWeights: [{ module: 'SEO', tariffWeight: 1, effectiveWeight: 1 }],
    },
    modules: MODULE_NAMES.map((name) => unreadModule(name, reason)),
    geoObservations: [],
  };
}

const EMPTY_SUMMARY: IssueSummary = { total: 0, open: 0, bySeverity: {}, groups: [] };

const PLAN_STATE = {
  scanId: SCAN.id,
  languages: [],
  running: null,
  lastFailure: null,
  remaining: { successes: 3, attempts: 6 },
  windowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
  plan: null,
};

/** Answers the dashboard, the issue summary and the Action Plan by path. */
function stubFetch(dashboard: Dashboard): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const { pathname } = new URL(String(input), 'http://localhost');
      const data = pathname.endsWith('/dashboard')
        ? dashboard
        : pathname.endsWith('/issues/summary')
          ? EMPTY_SUMMARY
          : pathname.endsWith('/action-plan')
            ? PLAN_STATE
            : null;
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, data, error: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
}

async function openReport(dashboard: Dashboard, language: Language): Promise<void> {
  stubFetch(dashboard);
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

/** How many times a string occurs in the rendered text. */
function occurrences(needle: string): number {
  return document.body.textContent?.split(needle).length ?? 1;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a report whose site could not be read', () => {
  it('leads with one plain-language block, causes and what to do (EN)', async () => {
    await openReport(dashboardOf(SCAN), 'en');

    const block = screen.getByRole('region', { name: 'We could not open your site' });
    expect(within(block).getByText(/We tried to read evagrace\.example/)).toBeTruthy();
    expect(within(block).getByText(/not with a page we could read/)).toBeTruthy();
    expect(within(block).getByText(/^The site answers with an error page/)).toBeTruthy();
    expect(within(block).getByText(/returns a file rather than a web page/)).toBeTruthy();
    expect(
      within(block).getByText(/redirects to an address that answers with an error/),
    ).toBeTruthy();
    // The site answered with no refusal status, so these causes are ruled out.
    expect(within(block).queryByText(/blocks automated checks/)).toBeNull();
    expect(within(block).queryByText(/asks for a login/)).toBeNull();
    expect(within(block).queryByText(/did not answer in time/)).toBeNull();
    expect(within(block).queryByText(/comes back empty/)).toBeNull();
    expect(within(block).getByText(/Open evagrace\.example in a browser/)).toBeTruthy();
    expect(within(block).getByRole('link', { name: 'crawler page' })).toHaveAttribute(
      'href',
      '/bot',
    );
    expect(within(block).getByText(/Run the scan again/)).toBeTruthy();
  });

  it('says nothing was checked, never that there are no open problems', async () => {
    await openReport(dashboardOf(SCAN), 'en');

    expect(await screen.findByText(/^Nothing was checked/)).toBeTruthy();
    // The lead block already says to run the scan again; no plan block repeats it.
    expect(screen.queryByText('AI Action Plan')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Nothing on this report was checked/);
    expect(document.body.textContent).not.toMatch(/No open problems/);
    expect(document.body.textContent).not.toMatch(/No open finding on this report/);
  });

  it('shows the raw reason only in the technical details line', async () => {
    await openReport(dashboardOf(SCAN), 'en');

    expect(occurrences(REASON)).toBe(2);
    expect(screen.getByText(`Technical details: ${REASON} · HTTP 500`)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/The audit recorded this reason/);
  });

  it('folds the eight Unavailable cards into one line', async () => {
    await openReport(dashboardOf(SCAN), 'en');

    expect(document.querySelector('.module-grid')).toBeNull();
    expect(screen.queryAllByText(/coverage unavailable/)).toHaveLength(0);
    expect(
      screen.getByText(/^These sections were not checked, because there was no page to check/),
    ).toHaveTextContent('SEO');
  });

  it('says all of it in Ukrainian', async () => {
    await openReport(dashboardOf(SCAN), 'uk');

    const block = screen.getByRole('region', { name: 'Нам не вдалося відкрити ваш сайт' });
    expect(within(block).getByText(/Найчастіші причини/)).toBeTruthy();
    expect(within(block).getByText(/не сторінкою, яку ми могли прочитати/)).toBeTruthy();
    expect(within(block).getByRole('link', { name: 'Наш краулер' })).toHaveAttribute(
      'href',
      '/bot',
    );
    expect(await screen.findByText(/^Нічого не перевірено/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Відкритих проблем немає/);
    expect(document.body.textContent).not.toMatch(/We could not open your site/);
    expect(occurrences(REASON)).toBe(2);
    expect(screen.getByText(/^Ці розділи не перевірено/)).toBeTruthy();
  });

  // Worded as the desktop's unread-site line: the refund is recorded on its
  // own, then issued by hand, so the report must not promise instant money.
  const PAID_EN =
    'If this check was paid for, it counts as not delivered: a refund is recorded for it automatically, without you asking, and is then issued by hand through Creem, so it is not instant.';
  const PAID_UK =
    'Якщо перевірка була платною, вона вважається не виконаною: повернення коштів для неї фіксується автоматично, просити не потрібно, а далі його вручну оформлюють через Creem, тож це не миттєво.';

  it('tells a paid plan how the refund works, without promising it is instant', async () => {
    await openReport(dashboardOf(SCAN), 'en');

    const block = screen.getByRole('region', { name: 'We could not open your site' });
    expect(within(block).getByText(PAID_EN)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/money is returned|refunded in full/i);
  });

  it.each(['en', 'uk'] as const)('words the refund as the desktop does (%s)', (language) => {
    const desktopLine = desktopCopy[language].nextStep.bodies.unread('evagrace.example');
    expect(desktopLine).toContain(language === 'en' ? PAID_EN : PAID_UK);
  });

  it('tells a paid plan how the refund works in Ukrainian', async () => {
    await openReport(dashboardOf(SCAN), 'uk');

    const block = screen.getByRole('region', { name: 'Нам не вдалося відкрити ваш сайт' });
    expect(within(block).getByText(PAID_UK)).toBeTruthy();
  });

  it('says nothing about a refund on the Free check, which nobody paid for', async () => {
    await openReport(dashboardOf({ ...SCAN, plan: 'Free' }), 'en');

    const block = screen.getByRole('region', { name: 'We could not open your site' });
    expect(within(block).queryByText(PAID_EN)).toBeNull();
    expect(block.textContent).not.toMatch(/refund/i);
    expect(document.body.textContent).not.toMatch(/money is returned|refunded in full/i);
  });

  it('falls back to a generic sentence for a reason this build does not know', async () => {
    const unknownReason = 'SiteSentSomethingNew';
    const scan: Scan = {
      ...SCAN,
      statusReason: unknownReason,
      crawlSummary: {
        ...UNREAD_CRAWL,
        reach: 'answered-in-riddles' as CrawlSummary['reach'],
        startStatus: null,
      },
    };
    await openReport(dashboardOf(scan, unknownReason), 'en');

    const block = screen.getByRole('region', { name: 'We could not open your site' });
    expect(
      within(block).getByText(
        'We could not read any page of your site, and the scan did not record why.',
      ),
    ).toBeTruthy();
    expect(occurrences(unknownReason)).toBe(2);
    expect(within(block).getByText(`Technical details: ${unknownReason}`)).toBeTruthy();
  });

  it('calls a refusal status likely protection, with the headers in the details', async () => {
    const scan: Scan = {
      ...SCAN,
      statusReason: 'SiteDeniedAccess',
      crawlSummary: {
        ...UNREAD_CRAWL,
        reach: 'access-denied',
        startStatus: 403,
        accessControlSignals: ['server: cloudflare', 'cf-mitigated'],
      },
    };
    await openReport(dashboardOf(scan, 'SiteDeniedAccess'), 'en');

    const block = screen.getByRole('region', { name: 'We could not open your site' });
    expect(within(block).getByText(/usually means a refusal/)).toBeTruthy();
    expect(within(block).getByText(/a server under load/)).toBeTruthy();
    expect(within(block).getByText(/^A firewall or bot protection/)).toBeTruthy();
    // 401 is one of the refusal statuses: a login wall belongs in this list.
    expect(within(block).getByText(/asks for a login or a password .*\(a 401\)/)).toBeTruthy();
    expect(within(block).getByRole('link', { name: 'crawler page' })).toBeTruthy();
    expect(
      within(block).getByText(
        'Technical details: SiteDeniedAccess · HTTP 403 · server: cloudflare, cf-mitigated',
      ),
    ).toBeTruthy();
  });

  const ROBOTS_SCAN: Scan = {
    ...SCAN,
    statusReason: 'SiteBlockedByRobots',
    crawlSummary: { ...UNREAD_CRAWL, reach: 'blocked-by-robots', startStatus: null },
  };

  it('points a robots.txt block at robots.txt and the lines to paste', async () => {
    await openReport(dashboardOf(ROBOTS_SCAN, 'SiteBlockedByRobots'), 'en');

    const block = screen.getByRole('region', { name: 'We could not open your site' });
    expect(within(block).getByText(/Your robots\.txt tells our crawler not to read/)).toBeTruthy();
    // "What we saw" names the one cause; no list repeats it.
    expect(within(block).queryByText('Common reasons')).toBeNull();
    const steps = within(block).getAllByRole('listitem');
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveTextContent(
      'Allow FluxRadarBot in robots.txt — our crawler page has the two lines to paste. Or turn off “Respect robots.txt” under “For experienced users” and confirm the override',
    );
    // The step names the new-scan screen's folded block by its own title, so a
    // rename on either side fails here instead of sending the owner nowhere.
    expect(steps[0]).toHaveTextContent(newScanCopy.en.expertTitle);
    expect(
      within(steps[0] as HTMLElement).getByRole('link', { name: 'crawler page' }),
    ).toHaveAttribute('href', '/bot');
    expect(steps[1]).toHaveTextContent('Run the scan again after the change.');
    expect(within(block).queryByText(/firewall/)).toBeNull();
    expect(within(block).queryByText(/opens in a browser/)).toBeNull();
    expect(within(block).queryByText(/HTTP/)).toBeNull();
  });

  it('offers no robots.txt override on the Free check, which has none', async () => {
    await openReport(dashboardOf({ ...ROBOTS_SCAN, plan: 'Free' }, 'SiteBlockedByRobots'), 'en');

    const block = screen.getByRole('region', { name: 'We could not open your site' });
    expect(within(block).getByText(/Allow FluxRadarBot in robots\.txt/)).toBeTruthy();
    expect(within(block).queryByText(/Respect robots\.txt/)).toBeNull();
  });

  it('says the robots.txt steps in Ukrainian', async () => {
    await openReport(dashboardOf(ROBOTS_SCAN, 'SiteBlockedByRobots'), 'uk');

    const block = screen.getByRole('region', { name: 'Нам не вдалося відкрити ваш сайт' });
    expect(within(block).getByText(/Дозвольте FluxRadarBot у robots\.txt/)).toBeTruthy();
    expect(
      within(block).getByText(/«Дотримуватись robots\.txt» у блоці «Для досвідчених користувачів»/),
    ).toBeTruthy();
    expect(block).toHaveTextContent(`«${newScanCopy.uk.expertTitle}»`);
    expect(within(block).getByRole('link', { name: 'Наш краулер' })).toHaveAttribute(
      'href',
      '/bot',
    );
    expect(within(block).getByText('Запустіть перевірку ще раз після змін.')).toBeTruthy();
  });

  it('shows no "HTTP 0" when the site never answered', async () => {
    const scan: Scan = {
      ...SCAN,
      statusReason: 'SiteUnreachable',
      // A fetch that threw (DNS, refused connection, timeout) is recorded as 0.
      crawlSummary: { ...UNREAD_CRAWL, reach: 'unreachable', startStatus: 0 },
    };
    await openReport(dashboardOf(scan, 'SiteUnreachable'), 'en');

    const block = screen.getByRole('region', { name: 'We could not open your site' });
    expect(within(block).getByText(/Your site did not answer/)).toBeTruthy();
    expect(within(block).getByText('Technical details: SiteUnreachable')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/HTTP 0/);
  });

  it('is a labelled region, not an alert read out on every visit', async () => {
    await openReport(dashboardOf(SCAN), 'en');

    expect(screen.queryByRole('alert', { name: 'We could not open your site' })).toBeNull();
  });
});

describe('a report whose site was read', () => {
  it('keeps the section cards and shows no failure block', async () => {
    const scan: Scan = {
      ...SCAN,
      status: 'Completed',
      statusReason: null,
      crawlSummary: { ...UNREAD_CRAWL, reach: 'reachable', pagesRead: 3, urlsDiscovered: 3 },
    };
    const dashboard: Dashboard = {
      ...dashboardOf(scan),
      overall: { ...dashboardOf(scan).overall, verdict: 'ok', score: 90, weightedCoverage: 1 },
      modules: [
        {
          ...unreadModule('SEO'),
          status: 'Completed',
          statusReason: null,
          coverage: 1,
          score: 90,
          completedApplicableChecks: 1,
          usableOutput: true,
        },
      ],
    };
    await openReport(dashboard, 'en');

    expect(screen.queryByRole('region', { name: 'We could not open your site' })).toBeNull();
    expect(document.querySelector('.module-grid')).not.toBeNull();
    expect(
      await screen.findByText('No open problems — nothing in this report is waiting for a fix.'),
    ).toBeTruthy();
  });
});
