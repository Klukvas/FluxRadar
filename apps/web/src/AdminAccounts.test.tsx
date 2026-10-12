import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { readAdminAccounts } from './admin-accounts';

// ─── Owner dashboard: Accounts list ──────────────────────────────────────────
//
// Under the numbers on /admin/stats, a page of 50 registered accounts with a
// search by email. It asks for one page at a time, starts a new search on page
// 1, and draws nothing at all from an answer it cannot read — the dashboard
// above already says whether the page is available, and saying it twice would
// be noise.
// ─────────────────────────────────────────────────────────────────────────────

const account = { accountId: 'account-1', email: 'owner@example.com', emailVerified: true };

function period() {
  return {
    accounts: { created: 3, verified: 2 },
    freeChecks: { claimed: 1 },
    scans: { created: 2, byStatus: [], byPlan: [] },
    checkouts: { opened: 0, completed: 0, rejected: 0, conversion: null },
    purchases: { completed: 0, byStatus: [] },
    revenue: [],
    refunds: { count: 0 },
    testMode: { checkoutsOpened: 0, purchases: 0 },
  };
}

const stats = {
  window: { days: 30, from: '2026-08-23T00:00:00.000Z', to: '2026-09-21T15:00:00.000Z' },
  period: period(),
  allTime: period(),
  daily: Array.from({ length: 30 }, (_, index) => ({
    day: `2026-08-${String(index + 1).padStart(2, '0')}`,
    accounts: 0,
    scans: 0,
    purchases: 0,
  })),
};

function row(index: number) {
  return {
    email: `person-${index}@example.com`,
    createdAt: '2026-09-16T23:30:00.000Z',
    emailVerified: index % 2 === 0,
    freeCheckUsedAt: index === 0 ? '2026-09-17T00:15:00.000Z' : null,
    scans: index,
    purchases: index === 0 ? 2 : 0,
    lastActivityAt: '2026-09-20T12:00:00.000Z',
  };
}

/** A page of a 120-account list, the way the API pages it. */
function pageOf(search: string) {
  const page = Number(new URLSearchParams(search).get('page'));
  const first = (page - 1) * 50;
  const count = Math.max(0, Math.min(50, 120 - first));
  return {
    page,
    pageSize: 50,
    total: 120,
    rows: Array.from({ length: count }, (_, index) => row(first + index)),
  };
}

function envelope<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function failure(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ success: false, data: null, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(adminAccounts: (search: string) => Response | Promise<Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/me') return Promise.resolve(envelope(account));
    if (url.pathname === '/profiles') return Promise.resolve(envelope([]));
    if (url.pathname === '/admin/stats') return Promise.resolve(envelope(stats));
    if (url.pathname === '/admin/accounts') return Promise.resolve(adminAccounts(url.search));
    return Promise.resolve(envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function accountRequests(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.pathname === '/admin/accounts')
    .map((url) => url.search);
}

function openDashboard(): void {
  window.history.replaceState(null, '', '/admin/stats');
  render(<App />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('owner dashboard accounts list', () => {
  it('draws a page of accounts with UTC dates and a pager', async () => {
    const fetchMock = stubApi((search) => envelope(pageOf(search)));
    openDashboard();

    const first = (await screen.findByText('person-0@example.com')).closest('tr');
    if (!(first instanceof HTMLElement)) throw new Error('no row');
    // 23:30 UTC on the 16th is still the 16th, whatever the browser's zone.
    expect(within(first).getByText('2026-09-16')).toBeInTheDocument();
    expect(within(first).getByText('yes')).toBeInTheDocument();
    expect(within(first).getByText('2026-09-17')).toBeInTheDocument();
    expect(within(first).getByText('2026-09-20')).toBeInTheDocument();
    const second = screen.getByText('person-1@example.com').closest('tr');
    if (!(second instanceof HTMLElement)) throw new Error('no row');
    expect(within(second).getAllByText('—')).toHaveLength(2);

    expect(screen.getByRole('heading', { name: 'Accounts' })).toBeInTheDocument();
    expect(screen.getByText('Showing 1–50 of 120')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    expect(accountRequests(fetchMock)).toEqual(['?page=1']);
  });

  it('asks for the next page, and stops at the last one', async () => {
    const fetchMock = stubApi((search) => envelope(pageOf(search)));
    openDashboard();
    await screen.findByText('person-0@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('person-50@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Showing 101–120 of 120')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
    expect(accountRequests(fetchMock)).toEqual(['?page=1', '?page=2', '?page=3']);
  });

  it('searches from page 1 with the query encoded, and clears back to every account', async () => {
    const fetchMock = stubApi((search) => envelope(pageOf(search)));
    openDashboard();
    await screen.findByText('person-0@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('person-50@example.com');

    const field = screen.getByLabelText('Search by email');
    fireEvent.change(field, { target: { value: '  Buyer+x@Example.com ' } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);

    await waitFor(() =>
      expect(accountRequests(fetchMock)).toEqual([
        '?page=1',
        '?page=2',
        '?page=1&q=Buyer%2Bx%40Example.com',
      ]),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));

    await waitFor(() => expect(accountRequests(fetchMock).at(-1)).toBe('?page=1'));
    expect(screen.getByLabelText('Search by email')).toHaveValue('');
  });

  it('keeps a search on screen when the page it replaced answers late', async () => {
    let answerPageTwo: () => void = () => undefined;
    stubApi((search) => {
      const params = new URLSearchParams(search);
      if (params.has('q')) {
        return envelope({ page: 1, pageSize: 50, total: 1, rows: [row(7)] });
      }
      if (params.get('page') === '2') {
        return new Promise<Response>((resolve) => {
          answerPageTwo = () => resolve(envelope(pageOf(search)));
        });
      }
      return envelope(pageOf(search));
    });
    openDashboard();
    await screen.findByText('person-0@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('Search by email'), { target: { value: 'person-7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Showing 1–1 of 1')).toBeInTheDocument();
    // Let the late answer and everything it would set run to the end.
    await act(async () => {
      answerPageTwo();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(screen.getByText('person-7@example.com')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–1 of 1')).toBeInTheDocument();
    expect(screen.queryByText('person-50@example.com')).not.toBeInTheDocument();
  });

  it('says no account matches a search that found none', async () => {
    stubApi((search) =>
      new URLSearchParams(search).has('q')
        ? envelope({ page: 1, pageSize: 50, total: 0, rows: [] })
        : envelope(pageOf(search)),
    );
    openDashboard();
    await screen.findByText('person-0@example.com');

    fireEvent.change(screen.getByLabelText('Search by email'), { target: { value: 'nobody' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('No accounts match')).toBeInTheDocument();
  });

  it.each([
    ['null', null],
    ['a scan object', { id: 'scan-1', status: 'Completed' }],
    ['a row with a field of the wrong type', { ...pageOf('?page=1'), rows: [{ email: 1 }] }],
  ])('draws nothing from %s', async (_label, data) => {
    stubApi(() => envelope(data));
    openDashboard();

    expect(await screen.findByText('Business numbers')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText('Loading results')).not.toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Accounts' })).not.toBeInTheDocument();
    expect(screen.queryAllByText('Not available')).toHaveLength(0);
  });

  it('offers another try when the server fails, and draws the list once it answers', async () => {
    let calls = 0;
    const fetchMock = stubApi((search) => {
      calls += 1;
      return calls === 1
        ? failure(500, 'INTERNAL', 'internal server error')
        : envelope(pageOf(search));
    });
    openDashboard();

    expect(await screen.findByText('The accounts could not be loaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('person-0@example.com')).toBeInTheDocument();
    expect(accountRequests(fetchMock)).toEqual(['?page=1', '?page=1']);
  });
});

describe('reading the accounts answer', () => {
  it('keeps only the documented fields and refuses a fractional count or a bad date', () => {
    const page = pageOf('?page=1');
    const withExtra = { ...page, rows: [{ ...row(0), passwordHash: 'x', id: 'account-9' }] };
    expect(Object.keys(readAdminAccounts(withExtra)?.rows[0] ?? {}).sort()).toEqual(
      Object.keys(row(0)).sort(),
    );
    expect(readAdminAccounts({ ...page, rows: [{ ...row(0), scans: 1.5 }] })).toBeNull();
    expect(readAdminAccounts({ ...page, rows: [{ ...row(0), createdAt: 'soon' }] })).toBeNull();
    expect(readAdminAccounts({ ...page, page: 0 })).toBeNull();
  });
});
