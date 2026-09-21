import { saveCookieConsent } from './browser-consent';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { PLAN_URL_LIMIT } from './plan-modules';

// What the new-scan form does with a page count that cannot be run as typed.
//
// Both halves of this used to end at the same place — a scan nobody asked for.
// A value the API would refuse (0, -3, 2.5) was dropped from the payload, and a
// dropped limit does not mean "no answer" to the server: it means the plan's
// whole allowance, so one mistyped digit turned a 15-page check into a
// 5,000-page one. A value from the last check of a site was carried forward
// whatever plan was chosen next, so a site last read on Complete and re-checked
// on Basic asked for more pages than Basic sells and came back as a 400 written
// for a developer, after the checkout had opened.
//
// The typo is now named on the field before anything is requested; the
// carried-over limit moves to the plan the owner just chose, where they can see
// it.

const internalAccount = {
  accountId: 'account-1',
  email: 'operator@example.com',
  internalFreeAccess: true,
};
const profile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };
/** A second saved site, so the prefill can arrive with a plan already chosen. */
const otherProfile = { id: 'profile-2', name: 'Other Site', domain: 'https://other.example.com' };

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

/** A previous check of the saved profile, whose settings the form opens on. */
function lastScanWith(maxPages: number, maxDepth: number) {
  return {
    ...scan,
    id: 'scan-last',
    status: 'Completed',
    scope: {
      includeSubdomains: false,
      maxPages,
      maxDepth,
      queryPolicy: 'ignore' as const,
      respectRobots: true,
      robotsOverrideConfirmed: false,
      userAgent: 'desktop' as const,
    },
  };
}

const lastModestScan = lastScanWith(42, 3);
/** The same site, last read on Complete-sized limits Basic does not sell. */
const lastCompleteScan = lastScanWith(20_000, 6);

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function pathOf(input: RequestInfo | URL): string {
  return new URL(String(input)).pathname;
}

function bodyOf(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

/**
 * The new-scan screen for an internal account, which opens on Complete and can
 * start a paid-sized scan without a checkout standing in the way.
 */
function renderNewScan(
  history: readonly object[] = [lastModestScan],
  language: 'en' | 'uk' = 'en',
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = pathOf(input);
    void init;
    if (path === '/auth/me') return Promise.resolve(envelope(internalAccount));
    if (path === '/profiles') return Promise.resolve(envelope([profile]));
    if (path === '/scans/active') return Promise.resolve(envelope(null));
    if (path === `/profiles/${profile.id}/scans`) return Promise.resolve(envelope(history));
    if (path === '/billing/dev-checkout') return Promise.resolve(envelope({ scanId: scan.id }));
    if (path.startsWith('/scans/')) return Promise.resolve(envelope(scan));
    return Promise.resolve(envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  saveCookieConsent({ preferences: true, analytics: false });
  window.localStorage.setItem('fluxradar.language', language);
  window.history.replaceState(null, '', '/scan');
  render(<App />);
  return fetchMock;
}

/**
 * The same screen with two saved sites, each with its own last check.
 *
 * Switching between them is how a prefill can land while a plan is already
 * chosen: the read is a request, so its answer arrives after the choice rather
 * than before it.
 */
function renderNewScanWithTwoSites(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = pathOf(input);
    void init;
    if (path === '/auth/me') return Promise.resolve(envelope(internalAccount));
    if (path === '/profiles') return Promise.resolve(envelope([profile, otherProfile]));
    if (path === '/scans/active') return Promise.resolve(envelope(null));
    if (path === `/profiles/${profile.id}/scans`)
      return Promise.resolve(envelope([lastModestScan]));
    if (path === `/profiles/${otherProfile.id}/scans`)
      return Promise.resolve(envelope([lastCompleteScan]));
    if (path === '/billing/dev-checkout') return Promise.resolve(envelope({ scanId: scan.id }));
    if (path.startsWith('/scans/')) return Promise.resolve(envelope(scan));
    return Promise.resolve(envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  saveCookieConsent({ preferences: true, analytics: false });
  window.localStorage.setItem('fluxradar.language', 'en');
  window.history.replaceState(null, '', '/scan');
  render(<App />);
  return fetchMock;
}

function chooseSite(id: string): void {
  fireEvent.change(screen.getByRole('combobox', { name: /^Profile/ }), { target: { value: id } });
}

function choosePlan(value: 'Free' | 'Basic' | 'Complete'): void {
  fireEvent.change(screen.getByRole('combobox', { name: /^Scan plan/ }), { target: { value } });
}

const pagesField = () => screen.getByRole('spinbutton', { name: /^Maximum pages/ });
const depthField = () => screen.getByRole('spinbutton', { name: /^Maximum crawl depth/ });

/**
 * Waits for the form to open on the last check's settings.
 *
 * That read is a request, so it lands after the first render and would
 * otherwise overwrite whatever a test typed before it arrived.
 */
async function openedOn(maxPages: number): Promise<void> {
  await waitFor(() => expect(pagesField()).toHaveValue(maxPages));
}
function runScan(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Run internal scan' }));
}
const checkoutCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([input]) => pathOf(input) === '/billing/dev-checkout');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('a page count the API would refuse', () => {
  it.each([
    ['zero', '0'],
    ['negative', '-3'],
  ])('stops the scan and says so when the page count is %s', async (_label, value) => {
    const fetchMock = renderNewScan();
    await screen.findByText('New scan — scope and tariff');
    await openedOn(42);

    fireEvent.change(pagesField(), { target: { value } });
    runScan();

    const announced = await screen.findByRole('alert');
    expect(announced).toHaveTextContent('Enter a whole number of pages, 1 or more');
    expect(pagesField()).toHaveAttribute('aria-invalid', 'true');
    // Nothing was requested: on a real account this is where a checkout opens.
    expect(checkoutCalls(fetchMock)).toHaveLength(0);
  });

  // A fraction never reaches the submit handler: the number control counts in
  // whole pages, so the browser refuses the submission itself. The message would
  // be the same one, and `scan-scope.test.ts` covers the value directly.
  it('never asks for half a page', async () => {
    const fetchMock = renderNewScan();
    await screen.findByText('New scan — scope and tariff');
    await openedOn(42);

    fireEvent.change(pagesField(), { target: { value: '2.5' } });
    runScan();

    expect((pagesField() as HTMLInputElement).validity.stepMismatch).toBe(true);
    expect(checkoutCalls(fetchMock)).toHaveLength(0);
  });

  it('says the same about a crawl depth, and leaves the page count alone', async () => {
    renderNewScan();
    await screen.findByText('New scan — scope and tariff');
    await openedOn(42);

    fireEvent.change(depthField(), { target: { value: '-1' } });
    runScan();

    expect(await screen.findByText(/Enter a whole crawl depth, 0 or more/)).toBeInTheDocument();
    expect(depthField()).toHaveAttribute('aria-invalid', 'true');
    expect(pagesField()).not.toHaveAttribute('aria-invalid');
  });

  // Depth counts from the homepage, so zero is an answer there rather than a typo.
  it('accepts a crawl depth of zero', async () => {
    const fetchMock = renderNewScan();
    await screen.findByText('New scan — scope and tariff');
    await openedOn(42);

    fireEvent.change(depthField(), { target: { value: '0' } });
    runScan();

    await waitFor(() => expect(checkoutCalls(fetchMock)).toHaveLength(1));
    expect(bodyOf(checkoutCalls(fetchMock)[0]?.[1] as RequestInit)).toMatchObject({
      scope: { maxDepth: 0 },
    });
  });

  it('withdraws the message when the field is corrected, and runs the scan', async () => {
    const fetchMock = renderNewScan();
    await screen.findByText('New scan — scope and tariff');
    await openedOn(42);

    fireEvent.change(pagesField(), { target: { value: '0' } });
    runScan();
    await screen.findByRole('alert');

    fireEvent.change(pagesField(), { target: { value: '30' } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(pagesField()).not.toHaveAttribute('aria-invalid');

    runScan();

    await waitFor(() => expect(checkoutCalls(fetchMock)).toHaveLength(1));
    expect(bodyOf(checkoutCalls(fetchMock)[0]?.[1] as RequestInit)).toMatchObject({
      scope: { maxPages: 30 },
    });
  });

  it('names the mistake in the language the form is read in', async () => {
    renderNewScan([lastModestScan], 'uk');
    await screen.findByText('Нова перевірка — область і тариф');
    await waitFor(() =>
      expect(screen.getByRole('spinbutton', { name: /^Максимум сторінок/ })).toHaveValue(42),
    );

    fireEvent.change(screen.getByRole('spinbutton', { name: /^Максимум сторінок/ }), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Запустити внутрішню перевірку' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Введіть ціле число сторінок');
  });
});

describe('a carried-over scope larger than the chosen plan', () => {
  it('brings a carried-over Complete limit down to what Basic sells', async () => {
    renderNewScan([lastCompleteScan]);
    await screen.findByText('New scan — scope and tariff');
    await openedOn(20_000);

    choosePlan('Basic');

    expect(pagesField()).toHaveValue(PLAN_URL_LIMIT.Basic);
  });

  it('asks for a scan Basic can run, instead of one the API refuses', async () => {
    const fetchMock = renderNewScan([lastCompleteScan]);
    await screen.findByText('New scan — scope and tariff');
    await openedOn(20_000);

    choosePlan('Basic');
    runScan();

    await waitFor(() => expect(checkoutCalls(fetchMock)).toHaveLength(1));
    expect(bodyOf(checkoutCalls(fetchMock)[0]?.[1] as RequestInit)).toMatchObject({
      plan: 'Basic',
      scope: { maxPages: PLAN_URL_LIMIT.Basic, maxDepth: 6 },
    });
  });

  // The other half of the same problem: the plan was chosen first and the
  // carried-over settings arrived afterwards. The payload was already clamped,
  // so the scan was right — but the form showed a page count Basic does not
  // sell right up until the checkout quietly replaced it.
  it('brings a prefill that lands on an already-chosen Basic down to what Basic sells', async () => {
    renderNewScanWithTwoSites();
    await screen.findByText('New scan — scope and tariff');
    await openedOn(42);

    choosePlan('Basic');
    chooseSite(otherProfile.id);

    await waitFor(() => expect(pagesField()).toHaveValue(PLAN_URL_LIMIT.Basic));
    expect(depthField()).toHaveValue(6);
  });

  it('asks for the scan the form is showing, not the one that was carried over', async () => {
    const fetchMock = renderNewScanWithTwoSites();
    await screen.findByText('New scan — scope and tariff');
    await openedOn(42);

    choosePlan('Basic');
    chooseSite(otherProfile.id);
    await waitFor(() => expect(pagesField()).toHaveValue(PLAN_URL_LIMIT.Basic));
    runScan();

    await waitFor(() => expect(checkoutCalls(fetchMock)).toHaveLength(1));
    expect(bodyOf(checkoutCalls(fetchMock)[0]?.[1] as RequestInit)).toMatchObject({
      plan: 'Basic',
      scope: { maxPages: PLAN_URL_LIMIT.Basic },
    });
  });

  // Nothing is trimmed that the chosen plan can actually run: the same prefill
  // arriving on Complete keeps every page it was checked with.
  it('leaves a prefill alone when the chosen plan sells it', async () => {
    renderNewScanWithTwoSites();
    await screen.findByText('New scan — scope and tariff');
    await openedOn(42);

    chooseSite(otherProfile.id);

    await waitFor(() => expect(pagesField()).toHaveValue(20_000));
  });

  // Switching back up must find the plan it switched to, not the one it left.
  it('keeps the full limits when the plan stays on Complete', async () => {
    const fetchMock = renderNewScan([lastCompleteScan]);
    await screen.findByText('New scan — scope and tariff');
    await openedOn(20_000);

    runScan();

    await waitFor(() => expect(checkoutCalls(fetchMock)).toHaveLength(1));
    expect(bodyOf(checkoutCalls(fetchMock)[0]?.[1] as RequestInit)).toMatchObject({
      plan: 'Complete',
      scope: { maxPages: 20_000 },
    });
  });
});
