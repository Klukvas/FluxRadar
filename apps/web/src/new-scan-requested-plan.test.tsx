// The plan the scan form was opened for has to survive the profile's saved
// settings loading after it — including when the profile list is re-read and
// those settings load a second time. A Free report's upgrade buttons opened the
// form on Free for a site whose saved plan was Free, and the dashboard's free
// check opened Complete for a site saved on Complete.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SiteProfile } from './api';
import { checkedPlan, choosePlanCard } from './new-scan-test-support';
import { NewScanScreen } from './NewScanScreen';
import { PLAN_URL_LIMIT, type Plan } from './plan-modules';
import { DEFAULT_SCOPE_FORM, profileScanConfigFromForm, type ScanScopeForm } from './scan-scope';

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

/**
 * A site whose saved settings are exactly what a real launch on `plan` stores —
 * built by the form's own serializer, so loading them is a clean round trip and
 * any "Unsaved changes" marker can only come from the request.
 */
function savedOn(
  plan: Plan,
  version: number,
  form: ScanScopeForm = DEFAULT_SCOPE_FORM,
): SiteProfile {
  return {
    id: 'profile-legmash',
    name: 'Legmash',
    domain: 'https://legmash.com.ua',
    scanConfigVersion: version,
    scanConfig: profileScanConfigFromForm(form, plan),
  } as SiteProfile;
}

/** Whether the form says its settings differ from the saved ones. */
function marksUnsaved(): boolean {
  return screen.queryByText('Unsaved changes') !== null;
}

/** The values of every text field on the form. */
function fieldValues(): readonly string[] {
  return [...document.querySelectorAll('input')].map((input) => input.value);
}

function screenFor(profile: SiteProfile, initialPlan: Plan, internalFreeAccess: boolean) {
  return (
    <NewScanScreen
      accountId="account-1"
      profiles={[profile]}
      selectedProfile={profile}
      internalFreeAccess={internalFreeAccess}
      language="en"
      initialPlan={initialPlan}
      onCreated={() => undefined}
      onCheckoutStarted={() => undefined}
      onProfilesChanged={() => Promise.resolve()}
      onClose={() => undefined}
      onError={() => undefined}
      onCreateProfile={() => undefined}
    />
  );
}

describe.each([true, false])('the requested plan (internal access: %s)', (internal) => {
  it('opens an upgrade on Complete for a site saved on Free, and keeps it when the settings reload', async () => {
    stubServer();
    const view = render(screenFor(savedOn('Free', 2), 'Complete', internal));
    await waitFor(() => expect(checkedPlan()).toBe('Complete'));

    // The workspace re-reads the profile list: same site, newer saved version.
    view.rerender(screenFor(savedOn('Free', 3), 'Complete', internal));
    await waitFor(() => expect(marksUnsaved()).toBe(true));
    expect(checkedPlan()).toBe('Complete');
  });

  it('marks nothing unsaved when the request is the saved plan', async () => {
    stubServer();
    const view = render(screenFor(savedOn('Complete', 2), 'Complete', internal));
    await waitFor(() => expect(checkedPlan()).toBe('Complete'));
    view.rerender(screenFor(savedOn('Complete', 3), 'Complete', internal));
    await waitFor(() => expect(screen.getByText('Saved · version 3')).toBeInTheDocument());
    expect(marksUnsaved()).toBe(false);
    expect(checkedPlan()).toBe('Complete');
  });

  it('opens a free check on Free for a site saved on Complete, and keeps it', async () => {
    stubServer();
    const view = render(screenFor(savedOn('Complete', 2), 'Free', internal));
    await waitFor(() => expect(checkedPlan()).toBe('Free'));

    view.rerender(screenFor(savedOn('Complete', 3), 'Free', internal));
    await waitFor(() => expect(marksUnsaved()).toBe(true));
    expect(checkedPlan()).toBe('Free');
  });

  it('clamps reloaded settings to the requested plan', async () => {
    stubServer();
    const large = { ...DEFAULT_SCOPE_FORM, maxPages: '20000' };
    const view = render(screenFor(savedOn('Complete', 2, large), 'Basic', internal));
    await waitFor(() => expect(checkedPlan()).toBe('Basic'));

    view.rerender(screenFor(savedOn('Complete', 3, large), 'Basic', internal));
    await waitFor(() => expect(marksUnsaved()).toBe(true));
    expect(checkedPlan()).toBe('Basic');
    expect(fieldValues()).toContain(String(PLAN_URL_LIMIT.Basic));
    expect(fieldValues()).not.toContain('20000');
  });

  it('lets the owner’s own choice replace the request', async () => {
    stubServer();
    const view = render(screenFor(savedOn('Free', 2), 'Complete', internal));
    await waitFor(() => expect(checkedPlan()).toBe('Complete'));
    choosePlanCard('Basic');

    view.rerender(screenFor(savedOn('Free', 3), 'Complete', internal));
    // The reload restores the saved settings; it does not bring the request back.
    await waitFor(() => expect(checkedPlan()).toBe('Free'));
    expect(marksUnsaved()).toBe(false);
  });
});
