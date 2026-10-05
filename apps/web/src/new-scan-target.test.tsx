import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { NewScanScreen } from './NewScanScreen';

const account = { accountId: 'account-1', email: 'operator@example.com' };
const profile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };
const configuredProfile = {
  ...profile,
  scanConfigVersion: 3,
  scanConfig: {
    plan: 'Complete' as const,
    scope: {
      includeSubdomains: true,
      maxPages: 120,
      maxDepth: 6,
      renderJs: false,
      queryPolicy: 'include' as const,
      respectRobots: true,
      robotsOverrideConfirmed: false,
      userAgent: 'mobile' as const,
    },
  },
};
const freeScan = {
  id: 'scan-free-1',
  profileId: profile.id,
  plan: 'Free' as const,
  domain: profile.domain,
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

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    headers: { 'content-type': 'application/json' },
  });
}
function pathOf(input: RequestInfo | URL): string {
  return new URL(String(input)).pathname;
}
function bodyOf(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}
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
function workspace(profiles: readonly object[]) {
  return (path: string, init?: RequestInit): Response => {
    if (path === '/auth/me') return envelope(account);
    if (path === '/profiles') return envelope(profiles);
    if (path === '/scans/active') return envelope(null);
    if (path === `/profiles/${profile.id}/scans`) return envelope([]);
    if (path.endsWith('/free-check')) return envelope(freeScan);
    if (path.startsWith('/profiles/') && init?.method === 'PATCH') return envelope(profile);
    return envelope(null);
  };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('new scan requires a saved profile', () => {
  it('shows the profile CTA without rendering a target address field or resolving a profile', async () => {
    const fetchMock = renderNewScan(workspace([]));
    await screen.findByText('New scan — scope and tariff');
    expect(screen.getByRole('link', { name: 'Create profile' })).toHaveAttribute(
      'href',
      '/profiles',
    );
    expect(screen.queryByRole('textbox', { name: /^Site address/ })).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => pathOf(input) === '/profiles/resolve')).toBe(
      false,
    );
  });

  it('launches the selected saved profile without resolving or creating another profile', async () => {
    const fetchMock = renderNewScan(workspace([profile]));
    await screen.findByText('New scan — scope and tariff');
    fireEvent.click(screen.getByRole('button', { name: 'Run free check' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input]) => pathOf(input) === `/profiles/${profile.id}/free-check`,
        ),
      ).toBe(true),
    );
    expect(fetchMock.mock.calls.some(([input]) => pathOf(input) === '/profiles/resolve')).toBe(
      false,
    );
  });

  it('offers only saved profiles as targets', async () => {
    renderNewScan(workspace([profile]));
    await screen.findByText('New scan — scope and tariff');
    expect(screen.getByRole('combobox', { name: /^Profile/ })).toHaveValue(profile.id);
    expect(screen.queryByRole('option', { name: /Another site address/ })).toBeNull();
  });

  it('preserves an explicit saved render setting when configuration is loaded', async () => {
    renderNewScan((path, init) =>
      path === '/auth/me'
        ? envelope({ ...account, internalFreeAccess: true })
        : workspace([configuredProfile])(path, init),
    );
    await screen.findByText('New scan — scope and tariff');
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: /Read pages after their JavaScript/ }),
      ).not.toBeChecked(),
    );
  });

  // Owner walkthrough: "New scan" on the salon's row opened the form on another
  // site's saved settings. The row the owner pressed is the site being checked.
  it('opens on the site whose row "New scan" was pressed, not the first saved one', async () => {
    const salon = { id: 'profile-salon', name: 'Eva Grace', domain: 'https://evagrace.example' };
    const handler = workspace([configuredProfile, salon]);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(handler(pathOf(input), init)),
    );
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/profiles');
    render(<App />);

    const salonName = await screen.findByText('Eva Grace');
    const row = salonName.closest('.profile-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'New scan' }));

    await screen.findByText('New scan — scope and tariff');
    expect(screen.getByRole('combobox', { name: /^Profile/ })).toHaveValue(salon.id);
    expect(screen.getByText(/^Checking:/)).toHaveTextContent(
      'Checking: Eva Grace, https://evagrace.example, plan Free',
    );
  });

  it('keeps the "Checking" line beside the button in step with the profile and the plan', async () => {
    const salon = { id: 'profile-salon', name: 'Eva Grace', domain: 'https://evagrace.example' };
    renderNewScan((path, init) =>
      path === '/auth/me'
        ? envelope({ ...account, internalFreeAccess: true })
        : workspace([profile, salon])(path, init),
    );
    await screen.findByText('New scan — scope and tariff');
    expect(screen.getByText(/^Checking:/)).toHaveTextContent(
      'Checking: My Site, https://example.com, plan Complete',
    );

    fireEvent.change(screen.getByRole('combobox', { name: /^Profile/ }), {
      target: { value: salon.id },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /^Scan plan/ }), {
      target: { value: 'Basic' },
    });

    await waitFor(() =>
      expect(screen.getByText(/^Checking:/)).toHaveTextContent(
        'Checking: Eva Grace, https://evagrace.example, plan Basic',
      ),
    );
  });

  it('saves configuration only to the selected saved profile', async () => {
    const fetchMock = renderNewScan((path, init) =>
      path === '/auth/me'
        ? envelope({ ...account, internalFreeAccess: true })
        : workspace([configuredProfile])(path, init),
    );
    await screen.findByText('New scan — scope and tariff');
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            pathOf(input) === `/profiles/${profile.id}` && init?.method === 'PATCH',
        ),
      ).toBe(true),
    );
    const call = fetchMock.mock.calls.find(
      ([input, init]) => pathOf(input) === `/profiles/${profile.id}` && init?.method === 'PATCH',
    );
    expect(bodyOf(call?.[1] as RequestInit)).toMatchObject({ expectedProfileConfigVersion: 3 });
    expect(fetchMock.mock.calls.some(([input]) => pathOf(input) === '/profiles/resolve')).toBe(
      false,
    );
  });
});

// Owner walkthrough: a saved profile arrived with "robots.txt override:
// confirmed" and depth 31 that the owner never set. The API cannot store
// "ignore robots.txt" without its confirmation, and the form saves its settings
// before every launch, so one run's confirmation became every later run's
// default. The stored value is kept; the form never restores the confirmation.
describe('a robots.txt override restored from saved settings', () => {
  const overrideBox = { name: /Yes, read the pages robots\.txt asks crawlers to skip/ };
  const overriddenScope = {
    includeSubdomains: false,
    maxDepth: 31,
    renderJs: true,
    queryPolicy: 'ignore' as const,
    respectRobots: false,
    robotsOverrideConfirmed: true,
    userAgent: 'desktop' as const,
  };
  const overriddenProfile = {
    ...profile,
    scanConfigVersion: 4,
    scanConfig: { plan: 'Complete' as const, scope: overriddenScope },
  };
  const plainSite = {
    id: 'profile-plain',
    name: 'Plain Site',
    domain: 'https://plain.example',
    scanConfigVersion: 1,
    scanConfig: {
      plan: 'Complete' as const,
      scope: {
        ...overriddenScope,
        maxDepth: 5,
        respectRobots: true,
        robotsOverrideConfirmed: false,
      },
    },
  };
  function internalWorkspace(path: string, init?: RequestInit): Response {
    if (path === '/auth/me') return envelope({ ...account, internalFreeAccess: true });
    if (path === '/billing/internal-checkout') return envelope({ scanId: 'scan-paid-1' });
    if (path === '/scans/scan-paid-1') return envelope({ ...freeScan, id: 'scan-paid-1' });
    return workspace([overriddenProfile, plainSite])(path, init);
  }
  const purchases = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.filter(
      ([input]) => pathOf(input as RequestInfo) === '/billing/internal-checkout',
    );

  it('warns in the summary and holds the launch until the override is confirmed again', async () => {
    const fetchMock = renderNewScan(internalWorkspace);
    await screen.findByText('New scan — scope and tariff');

    const confirmation = await screen.findByRole('checkbox', overrideBox);
    expect(confirmation).not.toBeChecked();
    const warning = screen.getByText(/This scan will ignore robots\.txt/);
    expect(warning).toHaveTextContent(/not from anything you chose just now/);
    expect(screen.getByRole('button', { name: 'Run internal scan' })).toBeDisabled();
    // The box is read with the warning and with the reason the button is held.
    const describedBy = confirmation.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(describedBy).toContain(warning.id);
    expect(describedBy).toContain('launch-blocked');
    // Warning, tick and reason are all in the launch column beside the button,
    // not inside the folded crawl settings the tick used to live in.
    const actions = screen
      .getByRole('button', { name: 'Run internal scan' })
      .closest('.launch-form__actions');
    expect(actions).toContainElement(confirmation);
    expect(actions).toContainElement(warning);
    // The block holding the setting opens by itself, with the depth nobody chose in view.
    expect(screen.getByLabelText(/^Maximum crawl depth/)).toBeVisible();
    expect(screen.getByLabelText(/^Maximum crawl depth/)).toHaveValue(31);

    fireEvent.click(confirmation);
    expect(screen.getByText(/This scan will ignore robots\.txt/)).not.toHaveTextContent(
      /not from anything you chose just now/,
    );
    expect(confirmation).toHaveAttribute('aria-describedby', 'robots-override-warning');
    const launch = screen.getByRole('button', { name: 'Run internal scan' });
    expect(launch).toBeEnabled();
    fireEvent.click(launch);

    await waitFor(() => expect(purchases(fetchMock)).toHaveLength(1));
    expect(bodyOf(purchases(fetchMock)[0]?.[1] as RequestInit)).toMatchObject({
      scope: { respectRobots: false, robotsOverrideConfirmed: true, maxDepth: 31 },
    });
  });

  // The disabled button is not the only guard: Enter in a field submits too.
  it('starts nothing when the form is submitted without the confirmation', async () => {
    const fetchMock = renderNewScan(internalWorkspace);
    await screen.findByText('New scan — scope and tariff');
    await screen.findByRole('checkbox', overrideBox);

    fireEvent.submit(
      screen.getByRole('button', { name: 'Run internal scan' }).closest('form') as HTMLFormElement,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(purchases(fetchMock)).toHaveLength(0);
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      ),
    ).toBe(false);
  });

  it('withdraws a confirmation when the site changes, and asks again on coming back', async () => {
    renderNewScan(internalWorkspace);
    await screen.findByText('New scan — scope and tariff');
    fireEvent.click(await screen.findByRole('checkbox', overrideBox));
    expect(screen.getByRole('button', { name: 'Run internal scan' })).toBeEnabled();

    const site = screen.getByRole('combobox', { name: /^Profile/ });
    fireEvent.change(site, { target: { value: plainSite.id } });
    await waitFor(() => expect(screen.queryByRole('checkbox', overrideBox)).toBeNull());
    fireEvent.change(site, { target: { value: overriddenProfile.id } });

    await waitFor(() => expect(screen.getByRole('checkbox', overrideBox)).not.toBeChecked());
    expect(screen.getByRole('button', { name: 'Run internal scan' })).toBeDisabled();
  });

  // The real server: a PATCH that changes the configuration bumps its version,
  // and the profile list re-read afterwards carries the bumped profile.
  function savingServer(launch: 'succeeds' | 'fails') {
    let stored: object = overriddenProfile;
    return (path: string, init?: RequestInit): Response => {
      if (path === `/profiles/${profile.id}` && init?.method === 'PATCH') {
        stored = {
          ...overriddenProfile,
          scanConfigVersion: 5,
          scanConfig: bodyOf(init).scanConfig,
        };
        return envelope(stored);
      }
      if (path === '/profiles') return envelope([stored, plainSite]);
      if (path === '/billing/internal-checkout' && launch === 'fails') {
        return new Response(
          JSON.stringify({
            success: false,
            data: null,
            error: { code: 'TEST_ERROR', message: 'Checkout is down' },
          }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        );
      }
      return internalWorkspace(path, init);
    };
  }

  it("keeps a confirmation given here through the owner's own save", async () => {
    renderNewScan(savingServer('succeeds'));
    await screen.findByText('New scan — scope and tariff');
    fireEvent.click(await screen.findByRole('checkbox', overrideBox));
    fireEvent.change(screen.getByLabelText(/^Maximum crawl depth/), { target: { value: '7' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    await screen.findByText('Saved · version 5');
    expect(screen.getByRole('checkbox', overrideBox)).toBeChecked();
    expect(screen.getByLabelText(/^Maximum crawl depth/)).toHaveValue(7);
    expect(screen.getByRole('button', { name: 'Run internal scan' })).toBeEnabled();
    expect(screen.queryByText(/confirm it again before launching/)).toBeNull();
  });

  it('keeps it through a launch that saved the settings and then failed', async () => {
    renderNewScan(savingServer('fails'));
    await screen.findByText('New scan — scope and tariff');
    fireEvent.click(await screen.findByRole('checkbox', overrideBox));
    fireEvent.change(screen.getByLabelText(/^Maximum crawl depth/), { target: { value: '7' } });

    fireEvent.click(screen.getByRole('button', { name: 'Run internal scan' }));

    await screen.findByText('Saved · version 5');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Run internal scan' })).toBeEnabled(),
    );
    expect(screen.getByRole('checkbox', overrideBox)).toBeChecked();
  });

  it('reads as saved, and rewrites nothing, just by opening the form', async () => {
    const fetchMock = renderNewScan(internalWorkspace);
    await screen.findByText('New scan — scope and tariff');
    await screen.findByRole('checkbox', overrideBox);

    expect(screen.getByText('Saved · version 4')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      ),
    ).toBe(false);
  });
});

// The note over the carried-over crawl settings says two things: where the
// values came from, and that the block is open because some of them differ
// from the safe default. The second half is only true where one of them does —
// a profile whose saved settings hold nothing but defaults carries them all the
// same, and whoever unfolds the block there by hand would be read a reason that
// never happened.
describe('the note over carried-over crawl settings', () => {
  const CARRIED = /came from this site’s saved settings/;
  const defaultsProfile = {
    ...profile,
    scanConfigVersion: 2,
    scanConfig: {
      plan: 'Complete' as const,
      scope: {
        includeSubdomains: false,
        maxDepth: 5,
        renderJs: true,
        queryPolicy: 'ignore' as const,
        respectRobots: true,
        robotsOverrideConfirmed: false,
        userAgent: 'desktop' as const,
      },
    },
  };
  function internalWith(saved: object) {
    return (path: string, init?: RequestInit): Response =>
      path === '/auth/me'
        ? envelope({ ...account, internalFreeAccess: true })
        : workspace([saved])(path, init);
  }

  it('says where a value nobody chose on this screen came from', async () => {
    renderNewScan(internalWith(configuredProfile));
    await screen.findByText('New scan — scope and tariff');

    // The saved mobile user agent and depth 6 open the block by themselves.
    expect(await screen.findByText(CARRIED)).toBeVisible();
    expect(screen.getByLabelText(/^User agent/)).toBeVisible();
  });

  it('says nothing when the saved settings hold the safe defaults', async () => {
    renderNewScan(internalWith(defaultsProfile));
    await screen.findByText('New scan — scope and tariff');
    await waitFor(() => expect(screen.getByText('Saved · version 2')).toBeInTheDocument());

    // Carried over all the same — the settings came from the profile — but
    // none of them differs, so nothing opened the block.
    expect(screen.getByLabelText(/^User agent/)).not.toBeVisible();
    expect(screen.queryByText(CARRIED)).toBeNull();

    // Opened by hand, the block still has no reason to explain: the owner's
    // own click is why it is open.
    const block = screen
      .getByText('For experienced users')
      .closest('details') as HTMLDetailsElement;
    block.open = true;
    fireEvent(block, new Event('toggle'));
    expect(screen.getByLabelText(/^User agent/)).toBeVisible();
    expect(screen.queryByText(CARRIED)).toBeNull();
  });
});

describe('the simple view', () => {
  it('folds the crawl settings when they hold the defaults, and still sends them', async () => {
    const fetchMock = renderNewScan((path, init) =>
      path === '/auth/me'
        ? envelope({ ...account, internalFreeAccess: true })
        : path === '/billing/internal-checkout'
          ? envelope({ scanId: 'scan-paid-1' })
          : workspace([profile])(path, init),
    );
    await screen.findByText('New scan — scope and tariff');

    expect(screen.getByText('For experienced users')).toBeVisible();
    expect(screen.getByLabelText(/^User agent/)).not.toBeVisible();
    expect(screen.getByLabelText(/Include subdomains/)).not.toBeVisible();
    expect(screen.getByLabelText(/^Maximum pages/)).not.toBeVisible();
    expect(screen.getByLabelText(/Respect robots\.txt/)).not.toBeVisible();
    // The site, the plan and the button are what the screen opens on.
    expect(screen.getByRole('combobox', { name: /^Profile/ })).toBeVisible();
    expect(screen.getByRole('combobox', { name: /^Scan plan/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run internal scan' })).toBeVisible();

    // A value changed inside the folded block is part of the scan all the same.
    fireEvent.change(screen.getByLabelText(/^User agent/), { target: { value: 'mobile' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run internal scan' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => pathOf(input) === '/billing/internal-checkout'),
      ).toBe(true),
    );
    const purchase = fetchMock.mock.calls.find(
      ([input]) => pathOf(input) === '/billing/internal-checkout',
    );
    expect(bodyOf(purchase?.[1] as RequestInit)).toMatchObject({
      scope: { userAgent: 'mobile', respectRobots: true, maxDepth: 5 },
    });
  });

  // A folded field cannot take focus, so a rejected page count unfolds the
  // block before the form moves the owner to it.
  it('unfolds the block and focuses a rejected page count', async () => {
    const fetchMock = renderNewScan((path, init) =>
      path === '/auth/me'
        ? envelope({ ...account, internalFreeAccess: true })
        : workspace([profile])(path, init),
    );
    await screen.findByText('New scan — scope and tariff');
    const pages = screen.getByLabelText(/^Maximum pages/);
    expect(pages).not.toBeVisible();

    // Zero, not 2.5: a fraction is already refused by the browser's own
    // number-field check before the form's handler runs.
    fireEvent.change(pages, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run internal scan' }));

    await waitFor(() => expect(screen.getByLabelText(/^Maximum pages/)).toBeVisible());
    expect(screen.getByLabelText(/^Maximum pages/)).toHaveFocus();
    expect(
      fetchMock.mock.calls.some(([input]) => pathOf(input) === '/billing/internal-checkout'),
    ).toBe(false);
  });

  // Start URLs live in "Advanced crawl rules", folded by default: a rejected
  // line unfolds it before the form moves the owner there.
  it('unfolds the crawl rules and focuses a rejected start URL', async () => {
    const fetchMock = renderNewScan((path, init) =>
      path === '/auth/me'
        ? envelope({ ...account, internalFreeAccess: true })
        : workspace([profile])(path, init),
    );
    await screen.findByText('New scan — scope and tariff');
    const seeds = screen.getByLabelText(/^Start URLs/);
    expect(seeds).not.toBeVisible();

    fireEvent.change(seeds, { target: { value: 'not a url' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run internal scan' }));

    await waitFor(() => expect(screen.getByLabelText(/^Start URLs/)).toBeVisible());
    expect(screen.getByLabelText(/^Start URLs/)).toHaveFocus();
    expect(
      fetchMock.mock.calls.some(([input]) => pathOf(input) === '/billing/internal-checkout'),
    ).toBe(false);
  });

  it('opens the crawl rules on a saved configuration with start URLs', async () => {
    renderNewScan((path, init) =>
      path === '/auth/me'
        ? envelope({ ...account, internalFreeAccess: true })
        : workspace([
            {
              ...configuredProfile,
              scanConfig: {
                ...configuredProfile.scanConfig,
                scope: {
                  ...configuredProfile.scanConfig.scope,
                  queryPolicy: 'ignore' as const,
                  seedUrls: ['https://example.com/pricing'],
                },
              },
            },
          ])(path, init),
    );
    await screen.findByText('New scan — scope and tariff');

    await waitFor(() => expect(screen.getByLabelText(/^Start URLs/)).toBeVisible());
  });

  it('opens the block when a saved setting differs from the default', async () => {
    renderNewScan((path, init) =>
      path === '/auth/me'
        ? envelope({ ...account, internalFreeAccess: true })
        : workspace([configuredProfile])(path, init),
    );
    await screen.findByText('New scan — scope and tariff');

    await waitFor(() => expect(screen.getByLabelText(/^User agent/)).toBeVisible());
    expect(screen.getByLabelText(/^User agent/)).toHaveValue('mobile');
    expect(screen.getByLabelText(/Include subdomains/)).toBeChecked();
  });

  it('names the block and its explanations in Ukrainian too', async () => {
    window.history.replaceState(null, '', '/scan?lang=uk');
    const handler = (path: string, init?: RequestInit): Response =>
      path === '/auth/me'
        ? envelope({ ...account, internalFreeAccess: true })
        : workspace([profile])(path, init);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(handler(pathOf(input), init)),
      ),
    );
    render(<App />);
    await screen.findByText('Нова перевірка — область і тариф');

    expect(screen.getByText('Для досвідчених користувачів')).toBeVisible();
    expect(
      screen.getByText(/^Перевіряємо: My Site, https:\/\/example\.com, тариф Complete/),
    ).toBeVisible();
  });
});

describe('the site the form is opened on', () => {
  // The selection is app state set before navigating; a form that only read it
  // once at mount stayed on whichever site it picked first when the selection
  // (or the profile list) arrived a render later.
  it("follows a selection made after the form mounted, and keeps the owner's own pick", async () => {
    const salon = { id: 'profile-salon', name: 'Eva Grace', domain: 'https://evagrace.example' };
    const handler = workspace([profile, salon]);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(handler(pathOf(input), init)),
      ),
    );
    const props = {
      accountId: account.accountId,
      onCheckoutStarted: () => undefined,
      internalFreeAccess: false,
      language: 'en' as const,
      onCreated: () => undefined,
      onProfilesChanged: () => Promise.resolve(),
      onClose: () => undefined,
      onError: () => undefined,
    };
    const { rerender } = render(<NewScanScreen {...props} profiles={[]} selectedProfile={null} />);
    rerender(<NewScanScreen {...props} profiles={[profile, salon]} selectedProfile={salon} />);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /^Profile/ })).toHaveValue(salon.id),
    );

    fireEvent.change(screen.getByRole('combobox', { name: /^Profile/ }), {
      target: { value: profile.id },
    });
    // A refreshed list (after a save) must not drag the form back to the row's site.
    rerender(
      <NewScanScreen
        {...props}
        profiles={[{ ...profile }, { ...salon }]}
        selectedProfile={salon}
      />,
    );
    expect(screen.getByRole('combobox', { name: /^Profile/ })).toHaveValue(profile.id);
  });
});

describe('"New scan" from a site\'s report list', () => {
  it('opens on the site whose reports were listed, not the last site a scan was opened for', async () => {
    const salon = { id: 'profile-salon', name: 'Eva Grace', domain: 'https://evagrace.example' };
    const base = workspace([profile, salon]);
    // Every report list is empty: the list's own "start a check" is the way in.
    const handler = (path: string, init?: RequestInit): Response =>
      path === '/scans' || path.endsWith('/scans') ? envelope([]) : base(path, init);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(handler(pathOf(input), init)),
      ),
    );
    window.history.replaceState(null, '', '/profiles');
    render(<App />);
    const rowOf = async (name: string): Promise<HTMLElement> =>
      (await screen.findByText(name)).closest('.profile-row') as HTMLElement;

    // The salon's reports first: that is the list "Reports" goes back to.
    fireEvent.click(within(await rowOf('Eva Grace')).getByRole('button', { name: /Actions for/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reports' }));
    await screen.findByText('No reports for this profile yet');
    // Then a scan opened for the other site, and abandoned.
    fireEvent.click(screen.getByRole('button', { name: 'Profiles' }));
    fireEvent.click(within(await rowOf('My Site')).getByRole('button', { name: 'New scan' }));
    await screen.findByText('New scan — scope and tariff');
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }));
    // Back to the salon's list, and a scan from there.
    fireEvent.click(await screen.findByRole('button', { name: 'Reports' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Check a profile' }));

    await screen.findByText('New scan — scope and tariff');
    expect(screen.getByRole('combobox', { name: /^Profile/ })).toHaveValue(salon.id);
  });
});
