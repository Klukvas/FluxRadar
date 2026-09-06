import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import {
  SBL_SCRIPT_ID,
  SBL_SCRIPT_URL,
  isPopupStorefront,
  openPopupCheckout,
  releasePopupCheckout,
  resetStoreBuilderForTests,
  storeBuilderScriptAttributes,
} from './fastspring-sbl';

// FastSpring popup checkout.
//
// The contract this file exists to pin down: with a popup checkout configured,
// the browser hands the server-issued session id to the Store Builder Library and
// NEVER opens the provider-hosted `webcheckoutUrl` in a tab of its own. The
// hosted page survives only as a link the buyer clicks themselves, after being
// told the popup could not be opened.

const STOREFRONT = 'fluxradar.test.onfastspring.com/popup-checkout';

const account = { accountId: 'account-1', email: 'operator@example.com' };
const profile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };

const checkoutConfig = {
  provider: 'fastspring',
  available: true,
  mode: 'test' as const,
  unavailableReason: null,
  popup: { storefront: STOREFRONT },
  plans: [
    { plan: 'Basic', priceUsd: 55, currency: 'USD' },
    { plan: 'Complete', priceUsd: 120, currency: 'USD' },
  ],
};

const session = {
  reference: 'frcs_abc',
  sessionId: 'sess_abc',
  // Present in the response and deliberately never opened by us in popup mode.
  checkoutUrl: 'https://fluxradar.test.onfastspring.com/session/sess_abc',
  plan: 'Complete',
  amount: 120,
  currency: 'USD',
  mode: 'test' as const,
  expiresAt: null,
};

const pendingStatus = {
  reference: session.reference,
  plan: 'Complete',
  status: 'created',
  reasonCode: null,
  scanId: null,
  purchaseId: null,
  expiresAt: null,
};

const listeners = { onClosed: () => undefined, onError: () => undefined };

function envelope<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === '/auth/me') return Promise.resolve(envelope(account));
    if (path === '/profiles') return Promise.resolve(envelope([profile]));
    if (path === '/scans/active') return Promise.resolve(envelope(null));
    if (path === '/billing/checkout-config') return Promise.resolve(envelope(checkoutConfig));
    if (path === '/billing/checkout-session') return Promise.resolve(envelope(session, 201));
    if (path === `/billing/checkout-session/${session.reference}`) {
      return Promise.resolve(envelope(pendingStatus));
    }
    return Promise.resolve(envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Pretends the SBL is already on the page, as it is after its script ran. */
function stubStoreBuilder(): ReturnType<typeof vi.fn> {
  const push = vi.fn();
  window.fastspring = { builder: { push } };
  return push;
}

async function payWithPaidPlan(): Promise<void> {
  render(<App />);
  await screen.findByText(account.email);
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
  await screen.findByText('Site Profiles');
  fireEvent.click(screen.getByRole('button', { name: 'New scan' }));
  await screen.findByText('New scan — scope and tariff');
  await screen.findByText('Complete · $120');
  fireEvent.change(screen.getByLabelText('Scan plan'), { target: { value: 'Complete' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /Allow sending public pages/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Pay and run scan' }));
}

afterEach(() => {
  cleanup();
  releasePopupCheckout();
  resetStoreBuilderForTests();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('FastSpring popup checkout', () => {
  it('opens the popup with the server-issued session id and never opens the hosted URL', async () => {
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal('open', open);
    stubApi();
    const push = stubStoreBuilder();

    await payWithPaidPlan();

    expect(await screen.findByText('Payment — confirming')).toBeInTheDocument();
    // The whole point of the migration: a session id into the Builder API, not a
    // hosted checkout page into a new browser tab.
    await waitFor(() => expect(push).toHaveBeenCalledWith({ checkout: session.sessionId }));
    expect(open).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Complete the payment in the checkout window/),
    ).toBeInTheDocument();
    // The hosted page is not offered at all while the popup is working.
    expect(screen.queryByRole('link', { name: 'Open the checkout page' })).not.toBeInTheDocument();
  });

  // The exact script block from developer.fastspring.com: the `fsc-api` id the
  // library requires, the pinned SBL bundle, the storefront it binds to, and the
  // three callbacks FastSpring resolves by global function name.
  it('declares the Store Builder script exactly as FastSpring documents it', () => {
    expect(storeBuilderScriptAttributes(STOREFRONT)).toEqual({
      id: 'fsc-api',
      src: 'https://sbl.onfastspring.com/sbl/1.0.6/fastspring-builder.min.js',
      type: 'text/javascript',
      'data-storefront': STOREFRONT,
      'data-popup-closed': 'fluxradarFastSpringPopupClosed',
      'data-popup-webhook-received': 'fluxradarFastSpringWebhookReceived',
      'data-error-callback': 'fluxradarFastSpringError',
    });
    expect(storeBuilderScriptAttributes(STOREFRONT).src).toBe(SBL_SCRIPT_URL);
    expect(storeBuilderScriptAttributes(STOREFRONT).id).toBe(SBL_SCRIPT_ID);
  });

  // An ad blocker, a privacy extension or a CSP that was never widened all end
  // here. The buyer must be told, and must not be quietly redirected to a hosted
  // checkout they did not ask for.
  it('explains a checkout that could not load and offers the hosted page as a link', async () => {
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal('open', open);
    stubApi();

    // No Store Builder on the page and no way to fetch one in this environment:
    // exactly what an ad blocker or a CSP that was never widened produces.
    await payWithPaidPlan();
    await screen.findByText('Payment — confirming');

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    const link = await screen.findByRole('link', { name: 'Open the checkout page' });
    expect(link).toHaveAttribute('href', session.checkoutUrl);
    expect(
      screen.getByText(/You can finish the same payment on the FastSpring/),
    ).toBeInTheDocument();
    // Nothing was charged and nothing was granted.
    expect(screen.getByText(/created by provider webhook only/)).toBeInTheDocument();
  });

  it('refuses a storefront that is not a FastSpring one, without loading a script', async () => {
    const result = await openPopupCheckout('evil.example.com/checkout', 'sess_1', listeners);

    expect(result).toEqual({ ok: false, reason: 'storefront_invalid' });
    expect(document.getElementById(SBL_SCRIPT_ID)).toBeNull();
  });

  it('accepts only FastSpring storefront hosts', () => {
    expect(isPopupStorefront('fluxradar.onfastspring.com/popup')).toBe(true);
    expect(isPopupStorefront('fluxradar.test.onfastspring.com/popup-checkout')).toBe(true);
    expect(isPopupStorefront('fluxradar.onfastspring.com')).toBe(false);
    expect(isPopupStorefront('fluxradar.onfastspring.com.evil.example/popup')).toBe(false);
    expect(isPopupStorefront('https://fluxradar.onfastspring.com/popup')).toBe(false);
    expect(isPopupStorefront(null)).toBe(false);
  });

  // A second click while the checkout is on screen must not push the same session
  // again: the buyer would watch the checkout rebuild itself under them.
  it('ignores a repeated launch while the checkout is already open', async () => {
    const push = stubStoreBuilder();

    expect(await openPopupCheckout(STOREFRONT, 'sess_1', listeners)).toEqual({ ok: true });
    expect(await openPopupCheckout(STOREFRONT, 'sess_1', listeners)).toEqual({ ok: true });

    expect(push).toHaveBeenCalledTimes(1);
  });

  // A buyer who reloaded may already have paid. Reopening a payment window by
  // itself over a page they did not ask it on is worse than offering the button.
  it('does not reopen the checkout by itself after a reload', async () => {
    window.localStorage.setItem(
      'fluxradar.pendingCheckout',
      JSON.stringify({
        accountId: account.accountId,
        reference: session.reference,
        sessionId: session.sessionId,
        checkoutUrl: session.checkoutUrl,
        storefront: STOREFRONT,
        restored: false,
        popupBlocked: false,
      }),
    );
    stubApi();
    const push = stubStoreBuilder();

    render(<App />);
    await screen.findByText(account.email);

    expect(await screen.findByText('Payment — confirming')).toBeInTheDocument();
    expect(screen.getByText(/This payment is still open/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Reopen the checkout' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith({ checkout: session.sessionId }));
  });

  // FastSpring closes the popup after the buyer pays; the confirmation still comes
  // from our server, so the close is only a reason to ask it sooner.
  it('asks the server again as soon as FastSpring closes the popup', async () => {
    const fetchMock = stubApi();
    stubStoreBuilder();

    await payWithPaidPlan();
    await screen.findByText('Payment — confirming');
    const statusPath = `/billing/checkout-session/${session.reference}`;
    const polls = (): number =>
      fetchMock.mock.calls.filter(
        (call: unknown[]) => new URL(String(call[0])).pathname === statusPath,
      ).length;
    await waitFor(() => expect(polls()).toBe(1));

    const closed = (window as unknown as Record<string, (() => void) | undefined>)
      .fluxradarFastSpringPopupClosed;
    expect(closed).toBeTypeOf('function');
    closed?.();

    await waitFor(() => expect(polls()).toBe(2));
    expect(await screen.findByText(/The checkout window is closed/)).toBeInTheDocument();
  });
});
