import { EVERYTHING_ALLOWED, saveCookieConsent } from './browser-consent';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { apiCheckLines, parseApiCheckLines } from './api-check-lines';

// The three settings this change adds to the paid scan form — start URLs, the
// API endpoint list and JavaScript rendering — and the pause control on the
// progress screen.
//
// What is defended here is that the form refuses a line the API would refuse,
// *before* a checkout opens on a scan that would silently drop it, and that
// pausing is a separate, reversible action from cancelling.

const account = { accountId: 'account-1', email: 'operator@example.com', internalFreeAccess: true };
const profile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };

const scan = {
  id: 'scan-1',
  profileId: profile.id,
  plan: 'Complete' as const,
  domain: profile.domain,
  status: 'Running',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-v1',
  progress: { completedModules: 1, totalModules: 6, scannedUrls: 12, discoveredUrls: 40 },
  startedAt: null,
  completedAt: null,
  createdAt: '2026-09-22T00:00:00.000Z',
  modules: [],
};

function envelope<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function pathOf(input: RequestInfo | URL): string {
  return new URL(String(input)).pathname;
}

function bodyOf(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

function renderNewScan(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = pathOf(input);
    if (path === '/auth/me') return Promise.resolve(envelope(account));
    if (path === '/profiles') return Promise.resolve(envelope([profile]));
    if (path === '/scans/active') return Promise.resolve(envelope(null));
    if (path === '/profiles/profile-1/scans') return Promise.resolve(envelope([]));
    if (path === '/billing/internal-checkout')
      return Promise.resolve(envelope({ scanId: scan.id }));
    if (path.startsWith('/scans/')) return Promise.resolve(envelope(scan));
    return Promise.resolve(envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  saveCookieConsent(EVERYTHING_ALLOWED);
  window.localStorage.setItem('fluxradar.language', 'en');
  window.history.replaceState(null, '', '/scan');
  render(<App />);
  return fetchMock;
}

async function openAdvanced(): Promise<void> {
  await screen.findByText('New scan — scope and tariff');
  fireEvent.click(screen.getByText('Advanced crawl rules'));
}

function devCheckoutBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> | null {
  const call = fetchMock.mock.calls.find(
    ([input]) => pathOf(input as RequestInfo | URL) === '/billing/internal-checkout',
  );
  return call === undefined ? null : bodyOf(call[1] as RequestInit);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('parseApiCheckLines', () => {
  it('defaults the method to GET and reads the expected statuses', () => {
    expect(parseApiCheckLines('https://example.com/api/health').valid).toEqual([
      { method: 'GET', url: 'https://example.com/api/health' },
    ]);
    expect(parseApiCheckLines('HEAD https://example.com/api 200,204').valid).toEqual([
      { method: 'HEAD', url: 'https://example.com/api', expectedStatus: [200, 204] },
    ]);
  });

  it('names the line of anything it cannot accept', () => {
    const parsed = parseApiCheckLines(
      [
        'https://example.com/ok',
        'POST https://example.com/api',
        'nonsense',
        'GET https://example.com/api 2xx',
        // A line whose tail nobody can read: accepting it would silently drop
        // whatever the owner meant by the part after the statuses.
        'GET https://example.com/api 200 oops',
      ].join('\n'),
    );

    expect(parsed.valid).toHaveLength(1);
    expect(parsed.problems.map((problem) => [problem.line, problem.reason])).toEqual([
      [2, 'method'],
      [3, 'method'],
      [4, 'status'],
      [5, 'status'],
    ]);
  });

  it('round-trips through the lines a saved configuration is reopened on', () => {
    const lines = 'GET https://example.com/a 200\nHEAD https://example.com/b';
    expect(apiCheckLines(parseApiCheckLines(lines).valid)).toBe(lines);
  });
});

describe('the paid scan form', () => {
  it('sends start URLs, API checks and the rendering choice', async () => {
    const fetchMock = renderNewScan();
    await openAdvanced();

    fireEvent.change(screen.getByLabelText(/^Start URLs/), {
      target: { value: 'https://example.com/pricing\n https://example.com/docs ' },
    });
    fireEvent.change(screen.getByLabelText(/^API endpoints to check/), {
      target: { value: 'GET https://example.com/api/health 200,204' },
    });
    fireEvent.click(screen.getByLabelText('Read pages after their JavaScript has run'));
    fireEvent.click(screen.getByRole('button', { name: 'Run internal scan' }));

    await waitFor(() => expect(devCheckoutBody(fetchMock)).not.toBeNull());
    expect(devCheckoutBody(fetchMock)?.scope).toMatchObject({
      seedUrls: ['https://example.com/pricing', 'https://example.com/docs'],
      apiChecks: [
        { method: 'GET', url: 'https://example.com/api/health', expectedStatus: [200, 204] },
      ],
      renderJs: true,
    });
  });

  it('refuses a start URL that is not an address, before anything is created', async () => {
    const fetchMock = renderNewScan();
    await openAdvanced();

    fireEvent.change(screen.getByLabelText(/^Start URLs/), {
      target: { value: 'example.com/pricing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run internal scan' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('http://');
    expect(devCheckoutBody(fetchMock)).toBeNull();
  });

  it('refuses a write method on an endpoint, before anything is created', async () => {
    const fetchMock = renderNewScan();
    await openAdvanced();

    fireEvent.change(screen.getByLabelText(/^API endpoints to check/), {
      target: { value: 'POST https://example.com/api/orders' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run internal scan' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('GET or HEAD');
    expect(devCheckoutBody(fetchMock)).toBeNull();
  });

  it('withdraws the complaint as soon as the line is edited', async () => {
    renderNewScan();
    await openAdvanced();
    fireEvent.change(screen.getByLabelText(/^Start URLs/), {
      target: { value: 'nope' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run internal scan' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Start URLs/), {
      target: { value: 'https://example.com/ok' },
    });

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('the progress screen', () => {
  function renderProgress(status: string, pauseRequestedAt: string | null = null) {
    const current = { ...scan, status, pauseRequestedAt };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = pathOf(input);
      if (path === '/auth/me') return Promise.resolve(envelope(account));
      if (path === '/profiles') return Promise.resolve(envelope([profile]));
      if (path === '/scans/active') return Promise.resolve(envelope(current));
      void init;
      return Promise.resolve(envelope(current));
    });
    vi.stubGlobal('fetch', fetchMock);
    saveCookieConsent(EVERYTHING_ALLOWED);
    window.localStorage.setItem('fluxradar.language', 'en');
    window.history.replaceState(null, '', `/scans/${scan.id}`);
    render(<App />);
    return fetchMock;
  }

  it('shows how much of the site has been read', async () => {
    renderProgress('Running');

    expect(await screen.findByText('12 of 40 pages read')).toBeInTheDocument();
  });

  it('pauses through its own endpoint, not through cancel', async () => {
    const fetchMock = renderProgress('Running');
    const pause = await screen.findByRole('button', { name: 'Pause scan' });

    fireEvent.click(pause);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            pathOf(input as RequestInfo | URL) === `/scans/${scan.id}/pause` &&
            (init as RequestInit | undefined)?.method === 'POST',
        ),
      ).toBe(true),
    );
    expect(
      fetchMock.mock.calls.some(([input]) =>
        pathOf(input as RequestInfo | URL).endsWith('/cancel'),
      ),
    ).toBe(false);
  });

  it('offers Resume once the scan is paused', async () => {
    const fetchMock = renderProgress('Paused');
    const resume = await screen.findByRole('button', { name: 'Resume scan' });

    fireEvent.click(resume);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            pathOf(input as RequestInfo | URL) === `/scans/${scan.id}/resume` &&
            (init as RequestInit | undefined)?.method === 'POST',
        ),
      ).toBe(true),
    );
  });

  it('says a pause is being honoured while the current section finishes', async () => {
    renderProgress('Running', '2026-09-22T10:00:00.000Z');

    expect(
      await screen.findByText(/Finishing the current section, then pausing/),
    ).toBeInTheDocument();
  });
});
