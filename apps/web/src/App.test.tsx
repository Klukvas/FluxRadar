import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { WEBSITE_INPUT_ERROR } from './website-input';

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
    expect(screen.getByRole('heading', { name: /SEO — what FluxRadar checks/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /AI SEO \/ Generative Engine Optimisation/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Security — OWASP ASVS public profile/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Accessibility — WCAG 2\.2 AA/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Reliability and performance/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Privacy and consent signals/i })).toBeInTheDocument();
  });

  it('shows the evidence and limitations sections', async () => {
    window.history.replaceState(null, '', '/checks');
    stubApi(() => envelope(null));
    render(<App />);
    await screen.findByRole('heading', { name: 'Audit coverage' });
    expect(screen.getByRole('heading', { name: /How findings are evidenced/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /What FluxRadar cannot certify/i })).toBeInTheDocument();
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
    await screen.findByText('Report dashboard · https://example.com');
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
    expect(
      await screen.findByText('Content-Security-Policy header absent'),
    ).toBeInTheDocument();
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

// ─── Onboarding — non-technical first-run customer journey ────────────────────
//
// A non-technical site owner must be able to:
//   • land in onboarding right after registration (pending onboarding, no site);
//   • type a natural website address ("mysite.com"), see it normalized to an
//     https origin, and run the one-time free homepage check;
//   • get a friendly error for an unusable address without any API call;
//   • pick a paid plan and be told, plainly, that checkout is deferred — no fake
//     purchase is created — while still being offered the free check;
//   • reopen the setup guide from the workspace after onboarding.
// ─────────────────────────────────────────────────────────────────────────────
describe('onboarding — non-technical first-run', () => {
  const pendingAccount = { ...account, onboarding: { status: 'pending' as const } };
  const onboardProfile = { id: 'profile-onb-1', name: 'My website', domain: 'https://mysite.com' };
  const freeScan = {
    ...scan,
    id: 'scan-free-onb',
    profileId: onboardProfile.id,
    plan: 'Free' as const,
    domain: 'https://mysite.com',
    status: 'Running',
    progress: { completedModules: 0, totalModules: 1 },
    modules: [],
  };

  function pathOf(input: RequestInfo | URL): string {
    return new URL(String(input)).pathname;
  }
  function calledPost(fetchMock: ReturnType<typeof vi.fn>, path: string): boolean {
    return fetchMock.mock.calls.some(
      ([input, init]) => pathOf(input) === path && (init as RequestInit | undefined)?.method === 'POST',
    );
  }
  function calledMethod(
    fetchMock: ReturnType<typeof vi.fn>,
    path: string,
    method: string,
  ): boolean {
    return fetchMock.mock.calls.some(
      ([input, init]) => pathOf(input) === path && (init as RequestInit | undefined)?.method === method,
    );
  }

  it('routes a newly registered owner into onboarding instead of the workspace', async () => {
    const fetchMock = await renderUnauthenticated((path, init) => {
      if (path === '/auth/me') return failure(401, 'session required');
      if (path === '/auth/register') return envelope(pendingAccount, 201);
      if (path === '/profiles' && init?.method === 'POST') return envelope(onboardProfile, 201);
      if (path === '/profiles') return envelope([]);
      return envelope(null);
    });

    openAuth();
    const dialog = screen.getByRole('dialog');
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: account.email },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'valid-password' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByRole('heading', { name: 'Set up your first check.' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calledPost(fetchMock, '/auth/register')).toBe(true);
  });

  it('normalizes a typed website and runs the one-time free homepage check', async () => {
    const fetchMock = stubApi((path, init) => {
      if (path === '/auth/me') return envelope(pendingAccount);
      if (path === '/profiles' && init?.method === 'POST') return envelope(onboardProfile, 201);
      if (path === '/profiles') return envelope([]);
      if (path === `/profiles/${onboardProfile.id}/free-check`) return envelope(freeScan, 201);
      if (path === '/account/onboarding')
        return envelope({ ...pendingAccount, onboarding: { status: 'completed' } });
      if (path === `/scans/${freeScan.id}`) return envelope(freeScan);
      return envelope(null);
    });

    render(<App />);
    await screen.findByRole('heading', { name: 'Set up your first check.' });

    fireEvent.change(screen.getByPlaceholderText('My website'), { target: { value: 'My website' } });
    fireEvent.change(screen.getByPlaceholderText('mysite.com'), { target: { value: 'mysite.com' } });

    // The owner sees, in plain terms, exactly which origin will be checked.
    expect(screen.getByText('https://mysite.com')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Create site and run free homepage check' }),
    );

    // Lands on the live progress screen for the Free plan.
    expect(await screen.findByText('Scan progress · Free')).toBeInTheDocument();

    // The profile was created from the normalized https origin (not the raw text).
    const profilePost = fetchMock.mock.calls.find(
      ([input, init]) =>
        pathOf(input) === '/profiles' && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(profilePost).toBeDefined();
    expect(String((profilePost?.[1] as RequestInit).body)).toContain('https://mysite.com');
    expect(calledPost(fetchMock, `/profiles/${onboardProfile.id}/free-check`)).toBe(true);
    expect(calledMethod(fetchMock, '/account/onboarding', 'PATCH')).toBe(true);
    // No fake paid transaction anywhere in the free path.
    expect(calledPost(fetchMock, '/billing/dev-checkout')).toBe(false);
  });

  it('rejects an unusable website address with a friendly message and no API call', async () => {
    const fetchMock = stubApi((path) => {
      if (path === '/auth/me') return envelope(pendingAccount);
      if (path === '/profiles') return envelope([]);
      return envelope(null);
    });

    render(<App />);
    await screen.findByRole('heading', { name: 'Set up your first check.' });

    fireEvent.change(screen.getByPlaceholderText('My website'), { target: { value: 'My website' } });
    fireEvent.change(screen.getByPlaceholderText('mysite.com'), {
      target: { value: 'not a website' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Create site and run free homepage check' }),
    );

    expect(await screen.findByText(WEBSITE_INPUT_ERROR)).toBeInTheDocument();
    // Nothing is created from an invalid address.
    expect(calledPost(fetchMock, '/profiles')).toBe(false);
  });

  it('defers a paid choice without faking a purchase and still offers the free check', async () => {
    const fetchMock = stubApi((path, init) => {
      if (path === '/auth/me') return envelope(pendingAccount);
      if (path === '/profiles' && init?.method === 'POST') return envelope(onboardProfile, 201);
      if (path === '/profiles') return envelope([]);
      if (path === '/scans/active') return envelope(null);
      if (path === '/account/onboarding')
        return envelope({ ...pendingAccount, onboarding: { status: 'completed' } });
      return envelope(null);
    });

    render(<App />);
    await screen.findByRole('heading', { name: 'Set up your first check.' });

    fireEvent.change(screen.getByPlaceholderText('My website'), { target: { value: 'My website' } });
    fireEvent.change(screen.getByPlaceholderText('mysite.com'), { target: { value: 'mysite.com' } });

    // Choose a paid plan.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Basic' } });

    // A clear, honest deferral notice — not a promise of payment.
    expect(screen.getByText('Paid audits open after setup')).toBeInTheDocument();
    expect(screen.getByText(/Checkout is not available during setup yet/i)).toBeInTheDocument();
    // Free is still offered as the primary action.
    expect(
      screen.getByRole('button', { name: 'Run the free homepage check now' }),
    ).toBeInTheDocument();

    // Saving the paid preference must not fake a purchase or start a scan.
    fireEvent.click(screen.getByRole('button', { name: 'Save choice and open workspace' }));

    expect(await screen.findByText('Unified public website audit station.')).toBeInTheDocument();
    expect(calledPost(fetchMock, '/profiles')).toBe(true);
    expect(calledMethod(fetchMock, '/account/onboarding', 'PATCH')).toBe(true);
    expect(calledPost(fetchMock, '/billing/dev-checkout')).toBe(false);
    expect(calledPost(fetchMock, `/profiles/${onboardProfile.id}/free-check`)).toBe(false);
  });

  it('reopens the setup guide from the workspace after onboarding', async () => {
    stubApi((path) => {
      if (path === '/auth/me')
        return envelope({ ...account, onboarding: { status: 'completed' } });
      if (path === '/profiles') return envelope([onboardProfile]);
      if (path === '/scans/active') return envelope(null);
      return envelope(null);
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open workspace' }));
    await screen.findByText('Site Profiles');

    fireEvent.click(screen.getByRole('button', { name: 'Open setup guide' }));
    expect(
      await screen.findByRole('heading', { name: 'Set up your first check.' }),
    ).toBeInTheDocument();
  });
});
