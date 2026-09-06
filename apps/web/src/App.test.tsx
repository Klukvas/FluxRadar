import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

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

    // Existing users can still switch to sign in from the same dialog.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByText('FluxRadar — Sign in')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create account' })).toBeInTheDocument();

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
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to sign in' }));
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
    await screen.findByText('Unified public website audit station.');

    // Open the New scan dialog.
    fireEvent.click(screen.getByRole('button', { name: 'New scan' }));
    expect(await screen.findByText('New scan — scope and tariff')).toBeInTheDocument();

    // Close the dialog via the title-bar close button.
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }));

    // Should be back on the desktop, not on the new-scan screen.
    expect(await screen.findByText('Unified public website audit station.')).toBeInTheDocument();
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
    expect(screen.getByText('Checking your website')).toBeInTheDocument();
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
    expect(screen.getByText('Unified website signal')).toBeInTheDocument();
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
    expect(screen.getByRole('progressbar', { name: 'Audit progress' })).toHaveAttribute(
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
    expect(screen.getByText('Website')).toBeInTheDocument();
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

    // URL should be reset to the root (no stale /scans/… fragment).
    expect(window.location.pathname).toBe('/');
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

    // Desktop is restored without any additional API calls.
    expect(screen.getByText('Site Profiles')).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callCountBefore);
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
// The /checks page is a fully static public SPA route: no API calls, no login.
// It must render all six audit-module sections, evidence, limitations, a
// back-to-home link, and be discoverable from the homepage footer and the
// homepage coverage-entry section.
// ─────────────────────────────────────────────────────────────────────────────
describe('public /checks — audit coverage page', () => {
  it('renders the audit coverage page without calling the API', async () => {
    const fetchMock = stubApi(() => envelope(null));
    window.history.replaceState(null, '', '/checks');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Audit coverage' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(screen.getByRole('link', { name: /Read the full audit coverage/i })).toHaveAttribute(
      'href',
      '/checks',
    );
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
      screen.getByText(/Each finding is something FluxRadar detected on a public page/i),
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

describe('/plans and workspace onboarding', () => {
  const pendingAccount = { ...account, onboarding: { status: 'pending' as const } };
  const profile = { id: 'profile-1', name: 'My website', domain: 'https://mysite.com' };

  function pathOf(input: RequestInfo | URL): string {
    return new URL(String(input)).pathname;
  }

  function calledMethod(
    fetchMock: ReturnType<typeof vi.fn>,
    path: string,
    method: string,
  ): boolean {
    return fetchMock.mock.calls.some(
      ([input, init]) =>
        pathOf(input) === path && (init as RequestInit | undefined)?.method === method,
    );
  }

  it('opens /plans directly, shows the honest pay-per-scan scope and keeps the route', async () => {
    window.history.replaceState(null, '', '/plans');
    stubApi((path) => (path === '/auth/me' ? failure(401, 'unauthenticated') : envelope(null)));

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Plans for every public audit.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Paid checkout is not enabled in this release/i)).toBeInTheDocument();
    expect(screen.getByText('One free check per account')).toBeInTheDocument();
    expect(
      screen.getByText('SEO analysis, AI SEO / GEO and actionable findings'),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/plans');
  });

  it('does not show a "Not included" row for the Complete plan, but keeps it for Free/Basic', async () => {
    window.history.replaceState(null, '', '/plans');
    stubApi((path) => (path === '/auth/me' ? failure(401, 'unauthenticated') : envelope(null)));

    render(<App />);

    await screen.findByRole('heading', { name: 'Plans for every public audit.' });
    const completeCard = document.querySelector('.home__plan--complete');
    expect(completeCard).not.toBeNull();
    expect(within(completeCard as HTMLElement).queryByText('Not included')).not.toBeInTheDocument();

    const freeCard = document.querySelector('.home__plan--free');
    expect(within(freeCard as HTMLElement).getByText('Not included')).toBeInTheDocument();
    const basicCard = document.querySelector('.home__plan--basic');
    expect(within(basicCard as HTMLElement).getByText('Not included')).toBeInTheDocument();
  });

  it('shows the plain-language plan explainer copy on the plans page', async () => {
    window.history.replaceState(null, '', '/plans');
    stubApi((path) => (path === '/auth/me' ? failure(401, 'unauthenticated') : envelope(null)));

    render(<App />);

    await screen.findByRole('heading', { name: 'Plans for every public audit.' });
    expect(
      screen.getByRole('heading', { name: 'Which plan is actually right for you?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Free — a quick sanity check')).toBeInTheDocument();
    expect(screen.getByText('Basic — search and AI visibility')).toBeInTheDocument();
    expect(screen.getByText('Complete — the full public-site picture')).toBeInTheDocument();
  });

  it('labels the signed-out plans CTA as create account and opens registration', async () => {
    window.history.replaceState(null, '', '/plans');
    stubApi((path) => (path === '/auth/me' ? failure(401, 'unauthenticated') : envelope(null)));

    render(<App />);

    // The action opens registration, so the label must not promise a sign in.
    const cta = await screen.findByRole('button', { name: 'Create account to start' });
    expect(screen.queryByRole('button', { name: 'Sign in to start' })).not.toBeInTheDocument();

    fireEvent.click(cta);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });

  it('switches the shell to Ukrainian and persists the language after remount', async () => {
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

    expect(await screen.findByText('Unified public website audit station.')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Files is your starting point' }),
    ).toBeInTheDocument();
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
    const tour = await screen.findByRole('dialog', { name: 'Files is your starting point' });
    expect(tour).toHaveAttribute('aria-modal', 'true');
    expect(tour).toHaveAccessibleDescription(/Files keeps your saved public website profiles/);

    // One minimal visual-presence check: the spotlight is decorative only and
    // must stay hidden from assistive technology.
    const spotlight = document.querySelector('.tour-overlay__spotlight');
    expect(spotlight).toBeInTheDocument();
    expect(spotlight).toHaveAttribute('aria-hidden', 'true');

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
      await screen.findByRole('dialog', { name: 'Scan turns a profile into an audit' }),
    ).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Back' }));
    expect(
      await screen.findByRole('dialog', { name: 'Files is your starting point' }),
    ).toBeInTheDocument();

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
    expect(
      screen.queryByRole('heading', { name: 'Files is your starting point' }),
    ).not.toBeInTheDocument();

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
    expect(
      await screen.findByRole('heading', { name: 'Files is your starting point' }),
    ).toBeInTheDocument();
    for (let step = 0; step < 6; step += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Files is your starting point' }),
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
    expect(
      await screen.findByRole('heading', { name: 'Files is your starting point' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Files is your starting point' }),
      ).not.toBeInTheDocument(),
    );
    expect(calledMethod(fetchMock, '/account/onboarding', 'PATCH')).toBe(true);
  });
});

// ─── Self-explanatory workflow — nav descriptions, workspace map, plain help ──
//
// A non-technical site owner must be able to understand the workflow without
// already knowing what Files/Scan/Reports/Integrations/Plans mean. These tests
// assert the user-visible, accessibility-friendly copy that carries that
// explanation, in both English and Ukrainian where the shell is bilingual.
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

    expect(screen.getByRole('button', { name: 'Files' })).toHaveAttribute(
      'title',
      'Your saved websites and their audit history.',
    );
    expect(screen.getByRole('button', { name: 'Files' })).toBeDisabled();
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
    expect(screen.getByRole('button', { name: 'Plans' })).toHaveAttribute(
      'title',
      'What each audit covers and its limits.',
    );
  });

  it('describes the navigation tabs in Ukrainian after switching language', async () => {
    await renderUnauthenticated((path) =>
      path === '/auth/me' ? failure(401, 'session required') : envelope([]),
    );

    switchLanguageToUkrainian();

    expect(screen.getByRole('button', { name: 'Сайти' })).toHaveAttribute(
      'title',
      'Ваші збережені сайти та історія їхніх перевірок.',
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

  it('shows a plain-language map of the workspace areas', async () => {
    stubApi(emptyWorkspace);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open workspace' }));
    const guide = await screen.findByRole('region', { name: 'What each area does' });

    expect(
      within(guide).getByText('Your saved websites and their audit history.'),
    ).toBeInTheDocument();
    expect(within(guide).getByText('Set up and start a new audit.')).toBeInTheDocument();
    expect(within(guide).getByText('Completed and in-progress audit results.')).toBeInTheDocument();
    expect(
      within(guide).getByText(
        'Optional data connections. The public-site scan works without them.',
      ),
    ).toBeInTheDocument();
    expect(within(guide).getByText('What each audit covers and its limits.')).toBeInTheDocument();
  });

  it('shows the workspace map in Ukrainian', async () => {
    stubApi(emptyWorkspace);
    render(<App />);

    await screen.findByRole('button', { name: 'Open workspace' });
    switchLanguageToUkrainian();
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити робочий простір' }));

    const guide = await screen.findByRole('region', { name: 'Що робить кожен розділ' });
    expect(
      within(guide).getByText('Ваші збережені сайти та історія їхніх перевірок.'),
    ).toBeInTheDocument();
    expect(within(guide).getByText('Готові та поточні результати перевірок.')).toBeInTheDocument();
  });

  it('tells a first-time owner what to enter and that saving does not start a scan', async () => {
    stubApi(emptyWorkspace);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open workspace' }));
    await screen.findByText('Site Profiles');

    // Empty state names the first action and the input in plain language.
    expect(screen.getByText(/Add your first public website to begin/i)).toBeInTheDocument();
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

// ─── /plans — MenuBar navigation must not silently no-op ─────────────────────
//
// The PlansScreen renders its own MenuBar.  Every nav button must navigate to
// the correct screen; buttons that previously had no handler in PlansScreen's
// onNavigate callback would silently do nothing (no-op).
// ─────────────────────────────────────────────────────────────────────────────
describe('/plans — MenuBar navigation (signed in)', () => {
  function stubPlansSignedIn() {
    return stubApi((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([]);
      if (path === '/scans/active') return envelope(null);
      if (path === '/integrations') return envelope([]);
      return envelope(null);
    });
  }

  it('navigates from /plans to the workspace when the Files tab is clicked', async () => {
    window.history.replaceState(null, '', '/plans');
    stubPlansSignedIn();
    render(<App />);

    await screen.findByRole('heading', { name: 'Plans for every public audit.' });
    expect(screen.getByRole('button', { name: 'Files' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Files' }));

    await screen.findByText('Unified public website audit station.');
    expect(
      screen.queryByRole('heading', { name: 'Plans for every public audit.' }),
    ).not.toBeInTheDocument();
  });

  it('navigates from /plans to integrations when the Integrations tab is clicked', async () => {
    window.history.replaceState(null, '', '/plans');
    stubPlansSignedIn();
    render(<App />);

    await screen.findByRole('heading', { name: 'Plans for every public audit.' });
    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }));

    await screen.findByText('Connected data sources');
    expect(
      screen.queryByRole('heading', { name: 'Plans for every public audit.' }),
    ).not.toBeInTheDocument();
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

// ─── Files tab — accurate copy ───────────────────────────────────────────────
//
// The Files tour step must describe what is actually rendered in the Files tab
// (saved website profiles) and must not claim it holds "saved files" or
// "audit artifacts" that do not appear in the UI.
// ─────────────────────────────────────────────────────────────────────────────
describe('Files tab — accurate tour copy', () => {
  it('tour body does not claim the tab holds saved files or audit artifacts', async () => {
    stubApi((path) => {
      if (path === '/auth/me')
        return envelope({ ...account, onboarding: { status: 'pending' as const } });
      if (path === '/profiles') return envelope([]);
      if (path === '/scans/active') return envelope(null);
      return envelope(null);
    });
    render(<App />);

    const tour = await screen.findByRole('dialog', { name: 'Files is your starting point' });

    expect(within(tour).queryByText(/saved files/i)).not.toBeInTheDocument();
    expect(within(tour).queryByText(/audit artifacts/i)).not.toBeInTheDocument();
    expect(within(tour).getByText(/saved public website profiles/i)).toBeInTheDocument();
  });
});

// ─── NewScanScreen — paid availability and i18n ───────────────────────────────
//
// Three focused tests that verify the VITE_LIVE_CHECKOUT_ENABLED gate and the
// NewScanScreen i18n wiring:
//
//  1. Ordinary user (no internalFreeAccess, checkout disabled by default in
//     test env) sees the paid-unavailable note, only the Free plan option, and
//     the "Run free check" button — and can actually submit (calls free-check,
//     never dev-checkout).
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

  it('internalFreeAccess user sees internal Basic and Complete options', async () => {
    const internalAccount = { ...account, internalFreeAccess: true };
    await openNewScan(internalAccount);

    // No unavailable note for internal users.
    expect(
      screen.queryByText(/Paid scans will be available when checkout is enabled/i),
    ).not.toBeInTheDocument();

    // Internal-free labels appear in the plan selector.
    expect(screen.getByText('Basic · internal free')).toBeInTheDocument();
    expect(screen.getByText('Complete · internal free')).toBeInTheDocument();

    // Default plan is Complete for internal users → submit label is Run internal scan.
    expect(screen.getByRole('button', { name: 'Run internal scan' })).toBeInTheDocument();
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
    // Field label in Ukrainian.
    expect(screen.getByText('Публічне джерело')).toBeInTheDocument();
    // Plan selector label in Ukrainian.
    expect(screen.getByText('Тариф перевірки')).toBeInTheDocument();
    // Submit button in Ukrainian (ordinary account → Free plan → runFree).
    expect(
      screen.getByRole('button', { name: 'Запустити безкоштовну перевірку' }),
    ).toBeInTheDocument();
  });
});
