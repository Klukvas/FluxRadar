import { saveCookieConsent } from './browser-consent';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import type { EgressLaunchConfig } from './api';
import { readEgressLaunchConfig } from './egress-location';

// The country a check leaves from, on the real new-scan screen (D-228): what is
// on the list, what the launch asks for, and what the summary repeats back.

const internalAccount = {
  accountId: 'account-1',
  email: 'operator@example.com',
  internalFreeAccess: true,
};
const profile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };
const scan = {
  id: 'scan-1',
  profileId: profile.id,
  plan: 'Complete' as const,
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

const KYIV = {
  id: 'ua',
  countryCode: 'UA',
  city: 'Kyiv',
  label: { en: 'Ukraine, Kyiv', uk: 'Україна, Київ' },
};
const FRANKFURT = {
  id: 'de',
  countryCode: 'DE',
  city: 'Frankfurt',
  label: { en: 'Germany, Frankfurt', uk: 'Німеччина, Франкфурт' },
};

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function pathOf(input: RequestInfo | URL): string {
  return new URL(String(input)).pathname;
}

function renderNewScan(egress: EgressLaunchConfig): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = pathOf(input);
    if (path === '/auth/me') return Promise.resolve(envelope(internalAccount));
    if (path === '/profiles') return Promise.resolve(envelope([profile]));
    if (path === '/scans/active') return Promise.resolve(envelope(null));
    if (path === '/scans/launch-config') return Promise.resolve(envelope({ egress }));
    if (path === '/profiles/profile-1/scans') return Promise.resolve(envelope([]));
    if (path === '/billing/dev-checkout') return Promise.resolve(envelope({ scanId: scan.id }));
    if (path.startsWith('/scans/')) return Promise.resolve(envelope(scan));
    return Promise.resolve(envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  saveCookieConsent(true);
  window.localStorage.setItem('fluxradar.language', 'en');
  window.history.replaceState(null, '', '/scan');
  render(<App />);
  return fetchMock;
}

function summaryRow(label: string): Element | null {
  const summary = screen.getByText('What will run').closest('section') ?? document.body;
  return within(summary as HTMLElement).getByText(label).nextElementSibling;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('choosing the country a check runs from', () => {
  it('sends the country on screen with the launch, and repeats it in the summary', async () => {
    const fetchMock = renderNewScan({
      mode: 'proxy',
      locations: [KYIV, FRANKFURT],
      defaultLocationId: 'ua',
    });
    const select = await screen.findByRole('combobox', { name: /^Country the check runs from/ });
    expect(summaryRow('Checked from')).toHaveTextContent('Ukraine, Kyiv');

    fireEvent.change(select, { target: { value: 'de' } });
    expect(summaryRow('Checked from')).toHaveTextContent('Germany, Frankfurt');
    fireEvent.click(screen.getByRole('button', { name: 'Run internal scan' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => pathOf(input) === '/billing/dev-checkout'),
      ).toBe(true),
    );
    const call = fetchMock.mock.calls.find(([input]) => pathOf(input) === '/billing/dev-checkout');
    const body = JSON.parse(String((call?.[1] as RequestInit).body)) as {
      scope: Record<string, unknown>;
    };
    expect(body.scope.egressLocation).toBe('de');
  });

  it('will not start a scan while no country is answering, and says why', async () => {
    renderNewScan({ mode: 'proxy', locations: [], defaultLocationId: 'ua' });

    expect(await screen.findByText(/No check location is answering right now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run internal scan' })).toBeDisabled();
    expect(
      screen.getByText('A scan cannot start while no check location is answering.'),
    ).toBeInTheDocument();
  });
});

describe('reading the launch configuration', () => {
  it('accepts what the API sends', () => {
    expect(
      readEgressLaunchConfig({
        egress: { mode: 'proxy', locations: [KYIV], defaultLocationId: 'ua' },
      }),
    ).toEqual({ mode: 'proxy', locations: [KYIV], defaultLocationId: 'ua' });
  });

  it.each([
    [null],
    [[]],
    [{ egress: null }],
    [{ egress: { mode: 'vpn', locations: [], defaultLocationId: null } }],
    [{ egress: { mode: 'proxy', locations: [{ label: null }], defaultLocationId: null } }],
    [{ egress: { mode: 'proxy', locations: 'ua', defaultLocationId: 'ua' } }],
  ])('treats %j as a list it could not read, not as "nothing available"', (value) => {
    expect(readEgressLaunchConfig(value)).toBeNull();
  });
});
