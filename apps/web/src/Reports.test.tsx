import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

// ─── Reports tab ─────────────────────────────────────────────────────────────
//
// The Reports tab used to open the report of whichever scan happened to be
// selected — and an "no completed report selected" dead end when none was, which
// is the state an owner arriving from the menu bar is always in. These cover the
// list that replaced it: that it lists real scans, that each of its three
// unhappy states says something an owner can act on, and that it pages with the
// API's own `meta` rather than assuming the first page is everything.
// ─────────────────────────────────────────────────────────────────────────────

const account = { accountId: 'account-1', email: 'operator@example.com' };

const profile = {
  id: 'profile-1',
  name: 'Product website',
  domain: 'https://example.com',
};

function scanAt(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    profileId: profile.id,
    plan: 'Basic' as const,
    domain: 'https://example.com',
    status: 'Completed',
    statusReason: null,
    scope: { includeSubdomains: false },
    rulesetVersion: 'rules-v1',
    progress: { completedModules: 2, totalModules: 2 },
    startedAt: '2026-09-04T00:00:00.000Z',
    completedAt: '2026-09-04T00:03:00.000Z',
    createdAt: '2026-09-04T00:00:00.000Z',
    modules: [],
    ...overrides,
  };
}

function envelope<T>(data: T, meta?: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(meta === undefined ? { success: true, data, error: null } : { success: true, data, error: null, meta }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function failure(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: { code: 'TEST_ERROR', message } }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function stubApi(handler: (path: string, search: string) => Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input));
    return Promise.resolve(handler(url.pathname, url.search));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Signed-in workspace whose only interesting endpoint is the scan list. */
function workspace(scans: (path: string, search: string) => Response) {
  return (path: string, search: string): Response => {
    if (path === '/auth/me') return envelope(account);
    if (path === '/profiles') return envelope([profile]);
    if (path === '/scans/active') return envelope(null);
    if (path === '/scans' || path === `/profiles/${profile.id}/scans`) return scans(path, search);
    const dashboardMatch = /^\/scans\/([^/]+)\/dashboard$/.exec(path);
    if (dashboardMatch !== null) {
      const scan = scanAt(dashboardMatch[1] ?? 'scan-a');
      return envelope({
        scan,
        overall: { verdict: 'good', score: 90, weightedCoverage: 1, moduleWeights: [] },
        modules: [],
      });
    }
    const scanMatch = /^\/scans\/([^/]+)$/.exec(path);
    if (scanMatch !== null) return envelope(scanAt(scanMatch[1] ?? 'scan-a'));
    return envelope(null);
  };
}

async function openReports(handler: (path: string, search: string) => Response) {
  const fetchMock = stubApi(handler);
  window.history.replaceState(null, '', '/reports');
  render(<App />);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('Reports list', () => {
  it('lists the account scans with a way into each one', async () => {
    await openReports(
      workspace(() =>
        envelope([scanAt('scan-a'), scanAt('scan-b', { status: 'Running', completedAt: null })], {
          total: 2,
          page: 1,
          limit: 20,
          hasNext: false,
        }),
      ),
    );

    const list = await screen.findByRole('list', { name: 'Your audit reports' });
    // A finished scan opens its report; one still running is followed, not opened.
    // The accessible name carries the website so two rows never sound alike.
    expect(
      within(list).getByRole('button', { name: 'Open report · example.com' }),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole('button', { name: 'Follow progress · example.com' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Showing 2 of 2.')).toBeInTheDocument();
  });

  it('opens the report of the scan that was clicked and puts it in the URL', async () => {
    await openReports(
      workspace(() => envelope([scanAt('scan-a')], { total: 1, page: 1, limit: 20, hasNext: false })),
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Open report/ }));

    await screen.findByText('Report dashboard · example.com');
    expect(window.location.pathname).toBe('/scans/scan-a');
  });

  it('tells a new owner why the list is empty and offers the first step', async () => {
    await openReports(
      workspace(() => envelope([], { total: 0, page: 1, limit: 20, hasNext: false })),
    );

    expect(await screen.findByText('No reports yet')).toBeInTheDocument();
    expect(screen.getByText(/A report appears here as soon as you check a website/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check a website' }));
    expect(await screen.findByText('New scan — scope and tariff')).toBeInTheDocument();
  });

  it('reports a failed load in product language and retries in place', async () => {
    let attempts = 0;
    await openReports(
      workspace(() => {
        attempts += 1;
        return attempts === 1
          ? failure(500, 'Request failed with HTTP 500')
          : envelope([scanAt('scan-a')], { total: 1, page: 1, limit: 20, hasNext: false });
      }),
    );

    // The provider's own wording never reaches the owner.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('FluxRadar is temporarily unavailable. Try again in a moment.');
    expect(screen.queryByText(/HTTP 500/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /^Open report/ })).toBeInTheDocument();
  });

  it('pages with the envelope meta and appends the next page', async () => {
    const fetchMock = await openReports(
      workspace((_path, search) =>
        search.includes('offset=20')
          ? envelope([scanAt('scan-old')], { total: 21, page: 2, limit: 20, hasNext: false })
          : envelope(
              Array.from({ length: 20 }, (_, index) => scanAt(`scan-${index}`)),
              { total: 21, page: 1, limit: 20, hasNext: true },
            ),
      ),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Show older reports' }));

    await waitFor(() => expect(screen.getByText('Showing 21 of 21.')).toBeInTheDocument());
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes('offset=20')),
    ).toBe(true);
    // The last page removes the control rather than offering a page that is not there.
    expect(screen.queryByRole('button', { name: 'Show older reports' })).not.toBeInTheDocument();
  });

  it('falls back to total/page arithmetic when the server sends no hasNext', async () => {
    await openReports(
      workspace((_path, search) =>
        search.includes('offset=20')
          ? envelope([scanAt('scan-old')], { total: 21, page: 2, limit: 20 })
          : envelope(
              Array.from({ length: 20 }, (_, index) => scanAt(`scan-${index}`)),
              // An older deployment: no hasNext field at all.
              { total: 21, page: 1, limit: 20 },
            ),
      ),
    );

    expect(await screen.findByRole('button', { name: 'Show older reports' })).toBeInTheDocument();
  });

  it('never asks for the Complete-only history view, which would 403 a Basic owner', async () => {
    const fetchMock = await openReports(
      workspace(() => envelope([scanAt('scan-a')], { total: 1, page: 1, limit: 20, hasNext: false })),
    );

    await screen.findByRole('button', { name: /^Open report/ });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('history='))).toBe(false);
  });
});

describe('Reports scoped to one website', () => {
  it('opens that website reports from the profile row and can widen back out', async () => {
    stubApi(
      workspace((path) =>
        path === `/profiles/${profile.id}/scans`
          ? envelope([scanAt('scan-a')], { total: 1, page: 1, limit: 20, hasNext: false })
          : envelope([scanAt('scan-a'), scanAt('scan-b')], {
              total: 2,
              page: 1,
              limit: 20,
              hasNext: false,
            }),
      ),
    );
    window.history.replaceState(null, '', '/profiles');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Inspect' }));

    // Inspect produces a visible result, not a silent state change.
    expect(await screen.findByText('Reports for Product website')).toBeInTheDocument();
    expect(screen.getByText('Every check of example.com, newest first.')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/reports');

    fireEvent.click(screen.getByRole('button', { name: 'Show all reports' }));
    expect(await screen.findByText('Your audit reports')).toBeInTheDocument();
  });
});
