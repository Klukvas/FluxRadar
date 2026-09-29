// Who the purchase note says takes the payment.
//
// The sentence beside the pay button names the merchant of record: Creem,
// the only provider this deployment sells through. It appears only once the
// checkout config has arrived, and says nothing while it has not.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SiteProfile } from './api';
import { NewScanScreen } from './NewScanScreen';
import { copy, type Language } from './i18n';

const PROFILE: SiteProfile = {
  id: 'profile-1',
  name: 'My Site',
  domain: 'https://example.com',
};

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

/** A deployment that sells Complete through the named provider. */
function stubApi(provider: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const { pathname } = new URL(String(input));
      if (pathname === '/billing/checkout-config') {
        return Promise.resolve(
          envelope({
            provider,
            available: true,
            mode: 'test',
            unavailableReason: null,
            plans: [{ plan: 'Complete', priceUsd: 120, currency: 'USD', available: true }],
            optInAiProviders: [],
          }),
        );
      }
      if (pathname.endsWith('/reachability')) {
        return Promise.resolve(
          envelope({
            state: 'reachable',
            checkedAt: '2026-09-20T00:00:00.000Z',
            canPurchase: true,
          }),
        );
      }
      return Promise.resolve(envelope(null));
    }),
  );
}

/** The note as rendered once a paid plan is picked, which is when it appears. */
async function purchaseNote(provider: string, language: Language): Promise<HTMLElement> {
  stubApi(provider);
  const view = render(
    <NewScanScreen
      accountId="account-1"
      profiles={[PROFILE]}
      selectedProfile={PROFILE}
      internalFreeAccess={false}
      language={language}
      initialPlan={null}
      onCreated={() => undefined}
      onCheckoutStarted={() => undefined}
      onProfilesChanged={() => Promise.resolve()}
      onClose={() => undefined}
      onError={() => undefined}
    />,
  );
  const planSelect = (): HTMLSelectElement => {
    const select = view.container.querySelector<HTMLSelectElement>('select[name="scan-plan"]');
    if (select === null) throw new Error('the plan picker is not on screen');
    return select;
  };
  // The paid option exists only once the checkout config has arrived.
  await waitFor(() =>
    expect(planSelect().querySelector('option[value="Complete"]')).not.toBeNull(),
  );
  fireEvent.change(planSelect(), { target: { value: 'Complete' } });
  return screen.findByRole('note', { name: copy[language].newScan.purchaseTermsLabel });
}

describe.each(['en', 'uk'] as const)('the purchase note in %s', (language) => {
  const merchant = copy[language].newScan.purchaseTermsMerchant;

  it('names Creem as the merchant of record once checkout is configured', async () => {
    const note = await purchaseNote('creem', language);
    expect(note).toHaveTextContent(merchant);
  });
});
