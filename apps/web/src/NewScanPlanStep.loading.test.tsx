// The plan step while the checkout configuration is still on its way: the paid
// cards must reserve their slots with placeholders once the read is slow, and
// must never flash them when the read is fast.

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SiteProfile } from './api';
import { NewScanScreen } from './NewScanScreen';
import { offeredPlans } from './new-scan-test-support';

const SALON: SiteProfile = {
  id: 'profile-salon',
  name: 'Salon',
  domain: 'https://mysalon.com.ua',
} as SiteProfile;

const REACHABLE = {
  state: 'reachable',
  startStatus: 200,
  accessControlSignals: [],
  checkedAt: '2026-10-17T12:00:00.000Z',
  expired: false,
  canPurchase: true,
};

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** A response the test answers when it chooses to. */
function held(): { promise: Promise<Response>; answer: (data: unknown) => void } {
  let answer: (data: unknown) => void = () => undefined;
  const promise = new Promise<Response>((resolve) => {
    answer = (data) => resolve(envelope(data));
  });
  return { promise, answer };
}

const PAID_CONFIG = {
  provider: 'creem',
  available: true,
  mode: 'live',
  unavailableReason: null,
  plans: [
    { plan: 'Basic', available: true },
    { plan: 'Complete', available: true },
  ],
};

function stubServer(config: ReturnType<typeof held>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = new URL(String(input));
      const method = (init?.method ?? 'GET').toUpperCase();
      if (pathname === '/billing/checkout-config') return config.promise;
      if (/^\/profiles\/[^/]+\/reachability$/.test(pathname) && method === 'POST') {
        return Promise.resolve(envelope(REACHABLE));
      }
      return Promise.resolve(envelope(null));
    }),
  );
}

function renderScreen(internalFreeAccess = false) {
  return render(
    <NewScanScreen
      accountId="account-1"
      profiles={[SALON]}
      selectedProfile={SALON}
      internalFreeAccess={internalFreeAccess}
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
}

function skeletonCards(): NodeListOf<Element> {
  return document.querySelectorAll('.plan-card--skeleton');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the plan step while the checkout configuration is answering', () => {
  it('reserves all three plan slots once the read is known to be slow', async () => {
    const config = held();
    stubServer(config);
    renderScreen();
    // The Free card is real data and renders immediately; the paid slots stay
    // empty through the holdback so a fast answer never flashes them.
    expect(offeredPlans()).toEqual(['Free']);
    expect(skeletonCards()).toHaveLength(0);
    await waitFor(() => expect(skeletonCards()).toHaveLength(2), { timeout: 1000 });
    expect(document.querySelectorAll('.plan-card')).toHaveLength(3);
  });

  it('never flashes the placeholders when the configuration answers fast', async () => {
    const config = held();
    stubServer(config);
    renderScreen();
    expect(skeletonCards()).toHaveLength(0);
    await act(async () => {
      config.answer(PAID_CONFIG);
    });
    await waitFor(() => expect(offeredPlans()).toContain('Complete'));
    // Past the holdback: the answered configuration cancelled the placeholders.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(skeletonCards()).toHaveLength(0);
  });

  it('replaces the placeholders with the real paid cards when the answer lands', async () => {
    const config = held();
    stubServer(config);
    renderScreen();
    await waitFor(() => expect(skeletonCards()).toHaveLength(2), { timeout: 1000 });
    await act(async () => {
      config.answer(PAID_CONFIG);
    });
    await waitFor(() => expect(offeredPlans()).toContain('Complete'));
    expect(skeletonCards()).toHaveLength(0);
    expect(document.querySelectorAll('.plan-card')).toHaveLength(3);
  });

  it('never doubles the paid slots under internal free access', async () => {
    // With internal free access the paid cards are real from the start — the
    // grid is complete while the configuration is still answering — so no
    // skeleton may reserve slots beside them.
    const config = held();
    stubServer(config);
    renderScreen(true);
    expect(document.querySelectorAll('.plan-card')).toHaveLength(3);
    expect(skeletonCards()).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(document.querySelectorAll('.plan-card')).toHaveLength(3);
    expect(skeletonCards()).toHaveLength(0);
  });
});
