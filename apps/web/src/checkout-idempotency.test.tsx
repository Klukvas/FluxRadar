// The client half of the checkout idempotency contract, through the real
// new-scan screen: one key per form draft, reused across retries of that
// draft, replaced when the draft changes, and cleared once the draft is
// consumed — so a retry after a lost response replays the server's stored
// checkout, and every new draft opens with its own key.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SiteProfile } from './api';
import { NewScanScreen } from './NewScanScreen';
import { choosePlanCard, queryPlanRadio } from './new-scan-test-support';

const PROFILE: SiteProfile = {
  id: 'profile-1',
  name: 'My Site',
  domain: 'https://example.com',
};

const CHECKOUT_SESSION = {
  reference: 'ref-1',
  sessionId: 'session-1',
  checkoutUrl: 'https://checkout.example/session-1',
  plan: 'Complete',
  amount: 8700,
  currency: 'USD',
  mode: 'test' as const,
  expiresAt: null,
};

function envelope<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorEnvelope(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ success: false, data: null, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * The endpoints every paid launch touches, answered the way a working
 * deployment would. The checkout-session endpoint itself is answered by the
 * per-test handler.
 */
function defaultHandler(pathname: string, init?: RequestInit): Response | null {
  if (pathname === '/billing/checkout-config') {
    return envelope({
      provider: 'creem',
      available: true,
      mode: 'test',
      unavailableReason: null,
      plans: ['Basic', 'Complete'].map((plan) => ({
        plan,
        priceUsd: 49,
        currency: 'USD',
        available: true,
      })),
      optInAiProviders: [],
    });
  }
  if (pathname.endsWith('/reachability')) {
    return envelope({
      state: 'reachable',
      checkedAt: '2026-09-20T00:00:00.000Z',
      canPurchase: true,
    });
  }
  // No egress list: the launch is not blocked on a location it was not offered.
  if (pathname === '/scans/launch-config') return envelope(null);
  if (init?.method === 'PATCH') return envelope({ ...PROFILE, scanConfigVersion: 1 });
  return null;
}

function checkoutSessionRequests(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([input]) => new URL(String(input)).pathname === '/billing/checkout-session',
  );
}

function idempotencyKeysOf(fetchMock: ReturnType<typeof vi.fn>): readonly (string | null)[] {
  return checkoutSessionRequests(fetchMock).map(([, init]) => {
    const headers = (init as RequestInit | undefined)?.headers;
    if (headers === undefined) return null;
    if (headers instanceof Headers) return headers.get('Idempotency-Key');
    return (headers as Record<string, string>)['Idempotency-Key'] ?? null;
  });
}

async function renderNewScan(
  checkoutSessionHandler: (call: number) => Response,
): Promise<{ fetchMock: ReturnType<typeof vi.fn> }> {
  let checkoutCalls = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = new URL(String(input));
    if (pathname === '/billing/checkout-session') {
      checkoutCalls += 1;
      return Promise.resolve(checkoutSessionHandler(checkoutCalls));
    }
    return Promise.resolve(defaultHandler(pathname, init) ?? envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <NewScanScreen
      accountId="account-1"
      profiles={[PROFILE]}
      selectedProfile={PROFILE}
      internalFreeAccess={false}
      language="en"
      initialPlan={null}
      onCreated={() => undefined}
      onCheckoutStarted={() => undefined}
      onProfilesChanged={() => Promise.resolve()}
      onClose={() => undefined}
      onError={() => undefined}
      onCreateProfile={() => undefined}
    />,
  );
  return { fetchMock };
}

/** Picks Complete once the picker offers it, and launches once the button arms. */
async function chooseCompleteAndLaunch(): Promise<void> {
  await waitFor(() => expect(queryPlanRadio('Complete')).not.toBeNull());
  choosePlanCard('Complete');
  const pay = await screen.findByRole('button', { name: /^Pay \$\d+ and start$/ });
  await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(pay);
}

describe('the checkout idempotency key', () => {
  it('reuses one key across retries of the same draft', async () => {
    const { fetchMock } = await renderNewScan((call) =>
      call === 1
        ? errorEnvelope('CREEM_API', 'Paid checkout is temporarily unavailable', 502)
        : envelope(CHECKOUT_SESSION, 201),
    );

    await chooseCompleteAndLaunch();
    await waitFor(() => expect(checkoutSessionRequests(fetchMock)).toHaveLength(1));

    await chooseCompleteAndLaunch();
    await waitFor(() => expect(checkoutSessionRequests(fetchMock)).toHaveLength(2));

    const keys = idempotencyKeysOf(fetchMock);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it('mints a new key once the draft changes', async () => {
    const { fetchMock } = await renderNewScan((call) =>
      call === 1
        ? errorEnvelope('CREEM_API', 'Paid checkout is temporarily unavailable', 502)
        : envelope(CHECKOUT_SESSION, 201),
    );

    await chooseCompleteAndLaunch();
    await waitFor(() => expect(checkoutSessionRequests(fetchMock)).toHaveLength(1));

    // The same plan card, chosen again, is still a change of the draft.
    choosePlanCard('Basic');
    await waitFor(() => expect(queryPlanRadio('Complete')).not.toBeNull());
    choosePlanCard('Complete');

    await chooseCompleteAndLaunch();
    await waitFor(() => expect(checkoutSessionRequests(fetchMock)).toHaveLength(2));

    const keys = idempotencyKeysOf(fetchMock);
    expect(keys[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(keys[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('clears the key once the draft is consumed, so the next launch is a new draft', async () => {
    const { fetchMock } = await renderNewScan(() => envelope(CHECKOUT_SESSION, 201));

    await chooseCompleteAndLaunch();
    await waitFor(() => expect(checkoutSessionRequests(fetchMock)).toHaveLength(1));

    await chooseCompleteAndLaunch();
    await waitFor(() => expect(checkoutSessionRequests(fetchMock)).toHaveLength(2));

    const keys = idempotencyKeysOf(fetchMock);
    expect(keys[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(keys[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(keys[1]).not.toBe(keys[0]);
  });
});
