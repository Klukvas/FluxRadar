import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

const account = { accountId: 'account-1', email: 'operator@example.com' };

const scan = {
  id: 'scan-refresh-1',
  profileId: 'profile-1',
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
  modules: [
    {
      module: 'SEO',
      status: 'Completed',
      statusReason: null,
      coverage: 1,
      score: 90,
      applicableChecks: 1,
      completedApplicableChecks: 1,
      usableOutput: true,
      metadata: {},
    },
  ],
};

const completedScan = { ...scan, status: 'Completed', completedAt: '2026-09-04T00:03:00.000Z' };

const dashboard = {
  scan: completedScan,
  overall: { verdict: 'good', score: 90, weightedCoverage: 1, moduleWeights: [] },
  modules: completedScan.modules,
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
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
}

function stubApi(
  handler: (path: string, init?: RequestInit) => Response,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    return Promise.resolve(handler(path, init));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function openAuth(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Run a free homepage check' }));
}

async function renderUnauthenticated(
  handler: (path: string, init?: RequestInit) => Response,
): Promise<ReturnType<typeof vi.fn>> {
  const fetchMock = stubApi(handler);
  render(<App />);
  await screen.findByRole('heading', { name: 'One URL. Every signal.' });
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('authentication UI', () => {
  it('opens auth as a modal, switches to registration, and closes without leaving home', async () => {
    await renderUnauthenticated((path) =>
      path === '/auth/me' ? failure(401, 'session required') : envelope([]),
    );

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    openAuth();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Password')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('FluxRadar — Create account')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Back to sign in' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'One URL. Every signal.' })).toBeInTheDocument();
  });

  it('shows a product error for a failed sign-in without leaking the HTTP error', async () => {
    await renderUnauthenticated((path) => {
      if (path === '/auth/me') return failure(401, 'session required');
      if (path === '/auth/login')
        return new Response('<h1>Not found</h1>', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        });
      return envelope([]);
    });

    openAuth();
    const dialog = screen.getByRole('dialog');
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'operator@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'valid-password' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('FluxRadar could not find the requested item.');
    expect(alert).not.toHaveTextContent('Request failed with HTTP 404');
  });

  it('registers successfully and moves the user into the signed-in workspace', async () => {
    const fetchMock = await renderUnauthenticated((path) => {
      if (path === '/auth/me') return failure(401, 'session required');
      if (path === '/auth/register') return envelope(account, 201);
      if (path === '/profiles') return envelope([]);
      return envelope([]);
    });

    openAuth();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: account.email },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'valid-password' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(screen.getByText('Unified public website audit station.')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/auth\/register$/),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('keeps an authenticated user on the public home and exposes the workspace entry', async () => {
    stubApi((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([]);
      if (path === '/scans/active') return envelope(null);
      return envelope([]);
    });

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'One URL. Every signal.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(account.email)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    await waitFor(() =>
      expect(screen.getByText('Unified public website audit station.')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByRole('heading', { name: 'One URL. Every signal.' })).toBeInTheDocument();
  });
});

describe('public legal pages', () => {
  it('renders the privacy policy without calling the API', async () => {
    const fetchMock = stubApi(() => envelope(null));
    window.history.replaceState(null, '', '/privacy');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Privacy policy' })).toBeInTheDocument();
    expect(screen.getByText('How Google user data is used')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Terms of service →' })).toHaveAttribute(
      'href',
      '/terms',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders the terms of service as a public page', async () => {
    window.history.replaceState(null, '', '/terms');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Terms of service' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Free and paid scans' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy policy →' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });
});

describe('refresh-safe scan routes', () => {
  it('restores an active scan from its deep link after authentication', async () => {
    window.history.replaceState(null, '', `/scans/${scan.id}`);
    stubApi((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([]);
      if (path === `/scans/${scan.id}`) return envelope(scan);
      return envelope(null);
    });

    render(<App />);

    expect(await screen.findByText('Scan progress · Basic')).toBeInTheDocument();
    expect(screen.getByText('state Running')).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/scans/${scan.id}`);
  });

  it('opens the persisted report when a completed scan URL is refreshed', async () => {
    window.history.replaceState(null, '', `/scans/${completedScan.id}`);
    stubApi((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([]);
      if (path === `/scans/${completedScan.id}`) return envelope(completedScan);
      if (path === `/scans/${completedScan.id}/dashboard`) return envelope(dashboard);
      return envelope(null);
    });

    render(<App />);

    expect(await screen.findByText('Report dashboard · https://example.com')).toBeInTheDocument();
    expect(screen.getByText('Unified website signal')).toBeInTheDocument();
  });

  it('opens the login modal instead of probing a deep-linked scan while signed out', async () => {
    window.history.replaceState(null, '', `/scans/${scan.id}`);
    stubApi((path) => (path === '/auth/me' ? failure(401, 'session required') : envelope(null)));

    render(<App />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('FluxRadar — Sign in')).toBeInTheDocument();
  });
});
