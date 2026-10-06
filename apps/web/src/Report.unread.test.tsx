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
import { reportFailureCopy } from './report-failure-copy';

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
      // Passed so the printable page is on offer: a control the screen was
      // never handed cannot be shown to be withheld.
      onPrint={() => {}}
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

  // Conditional wording, deliberately: nothing the report can read proves
  // money changed hands — a paid plan is bought through the provider, and
  // while the provider runs in test mode its own checkout says nothing is
  // taken from the card. The money is recorded first and issued by hand, and
  // the report and the desktop's per-site line end on the same clause, so the
  // two can never promise different things.
  const PAID_EN =
    'If this check was paid for, it counts as not delivered: a refund is recorded for it automatically, without you asking, and is then issued by hand through Creem, so it is not instant.';
  const PAID_UK =
    'Якщо перевірка була платною, вона вважається не виконаною: повернення коштів для неї фіксується автоматично, просити не потрібно, а далі його вручну оформлюють через Creem, тож це не миттєво.';
  // The clause both sentences end on. Nothing renders it on its own, so it is
  // not a copy key: it lives here, as the pin that keeps the report's sentence
  // and the desktop's per-site step from drifting apart.
  const REFUND_RECORDED = {
    en: 'a refund is recorded for it automatically, without you asking, and is then issued by hand through Creem, so it is not instant.',
    uk: 'повернення коштів для неї фіксується автоматично, просити не потрібно, а далі його вручну оформлюють через Creem, тож це не миттєво.',
  } as const;

  it('tells a paid plan how the refund works, without claiming the money moved', async () => {
    await openReport(dashboardOf(SCAN), 'en');

    const block = screen.getByRole('region', { name: 'We could not open your site' });
    expect(within(block).getByText(PAID_EN)).toBeTruthy();
    expect(block.textContent).not.toMatch(/You paid/);
    expect(document.body.textContent).not.toMatch(/money is returned|refunded in full/i);
  });

  it.each(['en', 'uk'] as const)(
    'words the money the same way the desktop does (%s)',
    (language) => {
      const clause = REFUND_RECORDED[language];
      expect(reportFailureCopy[language].paidNotDelivered).toContain(clause);
      expect(desktopCopy[language].nextStep.bodies.unread('evagrace.example')).toContain(clause);
    },
  );

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

  // "Technical details: SiteReturnedNoReadablePage · HTTP 410" was the only
  // line on the block that named what the site actually answered, and it named
  // it in two words no owner has. The sentence is added; the code and the
  // status stay in the technical line and nowhere else.
  it('says in words what the status the site answered with means', async () => {
    const scan: Scan = { ...SCAN, crawlSummary: { ...UNREAD_CRAWL, startStatus: 410 } };
    await openReport(dashboardOf(scan), 'en');

    const block = screen.getByRole('region', { name: 'We could not open your site' });
    expect(
      within(block).getByText(
        'The site answered that this page no longer exists and is not coming back.',
      ),
    ).toBeTruthy();
    // Still the one place the number and the raw reason appear.
    expect(within(block).getByText(`Technical details: ${REASON} · HTTP 410`)).toBeTruthy();
    expect(occurrences('410')).toBe(2);
  });

  it('says it in Ukrainian too', async () => {
    const scan: Scan = { ...SCAN, crawlSummary: { ...UNREAD_CRAWL, startStatus: 410 } };
    await openReport(dashboardOf(scan), 'uk');
    expect(
      screen.getByText('Сайт відповів, що цієї сторінки більше немає й вона не повернеться.'),
    ).toBeTruthy();
  });

  // Every class of answer has a sentence now, and a redirect was one of the
  // ones that had none: the whole record of a 304 was "HTTP 304" in the small
  // technical line. The classes themselves are pinned one by one, in both
  // languages, in report-failure-status.test.ts.
  it('explains a redirect the crawl could not follow to a page', async () => {
    const odd: Scan = { ...SCAN, crawlSummary: { ...UNREAD_CRAWL, startStatus: 304 } };
    await openReport(dashboardOf(odd), 'en');
    const block = screen.getByRole('region', { name: 'We could not open your site' });
    expect(within(block).getByText(`Technical details: ${REASON} · HTTP 304`)).toBeTruthy();
    expect(within(block).getByText(/pointed us to another address/)).toBeTruthy();
    // And still only in the technical line is the number itself named.
    expect(occurrences('304')).toBe(2);
  });

  // The owner's first reaction is "but it opens fine for me", and they are not
  // wrong: a protection layer can let people through and turn us away.
  it('answers the owner whose site opens fine in their own browser', async () => {
    await openReport(dashboardOf(SCAN), 'en');

    const block = screen.getByRole('region', { name: 'We could not open your site' });
    const step = within(block).getByText(/that does not mean this report is wrong/);
    expect(step).toHaveTextContent(/let people through and turn automated visitors away/);
    expect(within(step).getByRole('link', { name: 'Our crawler' })).toHaveAttribute('href', '/bot');
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
      'Allow FluxRadarBot in robots.txt — our crawler page has the two lines to paste. Or turn off “Respect robots.txt” under “For experienced users” and, beside the Run button, tick that you want the skipped pages read.',
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

// Five of the six controls a failed report ended with led nowhere: "Open Issue
// Center" to an empty list, "Download full report (PDF)" and "Printable report"
// to a document saying nothing was checked, and JSON and CSV to an empty file —
// all of it under a block that had just said to run the check again.
describe('the actions a report with nothing checked offers', () => {
  const OPEN_ISSUES = 'Open Issue Center';
  const PDF = /Download full report/;
  const PRINT = 'Printable report';

  it('offers no list, no download and no export, and says why (EN)', async () => {
    await openReport(dashboardOf(SCAN), 'en');

    expect(screen.queryByRole('button', { name: OPEN_ISSUES })).toBeNull();
    expect(screen.queryByRole('button', { name: PDF })).toBeNull();
    expect(screen.queryByRole('button', { name: PRINT })).toBeNull();
    expect(screen.queryByRole('button', { name: 'JSON' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'CSV' })).toBeNull();
    // Not silently: the row says why it is empty.
    expect(
      screen.getByText(/There is no list of problems to open and nothing to download/),
    ).toBeTruthy();
    // And the way back out stays, next to the block's own run-again guidance.
    expect(screen.getByRole('button', { name: 'Reports' })).toBeTruthy();
    expect(screen.getByText(/Run the scan again/)).toBeTruthy();
  });

  it('says the same in Ukrainian', async () => {
    await openReport(dashboardOf(SCAN), 'uk');

    expect(screen.queryByRole('button', { name: /Issue Center|Центр проблем/ })).toBeNull();
    expect(screen.getByText(/^Списку проблем немає/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Звіти' })).toBeTruthy();
  });

  // Wider than "the site could not be read": a scan whose sections all ran on a
  // readable site and returned nothing usable has nothing to export either.
  it('applies to any report that checked nothing, not only an unread site', async () => {
    const scan: Scan = {
      ...SCAN,
      status: 'Partial',
      statusReason: 'NoUsableOutput',
      crawlSummary: { ...UNREAD_CRAWL, reach: 'reachable', pagesRead: 2, urlsDiscovered: 2 },
    };
    await openReport(dashboardOf(scan, 'NoUsableOutput'), 'en');

    expect(screen.queryByRole('button', { name: OPEN_ISSUES })).toBeNull();
    expect(screen.queryByRole('button', { name: 'CSV' })).toBeNull();
  });

  // The other half of the rule: a report with results is untouched.
  it('leaves every action in place on a report that does have results', async () => {
    const scan: Scan = {
      ...SCAN,
      status: 'Completed',
      statusReason: null,
      crawlSummary: { ...UNREAD_CRAWL, reach: 'reachable', pagesRead: 3, urlsDiscovered: 3 },
    };
    const base = dashboardOf(scan);
    const dashboard: Dashboard = {
      ...base,
      overall: { ...base.overall, verdict: 'normal', score: 90, weightedCoverage: 1 },
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

    expect(screen.getByRole('button', { name: OPEN_ISSUES })).toBeTruthy();
    expect(screen.getByRole('button', { name: PDF })).toBeTruthy();
    expect(screen.getByRole('button', { name: PRINT })).toBeTruthy();
    // Complete carries the data export.
    expect(screen.getByRole('button', { name: 'JSON' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'CSV' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/nothing to download/);
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
