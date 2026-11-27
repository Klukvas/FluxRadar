// A paid check writes its market questions from the site's services or
// industry. With both empty it asks none, and its AI section comes back saying
// what the Free check already said. The form asks for one above the pay button
// and saves it in the profile write it makes before checkout.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SiteProfile } from './api';
import { copy } from './i18n';
import { checkedPlan } from './new-scan-test-support';
import { NewScanScreen } from './NewScanScreen';
import type { Plan } from './plan-modules';
import { DEFAULT_SCOPE_FORM, profileScanConfigFromForm } from './scan-scope';

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

/** Records every profile write; answers everything else with nothing. */
function stubServer(): unknown[] {
  const profileWrites: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = new URL(String(input));
      if (pathname.startsWith('/profiles/') && init?.method === 'PATCH') {
        profileWrites.push(JSON.parse(String(init.body)));
      }
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
  return profileWrites;
}

function site(fields: Partial<SiteProfile> = {}): SiteProfile {
  return {
    id: 'profile-soverra',
    name: 'Soverra',
    domain: 'https://playsoverra.com',
    scanConfigVersion: 1,
    scanConfig: profileScanConfigFromForm(DEFAULT_SCOPE_FORM, 'Basic'),
    ...fields,
  } as SiteProfile;
}

// Internal access skips the reachability probe and the payment provider, so
// the button's state is the gate's alone.
function renderForm(profile: SiteProfile, plan: Plan) {
  return render(
    <NewScanScreen
      accountId="account-1"
      profiles={[profile]}
      selectedProfile={profile}
      internalFreeAccess
      language="en"
      initialPlan={plan}
      onCreated={() => undefined}
      onCheckoutStarted={() => undefined}
      onProfilesChanged={() => Promise.resolve()}
      onClose={() => undefined}
      onError={() => undefined}
      onCreateProfile={() => undefined}
    />,
  );
}

const launchButton = () => screen.getByRole('button', { name: copy.en.newScan.runInternal });
const industryField = () => screen.queryByRole('textbox', { name: copy.en.workspace.businessType });

describe('a paid check for a site with no services and no industry', () => {
  it('asks for one above the button, and waits for it', async () => {
    stubServer();
    renderForm(site(), 'Basic');
    await waitFor(() => expect(checkedPlan()).toBe('Basic'));

    expect(screen.getByText('What do your customers search for?')).toBeVisible();
    expect(launchButton()).toBeDisabled();
    fireEvent.change(industryField() as HTMLElement, { target: { value: 'Browser game' } });
    expect(launchButton()).toBeEnabled();
  });

  it('saves what was typed in the profile write made before checkout', async () => {
    const writes = stubServer();
    renderForm(site(), 'Basic');
    await waitFor(() => expect(checkedPlan()).toBe('Basic'));

    fireEvent.change(industryField() as HTMLElement, { target: { value: '  Browser game ' } });
    fireEvent.click(launchButton());
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual(expect.objectContaining({ industry: 'Browser game' }));
    expect(writes[0]).not.toHaveProperty('offerings');
  });
});

describe('where the form does not ask', () => {
  it('a site that already names its services', async () => {
    stubServer();
    renderForm(site({ offerings: 'Online strategy game' }), 'Basic');
    await waitFor(() => expect(checkedPlan()).toBe('Basic'));
    expect(industryField()).toBeNull();
    expect(launchButton()).toBeEnabled();
  });

  it('a Free check, which asks no market question', async () => {
    stubServer();
    renderForm(site({ scanConfig: profileScanConfigFromForm(DEFAULT_SCOPE_FORM, 'Free') }), 'Free');
    await waitFor(() => expect(checkedPlan()).toBe('Free'));
    expect(industryField()).toBeNull();
  });
});
