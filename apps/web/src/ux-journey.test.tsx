// The owner's path through the product, end to end in the browser app: the
// site typed on the home page, the plan picked on the pricing cards, the
// confirmation link opened while signed in, the account screen, and the
// report's way from "what is wrong" to "fix this first".

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { saveCookieConsent } from './browser-consent';
import { copy } from './i18n';
import { COMPLETE_PRICE } from './tariff-prices';
import { checkedPlan } from './new-scan-test-support';

const account = { accountId: 'account-1', email: 'owner@example.com' };
const profile = { id: 'profile-1', name: 'Shop', domain: 'https://shop.example.com' };

const freeScan = {
  id: 'scan-free-1',
  profileId: profile.id,
  plan: 'Free' as const,
  domain: profile.domain,
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-v1',
  progress: { completedModules: 1, totalModules: 1 },
  startedAt: '2026-09-18T10:00:00.000Z',
  completedAt: '2026-09-18T10:01:00.000Z',
  createdAt: '2026-09-18T10:00:00.000Z',
  modules: [
    {
      module: 'SEO',
      status: 'Completed',
      statusReason: null,
      coverage: 1,
      score: null,
      applicableChecks: 4,
      completedApplicableChecks: 4,
      usableOutput: true,
      metadata: { scoring: 'NotScoredOnFreePlan' },
    },
  ],
};

const summary = {
  total: 3,
  open: 3,
  bySeverity: { Critical: 0, High: 1, Medium: 2, Low: 0 },
  groups: [
    { ruleId: 'SEO-ONPAGE-001', module: 'SEO', severity: 'High', issues: 1, openIssues: 1 },
    { ruleId: 'SEO-ONPAGE-002', module: 'SEO', severity: 'Medium', issues: 2, openIssues: 2 },
  ],
};

function envelope<T>(data: T, status = 200, meta?: Record<string, number>): Response {
  return new Response(
    JSON.stringify({ success: true, data, error: null, ...(meta ? { meta } : {}) }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
}

function failure(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ success: false, data: null, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Handler = (path: string, init: RequestInit | undefined, search: string) => Response;

function stubApi(handler: Handler): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    return Promise.resolve(handler(url.pathname, init, url.search));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function calls(fetchMock: ReturnType<typeof vi.fn>, path: string, method = 'GET'): string[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => {
      const url = new URL(String(input));
      return (
        url.pathname === path && ((init as RequestInit | undefined)?.method ?? 'GET') === method
      );
    })
    .map(
      ([input, init]) =>
        `${new URL(String(input)).search}|${String((init as RequestInit | undefined)?.body ?? '')}`,
    );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('the home page carries what the visitor asked for through sign-up', () => {
  /** Types an address on the home page and creates an account in the dialog it opens. */
  async function checkSiteAndRegister(): Promise<void> {
    render(<App />);
    await screen.findByRole('heading', {
      name: 'Online website audit: SEO, AI visibility and what to fix first',
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Your website address' }), {
      target: { value: 'shop.example.com/pricing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check my site' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('shop.example.com');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Email' }), {
      target: { value: account.email },
    });
    fireEvent.change(within(dialog).getByLabelText('Password'), {
      target: { value: 'valid-password' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
  }

  const runningScan = { ...freeScan, status: 'Running', completedAt: null, modules: [] };
  const reachable = { state: 'reachable', canPurchase: true, checkedAt: null };

  /**
   * The API a new visitor meets. Every route the automatic start uses can be
   * overridden; `registered` flips when the account is created.
   */
  function newVisitorApi(
    routes: Partial<Record<string, () => Response>> = {},
  ): ReturnType<typeof vi.fn> {
    let registered = false;
    return stubApi((path, init) => {
      const override = routes[path];
      if (override !== undefined) return override();
      if (path === '/auth/me')
        return registered ? envelope(account) : failure(401, 'UNAUTHORIZED', 'no');
      if (path === '/auth/register') {
        registered = true;
        return envelope(account, 201);
      }
      if (path === '/profiles/resolve') return envelope({ profile, created: true }, 201);
      if (path === `/profiles/${profile.id}/reachability`) return envelope(reachable);
      if (path === `/profiles/${profile.id}/free-check`) return envelope(runningScan, 201);
      if (path === '/profiles') return envelope(registered ? [profile] : []);
      if (path === `/scans/${freeScan.id}` && init?.method === undefined)
        return envelope(runningScan);
      return envelope(null);
    });
  }

  /** The writes in the order they were sent, by path. */
  function postedPaths(fetchMock: ReturnType<typeof vi.fn>): string[] {
    return fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
      .map(([input]) => new URL(String(input)).pathname);
  }

  // Of the first twenty-one accounts, eleven never saved a site: the address
  // they had typed opened a form that asked for it again. The check now starts.
  it('starts the free check of a typed site the moment the account exists', async () => {
    const fetchMock = newVisitorApi();
    await checkSiteAndRegister();

    await waitFor(() => expect(window.location.pathname).toBe(`/scans/${freeScan.id}`));
    // Saved, asked whether it answers, and only then started.
    expect(postedPaths(fetchMock)).toEqual([
      '/auth/register',
      '/profiles/resolve',
      `/profiles/${profile.id}/reachability`,
      `/profiles/${profile.id}/free-check`,
    ]);
    expect(calls(fetchMock, '/profiles/resolve', 'POST')).toEqual([
      `|${JSON.stringify({ domain: 'https://shop.example.com' })}`,
    ]);
    // The check alone, in the page's language: nobody has been shown the AI disclosure.
    expect(calls(fetchMock, `/profiles/${profile.id}/free-check`, 'POST')).toEqual([
      `|${JSON.stringify({ aiLanguage: 'en' })}`,
    ]);
    // The question is asked on the progress screen instead, and nothing is sent by showing it.
    expect(await screen.findByRole('button', { name: 'Yes, ask Claude' })).toBeInTheDocument();
    expect(calls(fetchMock, `/scans/${freeScan.id}/free-ai-preview`, 'POST')).toHaveLength(0);
  });

  it('opens the scan form with the reason when the free check is refused', async () => {
    newVisitorApi({
      [`/profiles/${profile.id}/free-check`]: () =>
        failure(409, 'FREE_CHECK_DOMAIN_USED', 'already checked'),
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await checkSiteAndRegister();

    await waitFor(() => expect(window.location.pathname).toBe('/scan'));
    // The site stays in the address, so a reload reopens the form on it.
    expect(new URLSearchParams(window.location.search).get('profile')).toBe(profile.id);
    // The reason in the page's language, not the API's English message.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      copy.en.newScan.freeCheckDomainUsedError,
    );
    errorLog.mockRestore();
  });

  // The free check is claimed the moment it starts and is never handed back: a
  // typo must not be able to use it up.
  it('starts nothing for a site that does not answer, and says why', async () => {
    const fetchMock = newVisitorApi({
      [`/profiles/${profile.id}/reachability`]: () =>
        envelope({ state: 'unreachable', canPurchase: false, checkedAt: null }),
    });
    await checkSiteAndRegister();

    await waitFor(() => expect(window.location.pathname).toBe('/scan'));
    expect(calls(fetchMock, `/profiles/${profile.id}/free-check`, 'POST')).toHaveLength(0);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      copy.en.reachability.states.unreachable.label,
    );
  });

  it('falls back to the add-a-site form, address kept, when the site cannot be saved', async () => {
    const fetchMock = newVisitorApi({
      '/profiles/resolve': () => failure(503, 'UNAVAILABLE', 'try later'),
      '/profiles': () => envelope([]),
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await checkSiteAndRegister();

    await waitFor(() => expect(window.location.pathname).toBe('/profiles'));
    expect(new URLSearchParams(window.location.search).get('add')).toBe('https://shop.example.com');
    expect(await screen.findByDisplayValue('https://shop.example.com')).toBeInTheDocument();
    expect(calls(fetchMock, `/profiles/${profile.id}/free-check`, 'POST')).toHaveLength(0);
    errorLog.mockRestore();
  });

  it('says it is checking the site while the site is being asked', async () => {
    newVisitorApi({
      // The site takes its time: the window has to be there meanwhile.
      [`/profiles/${profile.id}/reachability`]: () => {
        throw new Error('never answered in this test');
      },
    });
    let release: (value: Response) => void = () => {};
    const slow = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.mocked(fetch);
    const answer = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input, init) =>
      new URL(String(input)).pathname === `/profiles/${profile.id}/reachability`
        ? slow
        : (answer as NonNullable<typeof answer>)(input, init),
    );
    await checkSiteAndRegister();

    const status = await screen.findByRole('dialog', { name: 'Checking your site' });
    expect(status).toHaveTextContent('shop.example.com');
    // The focus is on it, not on the covered button that started it.
    expect(within(status).getByRole('heading', { name: 'Checking your site' })).toHaveFocus();
    release(envelope({ state: 'reachable', canPurchase: true, checkedAt: null }));
    await waitFor(() => expect(window.location.pathname).toBe(`/scans/${freeScan.id}`));
    expect(screen.queryByRole('dialog', { name: 'Checking your site' })).toBeNull();
  });

  it('refuses an address that is not a website before asking for an account', async () => {
    stubApi((path) => (path === '/auth/me' ? failure(401, 'UNAUTHORIZED', 'no') : envelope(null)));
    render(<App />);
    await screen.findByRole('heading', {
      name: 'Online website audit: SEO, AI visibility and what to fix first',
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Your website address' }), {
      target: { value: 'not a website' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check my site' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a public website address');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /** An owner already signed in, on the public home page. */
  async function typeSiteAsOwner(owner: Record<string, unknown>) {
    const fetchMock = stubApi((path, init) => {
      if (path === '/auth/me') return envelope(owner);
      if (path === '/profiles') return envelope([profile]);
      if (path === '/profiles/resolve') return envelope({ profile, created: false });
      if (path === `/profiles/${profile.id}/reachability`)
        return envelope({ state: 'reachable', canPurchase: true, checkedAt: null });
      if (path === `/profiles/${profile.id}/free-check`)
        return envelope({ ...freeScan, status: 'Running', completedAt: null, modules: [] }, 201);
      if (path === `/scans/${freeScan.id}` && init?.method === undefined)
        return envelope({ ...freeScan, status: 'Running', completedAt: null, modules: [] });
      return envelope(null);
    });
    window.history.replaceState(null, '', '/');
    render(<App />);
    const field = await screen.findByRole('textbox', { name: 'Your website address' });
    fireEvent.change(field, { target: { value: 'shop.example.com' } });
    return fetchMock;
  }

  // A returning owner whose free check is spent: a check that would only be
  // refused is no reason to save a site behind their back.
  it('gives a signed-in owner with a spent free check the form, and saves nothing', async () => {
    const fetchMock = await typeSiteAsOwner({ ...account, freeCheckUsed: true });
    fireEvent.click(screen.getByRole('button', { name: 'Check my site' }));

    await waitFor(() => expect(window.location.pathname).toBe('/profiles'));
    expect(new URLSearchParams(window.location.search).get('add')).toBe('https://shop.example.com');
    expect(postedPaths(fetchMock)).toEqual([]);
  });

  // The free check used in another tab since this one read the account.
  it('asks the server, not its own old copy, whether the free check is still unused', async () => {
    let reads = 0;
    const fetchMock = stubApi((path) => {
      if (path === '/auth/me') {
        reads += 1;
        return envelope(reads === 1 ? account : { ...account, freeCheckUsed: true });
      }
      if (path === '/profiles') return envelope([profile]);
      return envelope(null);
    });
    window.history.replaceState(null, '', '/');
    render(<App />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your website address' }), {
      target: { value: 'shop.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check my site' }));

    await waitFor(() => expect(window.location.pathname).toBe('/profiles'));
    expect(postedPaths(fetchMock)).toEqual([]);
  });

  it('starts one check however often a signed-in owner presses the button', async () => {
    const fetchMock = await typeSiteAsOwner(account);
    const button = screen.getByRole('button', { name: 'Check my site' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(window.location.pathname).toBe(`/scans/${freeScan.id}`));
    expect(calls(fetchMock, '/profiles/resolve', 'POST')).toHaveLength(1);
    expect(calls(fetchMock, `/profiles/${profile.id}/free-check`, 'POST')).toHaveLength(1);
  });

  it('opens the scan form on the plan picked on the pricing cards', async () => {
    let registered = false;
    stubApi((path) => {
      if (path === '/auth/me')
        return registered ? envelope(account) : failure(401, 'UNAUTHORIZED', 'no');
      if (path === '/auth/register') {
        registered = true;
        return envelope({ ...account, internalFreeAccess: true }, 201);
      }
      if (path === '/profiles') return envelope([profile]);
      return envelope(null);
    });
    render(<App />);
    await screen.findByRole('heading', {
      name: 'Online website audit: SEO, AI visibility and what to fix first',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start with Basic' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Email' }), {
      target: { value: account.email },
    });
    fireEvent.change(within(dialog).getByLabelText('Password'), {
      target: { value: 'valid-password' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(window.location.pathname).toBe('/scan'));
    const basic = await screen.findByRole('radio', { name: /^Basic/ });
    await waitFor(() => expect(basic).toBeChecked());
  });
});

describe('an email confirmation link opened in a signed-in browser', () => {
  it('confirms the address and says so, instead of leaving an empty workspace', async () => {
    const fetchMock = stubApi((path) => {
      if (path === '/auth/me') return envelope({ ...account, emailVerified: false });
      if (path === '/profiles') return envelope([profile]);
      if (path === '/auth/verify-email') return envelope({ status: 'verified' });
      if (path === '/scans') return envelope([], 200, { total: 0, page: 1, limit: 1 });
      return envelope(null);
    });
    window.history.replaceState(null, '', '/?verify_email=token-123');
    render(<App />);

    expect(
      await screen.findByText('Your email is verified. You can return to FluxRadar.'),
    ).toBeInTheDocument();
    expect(calls(fetchMock, '/auth/verify-email')[0]).toContain('token=token-123');
    expect(window.location.pathname).toBe('/profiles');
    // The "confirm your email" banner is gone with the reason for it.
    expect(screen.queryByText(/Confirm your email: we sent a link/)).not.toBeInTheDocument();
  });

  it('shows an unconfirmed owner a neutral banner after reload and accepts a resend request', async () => {
    const fetchMock = stubApi((path) => {
      if (path === '/auth/me') return envelope({ ...account, emailVerified: false });
      if (path === '/profiles') return envelope([profile]);
      if (path === '/auth/resend-verification') return envelope({ status: 'accepted' }, 202);
      if (path === '/scans') return envelope([], 200, { total: 0, page: 1, limit: 1 });
      return envelope(null);
    });
    window.history.replaceState(null, '', '/profiles');
    render(<App />);

    const banner = (
      await screen.findByText(
        'Confirm your email at owner@example.com. The link that resets a forgotten password goes only there. Check your inbox or ask for a new link.',
      )
    ).closest('div');
    if (banner === null) throw new Error('expected the banner');
    fireEvent.click(within(banner as HTMLElement).getByRole('button', { name: 'Send again' }));

    expect(
      await screen.findByText(
        'A confirmation request for owner@example.com was accepted. The link is valid for 24 hours if delivery is available.',
      ),
    ).toBeInTheDocument();
    expect(calls(fetchMock, '/auth/resend-verification', 'POST')[0]).toContain(account.email);
  });

  it('only says a confirmation link was sent when the signed-in registration response says so', async () => {
    stubApi((path) => {
      if (path === '/auth/me')
        return envelope({
          ...account,
          emailVerified: false,
          emailVerification: { status: 'sent' },
        });
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans') return envelope([], 200, { total: 0, page: 1, limit: 1 });
      return envelope(null);
    });
    window.history.replaceState(null, '', '/profiles');
    render(<App />);

    expect(
      await screen.findByText(
        'Confirm your email: we sent a link to owner@example.com. The link that resets a forgotten password goes only there — confirming is how we know the address works.',
      ),
    ).toBeInTheDocument();
  });
});

describe('the account screen', () => {
  function renderAccount(
    handler?: (path: string, init: RequestInit | undefined, search: string) => Response | undefined,
  ) {
    const fetchMock = stubApi((path, init, search) => {
      const handled = handler?.(path, init, search);
      if (handled) return handled;
      if (path === '/auth/me') return envelope({ ...account, emailVerified: true });
      if (path === '/profiles') return envelope([profile]);
      if (path === '/account/purchases')
        return envelope([
          {
            id: 'purchase-1',
            plan: 'Complete',
            status: 'paid',
            amount: 120,
            currency: 'USD',
            createdAt: '2026-09-10T10:00:00.000Z',
            domain: profile.domain,
            profileName: profile.name,
            entitlementExpiresAt: '2026-10-10T10:00:00.000Z',
            scanId: 'scan-paid-1',
            scanStatus: 'Completed',
          },
        ]);
      return envelope(null);
    });
    window.history.replaceState(null, '', '/account');
    render(<App />);
    return fetchMock;
  }

  it('is reached from the address in the header and lists what was bought', async () => {
    renderAccount();
    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeInTheDocument();
    expect(await screen.findByText('$120.00')).toBeInTheDocument();
    expect(screen.getByText('shop.example.com')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account: owner@example.com' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('marks a wrong current password on its field and keeps the owner signed in', async () => {
    renderAccount((path) =>
      path === '/account/password'
        ? failure(400, 'CURRENT_PASSWORD_INCORRECT', 'current password is incorrect')
        : undefined,
    );
    await screen.findByRole('heading', { name: 'Your account' });

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByLabelText(/^New password/), {
      target: { value: 'another-horse-2' },
    });
    fireEvent.change(screen.getByLabelText('Repeat the new password'), {
      target: { value: 'another-horse-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('The current password is not correct.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your account' })).toBeInTheDocument();
  });

  it('checks the new password twice before sending it', async () => {
    const fetchMock = renderAccount();
    await screen.findByRole('heading', { name: 'Your account' });

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'current-1' } });
    fireEvent.change(screen.getByLabelText(/^New password/), {
      target: { value: 'another-horse-2' },
    });
    fireEvent.change(screen.getByLabelText('Repeat the new password'), {
      target: { value: 'another-horse-3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('The two new passwords are different.')).toBeInTheDocument();
    expect(calls(fetchMock, '/account/password', 'POST')).toEqual([]);
  });

  it('deletes the account only after the address is typed, then leaves the workspace', async () => {
    const fetchMock = renderAccount((path, init) =>
      path === '/account' && init?.method === 'DELETE' ? envelope({ deleted: true }) : undefined,
    );
    await screen.findByRole('heading', { name: 'Your account' });
    const button = screen.getByRole('button', { name: 'Delete my account' });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText(`Type ${account.email} to confirm`), {
      target: { value: account.email.toUpperCase() },
    });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(await screen.findByText('Your account and its data were deleted.')).toBeInTheDocument();
    expect(calls(fetchMock, '/account', 'DELETE')).toHaveLength(1);
    expect(window.location.pathname).toBe('/');
  });
});

describe('a Free report', () => {
  function renderReport() {
    saveCookieConsent({ preferences: true, analytics: false });
    return stubApi((path) => {
      if (path === '/auth/me') return envelope({ ...account, emailVerified: true });
      if (path === '/profiles') return envelope([profile]);
      if (path === `/scans/${freeScan.id}`) return envelope(freeScan);
      if (path === `/scans/${freeScan.id}/dashboard`)
        return envelope({
          scan: freeScan,
          overall: { verdict: 'unscored', score: null, weightedCoverage: 0, moduleWeights: [] },
          modules: freeScan.modules,
        });
      if (path === `/scans/${freeScan.id}/issues/summary`) return envelope(summary);
      // A deployment that can sell a scan, so the form can open on a paid plan.
      if (path === '/billing/checkout-config')
        return envelope({
          provider: 'creem',
          available: true,
          mode: 'test',
          unavailableReason: null,
          plans: [
            { plan: 'Basic', priceUsd: 39, currency: 'USD' },
            // The Free report's upsell opens Complete (D-236).
            { plan: 'Complete', priceUsd: 87, currency: 'USD' },
          ],
        });
      if (path === `/scans/${freeScan.id}/issues`)
        return envelope([], 200, { total: 0, page: 1, limit: 50 });
      return envelope(null);
    });
  }

  it('names the problems to fix first and opens the Issue Center on the one chosen', async () => {
    const fetchMock = renderReport();
    window.history.replaceState(null, '', `/scans/${freeScan.id}`);
    render(<App />);

    const block = (await screen.findByRole('heading', { name: 'Fix these first' })).closest(
      'section',
    );
    if (block === null) throw new Error('expected the fix-first block');
    const items = within(block as HTMLElement).getAllByRole('listitem');
    // Most urgent first, by name — not by rule id, and by the plain name the
    // Issue Center uses rather than the rule's technical title, so the block
    // and the list it links to name one problem once (rule-naming.test.tsx).
    expect(items[0]).toHaveTextContent(
      'Page name for search results is missing, too short or too long',
    );
    expect(items[1]).toHaveTextContent(
      'Page summary for search results is missing or the wrong length',
    );

    fireEvent.click(
      within(block as HTMLElement).getByRole('button', {
        name: 'Where exactly and how to fix: Page summary for search results is missing or the wrong length',
      }),
    );

    await waitFor(() => expect(window.location.pathname).toBe(`/scans/${freeScan.id}/issues`));
    await waitFor(() =>
      expect(
        calls(fetchMock, `/scans/${freeScan.id}/issues`).some((call) =>
          call.includes('ruleId=SEO-ONPAGE-002'),
        ),
      ).toBe(true),
    );
    // The Issue Center opened on that one problem. Its name is the heading over
    // the addresses (`IssueTable`), so this line only says what the list is —
    // said here too, the name stood twice on the screen, one line apart.
    expect(await screen.findByText('Showing one problem only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to all problems' })).toBeInTheDocument();
  });

  // D-236 owner decision: the Free report's upsell opens Complete (was Basic).
  it('offers a Complete scan of the same site, opening the form on Complete', async () => {
    renderReport();
    window.history.replaceState(null, '', `/scans/${freeScan.id}`);
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: `Run the complete verification for ${COMPLETE_PRICE}`,
      }),
    );

    await waitFor(() => expect(window.location.pathname).toBe('/scan'));
    const target = (await screen.findByRole('combobox', { name: /^Site/ })) as HTMLSelectElement;
    expect(target.value).toBe(profile.id);
    // The plan cards are radios named `scan-plan`; the Complete card is the one
    // chosen, and no other card is.
    await waitFor(() => expect(screen.getByRole('radio', { name: /^Complete/ })).toBeChecked());
    expect(checkedPlan()).toBe('Complete');
  });

  it('opens a printable client report of the scan', async () => {
    renderReport();
    window.history.replaceState(null, '', `/scans/${freeScan.id}`);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Printable report' }));

    await waitFor(() => expect(window.location.pathname).toBe(`/scans/${freeScan.id}/report`));
    expect(
      await screen.findByRole('heading', { name: 'Public website audit of shop.example.com' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toBeEnabled();
  });
});

describe('the scan form for a site that never saved its settings', () => {
  it('says the configuration is new instead of loading forever', async () => {
    stubApi((path) => {
      if (path === '/auth/me') return envelope({ ...account, emailVerified: true });
      if (path === '/profiles') return envelope([profile]);
      if (path === `/profiles/${profile.id}/scans`) return envelope([]);
      return envelope(null);
    });
    window.history.replaceState(null, '', '/scan');
    render(<App />);

    expect(await screen.findByText('New configuration')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('Configuration is loading…')).not.toBeInTheDocument(),
    );
  });
});

describe('a report with a section that came back incomplete', () => {
  const partialScan = {
    ...freeScan,
    id: 'scan-partial-1',
    plan: 'Complete' as const,
    status: 'Partial',
    retry: { platform: 0, module: 0 },
  };

  function stubPartial(): ReturnType<typeof vi.fn> {
    let retried = false;
    return stubApi((path, init) => {
      if (path === '/auth/me') return envelope({ ...account, emailVerified: true });
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans') return envelope([partialScan], 200, { total: 1, page: 1, limit: 1 });
      if (path === `/scans/${partialScan.id}/retry` && init?.method === 'POST') {
        retried = true;
        return envelope({ scanId: partialScan.id, status: 'Running', module: 'Performance' }, 202);
      }
      if (path === `/scans/${partialScan.id}`)
        return envelope(
          retried ? { ...partialScan, status: 'Running', completedAt: null } : partialScan,
        );
      if (path === `/scans/${partialScan.id}/dashboard`)
        return envelope({
          scan: partialScan,
          overall: { verdict: 'partial', score: 80, weightedCoverage: 0.8, moduleWeights: [] },
          modules: partialScan.modules,
        });
      if (path === `/scans/${partialScan.id}/issues/summary`) return envelope(summary);
      if (path === `/scans/${partialScan.id}/changes`)
        return envelope({
          previous: null,
          introduced: 0,
          fixed: 0,
          persisting: 0,
          introducedByRule: [],
          fixedByRule: [],
        });
      return envelope(null);
    });
  }

  it('offers the retry as the next step on the desktop and follows it', async () => {
    const fetchMock = stubPartial();
    window.history.replaceState(null, '', '/profiles');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry the unfinished section' }));

    await waitFor(() => expect(window.location.pathname).toBe(`/scans/${partialScan.id}`));
    expect(calls(fetchMock, `/scans/${partialScan.id}/retry`, 'POST')).toHaveLength(1);
  });

  it('offers the same retry on the report itself', async () => {
    const fetchMock = stubPartial();
    window.history.replaceState(null, '', `/scans/${partialScan.id}`);
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'A section could not be read' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry the unfinished section' }));

    await waitFor(() =>
      expect(calls(fetchMock, `/scans/${partialScan.id}/retry`, 'POST')).toHaveLength(1),
    );
  });
});
