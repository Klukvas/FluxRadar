// The owner's path through the product, end to end in the browser app: the
// site typed on the home page, the plan picked on the pricing cards, the
// confirmation link opened while signed in, the account screen, and the
// report's way from "what is wrong" to "fix this first".

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { saveCookieConsent } from './browser-consent';

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
  it('turns the typed site into a profile and starts its free check once the account exists', async () => {
    let registered = false;
    const fetchMock = stubApi((path, init) => {
      if (path === '/auth/me')
        return registered ? envelope(account) : failure(401, 'UNAUTHORIZED', 'no');
      if (path === '/auth/register') {
        registered = true;
        return envelope(account, 201);
      }
      if (path === '/profiles/resolve') return envelope({ profile, created: true }, 201);
      if (path === '/profiles') return envelope(registered ? [profile] : []);
      if (path === `/profiles/${profile.id}/free-check` && init?.method === 'POST')
        return envelope({ ...freeScan, status: 'Running', completedAt: null }, 201);
      return envelope(null);
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });

    fireEvent.change(screen.getByRole('textbox', { name: 'Your website' }), {
      target: { value: 'shop.example.com/pricing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run a free homepage check' }));

    const dialog = await screen.findByRole('dialog');
    // The dialog says what will happen to the site the visitor typed.
    expect(dialog).toHaveTextContent('checks the homepage of shop.example.com straight away');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Email' }), {
      target: { value: account.email },
    });
    fireEvent.change(within(dialog).getByLabelText('Password'), {
      target: { value: 'valid-password' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(window.location.pathname).toBe(`/scans/${freeScan.id}`));
    expect(calls(fetchMock, '/profiles/resolve', 'POST')[0]).toContain(
      '"domain":"https://shop.example.com"',
    );
    expect(calls(fetchMock, `/profiles/${profile.id}/free-check`, 'POST')).toHaveLength(1);
  });

  it('opens the scan form with the reason when the typed site has had its free check', async () => {
    let registered = false;
    stubApi((path, init) => {
      if (path === '/auth/me')
        return registered ? envelope(account) : failure(401, 'UNAUTHORIZED', 'no');
      if (path === '/auth/register') {
        registered = true;
        return envelope(account, 201);
      }
      if (path === '/profiles/resolve') return envelope({ profile, created: true }, 201);
      if (path === '/profiles') return envelope(registered ? [profile] : []);
      if (path === `/profiles/${profile.id}/free-check` && init?.method === 'POST')
        return failure(
          409,
          'FREE_CHECK_DOMAIN_USED',
          'this domain has already received a free check',
        );
      return envelope(null);
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });

    fireEvent.change(screen.getByRole('textbox', { name: 'Your website' }), {
      target: { value: 'shop.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run a free homepage check' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Email' }), {
      target: { value: account.email },
    });
    fireEvent.change(within(dialog).getByLabelText('Password'), {
      target: { value: 'valid-password' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(window.location.pathname).toBe('/scan'));
    expect(await screen.findByText(/This site has already had its free check/)).toBeInTheDocument();
    expect(screen.getByText(/Yours is still unused/)).toBeInTheDocument();
    expect(screen.queryByText(/already received a free check/)).not.toBeInTheDocument();
  });

  it('refuses an address that is not a website before asking for an account', async () => {
    stubApi((path) => (path === '/auth/me' ? failure(401, 'UNAUTHORIZED', 'no') : envelope(null)));
    render(<App />);
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });

    fireEvent.change(screen.getByRole('textbox', { name: 'Your website' }), {
      target: { value: 'not a website' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run a free homepage check' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a public website address');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });

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
    const planSelect = (await screen.findByRole('combobox', {
      name: /Scan plan/i,
    })) as HTMLSelectElement;
    await waitFor(() => expect(planSelect.value).toBe('Basic'));
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

  it('shows an unconfirmed owner the banner and resends the link from it', async () => {
    const fetchMock = stubApi((path) => {
      if (path === '/auth/me') return envelope({ ...account, emailVerified: false });
      if (path === '/profiles') return envelope([profile]);
      if (path === '/auth/resend-verification') return envelope({ status: 'accepted' }, 202);
      if (path === '/scans') return envelope([], 200, { total: 0, page: 1, limit: 1 });
      return envelope(null);
    });
    window.history.replaceState(null, '', '/profiles');
    render(<App />);

    const banner = (await screen.findByText(/Confirm your email: we sent a link/)).closest('div');
    if (banner === null) throw new Error('expected the banner');
    fireEvent.click(within(banner as HTMLElement).getByRole('button', { name: 'Send again' }));

    expect(await screen.findByText(/Sent to owner@example.com/)).toBeInTheDocument();
    expect(calls(fetchMock, '/auth/resend-verification', 'POST')[0]).toContain(account.email);
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
    // Most urgent first, by name — not by rule id.
    expect(items[0]).toHaveTextContent('Page title is missing or the wrong length');
    expect(items[1]).toHaveTextContent('Meta description is missing or the wrong length');

    fireEvent.click(
      within(block as HTMLElement).getByRole('button', {
        name: 'Show findings: Meta description is missing or the wrong length',
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
    expect(
      await screen.findByText('Problem: Meta description is missing or the wrong length'),
    ).toBeInTheDocument();
  });

  it('offers the paid scan of the same site on the plan that reads it all', async () => {
    renderReport();
    window.history.replaceState(null, '', `/scans/${freeScan.id}`);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Run Complete for this site' }));

    await waitFor(() => expect(window.location.pathname).toBe('/scan'));
    const target = (await screen.findByRole('combobox', { name: /^Profile/ })) as HTMLSelectElement;
    expect(target.value).toBe(profile.id);
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
