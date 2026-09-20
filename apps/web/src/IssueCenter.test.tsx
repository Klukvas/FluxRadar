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
