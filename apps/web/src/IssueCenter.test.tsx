// The Issue Center reads problems first, and pages findings through the API.
//
// It used to fetch the first 100 findings, filter them in the browser and
// headline each row with its rule id; a search then quietly missed everything
// past the hundredth row, and nothing said there were more.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Issue, IssueSummary, Scan } from './api';
import { IssuesScreen } from './Issues';

const SCAN = { id: 'scan-1', domain: 'https://shop.example.com' } as Scan;

const SUMMARY: IssueSummary = {
  total: 60,
  open: 58,
  bySeverity: { Critical: 1, High: 0, Medium: 57, Low: 0 },
  groups: [
    { ruleId: 'SEC-ASVS-001', module: 'Security', severity: 'Critical', issues: 1, openIssues: 1 },
    { ruleId: 'SEO-ONPAGE-002', module: 'SEO', severity: 'Medium', issues: 59, openIssues: 57 },
  ],
};

function issue(index: number, overrides: Partial<Issue> = {}): Issue {
  return {
    id: `issue-${index}`,
    scanId: SCAN.id,
    ruleId: 'SEO-ONPAGE-002',
    module: 'SEO',
    fingerprint: `fp-${index}`,
    severity: 'Medium',
    category: 'on-page',
    status: 'New',
    targetUrl: `https://shop.example.com/page-${index}`,
    evidenceType: 'dom',
    evidenceRef: `issue/issue-${index}`,
    evidenceExcerpt: '<meta name="description"> is missing or empty',
    recommendation: 'Describe the page in a meta description.',
    confidence: 1,
    affectedTargets: 1,
    applicableTargets: 1,
    rulePenalty: 0,
    scoreDelta: 0,
    observedAt: '2026-09-18T00:00:00.000Z',
    ...overrides,
  };
}

function json(data: unknown, meta?: Record<string, number>): Response {
  return new Response(
    JSON.stringify({ success: true, data, error: null, ...(meta ? { meta } : {}) }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
}

function stubIssues(total = 60): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/issues/summary')) return Promise.resolve(json(SUMMARY));
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const limit = Number(url.searchParams.get('limit') ?? '50');
    const page = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, index) =>
      issue(offset + index),
    );
    return Promise.resolve(json(page, { total, page: Math.floor(offset / limit) + 1, limit }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function issueQueries(fetchMock: ReturnType<typeof vi.fn>): URLSearchParams[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.pathname.endsWith('/issues'))
    .map((url) => url.searchParams);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the Issue Center', () => {
  it('opens on problems, most urgent first, named in words', async () => {
    stubIssues();
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);

    const rows = await screen.findAllByRole('row');
    const body = rows.slice(1);
    expect(body[0]).toHaveTextContent('Content-Security-Policy is missing or weak');
    expect(body[1]).toHaveTextContent('Meta description is missing or the wrong length');
    expect(body[1]).toHaveTextContent('57 open of 59');
    expect(screen.getByText('58 open findings across 2 problems.')).toBeInTheDocument();
  });

  it('opens one problem onto its findings, filtered by the API', async () => {
    const fetchMock = stubIssues();
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Show findings: Meta description is missing or the wrong length',
      }),
    );

    expect(await screen.findByText('Showing 50 of 60')).toBeInTheDocument();
    expect(issueQueries(fetchMock).at(-1)?.get('ruleId')).toBe('SEO-ONPAGE-002');
  });

  it('pages past the first 50 and says how many there are', async () => {
    const fetchMock = stubIssues(60);
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Every finding' }));

    expect(await screen.findByText('Showing 50 of 60')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 10 more' }));

    expect(await screen.findByText('Showing 60 of 60')).toBeInTheDocument();
    expect(issueQueries(fetchMock).at(-1)?.get('offset')).toBe('50');
    expect(screen.queryByRole('button', { name: /more$/ })).not.toBeInTheDocument();
  });

  it('asks the API for a severity instead of filtering what happens to be loaded', async () => {
    const fetchMock = stubIssues();
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Every finding' }));
    await screen.findByText('Showing 50 of 60');

    fireEvent.change(screen.getByRole('combobox', { name: 'Severity' }), {
      target: { value: 'Critical' },
    });

    await waitFor(() => expect(issueQueries(fetchMock).at(-1)?.get('severity')).toBe('Critical'));
  });

  it('headlines a finding with its problem and links to how it is checked', async () => {
    stubIssues(1);
    render(
      <IssuesScreen scan={SCAN} language="uk" onError={() => {}} initialRuleId="SEO-ONPAGE-002" />,
    );

    const title = await screen.findAllByText('Meta description відсутній або неправильної довжини');
    expect(title.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Деталі' }));
    const detail = screen.getByText('Як це перевіряється →').closest('a');
    expect(detail).toHaveAttribute('href', '/checks#checks-seo');
    // The window is titled with the site, not with the report's database id.
    expect(screen.getByText(/Центр проблем · shop\.example\.com/)).toBeInTheDocument();
    expect(within(document.body).queryByText(/scan-1/)).not.toBeInTheDocument();
  });
});

// The three header rules are the ones that fill a report: a site that sends no
// Content-Security-Policy sends none on every page, so the default view has to
// stay one row per problem and that row has to say what the problem is in words
// — without implying anybody has attacked the site.
describe('the security problems an owner cannot read from a header name', () => {
  const SECURITY_SUMMARY: IssueSummary = {
    total: 124,
    open: 124,
    bySeverity: { Critical: 60, High: 0, Medium: 64, Low: 0 },
    groups: [
      {
        ruleId: 'SEC-ASVS-001',
        module: 'Security',
        severity: 'Critical',
        issues: 60,
        openIssues: 60,
      },
      {
        ruleId: 'SEC-PASSIVE-002',
        module: 'Security',
        severity: 'Medium',
        issues: 60,
        openIssues: 60,
      },
      {
        ruleId: 'SEC-PASSIVE-005',
        module: 'Security',
        severity: 'Medium',
        issues: 4,
        openIssues: 4,
      },
      { ruleId: 'SEO-ONPAGE-002', module: 'SEO', severity: 'Medium', issues: 1, openIssues: 1 },
    ],
  };

  /** Findings of one rule, as the API pages them, with per-page evidence. */
  function stubSecurity(findings: readonly Issue[], total = findings.length): void {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/issues/summary'))
          return Promise.resolve(json(SECURITY_SUMMARY));
        const limit = Number(url.searchParams.get('limit') ?? '50');
        return Promise.resolve(json(findings, { total, page: 1, limit }));
      }),
    );
  }

  /** The nth element of a queried list, or a failure naming what was missing. */
  function nth(elements: readonly HTMLElement[], index: number, what: string): HTMLElement {
    const element = elements[index];
    if (element === undefined) throw new Error(`expected ${what} at index ${index}`);
    return element;
  }

  function header(index: number, missing: string): Issue {
    return issue(index, {
      ruleId: 'SEC-PASSIVE-002',
      module: 'Security',
      severity: 'Medium',
      evidenceType: 'http',
      evidenceExcerpt: `The HTML response is missing security headers: ${missing}`,
      recommendation: 'Send the missing headers with HTML responses.',
    });
  }

  it('keeps one row per problem and explains it in plain language, folded', async () => {
    stubSecurity([]);
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);

    // Four problems, 124 findings: the default view is still four rows.
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows).toHaveLength(4);
    const csp = nth(rows, 0, 'the CSP problem row');
    expect(csp).toHaveTextContent('Content-Security-Policy is missing or weak');

    const disclosure = within(csp)
      .getByText('What this means in plain language')
      .closest('details');
    // Folded: a row that opened itself would be a row per problem in name only.
    expect(disclosure).not.toHaveAttribute('open');
    expect(
      within(csp).getByText(/do not tell the browser which outside sources/),
    ).toBeInTheDocument();
    // The owner's action is to ask a developer — not a header to paste.
    expect(
      within(csp).getByText(/Ask your website developer to set this protection up/),
    ).toBeInTheDocument();
    // One finding per page for this rule, so the count can be read as pages.
    expect(
      within(csp).getByText('One finding for each page where it is not set.'),
    ).toBeInTheDocument();
    // Never "you have been attacked", and never "every page of your site".
    expect(
      within(csp).getByText(
        /nothing was attacked, logged into or tested for whether it can be exploited/,
      ),
    ).toBeInTheDocument();
    expect(
      within(csp).getByText(/pages outside this scan’s scope were not read/),
    ).toBeInTheDocument();
  });

  it('explains the cookie and header rules too, and leaves other rules alone', async () => {
    stubSecurity([]);
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);

    const rows = (await screen.findAllByRole('row')).slice(1);
    const headers = nth(rows, 1, 'the security-headers problem row');
    const cookies = nth(rows, 2, 'the cookie problem row');
    const metaDescription = nth(rows, 3, 'the meta-description problem row');
    // Plain language all the way down: no header or attribute name in the row.
    expect(
      within(headers).getByText(/extra browser protection settings are not switched on/),
    ).toBeInTheDocument();
    expect(within(headers).queryByText(/X-Content-Type-Options/)).not.toBeInTheDocument();
    // The cookie rule counts cookies, not pages, and the row says so — "can be"
    // higher, since four cookies may well sit on four pages.
    expect(within(cookies).getByText(/there can be more findings than pages/)).toBeInTheDocument();
    expect(
      within(cookies).getByText(/value is not shown in the finding evidence/),
    ).toBeInTheDocument();
    // A rule with no explanation gets no empty disclosure.
    expect(
      within(metaDescription).queryByText('What this means in plain language'),
    ).not.toBeInTheDocument();
  });

  it('explains them in Ukrainian for a Ukrainian report', async () => {
    stubSecurity([]);
    render(<IssuesScreen scan={SCAN} language="uk" onError={() => {}} />);

    const rows = (await screen.findAllByRole('row')).slice(1);
    const csp = nth(rows, 0, 'the CSP problem row');
    expect(within(csp).getByText('Що це означає простою мовою')).toBeInTheDocument();
    expect(within(csp).getByText(/Це додатковий запобіжник/)).toBeInTheDocument();
    expect(
      within(csp).getByText(/Попросіть розробника налаштувати цей захист на сервері/),
    ).toBeInTheDocument();
    expect(
      within(csp).getByText(/жодної атаки, входу в акаунт чи перевірки на можливість зламу/),
    ).toBeInTheDocument();
  });

  // Regression: this button dropped the rule filter and stayed in the flat
  // list, so leaving a problem landed the reader in every finding of every
  // rule — one row per page, which is what the problem view exists to replace.
  it('returns from one problem to the problem list, not to every finding', async () => {
    stubSecurity([header(1, 'Referrer-Policy')], 1);
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Show findings: Security headers are missing',
      }),
    );
    expect(await screen.findByText('Showing 1 of 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show every problem' }));

    expect(
      await screen.findByRole('button', {
        name: 'Show findings: Content-Security-Policy is missing or weak',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Problems' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByText('Showing 1 of 1')).not.toBeInTheDocument();
  });

  it('says how many pages the open problem is on and where the pages differ', async () => {
    stubSecurity([
      header(1, 'Referrer-Policy'),
      header(2, 'Referrer-Policy'),
      header(3, 'X-Frame-Options / CSP frame-ancestors'),
    ]);
    render(
      <IssuesScreen scan={SCAN} language="en" onError={() => {}} initialRuleId="SEC-PASSIVE-002" />,
    );

    expect(await screen.findByText('These findings are on 3 pages.')).toBeInTheDocument();
    expect(screen.getByText('What differs between pages')).toBeInTheDocument();
    const variants = screen.getByRole('list');
    expect(variants).toHaveTextContent('Referrer-Policy — 2 findings');
    expect(variants).toHaveTextContent('X-Frame-Options / CSP frame-ancestors — 1 finding');
    // The drilldown is still per page: every finding keeps its own address,
    // its own status control and its own evidence behind Details.
    expect(screen.getByText('https://shop.example.com/page-3')).toBeInTheDocument();
    expect(
      screen.getAllByRole('combobox', { name: 'Status: Security headers are missing' }),
    ).toHaveLength(3);
    const thirdDetails = nth(
      screen.getAllByRole('button', { name: 'Details' }),
      2,
      'a Details button',
    );
    fireEvent.click(thirdDetails);
    const detail = document.getElementById('issue-detail-issue-3');
    if (detail === null) throw new Error('expected the third finding’s detail panel');
    // The plain language opens with the panel; the header names, the raw
    // recommendation, the confidence and the rule id stay reachable one fold
    // down, for whoever will do the work.
    expect(within(detail).getByText('What the check found')).toBeInTheDocument();
    const technical = within(detail)
      .getByText('Technical details for your developer')
      .closest('details');
    if (technical === null) throw new Error('expected the technical disclosure');
    expect(technical).not.toHaveAttribute('open');
    expect(
      within(technical).getByText(
        'The HTML response is missing security headers: X-Frame-Options / CSP frame-ancestors',
      ),
    ).toBeInTheDocument();
    expect(
      within(technical).getByText('Send the missing headers with HTML responses.'),
    ).toBeInTheDocument();
    expect(within(technical).getByText('SEC-PASSIVE-002')).toBeInTheDocument();
    expect(within(technical).getByText('Evidence')).toBeInTheDocument();
    expect(within(technical).getByText('Confidence')).toBeInTheDocument();
  });

  // A rule with no plain-language explanation keeps the detail panel it always
  // had: no fold, and the evidence where the reader last saw it.
  it('leaves the detail of an unexplained rule unfolded', async () => {
    stubSecurity([issue(1)]);
    render(
      <IssuesScreen scan={SCAN} language="en" onError={() => {}} initialRuleId="SEO-ONPAGE-002" />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));

    const detail = document.getElementById('issue-detail-issue-1');
    if (detail === null) throw new Error('expected the finding’s detail panel');
    expect(
      within(detail).queryByText('Technical details for your developer'),
    ).not.toBeInTheDocument();
    expect(
      within(detail).getByText('<meta name="description"> is missing or empty'),
    ).toBeInTheDocument();
  });

  it('says the page count is only of the findings loaded so far', async () => {
    stubSecurity([header(1, 'Referrer-Policy'), header(2, 'Referrer-Policy')], 60);
    render(
      <IssuesScreen scan={SCAN} language="en" onError={() => {}} initialRuleId="SEC-PASSIVE-002" />,
    );

    expect(
      await screen.findByText(
        '2 pages in the findings loaded so far — load the rest to count every page.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('These findings are on 2 pages.')).not.toBeInTheDocument();
  });

  it('says so when every loaded finding recorded the same evidence', async () => {
    stubSecurity([
      issue(1, { ruleId: 'SEC-ASVS-001', module: 'Security', severity: 'Critical' }),
      issue(2, { ruleId: 'SEC-ASVS-001', module: 'Security', severity: 'Critical' }),
    ]);
    render(
      <IssuesScreen scan={SCAN} language="en" onError={() => {}} initialRuleId="SEC-ASVS-001" />,
    );

    expect(
      await screen.findByText('Every finding loaded here recorded the same evidence.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('What differs between pages')).not.toBeInTheDocument();
  });

  // Regression: one variant was read as "all the same", but a finding that
  // recorded no evidence is in no variant at all — so the sentence was speaking
  // for findings it had never seen.
  it('stays silent about sameness when a loaded finding carries no evidence', async () => {
    stubSecurity([
      issue(1, { ruleId: 'SEC-ASVS-001', module: 'Security', severity: 'Critical' }),
      issue(2, {
        ruleId: 'SEC-ASVS-001',
        module: 'Security',
        severity: 'Critical',
        evidenceExcerpt: null,
      }),
    ]);
    render(
      <IssuesScreen scan={SCAN} language="en" onError={() => {}} initialRuleId="SEC-ASVS-001" />,
    );

    expect(await screen.findByText('These findings are on 2 pages.')).toBeInTheDocument();
    expect(
      screen.queryByText('Every finding loaded here recorded the same evidence.'),
    ).not.toBeInTheDocument();
  });
});

describe('opening a problem while a search is typed', () => {
  it('never sends the old search together with the new problem', async () => {
    const fetchMock = stubIssues();
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Every finding' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search' }), {
      target: { value: 'page-1' },
    });
    // The debounced search reaches the API first.
    await waitFor(() => expect(issueQueries(fetchMock).at(-1)?.get('search')).toBe('page-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Problems' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Show findings: Meta description is missing or the wrong length',
      }),
    );

    await waitFor(() =>
      expect(issueQueries(fetchMock).at(-1)?.get('ruleId')).toBe('SEO-ONPAGE-002'),
    );
    const withProblem = issueQueries(fetchMock).filter((query) => query.has('ruleId'));
    expect(withProblem.every((query) => !query.has('search'))).toBe(true);
  });
});
