// Paid GEO language choices retain their own checkout draft keys through retries.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { DEFAULT_SCOPE_FORM, profileScanConfigFromForm } from './scan-scope';
import { choosePlanCard } from './new-scan-test-support';

// Paid checkout in the UI.
//
// The invariant under test: the browser never creates a paid scan. It asks the
// server to open a Creem checkout, sends the tab to the hosted page, then polls
// a server-side status that only turns into a scan once the signed Creem
// webhook has been processed.

const account = { accountId: 'account-1', email: 'operator@example.com' };

const profile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };

const checkoutConfig = {
  provider: 'creem',
  available: true,
  mode: 'test' as const,
  unavailableReason: null,
  plans: [
    { plan: 'Basic', priceUsd: 39, currency: 'USD' },
    { plan: 'Complete', priceUsd: 87, currency: 'USD' },
  ],
};

function envelope<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The pay button is disabled until the API says this site lets the crawler in,
 * so every paid-checkout stub has to answer the reachability read. Answered
 * here rather than in each handler: these tests are about the checkout, and a
 * site that cannot be read is a different concern.
 */
function reachabilityEnvelope(): Response {
  return envelope({
    state: 'reachable',
    startStatus: 200,
    accessControlSignals: [],
    checkedAt: new Date().toISOString(),
    expired: false,
    canPurchase: true,
  });
}

function stubApi(handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/reachability')) return Promise.resolve(reachabilityEnvelope());
    return Promise.resolve(handler(path, init));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function selectPlan(plan: string): void {
  choosePlanCard(plan);
}

/**
 * Waits for the pay button to become usable.
 *
 * A paid scan is not offered until the API answers that this site lets the
 * crawler in, so pressing the button in the same tick as selecting the plan
 * would press a disabled one.
 */
async function awaitPayable(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Pay $87 and start' })).toBeEnabled(),
  );
}

async function openNewScan(
  handler: (path: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const fetchMock = stubApi(handler);
  render(<App />);
  await screen.findByText(account.email);
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
  await screen.findByText('My sites', { selector: '.window__titlebar > span' });
  fireEvent.click(screen.getByRole('button', { name: 'Check this site' }));
  await screen.findByText('New scan', { selector: '.window__titlebar > span' });
  return fetchMock;
}
beforeEach(() => {
  vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('paid checkout language and retries', () => {
  it('keeps the same draft key after its dirty configuration save increments the profile version', async () => {
    let savedProfile = {
      ...profile,
      scanConfigVersion: 1,
      scanConfig: profileScanConfigFromForm(DEFAULT_SCOPE_FORM, 'Free'),
    };
    const writes: number[] = [];
    const fetchMock = await openNewScan((path, init) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([{ ...savedProfile }]);
      if (path === '/billing/checkout-config') return envelope(checkoutConfig);
      if (path === `/profiles/${profile.id}/scans`) return envelope([]);
      if (path === `/profiles/${profile.id}` && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as {
          scanConfig: typeof savedProfile.scanConfig;
          expectedProfileConfigVersion: number;
        };
        writes.push(body.expectedProfileConfigVersion);
        if (JSON.stringify(body.scanConfig) !== JSON.stringify(savedProfile.scanConfig))
          savedProfile = {
            ...savedProfile,
            scanConfig: body.scanConfig,
            scanConfigVersion: savedProfile.scanConfigVersion + 1,
          };
        return envelope({ ...savedProfile });
      }
      if (path === '/billing/checkout-session')
        return Promise.reject(new TypeError('local lost response after persisted checkout'));
      return envelope(null);
    });
    await screen.findByRole('radio', { name: /^Complete/ });
    await screen.findByText('Saved · version 1');
    selectPlan('Complete');
    await awaitPayable();
    fireEvent.change(screen.getByRole('combobox', { name: 'AI SEO / GEO language' }), {
      target: { value: 'ru' },
    });
    const attempts = () =>
      fetchMock.mock.calls.filter(
        ([input]) => new URL(String(input)).pathname === '/billing/checkout-session',
      );
    for (const count of [1, 2]) {
      fireEvent.click(screen.getByRole('button', { name: 'Pay $87 and start' }));
      await waitFor(() => {
        expect(attempts()).toHaveLength(count);
        expect(screen.getByRole('button', { name: 'Pay $87 and start' })).toBeEnabled();
      });
    }
    expect(savedProfile.scanConfigVersion).toBe(2);
    expect(writes).toEqual([1, 2]);
    const first = attempts()[0]?.[1] as RequestInit;
    const retry = attempts()[1]?.[1] as RequestInit;
    expect(JSON.parse(String(first.body))).toMatchObject({
      expectedProfileConfigVersion: 2,
      aiLanguage: 'ru',
    });
    expect(retry.body).toBe(first.body);
    expect(new Headers(retry.headers).get('Idempotency-Key')).toBe(
      new Headers(first.headers).get('Idempotency-Key'),
    );
  });

  it('binds a key before a delayed profile save so editing language cannot reuse the old checkout', async () => {
    let releasePatch: (response: Response) => void = () => {
      throw new Error('profile PATCH has not started');
    };
    let patchCount = 0;
    const pendingPatch = new Promise<Response>((resolve) => {
      releasePatch = resolve;
    });
    const fetchMock = await openNewScan((path, init) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([profile]);
      if (path === '/billing/checkout-config') return envelope(checkoutConfig);
      if (path === `/profiles/${profile.id}/scans`) return envelope([]);
      if (path === `/profiles/${profile.id}` && init?.method === 'PATCH') {
        patchCount += 1;
        return patchCount === 1 ? pendingPatch : envelope({ ...profile, scanConfigVersion: 2 });
      }
      if (path === '/billing/checkout-session')
        return Promise.reject(new TypeError('local lost response'));
      return envelope(null);
    });
    selectPlan('Complete');
    await awaitPayable();
    fireEvent.change(screen.getByRole('combobox', { name: 'AI SEO / GEO language' }), {
      target: { value: 'ru' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pay $87 and start' }));
    await waitFor(() => expect(patchCount).toBe(1));
    fireEvent.change(screen.getByRole('combobox', { name: 'AI SEO / GEO language' }), {
      target: { value: 'uk' },
    });
    releasePatch(envelope({ ...profile, scanConfigVersion: 2 }));
    const attempts = () =>
      fetchMock.mock.calls.filter(
        ([input]) => new URL(String(input)).pathname === '/billing/checkout-session',
      );
    await waitFor(() => {
      expect(attempts()).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Pay $87 and start' })).toBeEnabled();
    });
    for (const count of [2, 3]) {
      fireEvent.click(screen.getByRole('button', { name: 'Pay $87 and start' }));
      await waitFor(() => {
        expect(attempts()).toHaveLength(count);
        expect(screen.getByRole('button', { name: 'Pay $87 and start' })).toBeEnabled();
      });
    }
    const keys = attempts().map((call) =>
      new Headers((call[1] as RequestInit).headers).get('Idempotency-Key'),
    );
    expect(keys[0]).toMatch(/^[a-f0-9]{32}$/);
    expect(keys[1]).not.toBe(keys[0]);
    expect(keys[2]).toBe(keys[1]);
    expect(
      attempts().map(
        (call) =>
          (JSON.parse(String((call[1] as RequestInit).body)) as { aiLanguage: string }).aiLanguage,
      ),
    ).toEqual(['ru', 'uk', 'uk']);
  });

  it('reuses the draft key on retries and replaces it when the selected GEO language changes', async () => {
    const fetchMock = await openNewScan((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([profile]);
      if (path === '/billing/checkout-config') return envelope(checkoutConfig);
      if (path === `/profiles/${profile.id}/scans`) return envelope([]);
      if (path === '/billing/checkout-session')
        return new Response(
          JSON.stringify({
            success: false,
            data: null,
            error: { code: 'LOCAL_RETRY', message: 'Local retry test' },
          }),
          { status: 502, headers: { 'content-type': 'application/json' } },
        );
      return envelope(null);
    });
    selectPlan('Complete');
    await awaitPayable();
    fireEvent.change(screen.getByRole('combobox', { name: 'AI SEO / GEO language' }), {
      target: { value: 'uk' },
    });
    const submit = async (count: number) => {
      fireEvent.click(screen.getByRole('button', { name: 'Pay $87 and start' }));
      await waitFor(() => {
        expect(
          fetchMock.mock.calls.filter(
            ([input]) => new URL(String(input)).pathname === '/billing/checkout-session',
          ),
        ).toHaveLength(count);
        expect(screen.getByRole('button', { name: 'Pay $87 and start' })).toBeEnabled();
      });
    };
    await submit(1);
    await submit(2);
    fireEvent.change(screen.getByRole('combobox', { name: 'AI SEO / GEO language' }), {
      target: { value: 'ru' },
    });
    await submit(3);
    const attempts = fetchMock.mock.calls.filter(
      ([input]) => new URL(String(input)).pathname === '/billing/checkout-session',
    );
    const keyOf = (index: number) =>
      new Headers((attempts[index]?.[1] as RequestInit).headers).get('Idempotency-Key');
    expect(keyOf(0)).toMatch(/^[a-f0-9]{32}$/);
    expect(keyOf(1)).toBe(keyOf(0));
    expect(keyOf(2)).not.toBe(keyOf(0));
    expect(
      attempts.map(
        (call) =>
          (JSON.parse(String((call[1] as RequestInit).body)) as { aiLanguage: string }).aiLanguage,
      ),
    ).toEqual(['uk', 'uk', 'ru']);
  });
});
