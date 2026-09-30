import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

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
