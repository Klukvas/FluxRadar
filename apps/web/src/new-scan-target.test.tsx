import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

// Starting a check from a raw address.
//
// The new-scan screen used to refuse to open at all without a saved profile: it
// rendered "Create a profile first" and an Add-profile button, which sent
// someone who had typed a URL into a different form to type it again. Everything
// the product hangs off a profile still does — billing, the Google binding, the
// report history — so the address becomes a profile before the scan starts. That
// step is the server's (`POST /profiles/resolve`); these pin that the screen
// takes it, takes it exactly once, and never takes it for an address that is not
// one.

const account = { accountId: 'account-1', email: 'operator@example.com' };
const savedProfile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };
const configuredProfile = {
  ...savedProfile,
  scanConfigVersion: 3,
  scanConfig: {
    plan: 'Complete' as const,
    scope: {
      includeSubdomains: true,
      maxPages: 120,
      maxDepth: 6,
      queryPolicy: 'include' as const,
      respectRobots: true,
      robotsOverrideConfirmed: false,
      userAgent: 'mobile' as const,
    },
  },
};
const createdProfile = { id: 'profile-new', name: 'mysite.com', domain: 'https://mysite.com' };

const freeScan = {
  id: 'scan-free-1',
  profileId: createdProfile.id,
  plan: 'Free' as const,
  domain: createdProfile.domain,
  status: 'Running',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-v1',
  progress: { completedModules: 0, totalModules: 1 },
  startedAt: null,
  completedAt: null,
  createdAt: '2026-09-08T00:00:00.000Z',
  modules: [],
};

const lastBasicScan = {
  ...freeScan,
  id: 'scan-basic-1',
  profileId: savedProfile.id,
  plan: 'Basic' as const,
  domain: savedProfile.domain,
  status: 'Completed',
  scope: {
    includeSubdomains: true,
    maxPages: 42,
    maxDepth: 2,
    urlPatterns: ['/docs/*'],
    excludePatterns: ['/admin/*'],
    queryPolicy: 'include' as const,
    respectRobots: true,
    robotsOverrideConfirmed: false,
    userAgent: 'mobile' as const,
  },
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

/** Renders the app straight onto the new-scan screen, as a workspace URL does. */
function renderNewScan(
  handler: (path: string, init?: RequestInit) => Response,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(pathOf(input), init)),
  );
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', '/scan');
  render(<App />);
  return fetchMock;
}

function stubWorkspace(profiles: readonly object[]) {
  return (path: string, init?: RequestInit): Response => {
    if (path === '/auth/me') return envelope(account);
    if (path === '/profiles') return envelope(profiles);
    if (path === '/scans/active') return envelope(null);
    if (path === '/profiles/profile-1/scans') return envelope([lastBasicScan]);
    if (path === '/profiles/resolve') return envelope({ profile: createdProfile, created: true });
    if (path.startsWith('/profiles/') && init?.method === 'PATCH') {
      return envelope(profiles[0] ?? createdProfile);
    }
    if (path.endsWith('/free-check')) return envelope(freeScan);
    if (path.startsWith('/scans/')) return envelope(freeScan);
    return envelope(null);
  };
}

const addressField = () => screen.getByRole('textbox', { name: /^Site address/ });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('new scan from a raw address — no saved profile', () => {
  it('opens on the address field instead of refusing to open', async () => {
    renderNewScan(stubWorkspace([]));
    await screen.findByText('New scan — scope and tariff');

    expect(screen.getByText(/No saved profiles yet/)).toBeInTheDocument();
    expect(addressField()).toBeInTheDocument();
    // The dead end this replaces.
    expect(screen.queryByText('Create a profile first')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run free check' })).toBeInTheDocument();
  });

  // Two sentences that used to describe a profile picker that is not on the
  // screen: the status line asked for a profile, and the picker's hint
  // explained a saved address the owner has not saved.
  it('asks for an address, not for a profile it is not showing', async () => {
    renderNewScan(stubWorkspace([]));
    await screen.findByText('New scan — scope and tariff');

    expect(screen.getByText(/Enter a site address/)).toBeInTheDocument();
    expect(screen.queryByText(/Select a profile/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Scans the site address saved on this profile/),
    ).not.toBeInTheDocument();
  });

  it('turns the address into a profile and checks it', async () => {
    const fetchMock = renderNewScan(stubWorkspace([]));
    await screen.findByText('New scan — scope and tariff');

    fireEvent.change(addressField(), { target: { value: 'www.mysite.com/pricing?ref=1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run free check' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => pathOf(input) === '/profiles/resolve')).toBe(
        true,
      ),
    );
    // The freeform address reaches the server as the strict origin a profile
    // stores — the path and the query never do.
    const resolveCall = fetchMock.mock.calls.find(
      ([input]) => pathOf(input) === '/profiles/resolve',
    );
    expect(bodyOf(resolveCall?.[1] as RequestInit)).toEqual({ domain: 'https://www.mysite.com' });
    // The check runs against the profile that address resolved to.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input]) => pathOf(input) === `/profiles/${createdProfile.id}/free-check`,
        ),
      ).toBe(true),
    );
  });

  it('refuses an address that is not one, without asking the server', async () => {
    const fetchMock = renderNewScan(stubWorkspace([]));
    await screen.findByText('New scan — scope and tariff');

    fireEvent.change(addressField(), { target: { value: 'not a site' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run free check' }));

    expect(
      await screen.findByText(
        'That does not look like a site address. Enter your domain, like mysite.com.',
      ),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => pathOf(input) === '/profiles/resolve')).toBe(
      false,
    );
  });

  // The refusal used to be red text and nothing else: the field still reported
  // itself as valid, and the message was in no live region, so someone using a
  // screen reader pressed the button and was told nothing at all.
  it('marks the refused field invalid and announces why', async () => {
    renderNewScan(stubWorkspace([]));
    await screen.findByText('New scan — scope and tariff');

    expect(addressField()).not.toHaveAttribute('aria-invalid');

    fireEvent.change(addressField(), { target: { value: 'not a site' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run free check' }));

    const announced = await screen.findByRole('alert');
    expect(announced).toHaveTextContent('That does not look like a site address.');
    expect(addressField()).toHaveAttribute('aria-invalid', 'true');
  });

  it('withdraws the refusal as soon as the address is edited', async () => {
    renderNewScan(stubWorkspace([]));
    await screen.findByText('New scan — scope and tariff');

    fireEvent.change(addressField(), { target: { value: 'not a site' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run free check' }));
    await screen.findByRole('alert');

    fireEvent.change(addressField(), { target: { value: 'mysite.com' } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(addressField()).not.toHaveAttribute('aria-invalid');
  });

  // Refreshing the workspace's copy of the profile list happens on the way to
  // the scan. It is a convenience: the profile is already saved, so a list that
  // will not re-read must not cancel the check it was created for.
  it('still starts the check when the profile list cannot be reloaded', async () => {
    let listReads = 0;
    const fetchMock = renderNewScan((path, init) => {
      if (path === '/profiles' && (listReads += 1) > 1)
        return new Response(
          JSON.stringify({ success: false, data: null, error: { code: 'X', message: 'no list' } }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        );
      return stubWorkspace([])(path, init);
    });
    await screen.findByText('New scan — scope and tariff');

    fireEvent.change(addressField(), { target: { value: 'mysite.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run free check' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input]) => pathOf(input) === `/profiles/${createdProfile.id}/free-check`,
        ),
      ).toBe(true),
    );
    expect(screen.queryByText('no list')).not.toBeInTheDocument();
  });
});

describe('new scan from a raw address — profiles already saved', () => {
  it('keeps Free runnable when saved Complete checkout is unavailable without overwriting that configuration', async () => {
    const fetchMock = renderNewScan(stubWorkspace([configuredProfile]));
    const button = await screen.findByRole('button', { name: 'Run free check' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByRole('combobox', { name: 'Scan plan' })).toHaveValue('Free');
    fireEvent.click(button);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => pathOf(input).endsWith('/free-check'))).toBe(
        true,
      ),
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('loads and saves the reusable configuration on the selected profile', async () => {
    const fetchMock = renderNewScan((path, init) => {
      if (path === '/auth/me') return envelope({ ...account, internalFreeAccess: true });
      if (path === `/profiles/${configuredProfile.id}` && init?.method === 'PATCH') {
        return envelope(configuredProfile);
      }
      return stubWorkspace([configuredProfile])(path, init);
    });
    await screen.findByText('New scan — scope and tariff');

    expect(screen.getByRole('combobox', { name: /^Scan plan/ })).toHaveValue('Complete');
    await waitFor(() => {
      expect(screen.getByRole('spinbutton', { name: /^Maximum pages/ })).toHaveValue(120);
      expect(screen.getByRole('spinbutton', { name: /^Maximum crawl depth/ })).toHaveValue(6);
      expect(screen.getByRole('combobox', { name: /^User agent/ })).toHaveValue('mobile');
    });
    expect(screen.getByText('Saved · version 3')).toBeInTheDocument();
    expect(screen.getByText('What will run')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('spinbutton', { name: /^Maximum pages/ }), {
      target: { value: '80' },
    });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(
      screen.getByText(/Starting the check will save these settings as a new version/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            pathOf(input) === `/profiles/${configuredProfile.id}` &&
            (init as RequestInit | undefined)?.method === 'PATCH',
        ),
      ).toBe(true),
    );
    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        pathOf(input) === `/profiles/${configuredProfile.id}` &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(bodyOf(patchCall?.[1] as RequestInit)).toMatchObject({
      expectedProfileConfigVersion: 3,
      scanConfig: {
        plan: 'Complete',
        scope: {
          includeSubdomains: true,
          maxPages: 80,
          maxDepth: 6,
          queryPolicy: 'include',
          respectRobots: true,
          robotsOverrideConfirmed: false,
          userAgent: 'mobile',
        },
      },
    });
  });

  it('offers the saved profiles and a way out of the list', async () => {
    renderNewScan(stubWorkspace([savedProfile]));
    await screen.findByText('New scan — scope and tariff');

    const picker = screen.getByRole('combobox', { name: /^Profile/ });
    expect(picker).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Another site address…' })).toBeInTheDocument();
    // The address field belongs to that option, not to the saved profile.
    expect(screen.queryByRole('textbox', { name: /^Site address/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Scans the site address saved on this profile/)).toBeInTheDocument();
  });

  it('drops the saved-profile hint when the address option is chosen', async () => {
    renderNewScan(stubWorkspace([savedProfile]));
    await screen.findByText('New scan — scope and tariff');

    fireEvent.change(screen.getByRole('combobox', { name: /^Profile/ }), {
      target: { value: 'new-address' },
    });

    expect(
      screen.queryByText(/Scans the site address saved on this profile/),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/FluxRadar saves this address as a profile/)).toBeInTheDocument();
  });

  it('checks an unsaved address while a saved profile exists', async () => {
    const fetchMock = renderNewScan((path, init) => {
      if (path === '/profiles/resolve')
        return envelope({ profile: createdProfile, created: false });
      return stubWorkspace([savedProfile])(path, init);
    });
    await screen.findByText('New scan — scope and tariff');

    fireEvent.change(screen.getByRole('combobox', { name: /^Profile/ }), {
      target: { value: 'new-address' },
    });
    fireEvent.change(await screen.findByRole('textbox', { name: /^Site address/ }), {
      target: { value: 'mysite.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run free check' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input]) => pathOf(input) === `/profiles/${createdProfile.id}/free-check`,
        ),
      ).toBe(true),
    );
    // Never the profile that happened to be selected before.
    expect(
      fetchMock.mock.calls.some(
        ([input]) => pathOf(input) === `/profiles/${savedProfile.id}/free-check`,
      ),
    ).toBe(false);
  });

  it('opens a saved profile on the settings its last check used', async () => {
    // An internal account is the one that can actually pick Complete here — a
    // plan a signed-out storefront does not offer is not in the list, and a
    // select cannot report a value it has no option for.
    renderNewScan((path, init) =>
      path === '/auth/me'
        ? envelope({ ...account, internalFreeAccess: true })
        : stubWorkspace([savedProfile])(path, init),
    );
    await screen.findByText('New scan — scope and tariff');

    // Paid settings are only visible on a paid plan; the note is not.
    expect(
      await screen.findByText('Settings carried over from your last check of this site.'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: /^Scan plan/ }), {
      target: { value: 'Complete' },
    });

    expect(screen.getByRole('spinbutton', { name: /^Maximum pages/ })).toHaveValue(42);
    expect(screen.getByRole('spinbutton', { name: /^Maximum crawl depth/ })).toHaveValue(2);
    expect(screen.getByRole('textbox', { name: /^Include path patterns/ })).toHaveValue('/docs/*');
    expect(screen.getByRole('textbox', { name: /^Exclude path patterns/ })).toHaveValue('/admin/*');
    expect(screen.getByRole('combobox', { name: /^User agent/ })).toHaveValue('mobile');
  });

  it('opens on the defaults, and says nothing about a carry-over, for a site with no history', async () => {
    renderNewScan((path, init) => {
      if (path === '/profiles/profile-1/scans') return envelope([]);
      return stubWorkspace([savedProfile])(path, init);
    });
    await screen.findByText('New scan — scope and tariff');

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /^User agent/ })).toHaveValue('desktop'),
    );
    expect(
      screen.queryByText('Settings carried over from your last check of this site.'),
    ).not.toBeInTheDocument();
  });
});
