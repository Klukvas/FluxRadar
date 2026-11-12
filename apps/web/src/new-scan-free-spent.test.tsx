// The free check is once per account. When it is spent, the plan step says so
// on the Free card and starts on a paid plan, instead of letting the owner fill
// the form in and learn it from a refusal after Run.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SiteProfile } from './api';
import { checkedPlan, planRadio } from './new-scan-test-support';
import { NewScanScreen } from './NewScanScreen';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubServer(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const { pathname } = new URL(String(input));
      if (pathname === '/billing/checkout-config') {
        return Promise.resolve(
          envelope({
            provider: 'creem',
            available: true,
            mode: 'live',
            unavailableReason: null,
            plans: ['Basic', 'Complete'].map((plan) => ({ plan, available: true })),
          }),
        );
      }
      return Promise.resolve(envelope(null));
    }),
  );
}

const profile = { id: 'profile-1', name: 'Site', domain: 'https://example.com' } as SiteProfile;

function screenWith(freeCheckUsed: boolean) {
  return (
    <NewScanScreen
      accountId="account-1"
      profiles={[profile]}
      selectedProfile={profile}
      internalFreeAccess={false}
      freeCheckUsed={freeCheckUsed}
      language="en"
      initialPlan={null}
      onCreated={() => undefined}
      onCheckoutStarted={() => undefined}
      onProfilesChanged={() => Promise.resolve()}
      onClose={() => undefined}
      onError={() => undefined}
      onCreateProfile={() => undefined}
    />
  );
}

describe('the Free plan card once the free check is used', () => {
  it('disables Free, says why, and starts on a paid plan', async () => {
    stubServer();
    render(screenWith(true));

    await waitFor(() => expect(checkedPlan()).toBe('Basic'));
    expect(planRadio('Free')).toBeDisabled();
    expect(screen.getByText(/Already used on this account/)).toBeInTheDocument();
  });

  it('leaves Free selectable while the check is still unused', async () => {
    stubServer();
    render(screenWith(false));

    await waitFor(() => expect(checkedPlan()).toBe('Free'));
    expect(planRadio('Free')).toBeEnabled();
    expect(screen.queryByText(/Already used on this account/)).toBeNull();
  });
});
