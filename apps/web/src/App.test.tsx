import { saveCookieConsent } from './browser-consent';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { copy } from './i18n';
import { tourSteps } from './tour-steps';

/**
 * The element the tour spotlight resolved to, found through the stable
 * `data-tour-target` contract rather than through class names or geometry.
 */
function resolvedTourTarget(): HTMLElement {
  const overlay = document.querySelector('.tour-overlay');
  const name = overlay?.getAttribute('data-tour-active-target');
  const target =
    name === null || name === undefined
      ? null
      : document.querySelector<HTMLElement>(`[data-tour-target="${name}"]`);
  if (target === null) throw new Error('expected the tour to resolve a target element');
  return target;
}

function switchLanguageToUkrainian() {
  fireEvent.click(screen.getByRole('combobox', { name: 'Language' }));
  fireEvent.click(screen.getByRole('option', { name: 'Українська' }));
}

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

const completedScan = {
  ...scan,
  status: 'Completed',
  progress: { completedModules: 2, totalModules: 2 },
  completedAt: '2026-09-04T00:03:00.000Z',
};

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

function pathOf(input: RequestInfo | URL): string {
  return new URL(String(input)).pathname;
}

function calledMethod(fetchMock: ReturnType<typeof vi.fn>, path: string, method: string): boolean {
  return fetchMock.mock.calls.some(
    ([input, init]) =>
      pathOf(input) === path && (init as RequestInit | undefined)?.method === method,
  );
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
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('authentication UI', () => {
  it.each([
    { rememberMe: false, label: 'a browser-session cookie' },
    { rememberMe: true, label: 'an explicitly persistent cookie' },
  ])('submits $label only when Remember me is selected', async ({ rememberMe }) => {
    const fetchMock = await renderUnauthenticated((path) => {
      if (path === '/auth/me') return failure(401, 'session required');
      if (path === '/auth/register') return envelope(account, 201);
      if (path === '/profiles') return envelope([]);
      return envelope([]);
    });

    openAuth();
    const dialog = screen.getByRole('dialog');
    const checkbox = within(dialog).getByRole('checkbox', { name: 'Remember me for 7 days' });
    expect(checkbox).not.toBeChecked();
    expect(within(dialog).getByRole('link', { name: 'Terms of service' })).toHaveAttribute(
      'href',
      '/terms?lang=en',
    );
    expect(within(dialog).getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
      'href',
      '/privacy?lang=en',
    );
    expect(within(dialog).getByRole('link', { name: 'Cookie policy' })).toHaveAttribute(
      'href',
      '/cookies?lang=en',
    );
    if (rememberMe) fireEvent.click(checkbox);
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Email' }), {
      target: { value: account.email },
    });
    fireEvent.change(within(dialog).getByLabelText('Password'), {
      target: { value: 'valid-password' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));

    await screen.findByText('Unified public site audit station.');
    const registerCall = fetchMock.mock.calls.find(([input]) => pathOf(input) === '/auth/register');
    expect(registerCall).toBeDefined();
    expect(JSON.parse(String((registerCall?.[1] as RequestInit | undefined)?.body))).toMatchObject({
      email: account.email,
      rememberMe,
    });
  });

  it('completes a password reset from the emailed deep link', async () => {
    const fetchMock = stubApi((path) => {
      if (path === '/auth/me') return failure(401, 'session required');
      if (path === '/auth/password-reset/confirm') return envelope({ status: 'reset' });
      return envelope([]);
    });
    window.history.replaceState(null, '', '/?reset_token=one-time-reset-token');
    render(<App />);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Set a new password' })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('New password'), {
      target: { value: 'new-valid-password' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update password' }));
    expect(await within(dialog).findByText('Password updated')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/auth\/password-reset\/confirm$/),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('opens the free-check CTA as a registration modal, switches to sign in, and closes without leaving home', async () => {
    await renderUnauthenticated((path) =>
      path === '/auth/me' ? failure(401, 'session required') : envelope([]),
    );

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Blog' })).toHaveAttribute('href', '/blog');
    expect(screen.getByRole('link', { name: 'Blog' })).toHaveClass('menubar__blog-link');
    openAuth();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // A new owner running a free check lands on registration, not sign in.
    expect(screen.getByText('FluxRadar — Create account')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Password')).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      'By creating an account, you agree to the terms and acknowledge the policies:',
    );

    // Existing users can still switch to sign in from the same dialog.
    fireEvent.click(within(dialog).getByRole('button', { name: 'I already have an account' }));
    expect(screen.getByText('FluxRadar — Sign in')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create an account' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Sign-in uses a necessary cookie. Learn more:');
    expect(dialog).not.toHaveTextContent('By creating an account');

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
    // The CTA opens registration; switch to sign in to exercise the login path.
    fireEvent.click(within(dialog).getByRole('button', { name: 'I already have an account' }));
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
    // The CTA already opens the registration form — fill it in directly.
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: account.email },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'valid-password' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(screen.getByText('Unified public site audit station.')).toBeInTheDocument(),
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
      expect(screen.getByText('Unified public site audit station.')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByRole('heading', { name: 'One URL. Every signal.' })).toBeInTheDocument();
  });
});

/**
 * The paths a public document asked the API for. It renders without waiting on
 * any of them; the one it may ask for is the session its header follows.
 */
function requestedPaths(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => new URL(String((call as unknown[])[0])).pathname);
}

describe('public legal pages', () => {
  it('renders the privacy policy with no request but the session read', async () => {
    const fetchMock = stubApi(() => envelope(null));
    window.history.replaceState(null, '', '/privacy');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Privacy policy' })).toBeInTheDocument();
    expect(screen.getByText('Connected Google account data')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Terms of service →' })).toHaveAttribute(
      'href',
      '/terms?lang=en',
    );
    // The second read is the site-wide support launcher asking whether to show
    // itself; like the session read, it never holds the document back.
    expect(requestedPaths(fetchMock)).toEqual(['/auth/me', '/support/status']);
  });

  it('renders the terms of service as a public page', async () => {
    // Stubbed so the header's background session read never reaches the network.
    stubApi(() => envelope(null));
    window.history.replaceState(null, '', '/terms');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Terms of service' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'One-time audits, delivery and refunds' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy policy →' })).toHaveAttribute(
      'href',
      '/privacy?lang=en',
    );
  });

  it('renders the cookie policy as a public page', async () => {
    const fetchMock = stubApi(() => envelope(null));
    window.history.replaceState(null, '', '/cookies');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Cookie policy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What is stored' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy policy →' })).toHaveAttribute(
      'href',
      '/privacy?lang=en',
    );
    // The second read is the site-wide support launcher asking whether to show
    // itself; like the session read, it never holds the document back.
    expect(requestedPaths(fetchMock)).toEqual(['/auth/me', '/support/status']);
  });
});

describe('NewScanScreen', () => {
  const profile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };

  it('closes the New scan window and returns to the desktop workspace', async () => {
    stubApi((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans/active') return envelope(null);
      return envelope(null);
    });

    render(<App />);

    // Navigate into the workspace.
    fireEvent.click(await screen.findByRole('button', { name: 'Open workspace' }));
    await screen.findByText('Unified public site audit station.');

    // Open the New scan dialog.
    fireEvent.click(screen.getByRole('button', { name: 'New scan' }));
    expect(await screen.findByText('New scan — scope and tariff')).toBeInTheDocument();

    // Close the dialog via the title-bar close button.
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }));

    // Should be back on the desktop, not on the new-scan screen.
    expect(await screen.findByText('Unified public site audit station.')).toBeInTheDocument();
    expect(screen.queryByText('New scan — scope and tariff')).not.toBeInTheDocument();
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
    // Human-readable progress copy — the UI intentionally hides raw scan state and ruleset details.
    expect(screen.getByText('Checking your site')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Audit progress' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    expect(
      screen.getByText('Checking your site — 1 of 2 audit sections done.'),
    ).toBeInTheDocument();
    // Technical internals must NOT appear anywhere on the progress screen.
    expect(screen.queryByText(/state Running/)).not.toBeInTheDocument();
    expect(screen.queryByText(/rules-v1/)).not.toBeInTheDocument();
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

    expect(await screen.findByText('Report dashboard · example.com')).toBeInTheDocument();
    // The heading names the screen. "Unified site signal" named a metric that
    // does not exist and sat above a dial the reader then tried to match it to.
    expect(screen.getByText('Site audit report')).toBeInTheDocument();
    expect(screen.queryByText('Unified site signal')).not.toBeInTheDocument();
  });

  it('shows an explicit completed state while keeping progress accessible', async () => {
    window.history.replaceState(null, '', `/scans/${scan.id}`);
    let scanRequests = 0;
    stubApi((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([]);
      if (path === `/scans/${scan.id}`) {
        scanRequests += 1;
        return envelope(scanRequests === 1 ? scan : completedScan);
      }
      return envelope(null);
    });

    render(<App />);

    expect(await screen.findByText('Scan progress · Basic')).toBeInTheDocument();
    expect(await screen.findByText('Your report is ready.')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    // A finished scan reports a measurement, not an operation in flight: the
    // bar becomes a `meter` and stops wearing the running zebra, while the
    // value it always exposed stays exposed. It used to stay a `progressbar`
    // at 100% next to "Your report is ready", which read as a scan still going.
    expect(screen.queryByRole('progressbar', { name: 'Audit progress' })).toBeNull();
    expect(screen.getByRole('meter', { name: 'Audit progress' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
  });

  it('renders an initial report with readable metadata and honest insufficient data state', async () => {
    const insufficientScan = {
      ...completedScan,
      id: 'scan-insufficient-1',
      plan: 'Free' as const,
      domain: 'https://flux-lab.dev',
      modules: [
        {
          ...completedScan.modules[0],
          status: 'Completed',
          coverage: 1,
          score: null,
          usableOutput: false,
          statusReason: 'TargetsUnreachable',
        },
      ],
    };
    const insufficientDashboard = {
      scan: insufficientScan,
      overall: {
        verdict: 'insufficient_data',
        score: null,
        weightedCoverage: 0,
        moduleWeights: [],
      },
      modules: insufficientScan.modules,
    };
    window.history.replaceState(null, '', `/scans/${insufficientScan.id}`);
    stubApi((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([]);
      if (path === `/scans/${insufficientScan.id}`) return envelope(insufficientScan);
      if (path === `/scans/${insufficientScan.id}/dashboard`)
        return envelope(insufficientDashboard);
      return envelope(null);
    });

    render(<App />);

    expect(await screen.findByText('Report dashboard · flux-lab.dev')).toBeInTheDocument();
    expect(screen.getByText('Site address')).toBeInTheDocument();
    expect(screen.getByText('flux-lab.dev')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Report')).toBeInTheDocument();
    expect(screen.getByText('Insufficient data · coverage unavailable')).toBeInTheDocument();
    expect(screen.getByText('No score')).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });

  it('opens the login modal instead of probing a deep-linked scan while signed out', async () => {
    window.history.replaceState(null, '', `/scans/${scan.id}`);
    stubApi((path) => (path === '/auth/me' ? failure(401, 'session required') : envelope(null)));

    render(<App />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('FluxRadar — Sign in')).toBeInTheDocument();
  });
});

// ─── Regression: New Scan modal — Close window button ────────────────────────
//
// Finding: the Window close button (aria-label="Close window") on the New Scan
// screen must navigate back to the workspace desktop and must NOT submit the
// form, leave a broken screen, or silently no-op.
//
// Why this can regress:
//   • The Window component exposes an optional onClose prop — accidentally
//     removing the prop at the call-site leaves a no-op button.
//   • The button uses type="button" to avoid accidental form submission; losing
//     that attribute in a refactor would bubble the click into the <form>.
//   • navigate('desktop') must be the landing target, not 'home' or 'new-scan'.
//
// Navigation flow under test:
//   home (authenticated) → [Open workspace] → desktop → [New scan] →
//   new-scan modal → [Close window] → desktop
// ─────────────────────────────────────────────────────────────────────────────
describe('new scan modal — Close window button', () => {
  const profile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };

  function stubDesktop() {
    return stubApi((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans/active') return envelope(null);
      return envelope(null);
    });
  }

  /**
   * Render the app as an authenticated user, navigate to the workspace desktop
   * and wait for the "Site Profiles" window to appear.
   *
   * Authenticated users boot into the public home screen first (screen=home).
   * They must click "Open workspace" to reach the desktop.  This helper
   * captures that real user flow so individual tests do not duplicate it.
   */
  async function renderDesktop(): Promise<void> {
    render(<App />);
    // Home screen loads (with email visible since account is returned).
    await screen.findByText(account.email);
    // Navigate to the workspace.
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    // Desktop is ready once the "Site Profiles" window title appears.
    await screen.findByText('Site Profiles');
  }

  it('returns to the workspace desktop when the Close window button is clicked', async () => {
    stubDesktop();
    await renderDesktop();

    // The new-scan window must not be visible yet.
    expect(screen.queryByText('New scan — scope and tariff')).not.toBeInTheDocument();

    // Navigate into the new-scan screen via the profile's "New scan" button.
    fireEvent.click(screen.getByRole('button', { name: 'New scan' }));

    // The new-scan window is now on screen; the desktop windows are gone.
    expect(screen.getByText('New scan — scope and tariff')).toBeInTheDocument();
    expect(screen.queryByText('Site Profiles')).not.toBeInTheDocument();

    // Click the window's Close button (the ✕ in the titlebar).
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }));

    // The desktop must be restored; the new-scan window must be gone.
    expect(screen.getByText('Site Profiles')).toBeInTheDocument();
    expect(screen.queryByText('New scan — scope and tariff')).not.toBeInTheDocument();

    // The URL must name the screen we landed on (no stale /scans/… fragment),
    // so a reload from here comes back to the workspace rather than to home.
    expect(window.location.pathname).toBe('/profiles');
  });

  it('does not submit the scan form when Close window is clicked mid-form', async () => {
    const fetchMock = stubDesktop();
    await renderDesktop();

    fireEvent.click(screen.getByRole('button', { name: 'New scan' }));
    expect(screen.getByText('New scan — scope and tariff')).toBeInTheDocument();

    // Record API calls up to this point (auth + profiles + active scan).
    const callCountBefore = fetchMock.mock.calls.length;

    // Clicking Close must NOT POST /billing/dev-checkout or /profiles/*/free-check.
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }));

    // Desktop is restored. Landing on it is no longer call-free — the site
    // status panel reads this account's last check when it mounts — so what is
    // asserted is the thing the test is named for: nothing that leaves the form
    // writes. Every request made by going back is a plain read.
    expect(screen.getByText('Site Profiles')).toBeInTheDocument();
    const afterClose = fetchMock.mock.calls.slice(callCountBefore);
    expect(
      afterClose.map(([input, init]) => [
        pathOf(input),
        (init as RequestInit | undefined)?.method ?? 'GET',
      ]),
    ).toEqual([['/scans', 'GET']]);
  });

  it('stays on the new-scan screen when Escape is pressed (non-modal window)', async () => {
    // The new-scan window is not a focus-trapped modal (unlike the auth
    // dialog), so Escape must not crash or navigate to an unexpected screen.
    // This test documents the current behaviour so a future addition of Escape
    // support can be introduced deliberately without a silent regression.
    stubDesktop();
    await renderDesktop();

    fireEvent.click(screen.getByRole('button', { name: 'New scan' }));
    expect(screen.getByText('New scan — scope and tariff')).toBeInTheDocument();

    // Escape currently does nothing for this non-modal window.
    // The screen stays on new-scan without errors.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('New scan — scope and tariff')).toBeInTheDocument();
  });
});

// ─── Public /checks — audit coverage page ────────────────────────────────────
//
// The /checks page is a public SPA route: no login, and it renders without
// waiting on the API — the only request is the session read its header follows.
// It must render all six audit-module sections, evidence, limitations, a
// back-to-home link, and be discoverable from the homepage footer and the
// homepage coverage-entry section.
// ─────────────────────────────────────────────────────────────────────────────
describe('public /checks — audit coverage page', () => {
  it('renders the audit coverage page with no request but the session read', async () => {
    const fetchMock = stubApi(() => envelope(null));
    window.history.replaceState(null, '', '/checks');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Audit coverage' })).toBeInTheDocument();
    // The second read is the site-wide support launcher asking whether to show
    // itself; like the session read, it never holds the document back.
    expect(requestedPaths(fetchMock)).toEqual(['/auth/me', '/support/status']);
  });

  it('shows all six audit module section headings', async () => {
    window.history.replaceState(null, '', '/checks');
    stubApi(() => envelope(null));
    render(<App />);
    await screen.findByRole('heading', { name: 'Audit coverage' });
    expect(
      screen.getByRole('heading', { name: /SEO — what FluxRadar checks/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /AI SEO \/ Generative Engine Optimisation/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Security — OWASP ASVS public profile/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Accessibility — WCAG 2\.2 AA/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Reliability and performance/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Privacy and consent signals/i }),
    ).toBeInTheDocument();
  });

  it('shows the evidence and limitations sections', async () => {
    window.history.replaceState(null, '', '/checks');
    stubApi(() => envelope(null));
    render(<App />);
    await screen.findByRole('heading', { name: 'Audit coverage' });
    expect(
      screen.getByRole('heading', { name: /How findings are evidenced/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /What FluxRadar cannot certify/i }),
    ).toBeInTheDocument();
  });

  it('renders a back-to-home link pointing to /', async () => {
    window.history.replaceState(null, '', '/checks');
    stubApi(() => envelope(null));
    render(<App />);
    await screen.findByRole('heading', { name: 'Audit coverage' });
    expect(screen.getByRole('link', { name: '← Back to home' })).toHaveAttribute('href', '/');
  });

  it('shows the audit coverage link in the homepage footer', async () => {
    window.history.replaceState(null, '', '/');
    stubApi((path) => (path === '/auth/me' ? failure(401, 'session required') : envelope(null)));
    render(<App />);
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });
    expect(screen.getByRole('link', { name: 'Audit coverage' })).toHaveAttribute('href', '/checks');
  });

  it('shows the coverage entry section and link on the homepage', async () => {
    window.history.replaceState(null, '', '/');
    stubApi((path) => (path === '/auth/me' ? failure(401, 'session required') : envelope(null)));
    render(<App />);
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });
    expect(
      screen.getByRole('heading', { name: 'Every check. Every standard. No surprises.' }),
    ).toBeInTheDocument();
    const coverage = screen.getByRole('region', {
      name: 'Every check. Every standard. No surprises.',
    });
    expect(
      within(coverage).getByRole('link', { name: /Read the full audit coverage/i }),
    ).toHaveAttribute('href', '/checks');
  });
});

// ─── Regression: /blog routing — SPA must not intercept static pages ──────────
//
// Finding: navigating to /blog must render the standalone blog HTML page, NOT
// the React SPA home screen.  The fix lives in two places:
//   1. Vite dev/preview: the blogIndexRewritePlugin in vite.config.ts rewrites
//      /blog → /blog/index.html and /blog/<slug> → /blog/<slug>/index.html
//      so Vite's static file middleware serves the correct HTML before the SPA
//      HTML fallback is reached.
//   2. Production nginx: try_files $uri $uri/index.html /index.html tests the
//      physical file directly, avoiding the 301→$uri/ double-slash collapse.
//
// What we can test at the SPA unit level:
//   • readInitialRoute() must NOT classify /blog (or article paths) as a known
//     SPA screen — these paths should fall through to 'home' so the SPA never
//     claims ownership of URLs that belong to the static blog.
//   • The SPA must not call window.location.assign or replace for /blog, which
//     would create a redirect loop when the server is correctly configured.
//
// The full end-to-end guarantee (server actually serves the right file) is
// enforced by the nginx config and Vite plugin; see those files for the
// authoritative routing logic.
// ─────────────────────────────────────────────────────────────────────────────
// ─── Regression: Issue Center — inline detail row ────────────────────────────
//
// Finding: clicking "Details" for a finding must reveal its detail content
// inline directly below that row (not in a detached block below the table).
//
// Expectations:
//   • Details are hidden by default.
//   • Clicking "Details" expands the row inline (same tbody); detail content
//     appears; button label changes to "Hide details".
//   • Clicking "Hide details" (or "Close details") collapses the row.
//   • Clicking "Details" on a second row collapses the first and expands the
//     second — only one detail row is visible at a time.
//   • The trigger button carries aria-expanded=true/false.
// ─────────────────────────────────────────────────────────────────────────────
describe('Issue Center — inline detail row', () => {
  const profile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };

  const issue1 = {
    id: 'issue-1',
    scanId: completedScan.id,
    ruleId: 'seo.title-missing',
    module: 'SEO',
    severity: 'High',
    status: 'New',
    targetUrl: 'https://example.com/',
    evidenceExcerpt: 'No <title> element found',
    recommendation: 'Add a descriptive title tag.',
    affectedTargets: 1,
    applicableTargets: 1,
    scoreDelta: -5,
    confidence: 0.95,
    fingerprint: 'fp-1',
  };

  const issue2 = {
    id: 'issue-2',
    scanId: completedScan.id,
    ruleId: 'security.csp-missing',
    module: 'Security',
    severity: 'Critical',
    status: 'New',
    targetUrl: 'https://example.com/about',
    evidenceExcerpt: 'Content-Security-Policy header absent',
    recommendation: 'Deploy a Content-Security-Policy header.',
    affectedTargets: 1,
    applicableTargets: 1,
    scoreDelta: -10,
    confidence: 1,
    fingerprint: 'fp-2',
  };

  function stubIssues(): ReturnType<typeof vi.fn> {
    return stubApi((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([profile]);
      if (path === `/scans/${completedScan.id}`) return envelope(completedScan);
      if (path === `/scans/${completedScan.id}/dashboard`) return envelope(dashboard);
      if (path === `/scans/${completedScan.id}/issues`) return envelope([issue1, issue2]);
      return envelope(null);
    });
  }

  async function renderIssues(): Promise<void> {
    window.history.replaceState(null, '', `/scans/${completedScan.id}`);
    render(<App />);
    // Lands on results screen after boot.
    await screen.findByText('Report dashboard · example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Open Issue Center' }));
    // Wait for issues to load.
    await screen.findByText('seo.title-missing');
  }

  it('hides all details by default', async () => {
    stubIssues();
    await renderIssues();

    expect(screen.queryByText('No <title> element found')).not.toBeInTheDocument();
    expect(screen.queryByText('Content-Security-Policy header absent')).not.toBeInTheDocument();
  });

  it('shows inline detail below the row when Details is clicked', async () => {
    stubIssues();
    await renderIssues();

    const detailsButtons = screen.getAllByRole('button', { name: 'Details' });
    fireEvent.click(detailsButtons[0] as HTMLElement);

    // Detail content for issue1 must be visible.
    expect(await screen.findByText('No <title> element found')).toBeInTheDocument();
    expect(screen.getByText('Add a descriptive title tag.')).toBeInTheDocument();

    // issue2 detail must not be visible.
    expect(screen.queryByText('Content-Security-Policy header absent')).not.toBeInTheDocument();
  });

  it('changes button label to "Hide details" when expanded', async () => {
    stubIssues();
    await renderIssues();

    const firstDetails = screen.getAllByRole('button', { name: 'Details' })[0]!;
    fireEvent.click(firstDetails);

    expect(await screen.findByRole('button', { name: 'Hide details' })).toBeInTheDocument();
  });

  it('sets aria-expanded=true on the trigger button when expanded', async () => {
    stubIssues();
    await renderIssues();

    const firstDetails = screen.getAllByRole('button', { name: 'Details' })[0] as HTMLElement;
    expect(firstDetails).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(firstDetails);

    const hideBtn = await screen.findByRole('button', { name: 'Hide details' });
    expect(hideBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses the detail row when Hide details is clicked', async () => {
    stubIssues();
    await renderIssues();

    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0] as HTMLElement);
    await screen.findByText('No <title> element found');

    fireEvent.click(screen.getByRole('button', { name: 'Hide details' }));

    await waitFor(() =>
      expect(screen.queryByText('No <title> element found')).not.toBeInTheDocument(),
    );
    // Button label reverts.
    expect(screen.getAllByRole('button', { name: 'Details' })).toHaveLength(2);
  });

  it('collapses the detail row when Close details is clicked', async () => {
    stubIssues();
    await renderIssues();

    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0] as HTMLElement);
    await screen.findByText('No <title> element found');

    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));

    await waitFor(() =>
      expect(screen.queryByText('No <title> element found')).not.toBeInTheDocument(),
    );
  });

  it('collapses the first row and expands the second when a different row is clicked', async () => {
    stubIssues();
    await renderIssues();

    const allDetails = screen.getAllByRole('button', { name: 'Details' });
    const firstDetailsBtn = allDetails[0] as HTMLElement;
    const secondDetailsBtn = allDetails[1] as HTMLElement;

    fireEvent.click(firstDetailsBtn);
    await screen.findByText('No <title> element found');

    // Click Details on the second row.
    fireEvent.click(secondDetailsBtn);

    // First issue detail must disappear.
    await waitFor(() =>
      expect(screen.queryByText('No <title> element found')).not.toBeInTheDocument(),
    );
    // Second issue detail must appear.
    expect(await screen.findByText('Content-Security-Policy header absent')).toBeInTheDocument();
  });

  it('explains findings and severity in plain language without exposing internal jargon', async () => {
    stubIssues();
    await renderIssues();

    // A non-technical owner is told what a finding is and how to act on it.
    expect(
      screen.getByText(/Findings are grouped by the problem behind them, most urgent first/i),
    ).toBeInTheDocument();
    // Severity is explained rather than left as bare Critical/High/Medium/Low chips.
    expect(
      screen.getByText(/Critical and High need attention first, then Medium, then Low/i),
    ).toBeInTheDocument();
    // The implementation-only word "fingerprint" must not leak to the owner.
    expect(screen.queryByText(/fingerprint/i)).not.toBeInTheDocument();
  });
});

describe('/blog routing — SPA does not intercept static pages', () => {
  it('does not crash or claim /blog as a known SPA route (falls back to home)', async () => {
    // If the SPA ever loads for /blog (because the server is misconfigured), it
    // must show the public home gracefully — not a blank screen or error.
    window.history.replaceState(null, '', '/blog');
    stubApi((path) => (path === '/auth/me' ? failure(401, 'unauthenticated') : envelope(null)));

    render(<App />);

    // The SPA shows the public home page (the blog index is served by the
    // static layer before React ever loads in a correctly-configured server).
    expect(
      await screen.findByRole('heading', { name: 'One URL. Every signal.' }),
    ).toBeInTheDocument();

    // The URL is preserved as /blog — the SPA must not rewrite it.
    expect(window.location.pathname).toBe('/blog');
  });

  it('does not crash or claim article sub-paths as known SPA routes', async () => {
    window.history.replaceState(null, '', '/blog/ai-crawler-readiness');
    stubApi((path) => (path === '/auth/me' ? failure(401, 'unauthenticated') : envelope(null)));

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'One URL. Every signal.' }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/blog/ai-crawler-readiness');
  });
});

describe('home pricing and workspace onboarding', () => {
  const pendingAccount = { ...account, onboarding: { status: 'pending' as const } };
  const profile = { id: 'profile-1', name: 'My website', domain: 'https://mysite.com' };

  function renderHome() {
    stubApi((path) => (path === '/auth/me' ? failure(401, 'unauthenticated') : envelope(null)));
    render(<App />);
  }

  it('describes both one-time products on the home page with their prices', async () => {
    renderHome();
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });

    const pricing = screen.getByRole('region', { name: 'Two one-time reports. No subscription.' });
    const basic = within(pricing).getByRole('heading', { name: 'Basic' }).closest('article');
    const complete = within(pricing).getByRole('heading', { name: 'Complete' }).closest('article');
    if (basic === null || complete === null) throw new Error('expected both product cards');

    // The currency is stated, not implied: the checkout localises, so a bare "$"
    // is a figure the buyer may not see again.
    expect(within(basic).getByText('$55 USD')).toBeInTheDocument();
    expect(within(complete).getByText('$120 USD')).toBeInTheDocument();

    // Each card says what it does, who it is for and where it stops.
    expect(within(basic).getByText('What you get')).toBeInTheDocument();
    expect(within(basic).getByText('Best for')).toBeInTheDocument();
    expect(within(basic).getByText('Not covered')).toBeInTheDocument();
    expect(within(basic).getByText(/up to 5,000 crawled pages/i)).toBeInTheDocument();
    expect(within(complete).getByText(/up to 50,000 crawled pages/i)).toBeInTheDocument();
  });

  it('presents Complete as one price with every module and no add-on', async () => {
    renderHome();
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });

    const complete = screen
      .getByRole('heading', { name: 'Complete' })
      .closest('article') as HTMLElement;
    // No "not covered" row: the point of Complete is that nothing is held back.
    expect(within(complete).queryByText('Not covered')).not.toBeInTheDocument();
    expect(
      within(complete).getByText(/Every module FluxRadar runs is already in this price/i),
    ).toBeInTheDocument();
    expect(within(complete).getByText(/nothing extra to add at checkout/i)).toBeInTheDocument();
    // The old "unified audit" line item must not read as a separate purchase.
    expect(screen.queryByText(/unified audit/i)).not.toBeInTheDocument();
  });

  it('explains in plain language which product to choose and what stays free', async () => {
    renderHome();
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });

    expect(
      screen.getByRole('heading', { name: 'Which one is right for you?' }),
    ).toBeInTheDocument();
    // The choice is a comparison, and it is laid out as one — the structure of
    // the table is pinned in pricing-comparison.test.tsx.
    const comparison = screen.getByRole('table', { name: /Basic and Complete side by side/ });
    expect(
      within(comparison).getByRole('rowheader', { name: 'The question it answers' }),
    ).toBeInTheDocument();
    expect(
      within(comparison).getByText('Why is my site not being found — in search, or in AI answers?'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/It is a first look at the report format, not a third product/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/the scan starts once the payment provider confirms/i),
    ).toBeInTheDocument();
  });

  it('describes both products in Ukrainian after switching language', async () => {
    renderHome();
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });

    switchLanguageToUkrainian();

    expect(
      screen.getByRole('heading', { name: 'Два разові звіти. Без підписки.' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Що ви отримуєте')).toHaveLength(2);
    expect(screen.getByText(/до 5 000 сторінок обходу/)).toBeInTheDocument();
    expect(screen.getByText(/до 50 000 сторінок обходу/)).toBeInTheDocument();
    expect(
      screen.getByText(/Усі модулі, які запускає FluxRadar, уже входять у цю ціну/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Єдиний аудит/i)).not.toBeInTheDocument();
  });

  it('sends an old /plans link to the home pricing section and cleans the URL', async () => {
    window.history.replaceState(null, '', '/plans');
    renderHome();

    await screen.findByRole('heading', { name: 'One URL. Every signal.' });
    expect(
      screen.getByRole('region', { name: 'Two one-time reports. No subscription.' }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    // The standalone plans screen is gone for good.
    expect(
      screen.queryByRole('heading', { name: 'Plans for every public audit.' }),
    ).not.toBeInTheDocument();
  });

  it('opens registration from a product CTA for a signed-out visitor', async () => {
    renderHome();
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });

    fireEvent.click(screen.getByRole('button', { name: 'Start with Complete' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });

  it('switches the shell to Ukrainian and persists the language after remount', async () => {
    saveCookieConsent({ preferences: true, analytics: false });
    stubApi((path) => (path === '/auth/me' ? failure(401, 'unauthenticated') : envelope(null)));
    render(<App />);
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });

    switchLanguageToUkrainian();
    expect(screen.getByRole('button', { name: 'Увійти' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Запустити безкоштовну перевірку' }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem('fluxradar.language')).toBe('uk');

    cleanup();
    stubApi((path) => (path === '/auth/me' ? failure(401, 'unauthenticated') : envelope(null)));
    render(<App />);
    await screen.findByRole('heading', { name: 'Одна адреса. Усі сигнали.' });
    expect(screen.getByRole('combobox', { name: 'Мова' })).toHaveTextContent('Українська');
    expect(screen.getByRole('button', { name: 'Увійти' })).toBeInTheDocument();
  });

  it('keeps the language listbox outside the scrollable menubar strip', async () => {
    stubApi((path) => (path === '/auth/me' ? failure(401, 'unauthenticated') : envelope(null)));
    render(<App />);
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });

    fireEvent.click(screen.getByRole('combobox', { name: 'Language' }));

    const scrollStrip = document.querySelector('.menubar__nav');
    expect(scrollStrip).not.toBeNull();
    const listbox = screen.getByRole('listbox', { name: 'Language' });
    expect(scrollStrip).not.toContainElement(listbox);
  });

  it('closes the language listbox when clicking outside it inside the mobile burger menu', async () => {
    stubApi((path) => (path === '/auth/me' ? failure(401, 'unauthenticated') : envelope(null)));
    render(<App />);
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });

    fireEvent.click(screen.getByRole('combobox', { name: 'Language' }));
    expect(screen.getByRole('listbox', { name: 'Language' })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByText('System'));

    expect(screen.queryByRole('listbox', { name: 'Language' })).not.toBeInTheDocument();
  });

  it('renders the full homepage in Ukrainian, not just the header, after switching language', async () => {
    stubApi((path) => (path === '/auth/me' ? failure(401, 'unauthenticated') : envelope(null)));
    render(<App />);
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });

    switchLanguageToUkrainian();

    expect(
      await screen.findByRole('heading', { name: 'Одна адреса. Усі сигнали.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Сайт — це більше, ніж позиція в рейтингу.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Кожна перевірка. Кожен стандарт. Без сюрпризів.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Від публічної адреси до пріоритезованих завдань.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Почніть із сайту/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Запустити безкоштовну перевірку' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Запустити перевірку/ })).toBeInTheDocument();
    expect(screen.getByText('FLUXRADAR / ВІД FLUXLAB')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Політика приватності' })).toBeInTheDocument();
    expect(screen.queryByText('A website is more than a ranking.')).not.toBeInTheDocument();
  });

  it('routes a newly registered owner into workspace tour without creating a profile or scan', async () => {
    const fetchMock = await renderUnauthenticated((path) => {
      if (path === '/auth/me') return failure(401, 'session required');
      if (path === '/auth/register') return envelope(pendingAccount, 201);
      if (path === '/profiles') return envelope([]);
      if (path === '/scans/active') return envelope(null);
      return envelope(null);
    });

    openAuth();
    const dialog = screen.getByRole('dialog');
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: account.email },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'valid-password' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Unified public site audit station.')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Your workspace tabs' })).toBeInTheDocument();
    expect(calledMethod(fetchMock, '/profiles', 'POST')).toBe(false);
    expect(calledMethod(fetchMock, '/account/onboarding', 'PATCH')).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => pathOf(input).includes('/free-check'))).toBe(
      false,
    );
    expect(calledMethod(fetchMock, '/billing/dev-checkout', 'POST')).toBe(false);
  });

  it('exposes the tour as an accessible dialog and moves between steps via its controls', async () => {
    const fetchMock = stubApi((path, init) => {
      if (path === '/auth/me') return envelope(pendingAccount);
      if (path === '/profiles') return envelope([]);
      if (path === '/scans/active') return envelope(null);
      if (path === '/account/onboarding' && init?.method === 'PATCH') {
        return envelope({ ...account, onboarding: { status: 'skipped' as const } });
      }
      return envelope(null);
    });

    render(<App />);

    // The step title names the dialog and the body describes it, so assistive
    // technology announces the current step, not just an unlabelled modal.
    const tour = await screen.findByRole('dialog', { name: 'Your workspace tabs' });
    expect(tour).toHaveAttribute('aria-modal', 'true');
    expect(tour).toHaveAccessibleDescription(/The bar at the top is the whole workspace/);

    // One minimal visual-presence check: the spotlight is decorative only and
    // must stay hidden from assistive technology.
    const spotlight = document.querySelector('.tour-overlay__spotlight');
    expect(spotlight).toBeInTheDocument();
    expect(spotlight).toHaveAttribute('aria-hidden', 'true');

    // The spotlight anchors to a stable data-tour-target that contains the
    // whole tab strip, so highlighting the header cannot miss the tabs.
    const highlighted = resolvedTourTarget();
    expect(highlighted).toContainElement(screen.getByRole('button', { name: 'Profiles' }));
    expect(highlighted).toContainElement(screen.getByRole('button', { name: 'Scan' }));
    expect(highlighted).toContainElement(screen.getByRole('button', { name: 'Reports' }));

    // Keyboard focus stays trapped within the dialog controls.
    const controls = within(tour).getAllByRole('button');
    const firstControl = controls[0];
    const lastControl = controls[controls.length - 1];
    if (!firstControl || !lastControl) throw new Error('expected tour controls to render');
    lastControl.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(firstControl).toHaveFocus();
    firstControl.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(lastControl).toHaveFocus();

    // Next and Back change the visible step, announced through the dialog name.
    fireEvent.click(within(tour).getByRole('button', { name: 'Next' }));
    expect(
      await screen.findByRole('dialog', { name: 'Add your first profile' }),
    ).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('dialog', { name: 'Your workspace tabs' })).toBeInTheDocument();

    // Escape performs the same safe skip as the Skip button.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calledMethod(fetchMock, '/account/onboarding', 'PATCH')).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => pathOf(input).includes('/free-check'))).toBe(
      false,
    );
  });

  it('does not auto-open the tour for an account that already skipped it', async () => {
    stubApi((path) => {
      if (path === '/auth/me') {
        return envelope({ ...account, onboarding: { status: 'skipped' as const } });
      }
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans/active') return envelope(null);
      return envelope(null);
    });

    render(<App />);

    // A returning skipped user lands on the signed-in home, never the tour.
    expect(await screen.findByRole('button', { name: 'Open workspace' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your workspace tabs' })).not.toBeInTheDocument();

    // Entering the workspace does not resurrect the skipped tour either.
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(await screen.findByText('Site Profiles')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('finishes the tour through the onboarding status endpoint only', async () => {
    const fetchMock = stubApi((path, init) => {
      if (path === '/auth/me') return envelope(pendingAccount);
      if (path === '/profiles') return envelope([]);
      if (path === '/scans/active') return envelope(null);
      if (path === '/account/onboarding' && init?.method === 'PATCH') {
        return envelope({ ...account, onboarding: { status: 'completed' as const } });
      }
      return envelope(null);
    });

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Your workspace tabs' })).toBeInTheDocument();
    for (let step = 0; step < tourSteps.length - 1; step += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Your workspace tabs' }),
      ).not.toBeInTheDocument(),
    );
    expect(calledMethod(fetchMock, '/account/onboarding', 'PATCH')).toBe(true);
    expect(calledMethod(fetchMock, '/profiles', 'POST')).toBe(false);
  });

  it('reopens the same tour from the workspace and allows skipping', async () => {
    const fetchMock = stubApi((path, init) => {
      if (path === '/auth/me')
        return envelope({ ...account, onboarding: { status: 'completed' as const } });
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans/active') return envelope(null);
      if (path === '/account/onboarding' && init?.method === 'PATCH') {
        return envelope({ ...account, onboarding: { status: 'skipped' as const } });
      }
      return envelope(null);
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open workspace' }));
    await screen.findByText('Site Profiles');
    fireEvent.click(screen.getByRole('button', { name: 'Open setup guide' }));
    expect(await screen.findByRole('heading', { name: 'Your workspace tabs' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Your workspace tabs' }),
      ).not.toBeInTheDocument(),
    );
    expect(calledMethod(fetchMock, '/account/onboarding', 'PATCH')).toBe(true);
  });

  // The tour is an explanation, not a wizard: a first-time owner has to be able
  // to dismiss it on step one and be left in an empty, unbilled workspace.
  it('lets a brand-new owner skip the tour on the first step without running a scan', async () => {
    const fetchMock = stubApi((path, init) => {
      if (path === '/auth/me') return envelope(pendingAccount);
      if (path === '/profiles') return envelope([]);
      if (path === '/scans/active') return envelope(null);
      if (path === '/account/onboarding' && init?.method === 'PATCH') {
        return envelope({ ...account, onboarding: { status: 'skipped' as const } });
      }
      return envelope(null);
    });

    render(<App />);
    await screen.findByRole('dialog', { name: 'Your workspace tabs' });

    // The opening step frames the header, so the spotlight covers the whole tab
    // strip rather than a single control inside it. Which of the two header
    // targets carries it depends on the viewport; `tour-targets.test.ts` pins
    // that choice, and what matters here is that the tabs are inside it.
    const highlighted = resolvedTourTarget();
    expect(['workspace-header', 'workspace-tabs']).toContain(highlighted.dataset.tourTarget);
    for (const tab of ['Profiles', 'Scan', 'Reports']) {
      expect(highlighted).toContainElement(screen.getByRole('button', { name: tab }));
    }

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(screen.getByText('Unified public site audit station.')).toBeInTheDocument();
    expect(calledMethod(fetchMock, '/scans', 'POST')).toBe(false);
    expect(calledMethod(fetchMock, '/profiles', 'POST')).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => pathOf(input).includes('/free-check'))).toBe(
      false,
    );
  });
});

// ─── Self-explanatory workflow — nav descriptions and plain help ─────────────
//
// A non-technical site owner must be able to understand the workflow without
// already knowing what Profiles/Scan/Reports/Integrations/FAQ mean. The tab
// tooltips and the tour carry that explanation; the old "What each area does"
// panel is gone and must not come back in either locale.
// ─────────────────────────────────────────────────────────────────────────────
describe('self-explanatory workflow copy', () => {
  const emptyWorkspace = (path: string): Response => {
    if (path === '/auth/me') return envelope(account);
    if (path === '/profiles') return envelope([]);
    if (path === '/scans/active') return envelope(null);
    return envelope(null);
  };

  it('describes each main navigation tab in plain language (English)', async () => {
    await renderUnauthenticated((path) =>
      path === '/auth/me' ? failure(401, 'session required') : envelope([]),
    );

    expect(screen.getByRole('button', { name: 'Profiles' })).toHaveAttribute(
      'title',
      'Your saved profiles and their audit history.',
    );
    expect(screen.getByRole('button', { name: 'Profiles' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Scan' })).toHaveAttribute(
      'title',
      'Set up and start a new audit.',
    );
    expect(screen.getByRole('button', { name: 'Reports' })).toHaveAttribute(
      'title',
      'Completed and in-progress audit results.',
    );
    expect(screen.getByRole('button', { name: 'Integrations' })).toHaveAttribute(
      'title',
      'Optional data connections. The public-site scan works without them.',
    );
    // The header link carries the tooltip; the footer link is a plain shortcut.
    expect(screen.getAllByRole('link', { name: 'FAQ' })[0]).toHaveAttribute(
      'title',
      'Plain answers about every check and the limits of a report.',
    );
  });

  it('never calls the saved-websites tab "Files" in either locale', async () => {
    await renderUnauthenticated((path) =>
      path === '/auth/me' ? failure(401, 'session required') : envelope([]),
    );

    expect(screen.queryByRole('button', { name: 'Files' })).not.toBeInTheDocument();
    expect(JSON.stringify(copy)).not.toContain('Files');

    switchLanguageToUkrainian();
    expect(screen.getByRole('button', { name: 'Профілі' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сайти' })).not.toBeInTheDocument();
  });

  it('keeps a separate Plans page out of the navigation in both locales', async () => {
    await renderUnauthenticated((path) =>
      path === '/auth/me' ? failure(401, 'session required') : envelope([]),
    );

    expect(screen.queryByRole('button', { name: 'Plans' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Plans' })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/plans"]')).toBeNull();

    switchLanguageToUkrainian();
    expect(screen.queryByRole('button', { name: 'Тарифи' })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/plans"]')).toBeNull();
  });

  it('offers the FAQ from the navigation and the footer in both locales', async () => {
    await renderUnauthenticated((path) =>
      path === '/auth/me' ? failure(401, 'session required') : envelope([]),
    );

    // One link in the header/mobile sheet (the same markup serves both) and one
    // in the page footer, so the FAQ is reachable from either end of the page.
    const links = screen.getAllByRole('link', { name: 'FAQ' });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/faq');

    switchLanguageToUkrainian();
    expect(screen.getAllByRole('link', { name: 'FAQ' })[0]).toHaveAttribute('href', '/faq');
  });

  it('describes the navigation tabs in Ukrainian after switching language', async () => {
    await renderUnauthenticated((path) =>
      path === '/auth/me' ? failure(401, 'session required') : envelope([]),
    );

    switchLanguageToUkrainian();

    expect(screen.getByRole('button', { name: 'Профілі' })).toHaveAttribute(
      'title',
      'Ваші збережені профілі та історія їхніх перевірок.',
    );
    expect(screen.getByRole('button', { name: 'Перевірка' })).toHaveAttribute(
      'title',
      'Налаштуйте та запустіть нову перевірку.',
    );
    expect(screen.getByRole('button', { name: 'Інтеграції' })).toHaveAttribute(
      'title',
      'Необовʼязкові підключення даних. Публічна перевірка працює без них.',
    );
  });

  it('no longer renders the removed "What each area does" workspace map', async () => {
    stubApi(emptyWorkspace);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open workspace' }));
    await screen.findByText('Site Profiles');

    expect(screen.queryByRole('region', { name: /what each area does/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/what each area does/i)).not.toBeInTheDocument();
    // The per-tab explanation of the workflow stays available on the tabs.
    expect(screen.getByRole('button', { name: 'Profiles' })).toHaveAttribute(
      'title',
      'Your saved profiles and their audit history.',
    );
  });

  it('no longer renders the removed workspace map in Ukrainian', async () => {
    stubApi(emptyWorkspace);
    render(<App />);

    await screen.findByRole('button', { name: 'Open workspace' });
    switchLanguageToUkrainian();
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити робочий простір' }));
    await screen.findByText('Профілі сайтів');

    expect(
      screen.queryByRole('region', { name: /Що робить кожен розділ/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Що робить кожен розділ/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Профілі' })).toHaveAttribute(
      'title',
      'Ваші збережені профілі та історія їхніх перевірок.',
    );
  });

  it('keeps the removed heading out of every localized string', () => {
    const strings = JSON.stringify(copy);

    expect(strings.toLowerCase()).not.toContain('what each area does');
    expect(strings).not.toContain('Що робить кожен розділ');
  });

  it('tells a first-time owner what to enter and that saving does not start a scan', async () => {
    stubApi(emptyWorkspace);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open workspace' }));
    await screen.findByText('Site Profiles');

    // Empty state names the first action and the input in plain language.
    expect(screen.getByText(/Add your first profile to begin/i)).toBeInTheDocument();
    // The add-site form reassures that saving is not a scan and not a charge.
    expect(screen.getByText(/saving does not start a scan or charge you/i)).toBeInTheDocument();
  });

  it('explains score, coverage and findings on the report dashboard', async () => {
    window.history.replaceState(null, '', `/scans/${completedScan.id}`);
    stubApi((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([]);
      if (path === `/scans/${completedScan.id}`) return envelope(completedScan);
      if (path === `/scans/${completedScan.id}/dashboard`) return envelope(dashboard);
      return envelope(null);
    });

    render(<App />);

    const help = await screen.findByRole('region', { name: 'How to read this report' });
    expect(within(help).getByText('Score')).toBeInTheDocument();
    expect(within(help).getByText(/0–100 rating/)).toBeInTheDocument();
    expect(within(help).getByText('Coverage')).toBeInTheDocument();
    expect(
      within(help).getByText(/How much of your site FluxRadar was able to check/i),
    ).toBeInTheDocument();
    expect(within(help).getByText('Findings')).toBeInTheDocument();
  });
});

// ─── MenuBar navigation must not silently no-op ──────────────────────────────
//
// Every screen renders its own MenuBar. A nav button whose screen is not
// handled in that screen's onNavigate callback would silently do nothing, so
// the signed-in home screen is checked for the tabs it has to route.
// ─────────────────────────────────────────────────────────────────────────────
describe('MenuBar navigation (signed in)', () => {
  function stubSignedIn() {
    return stubApi((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([]);
      if (path === '/scans/active') return envelope(null);
      if (path === '/integrations') return envelope([]);
      return envelope(null);
    });
  }

  it('navigates from home to the workspace when the Profiles tab is clicked', async () => {
    stubSignedIn();
    render(<App />);

    await screen.findByRole('heading', { name: 'One URL. Every signal.' });
    expect(screen.getByRole('button', { name: 'Profiles' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Profiles' }));

    await screen.findByText('Unified public site audit station.');
  });

  it('navigates from home to integrations when the Integrations tab is clicked', async () => {
    stubSignedIn();
    render(<App />);

    await screen.findByRole('heading', { name: 'One URL. Every signal.' });
    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }));

    await screen.findByText('Connected data sources');
  });

  it('shows only customer-connectable integrations', async () => {
    window.history.replaceState(null, '', '/#integrations');
    stubApi((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([]);
      if (path === '/integrations') {
        return envelope([
          {
            provider: 'google',
            label: 'Google data',
            kind: 'user',
            status: 'available',
            services: ['Google Search Console', 'Google Analytics 4'],
            canConnect: true,
            lastCheckedAt: null,
            lastError: null,
          },
          {
            provider: 'bing',
            label: 'Bing Webmaster Tools',
            kind: 'user',
            status: 'available',
            services: ['Bing Webmaster Tools'],
            canConnect: true,
            lastCheckedAt: null,
            lastError: null,
          },
        ]);
      }
      return envelope(null);
    });
    render(<App />);

    await screen.findByText('Google data');
    expect(screen.getAllByText('Bing Webmaster Tools')).toHaveLength(2);
    expect(screen.queryByText('Chrome UX Report')).not.toBeInTheDocument();
    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument();
    expect(screen.queryByText('Hetzner Object Storage')).not.toBeInTheDocument();
    expect(screen.queryByText('ROADMAP / LATER')).not.toBeInTheDocument();
  });
});

// ─── Tour — explains the tabs, never runs a scan ─────────────────────────────
//
// The tour must teach the workspace: what the header tabs are for and how a
// scan is started. It must describe what is actually rendered (saved site
// profiles, not "files" or "audit artifacts") and must never push the user
// into running a check as part of onboarding.
// ─────────────────────────────────────────────────────────────────────────────
describe('workspace tour copy', () => {
  const pendingWorkspace = (path: string): Response => {
    if (path === '/auth/me') return envelope({ ...account, onboarding: { status: 'pending' } });
    if (path === '/profiles') return envelope([]);
    if (path === '/scans/active') return envelope(null);
    return envelope(null);
  };

  it('explains the tabs without claiming the tab holds files or audit artifacts', async () => {
    stubApi(pendingWorkspace);
    render(<App />);

    const tour = await screen.findByRole('dialog', { name: 'Your workspace tabs' });

    expect(within(tour).queryByText(/saved files/i)).not.toBeInTheDocument();
    expect(within(tour).queryByText(/audit artifacts/i)).not.toBeInTheDocument();
    expect(
      within(tour).getByText(/Profiles holds the public sites you saved as profiles/i),
    ).toBeInTheDocument();
    expect(within(tour).getByText(/Scan starts an audit/i)).toBeInTheDocument();
    expect(within(tour).getByText(/Reports keeps the finished results/i)).toBeInTheDocument();
  });

  it('closes by explaining how to start a scan, and starts none itself', async () => {
    const fetchMock = stubApi(pendingWorkspace);
    render(<App />);

    await screen.findByRole('dialog', { name: 'Your workspace tabs' });
    for (let step = 0; step < tourSteps.length - 1; step += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    }

    const last = await screen.findByRole('dialog', { name: 'Start a scan when you are ready' });
    expect(within(last).getByText(/press start/i)).toBeInTheDocument();
    expect(within(last).getByText(/this tour never starts a scan for you/i)).toBeInTheDocument();
    // The closing step points back at the tab strip, not at a lone control.
    expect(resolvedTourTarget()).toContainElement(screen.getByRole('button', { name: 'Scan' }));

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Start a scan/ })).not.toBeInTheDocument(),
    );
    expect(fetchMock.mock.calls.some(([input]) => pathOf(input).includes('/free-check'))).toBe(
      false,
    );
    expect(calledMethod(fetchMock, '/scans', 'POST')).toBe(false);
  });

  it('explains Integrations as optional context rather than a setup step', async () => {
    stubApi(pendingWorkspace);
    render(<App />);

    await screen.findByRole('dialog', { name: 'Your workspace tabs' });
    // Integrations is explained on its own step, before the closing scan step.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    const step = await screen.findByRole('dialog', { name: 'Integrations are optional' });
    expect(within(step).getByText(/Nothing there is required/i)).toBeInTheDocument();
    expect(within(step).getByText(/reads public pages only/i)).toBeInTheDocument();
    expect(within(step).getByText(/Google Search Console/i)).toBeInTheDocument();
    // It is a step of the tour, not the end of it: the scan step still follows.
    expect(within(step).getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('explains Integrations as optional context in Ukrainian', async () => {
    stubApi(pendingWorkspace);
    render(<App />);

    await screen.findByRole('dialog', { name: 'Your workspace tabs' });
    switchLanguageToUkrainian();
    await screen.findByRole('dialog', { name: 'Вкладки робочого простору' });
    for (let step = 0; step < 3; step += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Далі' }));
    }

    const step = await screen.findByRole('dialog', { name: 'Інтеграції — необовʼязкові' });
    expect(within(step).getByText(/не обовʼязкове/)).toBeInTheDocument();
    expect(within(step).getByText(/лише публічні сторінки/)).toBeInTheDocument();
  });

  it('explains the tabs and the scan step in Ukrainian', async () => {
    stubApi(pendingWorkspace);
    render(<App />);

    await screen.findByRole('dialog', { name: 'Your workspace tabs' });
    switchLanguageToUkrainian();

    const tour = await screen.findByRole('dialog', { name: 'Вкладки робочого простору' });
    expect(
      within(tour).getByText(/«Профілі» — це публічні сайти, які ви зберегли/),
    ).toBeInTheDocument();
    expect(within(tour).getByText(/«Перевірка» запускає аудит/)).toBeInTheDocument();

    for (let step = 0; step < tourSteps.length - 1; step += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Далі' }));
    }
    const last = await screen.findByRole('dialog', {
      name: 'Запустіть перевірку, коли будете готові',
    });
    expect(within(last).getByText(/цей огляд не запускає перевірку за вас/i)).toBeInTheDocument();
  });
});

// ─── NewScanScreen — paid availability and i18n ───────────────────────────────
//
// Three focused tests that verify the server-driven paid-checkout gate and the
// NewScanScreen i18n wiring:
//
//  1. Ordinary user (no internalFreeAccess, and /billing/checkout-config reports
//     no provider) sees the paid-unavailable note, only the Free plan option,
//     and the "Run free check" button — and can actually submit (calls
//     free-check, never dev-checkout). The paid flow itself lives in
//     Checkout.test.tsx.
//
//  2. internalFreeAccess user sees "Basic · internal free" / "Complete · internal
//     free" plan options and the "Run internal scan" button; no unavailable note.
//
//  3. After switching the shell language to Ukrainian the NewScanScreen window
//     title, key field labels and the submit button all render in Ukrainian.
// ─────────────────────────────────────────────────────────────────────────────
describe('NewScanScreen — paid availability and i18n', () => {
  const profile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };

  function stubNewScan(acct: object): ReturnType<typeof vi.fn> {
    return stubApi((path) => {
      if (path === '/auth/me') return envelope(acct);
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans/active') return envelope(null);
      if (path === `/profiles/${profile.id}/free-check`)
        return envelope({ ...scan, id: 'scan-free-1', plan: 'Free' as const });
      if (path.startsWith('/scans/'))
        return envelope({ ...scan, id: 'scan-free-1', plan: 'Free' as const });
      return envelope(null);
    });
  }

  async function openNewScan(acct: object): Promise<ReturnType<typeof vi.fn>> {
    const fetchMock = stubNewScan(acct);
    render(<App />);
    await screen.findByText(account.email);
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    await screen.findByText('Site Profiles');
    fireEvent.click(screen.getByRole('button', { name: 'New scan' }));
    await screen.findByText('New scan — scope and tariff');
    return fetchMock;
  }

  it('ordinary user sees paid-unavailable note and can still run Free', async () => {
    const fetchMock = await openNewScan(account);

    // Paid-unavailable note is shown.
    expect(
      screen.getByText(/Paid scans will be available when checkout is enabled/i),
    ).toBeInTheDocument();

    // Basic and Complete options are absent from the plan selector.
    expect(screen.queryByText(/Basic · \$55/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Complete · \$120/)).not.toBeInTheDocument();

    // Submit button is enabled and labelled for Free.
    const runBtn = screen.getByRole('button', { name: 'Run free check' });
    expect(runBtn).toBeEnabled();

    // Submitting calls free-check, never dev-checkout.
    fireEvent.click(runBtn);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/profiles\/profile-1\/free-check$/),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/billing\/dev-checkout/),
      expect.anything(),
    );
  });

  // Until the server has answered, the screen must not announce an absence it
  // cannot know about: an unresolved config request used to read exactly like a
  // deployment that does not sell scans, and then contradict itself on arrival.
  it('says it is still checking while the checkout config is in flight', async () => {
    let releaseConfig = (): void => undefined;
    const configArrived = new Promise<Response>((resolve) => {
      releaseConfig = () =>
        resolve(
          envelope({
            provider: 'fastspring',
            available: true,
            mode: 'test',
            unavailableReason: null,
            popup: { storefront: 'fluxlab.test.onfastspring.com/popup-fluxlab' },
            plans: [],
          }),
        );
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = pathOf(input);
      if (path === '/billing/checkout-config') return configArrived;
      if (path === '/auth/me') return Promise.resolve(envelope(account));
      if (path === '/profiles') return Promise.resolve(envelope([profile]));
      if (path === '/scans/active') return Promise.resolve(envelope(null));
      return Promise.resolve(envelope(null));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByText(account.email);
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    await screen.findByText('Site Profiles');
    fireEvent.click(screen.getByRole('button', { name: 'New scan' }));
    await screen.findByText('New scan — scope and tariff');

    expect(
      screen.getByText('Checking whether paid reports can be bought here…'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Paid scans will be available when checkout is enabled/i),
    ).not.toBeInTheDocument();

    releaseConfig();

    // Once the answer lands, the paid plans are offered — no note either way.
    expect(await screen.findByText(/Complete · \$/)).toBeInTheDocument();
    expect(
      screen.queryByText('Checking whether paid reports can be bought here…'),
    ).not.toBeInTheDocument();
  });

  it('internalFreeAccess user sees internal Basic and Complete options', async () => {
    const internalAccount = { ...account, internalFreeAccess: true };
    await openNewScan(internalAccount);

    // No unavailable note for internal users.
    expect(
      screen.queryByText(/Paid scans will be available when checkout is enabled/i),
    ).not.toBeInTheDocument();

    // Internal-free labels appear in the plan selector.
    expect(screen.getByText('Basic · internal free')).toBeInTheDocument();
    expect(screen.getAllByText('Complete · internal free').length).toBeGreaterThan(0);

    // Default plan is Complete for internal users → submit label is Run internal scan.
    expect(screen.getByRole('button', { name: 'Run internal scan' })).toBeInTheDocument();
    const performance = screen.getByRole('group', {
      name: 'External performance measurement',
    });
    expect(within(performance).getByText(/You do not connect a Google account/i)).toBeVisible();
    expect(screen.getByText('Performance provider')).toBeVisible();
    expect(screen.getByText('Google PageSpeed / CrUX · no sign-in')).toBeVisible();
  });

  it('renders New scan labels in Ukrainian after language switch', async () => {
    stubNewScan(account);
    render(<App />);
    await screen.findByText(account.email);

    // Switch language before entering the workspace.
    switchLanguageToUkrainian();

    fireEvent.click(screen.getByRole('button', { name: 'Відкрити робочий простір' }));
    await screen.findByText('Профілі сайтів');
    fireEvent.click(screen.getByRole('button', { name: 'Нова перевірка' }));

    // Window title in Ukrainian.
    expect(await screen.findByText('Нова перевірка — область і тариф')).toBeInTheDocument();
    // Field label in Ukrainian. The control picks a saved profile, so it is
    // named after that and not after the public address the profile holds.
    expect(screen.getByText('Профіль')).toBeInTheDocument();
    expect(screen.queryByText('Публічне джерело')).not.toBeInTheDocument();
    // Plan selector label in Ukrainian.
    expect(screen.getByText('Тариф перевірки')).toBeInTheDocument();
    // Submit button in Ukrainian (ordinary account → Free plan → runFree).
    expect(
      screen.getByRole('button', { name: 'Запустити безкоштовну перевірку' }),
    ).toBeInTheDocument();
  });
});

// ─── Add-profile form — one call to action, name derived from the address ────
//
// The empty profiles screen used to show an "Add profile" button next to a form
// that already had a Save profile button, and the name had to be typed by hand
// even though it is almost always the domain. These pin both behaviours.
// ─────────────────────────────────────────────────────────────────────────────
describe('add-profile form', () => {
  const emptyProfiles = (path: string): Response => {
    if (path === '/auth/me') return envelope(account);
    if (path === '/profiles') return envelope([]);
    if (path === '/scans/active') return envelope(null);
    return envelope(null);
  };

  async function renderProfilesScreen(): Promise<ReturnType<typeof vi.fn>> {
    const fetchMock = stubApi(emptyProfiles);
    window.history.replaceState(null, '', '/profiles');
    render(<App />);
    await screen.findByText('Site Profiles');
    return fetchMock;
  }

  // The field label carries its hint text too, so the accessible name is
  // matched by prefix rather than by an exact string.
  const addressField = () => screen.getByRole('textbox', { name: /^Site address/ });
  const nameField = () =>
    screen.getByRole('textbox', { name: /^Display name/ }) as HTMLInputElement;
  const typeAddress = (value: string) => fireEvent.change(addressField(), { target: { value } });
  const typeName = (value: string) => fireEvent.change(nameField(), { target: { value } });

  it('shows the empty state without a second Add profile button', async () => {
    await renderProfilesScreen();

    expect(screen.getByText('No profiles yet')).toBeInTheDocument();
    // The form on the same screen is the one and only way to add a profile.
    expect(screen.queryByRole('button', { name: 'Add profile' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeInTheDocument();
  });

  it('shows the empty state without a second Add profile button in Ukrainian', async () => {
    stubApi(emptyProfiles);
    window.history.replaceState(null, '', '/profiles');
    saveCookieConsent({ preferences: true, analytics: false });
    window.localStorage.setItem('fluxradar.language', 'uk');
    render(<App />);
    await screen.findByText('Профілі сайтів');

    expect(screen.getByText('Профілів ще немає')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Додати профіль' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Зберегти профіль' })).toBeInTheDocument();
  });

  it('fills the name from the address the owner pastes, and keeps it editable', async () => {
    const fetchMock = await renderProfilesScreen();

    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
    typeAddress('https://www.mysite.com/pricing?ref=1');

    expect(nameField().value).toBe('mysite.com');
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeEnabled();

    // The suggestion keeps following the address while it is untouched.
    typeAddress('shop.other.co.uk');
    expect(nameField().value).toBe('shop.other.co.uk');

    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(calledMethod(fetchMock, '/profiles', 'POST')).toBe(true));
    const created = fetchMock.mock.calls.find(
      ([input, init]) =>
        pathOf(input) === '/profiles' && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(JSON.parse(String((created?.[1] as RequestInit).body))).toEqual({
      name: 'shop.other.co.uk',
      domain: 'https://shop.other.co.uk',
    });
  });

  it('never overwrites a name the owner typed', async () => {
    await renderProfilesScreen();

    typeAddress('mysite.com');
    typeName('Client landing page');
    typeAddress('another-site.com');

    expect(nameField().value).toBe('Client landing page');
    // Clearing the address leaves an owner-written name alone as well.
    typeAddress('');
    expect(nameField().value).toBe('Client landing page');
  });

  it('leaves a name typed before the address alone', async () => {
    await renderProfilesScreen();

    // The other order of the same rule: a name that was never this form's
    // suggestion is the owner's, whether they typed it first or last.
    typeName('Client landing page');
    typeAddress('mysite.com');

    expect(nameField().value).toBe('Client landing page');
  });

  it('takes the name back over once the owner clears it', async () => {
    await renderProfilesScreen();

    typeAddress('mysite.com');
    typeName('Client landing page');
    typeName('');
    typeAddress('another-site.com');

    // An empty name is not an owner's answer, so the address fills it again
    // rather than leaving the form unsubmittable.
    expect(nameField().value).toBe('another-site.com');
  });

  it('suggests no name while the address is not a site address, and clears its own suggestion', async () => {
    await renderProfilesScreen();

    typeAddress('mysite');
    expect(nameField().value).toBe('');
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();

    typeAddress('mysite.com');
    expect(nameField().value).toBe('mysite.com');

    // Clearing the address clears the name this form suggested — nothing stale.
    typeAddress('');
    expect(nameField().value).toBe('');
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  });

  it('fills the name from the address in Ukrainian too', async () => {
    stubApi(emptyProfiles);
    window.history.replaceState(null, '', '/profiles');
    saveCookieConsent({ preferences: true, analytics: false });
    window.localStorage.setItem('fluxradar.language', 'uk');
    render(<App />);
    await screen.findByText('Профілі сайтів');

    fireEvent.change(screen.getByRole('textbox', { name: /^Адреса сайту/ }), {
      target: { value: 'www.mysite.com' },
    });

    expect((screen.getByRole('textbox', { name: /^Назва/ }) as HTMLInputElement).value).toBe(
      'mysite.com',
    );
    expect(screen.getByRole('button', { name: 'Зберегти профіль' })).toBeEnabled();
  });
});
