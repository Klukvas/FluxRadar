import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

// ─── Workspace URLs ──────────────────────────────────────────────────────────
//
// Every workspace screen used to live at `/` and be restored by replaceState,
// so a reload of the workspace landed on the marketing home page, Back left the
// app entirely, and the Reports tab could not be linked to at all. These lock
// the routes down: each screen has a URL, that URL survives a reload, Back moves
// between screens, and a signed-out visitor who follows one is asked to sign in
// and then gets the screen they asked for.
// ─────────────────────────────────────────────────────────────────────────────

const account = { accountId: 'account-1', email: 'operator@example.com' };
const profile = { id: 'profile-1', name: 'Product website', domain: 'https://example.com' };

const runningScan = {
  id: 'scan-1',
  profileId: profile.id,
  plan: 'Basic' as const,
  domain: 'https://example.com',
  status: 'Running',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-v1',
  progress: { completedModules: 1, totalModules: 2 },
  startedAt: '2026-09-04T00:00:00.000Z',
  completedAt: null,
  createdAt: '2026-09-04T00:00:00.000Z',
  modules: [],
};

function envelope<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function failure(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: { code: 'TEST_ERROR', message } }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function stubApi(handler: (path: string) => Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(handler(new URL(String(input)).pathname)),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function signedIn(path: string): Response {
  if (path === '/auth/me') return envelope(account);
  if (path === '/profiles') return envelope([profile]);
  if (path === '/scans/active') return envelope(null);
  if (path === '/scans') return envelope([]);
  if (path === `/profiles/${profile.id}/scans`) return envelope([]);
  if (path === '/integrations') return envelope([]);
  if (path === `/scans/${runningScan.id}`) return envelope(runningScan);
  if (path === `/scans/${runningScan.id}/issues`) return envelope([]);
  return envelope(null);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('workspace deep links survive a reload', () => {
  it.each([
    ['/profiles', 'Site Profiles'],
    ['/scan', 'New scan — scope and tariff'],
    ['/reports', 'Your audit reports'],
    ['/integrations', 'Connected data sources'],
  ])('restores %s directly', async (path, expected) => {
    stubApi(signedIn);
    window.history.replaceState(null, '', path);

    render(<App />);

    expect(await screen.findByText(expected)).toBeInTheDocument();
    // The URL is left exactly as it was entered; nothing rewrites it on boot.
    expect(window.location.pathname).toBe(path);
  });

  it('opens the Issue Center from its own deep link', async () => {
    stubApi(signedIn);
    window.history.replaceState(null, '', `/scans/${runningScan.id}/issues`);

    render(<App />);

    expect(await screen.findByText('Findings and evidence')).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/scans/${runningScan.id}/issues`);
  });

  it.each([
    ['the language its address names', '?plan=de', 'de'],
    ['the reader’s language for a code the picker does not list', '?plan=xx', 'en'],
  ])('asks the client report for the Action Plan in %s', async (_case, search, language) => {
    const fetchMock = stubApi(signedIn);
    window.history.replaceState(null, '', `/scans/${runningScan.id}/report${search}`);

    render(<App />);

    await waitFor(() =>
      expect(fetchMock.mock.calls.map(([input]) => String(input))).toContainEqual(
        expect.stringContaining(`/scans/${runningScan.id}/action-plan?language=${language}`),
      ),
    );
  });

  it('does not hijack a workspace URL with whatever scan happens to be running', async () => {
    const fetchMock = stubApi((path) =>
      path === '/scans/active' ? envelope(runningScan) : signedIn(path),
    );
    window.history.replaceState(null, '', '/reports');

    render(<App />);

    await screen.findByText('Your audit reports');
    // An explicit screen request must not be overruled by the active-scan probe.
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/scans/active'))).toBe(
      false,
    );
    expect(window.location.pathname).toBe('/reports');
  });
});

describe('menu bar tabs land somewhere real', () => {
  it('routes the Reports tab to the reports list, not to a blank report', async () => {
    stubApi(signedIn);
    window.history.replaceState(null, '', '/profiles');
    render(<App />);
    await screen.findByText('Site Profiles');

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));

    expect(await screen.findByText('Your audit reports')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/reports');
  });

  it('returns to the report, not to the progress window, when Back leaves the Issue Center', async () => {
    const completed = { ...runningScan, status: 'Completed', completedAt: '2026-09-04T00:03:00.000Z' };
    stubApi((path) => {
      if (path === `/scans/${runningScan.id}`) return envelope(completed);
      if (path === `/scans/${runningScan.id}/dashboard`)
        return envelope({
          scan: completed,
          overall: { verdict: 'good', score: 90, weightedCoverage: 1, moduleWeights: [] },
          modules: [],
        });
      return signedIn(path);
    });
    window.history.replaceState(null, '', `/scans/${runningScan.id}`);
    render(<App />);
    await screen.findByText('Report dashboard · example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Open Issue Center' }));
    await screen.findByText('Findings and evidence');

    window.history.back();

    // `/scans/:id` means the report for a finished scan, forwards and backwards.
    expect(await screen.findByText('Report dashboard · example.com')).toBeInTheDocument();
  });

  it('walks Profiles → Scan → Reports and back again with the browser Back button', async () => {
    stubApi(signedIn);
    window.history.replaceState(null, '', '/profiles');
    render(<App />);
    await screen.findByText('Site Profiles');

    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    await screen.findByText('New scan — scope and tariff');
    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    await screen.findByText('Your audit reports');

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe('/scan'));
    expect(await screen.findByText('New scan — scope and tariff')).toBeInTheDocument();

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe('/profiles'));
    expect(await screen.findByText('Site Profiles')).toBeInTheDocument();
  });
});

describe('signed-out visitors following a workspace link', () => {
  it('asks for a sign-in instead of silently showing the marketing page', async () => {
    stubApi((path) => (path === '/auth/me' ? failure(401, 'session required') : envelope(null)));
    window.history.replaceState(null, '', '/reports');

    render(<App />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('FluxRadar — Sign in')).toBeInTheDocument();
  });

  it('lands on the screen that was asked for once signed in', async () => {
    let authenticated = false;
    stubApi((path) => {
      if (path === '/auth/me') return authenticated ? envelope(account) : failure(401, 'no session');
      if (path === '/auth/login') {
        authenticated = true;
        return envelope(account);
      }
      return signedIn(path);
    });
    window.history.replaceState(null, '', '/integrations');
    render(<App />);
    await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'operator@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1234' } });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Sign in' }).filter((button) => button.getAttribute('type') === 'submit')[0]!,
    );

    expect(await screen.findByText('Connected data sources')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/integrations');
  });
});

describe('document language', () => {
  it('marks the page in the language it is actually rendered in', async () => {
    stubApi(signedIn);
    render(<App />);
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });
    expect(document.documentElement.lang).toBe('en');

    fireEvent.click(screen.getByRole('combobox', { name: 'Language' }));
    fireEvent.click(screen.getByRole('option', { name: 'Українська' }));

    await waitFor(() => expect(document.documentElement.lang).toBe('uk'));
  });
});


// ─── Controls that look like controls must be controls ───────────────────────
//
// Every Window draws a titlebar close box. Only some windows are closable, and
// the rest used to render the box as a real <button> with no handler — the
// first thing a keyboard user reaches on the screen, and it did nothing.
// ─────────────────────────────────────────────────────────────────────────────
describe('window titlebar close box', () => {
  it('is a real control only on a window that can be closed', async () => {
    stubApi(signedIn);
    window.history.replaceState(null, '', '/profiles');
    render(<App />);
    await screen.findByText('Site Profiles');

    // The workspace desktop has no closable window, so it offers no close button.
    expect(screen.queryByRole('button', { name: 'Close window' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    await screen.findByText('New scan — scope and tariff');

    // The new-scan window is closable, so its box is a button and it works.
    const close = screen.getByRole('button', { name: 'Close window' });
    fireEvent.click(close);
    expect(await screen.findByText('Site Profiles')).toBeInTheDocument();
  });
});
