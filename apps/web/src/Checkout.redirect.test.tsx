import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

// Creem's hosted checkout: the redirect flow.
//
// The invariant under test is the same one Checkout.test.tsx pins for the tab
// flow — the browser never creates a paid scan — with one more twist: this very
// tab leaves the app for the provider's page and is sent back to
// `/checkout/return` with the checkout's reference in the address. That
// address grants nothing. The app polls the same server-side status it always
// did, and the scan appears only once the signed webhook created it.

const account = { accountId: 'account-1', email: 'operator@example.com' };
const profile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };

/** A reference exactly as the server issues one: `frcs_` and a UUID. */
const REFERENCE = 'frcs_0f8fad5b-d9cb-469f-a165-70867728950e';

const checkoutConfig = {
  provider: 'creem',
  checkoutFlow: 'redirect' as const,
  available: true,
  mode: 'test' as const,
  unavailableReason: null,
  popup: null,
  plans: [
    { plan: 'Basic', priceUsd: 55, currency: 'USD' },
    { plan: 'Complete', priceUsd: 120, currency: 'USD' },
  ],
};

const session = {
  reference: REFERENCE,
  sessionId: 'ch_1',
  checkoutUrl: 'https://checkout.creem.io/checkout/ch_1',
  plan: 'Complete',
  amount: 120,
  currency: 'USD',
  mode: 'test' as const,
  expiresAt: null,
};

const paidScan = {
  id: 'scan-paid-1',
  profileId: profile.id,
  plan: 'Complete' as const,
  domain: profile.domain,
  status: 'Pending',
  reasonCode: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-v1',
  progress: { completedModules: 0, totalModules: 10 },
  startedAt: null,
  completedAt: null,
  createdAt: '2026-09-06T00:00:00.000Z',
  modules: [],
};

const RETURN_PATH = `/checkout/return?request_id=${REFERENCE}&checkout_id=ch_1&order_id=ord_1`;
const RETURNED_COPY =
  'Thanks — if you completed the payment, FluxRadar is waiting for Creem to confirm it. This usually takes a few seconds.';
const PAUSED_COPY = /This payment is still open\. Reopen the checkout to finish it/;
const LEAVING_COPY = 'Taking you to the secure Creem checkout…';

/** A reference the server never issued: well-formed, which is all a crafted link needs to be. */
const FOREIGN_REFERENCE = 'frcs_9b2c1a7e-3f4d-4c8a-9e1b-2d3f4a5b6c7d';
const FOREIGN_RETURN_PATH = `/checkout/return?request_id=${FOREIGN_REFERENCE}&checkout_id=ch_x&order_id=ord_x`;
const NOT_FOUND_COPY =
  'FluxRadar has no checkout with this reference for your account, so there is nothing to confirm here. If you did pay, contact support with the link you came back on.';

function envelope<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function failure(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: { code: 'TEST_ERROR', message } }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

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

function pendingStatus(scanId: string | null): Response {
  return envelope({
    reference: REFERENCE,
    plan: 'Complete',
    status: scanId === null ? 'created' : 'completed',
    reasonCode: null,
    scanId,
    purchaseId: scanId === null ? null : 'purchase-1',
    expiresAt: null,
  });
}

function stubApi(handler: (path: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/reachability')) return Promise.resolve(reachabilityEnvelope());
    return Promise.resolve(handler(path, init));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function called(fetchMock: ReturnType<typeof stubApi>, path: string): boolean {
  return fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname === path);
}

function signedIn(path: string): Response {
  if (path === '/auth/me') return envelope(account);
  if (path === '/profiles') return envelope([profile]);
  if (path === '/scans/active') return envelope(null);
  if (path === '/billing/checkout-config') return envelope(checkoutConfig);
  return envelope(null);
}

/** Stands in for the navigation happy-dom would otherwise attempt for real. */
function stubNavigation(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  vi.spyOn(window.location, 'assign').mockImplementation(assign);
  return assign;
}

function storedCheckout(): Record<string, unknown> | null {
  const raw = window.localStorage.getItem('fluxradar.pendingCheckout');
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

/** The record the outgoing leg leaves in storage, as this browser wrote it. */
function storeStartedCheckout(): void {
  window.localStorage.setItem(
    'fluxradar.pendingCheckout',
    JSON.stringify({
      accountId: account.accountId,
      reference: REFERENCE,
      sessionId: session.sessionId,
      checkoutUrl: session.checkoutUrl,
      storefront: null,
      flow: 'redirect',
      restored: false,
      popupBlocked: false,
    }),
  );
}

/**
 * `pageshow` as the browser fires it. `persisted` is what tells a page coming
 * out of the back-forward cache from one that has just loaded.
 */
function pageShow(persisted: boolean): Event {
  const event = new Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: persisted });
  return event;
}

async function payForCompleteScan(): Promise<void> {
  render(<App />);
  await screen.findByText(account.email);
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
  await screen.findByText('Site Profiles');
  fireEvent.click(screen.getByRole('button', { name: 'New scan' }));
  await screen.findByText('New scan — scope and tariff');
  await screen.findByText('Complete · $120');
  fireEvent.change(screen.getByLabelText('Scan plan'), { target: { value: 'Complete' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Pay and run scan' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Pay and run scan' }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('paying through the Creem hosted checkout', () => {
  it('sends this tab to the hosted page after remembering the checkout', async () => {
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal('open', open);
    const assign = stubNavigation();
    // What storage held at the moment the tab was told to leave.
    let storedWhenLeaving: Record<string, unknown> | null = null;
    assign.mockImplementation(() => {
      storedWhenLeaving = storedCheckout();
    });
    const fetchMock = stubApi((path) => {
      if (path === '/billing/checkout-session') return envelope(session, 201);
      if (path === `/billing/checkout-session/${REFERENCE}`) return pendingStatus(null);
      return signedIn(path);
    });

    await payForCompleteScan();

    await waitFor(() => expect(assign).toHaveBeenCalledWith(session.checkoutUrl));
    // The page unloads the moment it navigates, so the record has to be there
    // before that — it is what the return page confirms the payment against.
    expect(storedWhenLeaving).toEqual(
      expect.objectContaining({
        accountId: account.accountId,
        reference: REFERENCE,
        sessionId: session.sessionId,
        checkoutUrl: session.checkoutUrl,
        flow: 'redirect',
        storefront: null,
      }),
    );
    // No tab, no popup: the navigation is the checkout.
    expect(open).not.toHaveBeenCalled();
    expect(await screen.findByText(LEAVING_COPY)).toBeInTheDocument();
    expect(screen.getByText(/popup\s+redirect/)).toBeInTheDocument();
    expect(called(fetchMock, '/billing/internal-checkout')).toBe(false);
    expect(called(fetchMock, `/profiles/${profile.id}/free-check`)).toBe(false);
  });

  // The buyer presses Back on the Creem page. With the back-forward cache the
  // page is shown again exactly as it was, without a load: nothing re-read
  // storage, and the window went on saying the tab was on its way to Creem.
  it('pauses the checkout when the tab comes back through the back-forward cache', async () => {
    const assign = stubNavigation();
    stubApi((path) => {
      if (path === '/billing/checkout-session') return envelope(session, 201);
      if (path === `/billing/checkout-session/${REFERENCE}`) return pendingStatus(null);
      return signedIn(path);
    });
    await payForCompleteScan();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(session.checkoutUrl));
    const leaving = await screen.findByText(LEAVING_COPY);

    // A page that has just loaded fires the same event without the flag, and
    // that changes nothing — the sentence is still true.
    fireEvent(window, pageShow(false));
    expect(leaving).toBeInTheDocument();
    expect(screen.queryByText(PAUSED_COPY)).not.toBeInTheDocument();

    fireEvent(window, pageShow(true));

    expect(await screen.findByText(PAUSED_COPY)).toBeInTheDocument();
    expect(screen.queryByText(LEAVING_COPY)).not.toBeInTheDocument();
    // The page it can go back to, in this tab, as the checkout was opened.
    const link = screen.getByRole('link', { name: 'Reopen the checkout' });
    expect(link).toHaveAttribute('href', session.checkoutUrl);
    expect(link).not.toHaveAttribute('target');
  });
});

describe('coming back from the Creem hosted checkout', () => {
  it('confirms the payment named in the return address and opens the scan the webhook made', async () => {
    let statusCalls = 0;
    const fetchMock = stubApi((path) => {
      if (path === `/billing/checkout-session/${REFERENCE}`) {
        statusCalls += 1;
        return pendingStatus(statusCalls === 1 ? null : paidScan.id);
      }
      if (path === `/scans/${paidScan.id}`) return envelope(paidScan);
      return signedIn(path);
    });
    // Started in another browser, or storage was cleared on the way: the
    // return address is all the app has.
    window.history.replaceState(null, '', RETURN_PATH);

    render(<App />);

    expect(await screen.findByText('Payment — confirming')).toBeInTheDocument();
    expect(screen.getByText(RETURNED_COPY)).toBeInTheDocument();
    expect(screen.getByText(`checkout ${REFERENCE}`)).toBeInTheDocument();
    // The Creem parameters leave the address bar; a reload lands on the workspace.
    expect(window.location.pathname).toBe('/profiles');
    expect(window.location.search).toBe('');
    // Nothing to reopen: the return address carries no checkout page.
    expect(screen.queryByRole('link', { name: 'Reopen the checkout' })).not.toBeInTheDocument();
    // The same poll as every other flow; the address confirmed nothing by itself.
    await waitFor(() =>
      expect(called(fetchMock, `/billing/checkout-session/${REFERENCE}`)).toBe(true),
    );
    expect(called(fetchMock, `/scans/${paidScan.id}`)).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Check payment status' }));

    await waitFor(() => expect(called(fetchMock, `/scans/${paidScan.id}`)).toBe(true));
    await waitFor(() => expect(window.location.pathname).toBe(`/scans/${paidScan.id}`));
    expect(screen.queryByText('Payment — confirming')).not.toBeInTheDocument();
  });

  it('keeps the checkout this browser started, and offers its page again in the same tab', async () => {
    storeStartedCheckout();
    stubApi((path) =>
      path === `/billing/checkout-session/${REFERENCE}` ? pendingStatus(null) : signedIn(path),
    );
    window.history.replaceState(null, '', RETURN_PATH);

    render(<App />);

    expect(await screen.findByText(RETURNED_COPY)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Reopen the checkout' });
    expect(link).toHaveAttribute('href', session.checkoutUrl);
    // Same tab, as the checkout was opened: Creem brings the buyer back here.
    expect(link).not.toHaveAttribute('target');
    expect(screen.queryByRole('button', { name: 'Reopen the checkout' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/profiles');
  });

  // Anyone can type a return address, and a well-formed reference is all it
  // takes to look like one. The server answers 404 to a checkout it never
  // issued for this account, and that has to end the matter: the record built
  // from the address used to be stored and restored on every reload, hiding the
  // New scan screen behind a confirming window for a payment that never existed.
  it('drops a return whose reference the server does not know, and frees the workspace', async () => {
    const foreignStatus = `/billing/checkout-session/${FOREIGN_REFERENCE}`;
    const fetchMock = stubApi((path) => {
      if (path === foreignStatus) return failure(404, 'Checkout not found');
      return signedIn(path);
    });
    window.history.replaceState(null, '', FOREIGN_RETURN_PATH);

    render(<App />);

    await waitFor(() => expect(called(fetchMock, foreignStatus)).toBe(true));
    await waitFor(() => expect(screen.queryByText('Payment — confirming')).not.toBeInTheDocument());
    // Told what happened, in a notice — not the "could not read the status"
    // alert, which would describe a payment that never was.
    expect(await screen.findByText(NOT_FOUND_COPY)).toBeInTheDocument();
    expect(screen.queryByText(/could not read the payment status/)).not.toBeInTheDocument();
    // Gone from storage too, so a reload does not bring it back.
    expect(storedCheckout()).toBeNull();
    // One look was enough.
    expect(
      fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname === foreignStatus),
    ).toHaveLength(1);
    // And the workspace is usable again.
    fireEvent.click(await screen.findByRole('button', { name: 'New scan' }));
    expect(await screen.findByText('New scan — scope and tariff')).toBeInTheDocument();
  });

  // The stored record is the checkout this browser started, with the page it
  // can be reopened on. A return naming some other reference — crafted, or a
  // checkout started elsewhere — must not replace it: it would hand the slot to
  // a checkout that may not exist and silently lose the genuine one's page.
  it('keeps the checkout this browser started when the return names another reference', async () => {
    storeStartedCheckout();
    const fetchMock = stubApi((path) =>
      path === `/billing/checkout-session/${REFERENCE}` ? pendingStatus(null) : signedIn(path),
    );
    window.history.replaceState(null, '', FOREIGN_RETURN_PATH);

    render(<App />);

    expect(await screen.findByText('Payment — confirming')).toBeInTheDocument();
    expect(screen.getByText(`checkout ${REFERENCE}`)).toBeInTheDocument();
    // Not a return from this checkout: the window pauses and offers its page.
    expect(screen.getByText(PAUSED_COPY)).toBeInTheDocument();
    expect(screen.queryByText(RETURNED_COPY)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reopen the checkout' })).toHaveAttribute(
      'href',
      session.checkoutUrl,
    );
    expect(storedCheckout()).toEqual(
      expect.objectContaining({ reference: REFERENCE, checkoutUrl: session.checkoutUrl }),
    );
    // The foreign reference is never asked about; the address is cleaned all the same.
    expect(called(fetchMock, `/billing/checkout-session/${FOREIGN_REFERENCE}`)).toBe(false);
    expect(window.location.pathname).toBe('/profiles');
    expect(window.location.search).toBe('');
  });

  it('ignores a return address whose reference is not one the server issues', async () => {
    const fetchMock = stubApi(signedIn);
    window.history.replaceState(
      null,
      '',
      '/checkout/return?request_id=..%2F..%2Fscans%2Fsomeone-elses-scan&checkout_id=ch_1',
    );

    render(<App />);

    expect(await screen.findByText('Site Profiles')).toBeInTheDocument();
    expect(screen.queryByText('Payment — confirming')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        new URL(String(input)).pathname.startsWith('/billing/checkout-session/'),
      ),
    ).toBe(false);
  });

  it('asks a signed-out buyer to sign in, then confirms their payment', async () => {
    let authenticated = false;
    stubApi((path) => {
      if (path === '/auth/me')
        return authenticated ? envelope(account) : failure(401, 'no session');
      if (path === '/auth/login') {
        authenticated = true;
        return envelope(account);
      }
      if (path === `/billing/checkout-session/${REFERENCE}`) return pendingStatus(null);
      return signedIn(path);
    });
    window.history.replaceState(null, '', RETURN_PATH);
    render(<App />);
    await screen.findByRole('dialog');
    expect(screen.queryByText('Payment — confirming')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: account.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1234' } });
    const [submit] = screen
      .getAllByRole('button', { name: 'Sign in' })
      .filter((button) => button.getAttribute('type') === 'submit');
    if (submit === undefined) throw new Error('expected the sign-in form to have a submit button');
    fireEvent.click(submit);

    expect(await screen.findByText(RETURNED_COPY)).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/profiles'));
  });
});

describe('a Creem checkout reopened without a return', () => {
  it('pauses rather than sending the tab away again, and links the page in the same tab', async () => {
    const assign = stubNavigation();
    window.localStorage.setItem(
      'fluxradar.pendingCheckout',
      JSON.stringify({
        accountId: account.accountId,
        reference: REFERENCE,
        sessionId: session.sessionId,
        checkoutUrl: session.checkoutUrl,
        storefront: null,
        flow: 'redirect',
        restored: false,
        popupBlocked: false,
      }),
    );
    stubApi((path) =>
      path === `/billing/checkout-session/${REFERENCE}` ? pendingStatus(null) : signedIn(path),
    );

    render(<App />);

    expect(await screen.findByText('Payment — confirming')).toBeInTheDocument();
    expect(
      screen.getByText(/This payment is still open. Reopen the checkout to finish it/),
    ).toBeInTheDocument();
    expect(screen.queryByText(RETURNED_COPY)).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Reopen the checkout' });
    expect(link).toHaveAttribute('href', session.checkoutUrl);
    expect(link).not.toHaveAttribute('target');
    expect(assign).not.toHaveBeenCalled();
  });
});
