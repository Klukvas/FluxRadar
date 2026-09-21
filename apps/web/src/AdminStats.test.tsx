import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { readAdminStats } from './admin-stats';

// ─── Owner dashboard ─────────────────────────────────────────────────────────
//
// /admin/stats draws the business numbers the API counts for a listed admin,
// and to everyone else it is a plain "Not available" — including when the
// answer is not the shape it expects, which is what every other workspace
// test's mock returns for a path it does not know. A half-read payload would
// draw zeros that look exactly like a quiet week, so nothing is drawn from one.
// ─────────────────────────────────────────────────────────────────────────────

const account = { accountId: 'account-1', email: 'owner@example.com', emailVerified: true };

function period(scale: number) {
  return {
    accounts: { created: 12 * scale, verified: 9 * scale },
    freeChecks: { claimed: 7 * scale },
    scans: {
      created: 20 * scale,
      byStatus: [
        { status: 'Completed', count: 15 * scale },
        { status: 'Failed', count: 5 * scale },
      ],
      byPlan: [
        { plan: 'Free', count: 14 * scale },
        { plan: 'Complete', count: 6 * scale },
      ],
    },
    checkouts: { opened: 8 * scale, completed: 2 * scale, rejected: 1, conversion: 0.25 },
    purchases: { completed: 2 * scale, byStatus: [{ status: 'paid', count: 2 * scale }] },
    revenue: [
      { currency: 'EUR', gross: 110.5 * scale, refunded: 110.5, net: 110.5 * scale - 110.5 },
      { currency: 'USD', gross: 55 * scale, refunded: 0, net: 55 * scale },
    ],
    refunds: { count: 1 },
    testMode: { checkoutsOpened: 3, purchases: 1 },
  };
}

function statsFor(days: number) {
  return {
    window: { days, from: '2026-09-15T00:00:00.000Z', to: '2026-09-21T15:00:00.000Z' },
    period: period(1),
    allTime: period(4),
    daily: Array.from({ length: days }, (_, index) => ({
      day: `2026-08-${String(index + 1).padStart(2, '0')}`,
      accounts: index % 3,
      scans: index % 5,
      purchases: index === 2 ? 1 : 0,
    })),
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

function stubApi(adminStats: (search: string) => Response, signedIn = true) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/me')
      return Promise.resolve(signedIn ? envelope(account) : failure(401, 'UNAUTHORIZED', 'no'));
    if (url.pathname === '/profiles') return Promise.resolve(envelope([]));
    if (url.pathname === '/admin/stats') return Promise.resolve(adminStats(url.search));
    return Promise.resolve(envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function statsRequests(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.pathname === '/admin/stats')
    .map((url) => url.search);
}

function panelTitled(title: string): HTMLElement {
  const panel = screen.getByText(title).closest('.panel');
  if (!(panel instanceof HTMLElement)) throw new Error(`no panel titled ${title}`);
  return panel;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('owner dashboard', () => {
  it('draws the numbers the API counted, per currency, for the last 30 days', async () => {
    const fetchMock = stubApi((search) =>
      envelope(statsFor(Number(new URLSearchParams(search).get('days')))),
    );
    window.history.replaceState(null, '', '/admin/stats');

    render(<App />);

    expect(await screen.findByText('Business numbers')).toBeInTheDocument();
    expect(await screen.findByText('9 confirmed their email')).toBeInTheDocument();
    expect(within(panelTitled('New accounts')).getByText('12')).toBeInTheDocument();
    expect(within(panelTitled('New accounts')).getByText('All time: 48')).toBeInTheDocument();
    expect(
      within(panelTitled('Checkouts opened')).getByText(/2 paid · 1 rejected · 25%/),
    ).toBeInTheDocument();

    const revenue = panelTitled('Revenue · last 30 days');
    const euro = within(revenue).getByText('EUR').closest('tr');
    const dollar = within(revenue).getByText('USD').closest('tr');
    expect(euro).toHaveTextContent('€110.50€110.50€0.00');
    expect(dollar).toHaveTextContent('$55.00$0.00$55.00');

    expect(
      screen.getByRole('img', { name: /^New accounts per day, .*30 in total/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/checkouts opened: 3, orders paid: 1\./)).toBeInTheDocument();
    expect(statsRequests(fetchMock)).toEqual(['?days=30']);
    // Never indexed: it is a workspace page to search engines.
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
  });

  it('asks again for the window the owner switches to', async () => {
    const fetchMock = stubApi((search) =>
      envelope(statsFor(Number(new URLSearchParams(search).get('days')))),
    );
    window.history.replaceState(null, '', '/admin/stats');
    render(<App />);
    await screen.findByText('Revenue · last 30 days');

    fireEvent.click(screen.getByRole('button', { name: '7 days' }));

    expect(await screen.findByText('Revenue · last 7 days')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(statsRequests(fetchMock)).toEqual(['?days=30', '?days=7']);
  });

  it('says "Not available" when the API answers 404', async () => {
    stubApi(() => failure(404, 'NOT_FOUND', 'route not found'));
    window.history.replaceState(null, '', '/admin/stats');

    render(<App />);

    expect(await screen.findAllByText('Not available')).not.toHaveLength(0);
    expect(
      screen.getByText('This page does not exist, or is not available to this account.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Business numbers')).not.toBeInTheDocument();
  });

  it.each([
    ['null', null],
    ['a scan object', { id: 'scan-1', status: 'Completed' }],
    ['a payload with one field of the wrong type', { ...statsFor(30), daily: 'none' }],
  ])('treats %s as not available rather than drawing zeros', async (_label, data) => {
    stubApi(() => envelope(data));
    window.history.replaceState(null, '', '/admin/stats');

    render(<App />);

    expect(await screen.findAllByText('Not available')).not.toHaveLength(0);
    expect(screen.queryByText('Business numbers')).not.toBeInTheDocument();
  });

  it('offers another try when the server fails, and draws the numbers once it answers', async () => {
    let calls = 0;
    stubApi(() => {
      calls += 1;
      return calls === 1
        ? failure(500, 'INTERNAL', 'internal server error')
        : envelope(statsFor(30));
    });
    window.history.replaceState(null, '', '/admin/stats');
    render(<App />);

    expect(await screen.findByText('The numbers could not be loaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Revenue · last 30 days')).toBeInTheDocument();
  });

  it('asks a signed-out visitor to sign in and never requests the numbers', async () => {
    const fetchMock = stubApi(() => envelope(statsFor(30)), false);
    window.history.replaceState(null, '', '/admin/stats');

    render(<App />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(statsRequests(fetchMock)).toEqual([]);
  });
});

describe('reading the dashboard answer', () => {
  it('accepts the API shape and refuses a negative or fractional count', () => {
    expect(readAdminStats(statsFor(7))).not.toBeNull();
    const negative = { ...statsFor(7), period: { ...period(1), refunds: { count: -1 } } };
    const fractional = { ...statsFor(7), period: { ...period(1), freeChecks: { claimed: 1.5 } } };
    expect(readAdminStats(negative)).toBeNull();
    expect(readAdminStats(fractional)).toBeNull();
  });
});
