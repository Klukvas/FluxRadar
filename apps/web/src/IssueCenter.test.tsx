// The Issue Center reads problems first, and pages findings through the API.
//
// It used to fetch the first 100 findings, filter them in the browser and
// headline each row with its rule id; a search then quietly missed everything
// past the hundredth row, and nothing said there were more.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Issue, IssueSummary, Scan } from './api';
import { copy } from './i18n';
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
    // The owner's name, and only that: the rule's technical title said the same
    // thing in the developer's words, so the row read as two problems. It lives
    // in the finding's technical fold now.
    expect(body[0]).toHaveTextContent('Pages do not limit where they load content from');
    expect(body[0]).not.toHaveTextContent('Content-Security-Policy is missing or weak');
    expect(body[0]).toHaveTextContent('On 1 page');
    expect(body[1]).toHaveTextContent(
      'Page summary for search results is missing or the wrong length',
    );
    expect(body[1]).not.toHaveTextContent('Meta description is missing or the wrong length');
    // A count of pages, said as pages — not a bare "57 open of 59".
    expect(body[1]).toHaveTextContent('Open on 57 of 59 pages');
    expect(screen.getByText('58 open findings across 2 problems.')).toBeInTheDocument();
  });

  // Regression: the grouped layout was inferred from the loaded rows, so an
  // unfiltered first page that happened to hold one rule lost its Problem
  // column — and "Show 50 more" bringing a second rule in rebuilt the table
  // under the reader mid-scroll. It follows the rule filter now, which is the
  // only thing that makes a list one problem's.
  it('keeps the Problem column on the unfiltered tab, whatever one page holds', async () => {
    stubIssues();
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Every finding' }));
    await screen.findByText('Showing 50 of 60');

    const problem = 'Page summary for search results is missing or the wrong length';
    // Every loaded row happens to be one rule's; the list is still every finding.
    expect(screen.getByRole('columnheader', { name: 'Problem' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: problem })).toBeNull();
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows[0]).toHaveTextContent(problem);
  });

  it('names the problem once above the table when the list is filtered to it', async () => {
    stubIssues();
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);
    const problem = 'Page summary for search results is missing or the wrong length';
    fireEvent.click(await screen.findByRole('button', { name: `Show findings: ${problem}` }));
    await screen.findByText('Showing 50 of 60');

    expect(screen.getByRole('heading', { name: problem })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Problem' })).toBeNull();
  });

  // Regression: the name lived in the table, and the table is drawn neither
  // while the findings load nor when a filter leaves none — so "Showing one
  // problem only" stood over a screen that never said which problem.
  it('names the open problem while it loads and when a filter empties it', async () => {
    const problem = 'Page summary for search results is missing or the wrong length';
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/issues/summary')) return Promise.resolve(json(SUMMARY));
        const matches = url.searchParams.has('search') ? [] : [issue(1)];
        return Promise.resolve(json(matches, { total: matches.length, page: 1, limit: 50 }));
      }),
    );
    render(
      <IssuesScreen scan={SCAN} language="en" onError={() => {}} initialRuleId="SEO-ONPAGE-002" />,
    );

    // The skeleton stands where the table will be, and the name is already up.
    expect(screen.getByLabelText('Loading results')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: problem })).toBeInTheDocument();

    // Loaded: said once on the whole screen, as it always was.
    expect(await screen.findByText('Showing 1 of 1')).toBeInTheDocument();
    expect(screen.getAllByText(problem)).toHaveLength(1);

    // A search word nothing matches empties the list; the name stays.
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'nothing-matches-this' },
    });
    expect(await screen.findByText('No issues match this filter')).toBeInTheDocument();
    expect(screen.getByText('Showing one problem only')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: problem })).toBeInTheDocument();
  });

  it('opens one problem onto its findings, filtered by the API', async () => {
    const fetchMock = stubIssues();
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Show findings: Page summary for search results is missing or the wrong length',
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

    const title = await screen.findAllByText(
      'Опис сторінки для пошуку відсутній або неправильної довжини',
    );
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
      {
        ruleId: 'A11Y-002',
        module: 'Accessibility',
        severity: 'Medium',
        issues: 1,
        openIssues: 1,
      },
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
    expect(csp).toHaveTextContent('Pages do not limit where they load content from');
    expect(csp).not.toHaveTextContent('Content-Security-Policy is missing or weak');

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

  // The fold was the whole explanation, so a list of problems could only be
  // read by opening one disclosure per row — which nobody does. The first
  // sentence is on the row; the rest of the explanation stays folded, because
  // one row per problem is what makes the list readable at all.
  it('says what each problem is on the row, without a click', async () => {
    stubSecurity([]);
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);

    const rows = (await screen.findAllByRole('row')).slice(1);
    const csp = nth(rows, 0, 'the CSP problem row');
    const sentence = within(csp).getByText(
      'These pages do not tell the browser which outside sources it may load content from.',
    );
    expect(sentence).toBeVisible();
    expect(sentence.closest('details')).toBeNull();

    // Said once: the fold under it no longer repeats the same sentence.
    const disclosure = within(csp)
      .getByText('What this means in plain language')
      .closest('details');
    if (disclosure === null) throw new Error('expected the plain-language disclosure');
    expect(disclosure).not.toHaveAttribute('open');
    expect(within(csp).queryByText('What the check found')).toBeNull();
    // Why it matters, what to do and what one finding counts are still in it.
    expect(within(disclosure).getByText('Why it matters')).toBeInTheDocument();
    expect(within(disclosure).getByText('What to do')).toBeInTheDocument();
    expect(within(disclosure).getByText('What one finding is')).toBeInTheDocument();
    expect(within(disclosure).getByText(/extra safeguard/)).not.toBeVisible();
  });

  it('says it on the row in Ukrainian too', async () => {
    stubSecurity([]);
    render(<IssuesScreen scan={SCAN} language="uk" onError={() => {}} />);

    const rows = (await screen.findAllByRole('row')).slice(1);
    const csp = nth(rows, 0, 'the CSP problem row');
    const sentence = within(csp).getByText(
      'Ці сторінки не повідомляють браузеру, з яких сторонніх джерел йому можна завантажувати вміст.',
    );
    expect(sentence).toBeVisible();
    expect(sentence.closest('details')).toBeNull();
    expect(within(csp).queryByText('Що знайшла перевірка')).toBeNull();
    expect(within(csp).getByText('Чому це важливо')).toBeInTheDocument();
  });

  it('explains the cookie and header rules too, and leaves other rules alone', async () => {
    stubSecurity([]);
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);

    const rows = (await screen.findAllByRole('row')).slice(1);
    const headers = nth(rows, 1, 'the security-headers problem row');
    const cookies = nth(rows, 2, 'the cookie problem row');
    const altText = nth(rows, 3, 'the image-alternative problem row');
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
    // A rule with no explanation gets no empty disclosure, keeps its own title
    // and id, and is counted in findings — it may not be one per page.
    expect(
      within(altText).queryByText('What this means in plain language'),
    ).not.toBeInTheDocument();
    expect(within(altText).getByText('Images without a text alternative')).toBeInTheDocument();
    expect(altText).toHaveTextContent('A11Y-002');
    expect(altText).toHaveTextContent('1 open finding');
    // Cookies are counted per cookie, so their count is never said in pages.
    expect(cookies).toHaveTextContent('4 open findings');
    expect(headers).toHaveTextContent('On 60 pages');
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
        name: 'Show findings: Some browser protection settings are off',
      }),
    );
    expect(await screen.findByText('Showing 1 of 1')).toBeInTheDocument();

    // The open problem is named once above its addresses, not on every row —
    // and once on the screen: the filter line above the heading said the same
    // sentence a second time, one line apart.
    expect(
      screen.getByRole('heading', { name: 'Some browser protection settings are off' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Some browser protection settings are off')).toHaveLength(1);
    expect(screen.getByText('Showing one problem only')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to all problems' }));

    expect(
      await screen.findByRole('button', {
        name: 'Show findings: Pages do not limit where they load content from',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Problems' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByText('Showing 1 of 1')).not.toBeInTheDocument();
  });

  // Regression: "Every finding" left the open problem's filter on, so the tab
  // claimed every finding while the list below was still one problem's — with
  // the "Showing one problem only" block stranded above it.
  it('means every finding when the tab says so', async () => {
    stubSecurity([header(1, 'Referrer-Policy')], 1);
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Show findings: Some browser protection settings are off',
      }),
    );
    expect(await screen.findByText('Showing one problem only')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Every finding' }));

    await waitFor(() =>
      expect(screen.queryByText('Showing one problem only')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Every finding' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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
    expect(screen.getByText('What we found, and on which pages')).toBeInTheDocument();
    // "<evidence> — 2 findings" was read as a statement about the address
    // inside the evidence; the pages it was found on are what the line is
    // about, so they are named under it.
    const variants = nth(screen.getAllByRole('list'), 0, 'the evidence list');
    expect(variants).toHaveTextContent('Referrer-Policy');
    expect(variants).toHaveTextContent('On these 2 pages:');
    expect(variants).toHaveTextContent('https://shop.example.com/page-1');
    expect(variants).toHaveTextContent('https://shop.example.com/page-2');
    expect(variants).toHaveTextContent('X-Frame-Options / CSP frame-ancestors');
    expect(variants).toHaveTextContent('On this page:');
    // The drilldown is still per page: every finding keeps its own address,
    // its own status control and its own evidence behind Details.
    expect(screen.getAllByText('https://shop.example.com/page-3').length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('combobox', { name: 'Status: Some browser protection settings are off' }),
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
    // Every label here says what its number is: "Impact 61/61 targets · score
    // -10.00" and "Confidence 100%" were three readings in two rows, in words
    // an owner does not have. The rule's technical title is here too now.
    expect(within(technical).getByText('How sure this finding is')).toBeInTheDocument();
    expect(within(technical).getByText('Pages affected')).toBeInTheDocument();
    expect(within(technical).getByText('1 of the 1 page checked for this')).toBeInTheDocument();
    expect(within(technical).getByText('Effect on the score')).toBeInTheDocument();
    // The fixture's delta is 0, and a finding that moves nothing says so
    // rather than printing "score 0.00".
    expect(within(technical).getByText('Does not change the score')).toBeInTheDocument();
    // The rule's own title, moved off the row above where it restated the
    // problem's plain name — labelled by what it is, not by the column
    // header's "Rule", which reads as something the owner broke.
    expect(within(technical).getByText('What the check is called')).toBeInTheDocument();
    expect(within(technical).getByText('Security headers are missing')).toBeInTheDocument();
    expect(within(technical).queryByText('Rule')).toBeNull();
    // The explanation comes before any scoring field.
    const explanation = within(detail).getByText('What the check found');
    expect(
      explanation.compareDocumentPosition(technical) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // A rule with no plain-language explanation has nothing to replace its
  // evidence and recommendation, so those stay where the reader last saw them;
  // the scoring and provenance fields still fold away.
  it('keeps an unexplained rule’s evidence in view and folds its scoring', async () => {
    stubSecurity([
      issue(1, {
        ruleId: 'A11Y-002',
        module: 'Accessibility',
        evidenceExcerpt: 'img.hero has no alt text',
        recommendation: 'Add alt text to meaningful images.',
      }),
    ]);
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} initialRuleId="A11Y-002" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));

    const detail = document.getElementById('issue-detail-issue-1');
    if (detail === null) throw new Error('expected the finding’s detail panel');
    expect(within(detail).queryByText('What the check found')).not.toBeInTheDocument();
    const technical = within(detail)
      .getByText('Technical details for your developer')
      .closest('details');
    if (technical === null) throw new Error('expected the technical disclosure');
    expect(technical).not.toHaveAttribute('open');
    const evidence = within(detail).getByText('img.hero has no alt text');
    expect(technical).not.toContainElement(evidence);
    expect(within(detail).getByText('Add alt text to meaningful images.')).toBeInTheDocument();
    expect(within(technical).getByText('Places affected')).toBeInTheDocument();
    expect(within(technical).getByText('How sure this finding is')).toBeInTheDocument();
    expect(within(technical).getByText('A11Y-002')).toBeInTheDocument();
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

// The rest of the report reads in the owner's words too: accessibility, SEO,
// privacy, content and the AI review — not only the three header rules.
describe('the other problems of a Complete report', () => {
  const REPORT_SUMMARY: IssueSummary = {
    total: 75,
    open: 75,
    bySeverity: { Critical: 0, High: 9, Medium: 66, Low: 0 },
    groups: [
      { ruleId: 'SEO-TECH-006', module: 'SEO', severity: 'High', issues: 9, openIssues: 9 },
      {
        ruleId: 'A11Y-007',
        module: 'Accessibility',
        severity: 'Medium',
        issues: 61,
        openIssues: 61,
      },
      {
        ruleId: 'UX-CONV-AI-001',
        module: 'UX/Conversion',
        severity: 'Medium',
        issues: 5,
        openIssues: 5,
      },
    ],
  };

  function stubReport(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/issues/summary')) return Promise.resolve(json(REPORT_SUMMARY));
        return Promise.resolve(json([], { total: 0, page: 1, limit: 50 }));
      }),
    );
  }

  it('names each problem plainly and counts pages only where a finding is a page', async () => {
    stubReport();
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);

    const rows = (await screen.findAllByRole('row')).slice(1);
    const [links, hints, offer] = rows;
    expect(links).toHaveTextContent('Links that lead to error pages');
    // One finding per broken link, so nine findings are not nine pages.
    expect(links).toHaveTextContent('9 open findings');
    expect(hints).toHaveTextContent('Screen-reader hints on these pages are broken');
    expect(hints).toHaveTextContent('On 61 pages');
    expect(offer).toHaveTextContent('It may not be clear what you offer');
    expect(offer).toHaveTextContent('5 open findings');
    // The AI review says what it is, and that it never saw the page's look.
    expect(within(offer as HTMLElement).getByText(/An AI review of the text/)).toBeInTheDocument();
  });

  it('reads in Ukrainian for a Ukrainian report, titles and advice included', async () => {
    stubReport();
    render(<IssuesScreen scan={SCAN} language="uk" onError={() => {}} />);

    const rows = (await screen.findAllByRole('row')).slice(1);
    const [links, hints] = rows;
    expect(links).toHaveTextContent('Посилання, що ведуть на сторінки з помилкою');
    expect(links).toHaveTextContent('Відкритих знахідок: 9');
    expect(hints).toHaveTextContent('Підказки для програм читання з екрана несправні');
    expect(hints).toHaveTextContent('На 61 сторінці');
    expect(
      within(hints as HTMLElement).getByText(/Попросіть розробника виправити або прибрати/),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Де знайдено' })).toBeInTheDocument();
  });
});

// The owner hands one problem on as one message, not as a row per page — and a
// browser that refuses the clipboard is told to the owner, not swallowed.
describe('copying a task for the developer', () => {
  const TASK_SUMMARY: IssueSummary = {
    total: 4,
    open: 4,
    bySeverity: { Critical: 0, High: 0, Medium: 4, Low: 0 },
    groups: [
      {
        ruleId: 'SEC-PASSIVE-002',
        module: 'Security',
        severity: 'Medium',
        issues: 4,
        openIssues: 4,
      },
    ],
  };
  const FINDINGS = [1, 2, 3, 4].map((index) =>
    issue(index, {
      ruleId: 'SEC-PASSIVE-002',
      module: 'Security',
      evidenceExcerpt: 'The HTML response is missing security headers: Referrer-Policy',
      recommendation: 'Send the missing headers with HTML responses.',
    }),
  );

  function stubTask(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/issues/summary')) return Promise.resolve(json(TASK_SUMMARY));
        return Promise.resolve(json(FINDINGS, { total: FINDINGS.length, page: 1, limit: 50 }));
      }),
    );
  }

  function stubClipboard(writeText: ((text: string) => Promise<void>) | undefined): void {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: writeText === undefined ? undefined : { writeText },
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
    vi.restoreAllMocks();
  });

  async function openProblem(language: 'en' | 'uk' = 'en'): Promise<void> {
    stubTask();
    render(
      <IssuesScreen
        scan={SCAN}
        language={language}
        onError={() => {}}
        initialRuleId="SEC-PASSIVE-002"
      />,
    );
    await screen.findByText(language === 'en' ? 'Showing 4 of 4' : 'Показано 4 з 4');
  }

  it('copies the problem, its reach, three example pages and the recommendation', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    stubClipboard(writeText);
    await openProblem();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Copy task for developer: Some browser protection settings are off',
      }),
    );

    expect(
      await screen.findByText('Task copied. Paste it into a message to your developer.'),
    ).toBeInTheDocument();
    const text = writeText.mock.calls[0]?.[0] ?? '';
    expect(text).toContain('Task: Some browser protection settings are off');
    expect(text).toContain('FluxRadar check: Security headers are missing (SEC-PASSIVE-002)');
    expect(text).toContain('Found on 4 pages.');
    expect(text).toContain('- https://shop.example.com/page-3');
    expect(text).not.toContain('page-4');
    expect(text).toContain('Recommendation: Send the missing headers with HTML responses.');
  });

  it('shows the text to copy by hand when the browser refuses', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubClipboard(() => Promise.reject(new Error('NotAllowedError')));
    await openProblem();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Copy task for developer: Some browser protection settings are off',
      }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'The task could not be copied automatically. Select the text below and copy it yourself.',
    );
    const fallback = within(alert).getByRole('textbox', { name: 'Task for your developer' });
    expect((fallback as HTMLTextAreaElement).value).toContain(
      'Task: Some browser protection settings are off',
    );
    expect(consoleError).toHaveBeenCalled();
    expect(
      screen.queryByText('Task copied. Paste it into a message to your developer.'),
    ).not.toBeInTheDocument();
  });

  it('says so in Ukrainian when the browser has no clipboard at all', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubClipboard(undefined);
    await openProblem('uk');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Скопіювати завдання для розробника: Частину захисних налаштувань браузера вимкнено',
      }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Не вдалося скопіювати завдання автоматично.');
    const fallback = within(alert).getByRole('textbox', { name: 'Завдання для вашого розробника' });
    expect((fallback as HTMLTextAreaElement).value).toContain('Знайдено на 4 сторінках.');
  });

  // Regression: for a rule that reports more than once per page the sentence
  // counted every loaded row of any status — "its 3 open findings" beside a
  // message about two — and with a lagging summary the two differed the other
  // way round. Both numbers are the task's own now.
  it('counts the findings the message counts, not the rows on screen', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    stubClipboard(writeText);
    const cookies = [1, 2, 3].map((index) =>
      issue(index, {
        ruleId: 'SEC-PASSIVE-005',
        module: 'Security',
        status: index === 1 ? 'Ignored' : 'New',
        targetUrl: 'https://shop.example.com/',
        evidenceExcerpt: 'Set-Cookie without the Secure attribute',
        recommendation: 'Send session cookies with Secure, HttpOnly and SameSite.',
      }),
    );
    // No summary, so nothing but the loaded findings can say what is open.
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/issues/summary')) {
          return Promise.resolve(new Response('unavailable', { status: 503 }));
        }
        return Promise.resolve(json(cookies, { total: cookies.length, page: 1, limit: 50 }));
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <IssuesScreen scan={SCAN} language="en" onError={() => {}} initialRuleId="SEC-PASSIVE-005" />,
    );

    expect(await screen.findByText(/and its 2 open findings/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Copy task for developer/ }));
    await screen.findByText('Task copied. Paste it into a message to your developer.');
    expect(writeText.mock.calls[0]?.[0] ?? '').toContain('2 findings on 1 page.');
  });

  it('is not offered for a slice of the problem narrowed by another filter', async () => {
    stubClipboard(() => Promise.resolve());
    await openProblem();
    expect(screen.getByRole('button', { name: /^Copy task for developer/ })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Severity' }), {
      target: { value: 'Medium' },
    });

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /^Copy task for developer/ }),
      ).not.toBeInTheDocument(),
    );
  });
});

// The task's reach comes from the summary's open count, not from the page of
// findings that happens to be loaded, and a problem with nothing open says so.
describe('the reach of a developer task', () => {
  function stubProblem(
    group: { issues: number; openIssues: number },
    findings: readonly Issue[],
  ): void {
    const summary: IssueSummary = {
      total: group.issues,
      open: group.openIssues,
      bySeverity: { Critical: group.issues, High: 0, Medium: 0, Low: 0 },
      groups: [{ ruleId: 'SEC-ASVS-001', module: 'Security', severity: 'Critical', ...group }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/issues/summary')) return Promise.resolve(json(summary));
        return Promise.resolve(json(findings, { total: group.issues, page: 1, limit: 50 }));
      }),
    );
  }

  function csp(index: number, status = 'New'): Issue {
    return issue(index, {
      ruleId: 'SEC-ASVS-001',
      module: 'Security',
      severity: 'Critical',
      status,
      evidenceExcerpt: 'The HTML response has no Content-Security-Policy',
      recommendation: 'Send a Content-Security-Policy header with HTML responses.',
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
    vi.restoreAllMocks();
  });

  // Regression guard: the first page holds 50 of 61 findings, 4 of them
  // settled; the task must say 57, not 50 or 46.
  it('counts the open findings of the whole problem from the summary', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      csp(index + 1, index < 4 ? 'Ignored' : 'New'),
    );
    stubProblem({ issues: 61, openIssues: 57 }, firstPage);
    render(
      <IssuesScreen scan={SCAN} language="en" onError={() => {}} initialRuleId="SEC-ASVS-001" />,
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Copy task for developer: Pages do not limit where they load content from',
      }),
    );

    await screen.findByText('Task copied. Paste it into a message to your developer.');
    const text = writeText.mock.calls[0]?.[0] ?? '';
    expect(text).toContain('Found on 57 pages.');
    expect(text.match(/^- https:\/\/shop\.example\.com\/page-\d+$/gm)).toHaveLength(3);
    // The examples are open findings: the four ignored ones lead the page.
    expect(text).toContain('- https://shop.example.com/page-5');
    expect(text).not.toMatch(/page-[1-4]$/m);
  });

  // Without a summary, a first page of settled findings says nothing about the
  // rest: the owner is told to load more rather than left with no button.
  it('asks to load more when no summary exists and nothing loaded is open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/issues/summary')) {
          return Promise.resolve(new Response('unavailable', { status: 503 }));
        }
        return Promise.resolve(
          json([csp(1, 'Ignored'), csp(2, 'Ignored')], { total: 61, page: 1, limit: 50 }),
        );
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <IssuesScreen scan={SCAN} language="en" onError={() => {}} initialRuleId="SEC-ASVS-001" />,
    );

    expect(
      await screen.findByText('No open finding is loaded yet. Show more findings to copy a task.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Copy task for developer/ }),
    ).not.toBeInTheDocument();
  });

  it('says there is no task when every finding is settled', async () => {
    stubProblem({ issues: 2, openIssues: 0 }, [csp(1, 'Ignored'), csp(2, 'False Positive')]);
    render(
      <IssuesScreen scan={SCAN} language="uk" onError={() => {}} initialRuleId="SEC-ASVS-001" />,
    );

    expect(
      await screen.findByText(
        'Для цієї проблеми нічого не відкрито, тож і завдання копіювати нічого.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Скопіювати завдання для розробника/ }),
    ).not.toBeInTheDocument();
  });

  // Regression: the sentence beside the button counted the addresses of every
  // loaded row, settled ones included, over a message about the open ones only.
  it('says the pages of the work still open, not of every loaded row', async () => {
    stubProblem({ issues: 4, openIssues: 1 }, [
      csp(1, 'Ignored'),
      csp(2, 'False Positive'),
      csp(3, 'Resolved'),
      csp(4),
    ]);
    render(
      <IssuesScreen scan={SCAN} language="en" onError={() => {}} initialRuleId="SEC-ASVS-001" />,
    );

    expect(await screen.findByText(/and the 1 page it was found on/)).toBeInTheDocument();
    expect(screen.queryByText(/the 4 pages it was found on/)).not.toBeInTheDocument();
  });

  // Part of the list, and no summary to say how much more there is: the message
  // hedges ("At least 1 open finding on 1 page"), so the sentence hedges too.
  it('hedges the count while only part of the list is loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/issues/summary')) {
          return Promise.resolve(new Response('unavailable', { status: 503 }));
        }
        return Promise.resolve(
          json([csp(1, 'Ignored'), csp(2)], { total: 61, page: 1, limit: 50 }),
        );
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <IssuesScreen scan={SCAN} language="en" onError={() => {}} initialRuleId="SEC-ASVS-001" />,
    );

    expect(
      await screen.findByText(/at least the 1 page it has been found on so far/),
    ).toBeInTheDocument();
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
        name: 'Show findings: Page summary for search results is missing or the wrong length',
      }),
    );

    await waitFor(() =>
      expect(issueQueries(fetchMock).at(-1)?.get('ruleId')).toBe('SEO-ONPAGE-002'),
    );
    const withProblem = issueQueries(fetchMock).filter((query) => query.has('ruleId'));
    expect(withProblem.every((query) => !query.has('search'))).toBe(true);
  });
});

// Inside "Technical details for your developer": how far a finding reaches, as
// a sentence rather than "Impact 14/59 targets". A rule checked on one page read
// "1 of the 1 pages checked for this", and the Ukrainian said «з 1 сторінок»,
// which agrees with nothing.
describe('how far a finding reaches, in words', () => {
  it.each([
    [1, '1 of the 1 page checked for this', '1 з 1 сторінки, перевіреної на це'],
    [2, '1 of the 2 pages checked for this', '1 з 2 сторінок, перевірених на це'],
    [5, '1 of the 5 pages checked for this', '1 з 5 сторінок, перевірених на це'],
    // English pluralises on one alone; a Ukrainian numeral ending in 1 takes the
    // singular noun again — but 11, a teen, does not.
    [21, '1 of the 21 pages checked for this', '1 з 21 сторінки, перевіреної на це'],
    [11, '1 of the 11 pages checked for this', '1 з 11 сторінок, перевірених на це'],
  ])('counts %i pages', (applicable, en, uk) => {
    expect(copy.en.issues.impactValue(1, applicable)).toBe(en);
    expect(copy.uk.issues.impactValue(1, applicable)).toBe(uk);
  });

  it.each([
    [1, '1 of the 1 place checked for this', '1 з 1 місця, перевіреного на це'],
    [2, '1 of the 2 places checked for this', '1 з 2 місць, перевірених на це'],
    [5, '1 of the 5 places checked for this', '1 з 5 місць, перевірених на це'],
    [21, '1 of the 21 places checked for this', '1 з 21 місця, перевіреного на це'],
    [11, '1 of the 11 places checked for this', '1 з 11 місць, перевірених на це'],
  ])('counts %i places for a rule that is not one per page', (applicable, en, uk) => {
    expect(copy.en.issues.impactTargetsValue(1, applicable)).toBe(en);
    expect(copy.uk.issues.impactTargetsValue(1, applicable)).toBe(uk);
  });
});
