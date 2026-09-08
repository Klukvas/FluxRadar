import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

// What the new-scan form is allowed to offer on the Free plan.
//
// Free is the fixed homepage check: the crawler reads one page, follows no
// links, leaves subdomains alone and obeys robots.txt, whatever the request
// says (apps/api/src/orchestrator/run-attempt.ts). The form used to collect
// "include subdomains" and a robots.txt override on that plan anyway, so the
// owner set two things that were silently discarded and had no way to find out.
//
// The controls a plan does not reach are therefore not shown on it, and the
// screen says in words what the free check does instead. Nothing about the paid
// plans changes — the second half of this file is what proves that.

const account = { accountId: 'account-1', email: 'operator@example.com' };
const internalAccount = { ...account, internalFreeAccess: true };
const profile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };

const scan = {
  id: 'scan-1',
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

function renderNewScan(acct: object, language: 'en' | 'uk' = 'en'): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = pathOf(input);
    if (path === '/auth/me') return Promise.resolve(envelope(acct));
    if (path === '/profiles') return Promise.resolve(envelope([profile]));
    if (path === '/scans/active') return Promise.resolve(envelope(null));
    if (path === '/profiles/profile-1/scans') return Promise.resolve(envelope([]));
    if (path.endsWith('/free-check')) return Promise.resolve(envelope(scan));
    if (path === '/billing/dev-checkout') return Promise.resolve(envelope({ scanId: scan.id }));
    if (path.startsWith('/scans/')) return Promise.resolve(envelope(scan));
    void init;
    return Promise.resolve(envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.setItem('fluxradar.language', language);
  window.history.replaceState(null, '', '/scan');
  render(<App />);
  return fetchMock;
}

const PAID_ONLY_CONTROLS = [
  ['include subdomains', /Include subdomains/],
  ['maximum pages', /^Maximum pages/],
  ['maximum crawl depth', /^Maximum crawl depth/],
  ['include patterns', /^Include path patterns/],
  ['exclude patterns', /^Exclude path patterns/],
  ['URL query parameters', /^URL query parameters/],
  ['robots.txt', /Respect robots\.txt/],
  ['AI consent', /Allow sending public pages/],
] as const;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('free plan controls', () => {
  it.each(PAID_ONLY_CONTROLS)('does not offer %s on Free', async (_label, pattern) => {
    renderNewScan(account);
    await screen.findByText('New scan — scope and tariff');

    expect(screen.queryByLabelText(pattern)).not.toBeInTheDocument();
  });

  it('explains what the free check actually reads', async () => {
    renderNewScan(account);
    await screen.findByText('New scan — scope and tariff');

    expect(screen.getByText('What the free check does')).toBeInTheDocument();
    expect(screen.getByText(/reads your homepage and nothing else/)).toBeInTheDocument();
    expect(screen.getByText('Homepage only')).toBeInTheDocument();
    expect(screen.getByText('Always respected')).toBeInTheDocument();
    expect(
      screen.getByText(/belong to the paid plans and are not available on Free/),
    ).toBeInTheDocument();
  });

  it('explains it in Ukrainian too', async () => {
    renderNewScan(account, 'uk');
    await screen.findByText('Нова перевірка — область і тариф');

    expect(screen.getByText('Що робить безкоштовна перевірка')).toBeInTheDocument();
    expect(screen.getByText(/читає лише головну сторінку/)).toBeInTheDocument();
    expect(screen.getByText('Лише головна')).toBeInTheDocument();
    expect(screen.getByText(/недоступні на Free/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Включати піддомени/)).not.toBeInTheDocument();
  });

  // The request says the same thing the screen says. The server decides this
  // for itself (apps/api/src/scans/free-scan-scope.ts); what must not happen is
  // the browser asking for limits that would be quietly replaced.
  it('asks for the homepage check and nothing more', async () => {
    const fetchMock = renderNewScan(account);
    await screen.findByText('New scan — scope and tariff');

    fireEvent.click(screen.getByRole('button', { name: 'Run free check' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => pathOf(input).endsWith('/free-check'))).toBe(
        true,
      ),
    );
    const call = fetchMock.mock.calls.find(([input]) => pathOf(input).endsWith('/free-check'));
    expect(bodyOf(call?.[1] as RequestInit)).toEqual({
      scope: {
        includeSubdomains: false,
        maxPages: 1,
        maxDepth: 0,
        queryPolicy: 'ignore',
        respectRobots: true,
        robotsOverrideConfirmed: false,
        userAgent: 'desktop',
      },
    });
  });
});

describe('paid plan controls', () => {
  it('keeps every crawl control the paid plans do reach', async () => {
    renderNewScan(internalAccount);
    await screen.findByText('New scan — scope and tariff');

    // An internal account opens on Complete, so the paid controls are the
    // starting state rather than something that has to be switched on.
    for (const [, pattern] of PAID_ONLY_CONTROLS) {
      expect(screen.getByLabelText(pattern)).toBeInTheDocument();
    }
    expect(screen.queryByText('What the free check does')).not.toBeInTheDocument();
  });

  it('explains the optional AI visibility check before consent is given', async () => {
    renderNewScan(internalAccount);
    await screen.findByText('New scan — scope and tariff');

    const callout = screen.getByRole('region', { name: 'Optional AI visibility check' });
    expect(
      within(callout).getByText(/sends the public pages read by this scan to Anthropic/),
    ).toBeInTheDocument();
    expect(
      within(callout).getByText(/Leave it off and the AI SEO \/ GEO module will not run/),
    ).toBeInTheDocument();
    expect(within(callout).getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(within(callout).getByRole('link', { name: 'Terms of service' })).toHaveAttribute(
      'href',
      '/terms',
    );
    expect(within(callout).getByLabelText(/Allow sending public pages/)).toHaveAttribute(
      'aria-describedby',
      'ai-consent-description',
    );
  });

  it('localizes the optional AI visibility callout', async () => {
    renderNewScan(internalAccount, 'uk');
    await screen.findByText('Нова перевірка — область і тариф');

    const callout = screen.getByRole('region', { name: 'Необовʼязкова перевірка AI-видимості' });
    expect(within(callout).getByRole('link', { name: 'Політика приватності' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });

  it('sends the settings the owner set', async () => {
    const fetchMock = renderNewScan(internalAccount);
    await screen.findByText('New scan — scope and tariff');

    fireEvent.click(screen.getByLabelText(/Include subdomains/));
    fireEvent.change(screen.getByLabelText(/^Maximum pages/), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText(/^Maximum crawl depth/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/^Include path patterns/), {
      target: { value: '/docs/*' },
    });
    fireEvent.click(screen.getByLabelText(/Allow sending public pages/));
    fireEvent.click(screen.getByRole('button', { name: 'Run internal scan' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => pathOf(input) === '/billing/dev-checkout'),
      ).toBe(true),
    );
    const call = fetchMock.mock.calls.find(([input]) => pathOf(input) === '/billing/dev-checkout');
    expect(bodyOf(call?.[1] as RequestInit)).toMatchObject({
      siteProfileId: profile.id,
      plan: 'Complete',
      scope: {
        includeSubdomains: true,
        maxPages: 30,
        maxDepth: 2,
        urlPatterns: ['/docs/*'],
        queryPolicy: 'ignore',
        respectRobots: true,
        robotsOverrideConfirmed: false,
        userAgent: 'desktop',
      },
    });
  });

  // Switching down to Free must not smuggle the paid settings out with it.
  it('drops back to the homepage check when the plan changes to Free', async () => {
    const fetchMock = renderNewScan(internalAccount);
    await screen.findByText('New scan — scope and tariff');

    fireEvent.click(screen.getByLabelText(/Include subdomains/));
    fireEvent.click(screen.getByLabelText(/Respect robots\.txt/));
    fireEvent.change(screen.getByRole('combobox', { name: /^Scan plan/ }), {
      target: { value: 'Free' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run free check' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => pathOf(input).endsWith('/free-check'))).toBe(
        true,
      ),
    );
    const call = fetchMock.mock.calls.find(([input]) => pathOf(input).endsWith('/free-check'));
    expect(bodyOf(call?.[1] as RequestInit)).toEqual({
      scope: {
        includeSubdomains: false,
        maxPages: 1,
        maxDepth: 0,
        queryPolicy: 'ignore',
        respectRobots: true,
        robotsOverrideConfirmed: false,
        userAgent: 'desktop',
      },
    });
  });
});
