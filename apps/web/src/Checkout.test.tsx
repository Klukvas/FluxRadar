import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { CheckoutPending, openCheckoutWindow, type PendingCheckout } from './Checkout';

// Paid checkout in the UI.
//
// The invariant under test: the browser never creates a paid scan. It asks the
// server to open a provider checkout, then polls a server-side status that only
// turns into a scan once the signed provider webhook has been processed.

const account = { accountId: 'account-1', email: 'operator@example.com' };
const profile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };

const checkoutConfig = {
  provider: 'fastspring',
  available: true,
  mode: 'test' as const,
  unavailableReason: null,
  // No popup checkout configured: this file covers the provider-hosted tab
  // fallback. The popup flow has its own file, Checkout.popup.test.tsx.
  popup: null,
  plans: [
    { plan: 'Basic', priceUsd: 55, currency: 'USD' },
    { plan: 'Complete', priceUsd: 120, currency: 'USD' },
  ],
};

const session = {
  reference: 'frcs_abc',
  sessionId: 'sess_abc',
  checkoutUrl: 'https://fluxradar.test.onfastspring.com/session/sess_abc',
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

/** A pending checkout on the provider-hosted path — no popup storefront. */
function hostedCheckout(reference: string): PendingCheckout {
  return {
    accountId: account.accountId,
    reference,
    sessionId: session.sessionId,
    checkoutUrl: session.checkoutUrl,
    storefront: null,
    restored: false,
    popupBlocked: false,
  };
}

function envelope<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(handler: (path: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    return Promise.resolve(handler(path, init));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function selectPlan(plan: string): void {
  fireEvent.change(screen.getByLabelText('Scan plan'), { target: { value: plan } });
}

function called(fetchMock: ReturnType<typeof stubApi>, path: string): boolean {
  return fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname === path);
}

async function openNewScan(handler: (path: string, init?: RequestInit) => Response) {
  const fetchMock = stubApi(handler);
  render(<App />);
  await screen.findByText(account.email);
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
  await screen.findByText('Site Profiles');
  fireEvent.click(screen.getByRole('button', { name: 'New scan' }));
  await screen.findByText('New scan — scope and tariff');
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('paid checkout flow', () => {
  it('opens the provider checkout and waits, creating no scan in the browser', async () => {
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal('open', open);
    let statusCalls = 0;
    const fetchMock = await openNewScan((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans/active') return envelope(null);
      if (path === '/billing/checkout-config') return envelope(checkoutConfig);
      if (path === '/billing/checkout-session') return envelope(session, 201);
      if (path === `/billing/checkout-session/${session.reference}`) {
        statusCalls += 1;
        // First poll: the provider webhook has not landed yet.
        return envelope({
          reference: session.reference,
          plan: 'Complete',
          status: statusCalls === 1 ? 'created' : 'completed',
          reasonCode: null,
          scanId: statusCalls === 1 ? null : paidScan.id,
          purchaseId: statusCalls === 1 ? null : 'purchase-1',
          expiresAt: null,
        });
      }
      if (path === `/scans/${paidScan.id}`) return envelope(paidScan);
      return envelope(null);
    });

    // Paid plans are offered because the server says checkout is configured.
    expect(await screen.findByText('Complete · $120')).toBeInTheDocument();
    expect(
      screen.getByText('Payment provider is in test mode — no real charge is made.'),
    ).toBeInTheDocument();

    // The paid default is never pre-selected: the plan stays Free until the
    // buyer picks a paid one themselves.
    selectPlan('Complete');
    fireEvent.click(screen.getByRole('checkbox', { name: /Allow sending public pages/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Pay and run scan' }));

    expect(await screen.findByText('Payment — confirming')).toBeInTheDocument();
    // No `noopener` in the features string: it would make window.open return null
    // on success too, and every buyer would be told their checkout was blocked.
    expect(open).toHaveBeenCalledWith(session.checkoutUrl, '_blank');
    expect(
      screen.queryByText('Your browser blocked the checkout tab. Use the link below to continue.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open the checkout page' })).not.toBeInTheDocument();
    // The mock checkout endpoint must not be reachable from this path any more.
    expect(called(fetchMock, '/billing/dev-checkout')).toBe(false);
    expect(called(fetchMock, `/profiles/${profile.id}/free-check`)).toBe(false);

    const posted = fetchMock.mock.calls.find(
      ([input, init]) =>
        new URL(String(input)).pathname === '/billing/checkout-session' &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(JSON.parse(String((posted?.[1] as RequestInit).body))).toEqual({
      siteProfileId: profile.id,
      plan: 'Complete',
      scope: expect.objectContaining({ includeSubdomains: false }),
      aiConsent: { providers: ['anthropic'], noticeVersion: 'v1' },
    });

    // Only after the server reports a scan does the UI move on.
    fireEvent.click(screen.getByRole('button', { name: 'Check payment status' }));
    await waitFor(() => expect(called(fetchMock, `/scans/${paidScan.id}`)).toBe(true));
  });

  it('offers the checkout link when the browser blocks the new tab', async () => {
    vi.stubGlobal(
      'open',
      vi.fn(() => null),
    );
    await openNewScan((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans/active') return envelope(null);
      if (path === '/billing/checkout-config') return envelope(checkoutConfig);
      if (path === '/billing/checkout-session') return envelope(session, 201);
      if (path === `/billing/checkout-session/${session.reference}`) {
        return envelope({
          reference: session.reference,
          plan: 'Complete',
          status: 'created',
          reasonCode: null,
          scanId: null,
          purchaseId: null,
          expiresAt: null,
        });
      }
      return envelope(null);
    });

    await screen.findByText('Complete · $120');
    selectPlan('Complete');
    fireEvent.click(screen.getByRole('checkbox', { name: /Allow sending public pages/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Pay and run scan' }));

    const link = await screen.findByRole('link', { name: 'Open the checkout page' });
    expect(link).toHaveAttribute('href', session.checkoutUrl);
    expect(
      screen.getByText('Your browser blocked the checkout tab. Use the link below to continue.'),
    ).toBeInTheDocument();
  });

  it('explains a rejected checkout instead of showing a scan', async () => {
    vi.stubGlobal(
      'open',
      vi.fn(() => ({}) as Window),
    );
    await openNewScan((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans/active') return envelope(null);
      if (path === '/billing/checkout-config') return envelope(checkoutConfig);
      if (path === '/billing/checkout-session') return envelope(session, 201);
      if (path === `/billing/checkout-session/${session.reference}`) {
        return envelope({
          reference: session.reference,
          plan: 'Complete',
          status: 'rejected',
          reasonCode: 'payment_not_verified',
          scanId: null,
          purchaseId: null,
          expiresAt: null,
        });
      }
      return envelope(null);
    });

    await screen.findByText('Complete · $120');
    selectPlan('Complete');
    fireEvent.click(screen.getByRole('checkbox', { name: /Allow sending public pages/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Pay and run scan' }));

    expect(
      await screen.findByText(/The payment provider reported a problem with this checkout/),
    ).toBeInTheDocument();
    // The buyer gets a sentence they can act on; the internal reason (amounts,
    // product paths, validation vocabulary) never leaves the server.
    expect(screen.getByText(/A payment could not be matched to this checkout/)).toBeInTheDocument();
    expect(screen.queryByText(/does not match the quoted/)).not.toBeInTheDocument();
  });

  it('keeps paid plans hidden when the server reports no checkout provider', async () => {
    const fetchMock = await openNewScan((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans/active') return envelope(null);
      if (path === '/billing/checkout-config') {
        return envelope({
          ...checkoutConfig,
          available: false,
          mode: null,
          unavailableReason: 'not_configured',
        });
      }
      if (path === `/profiles/${profile.id}/free-check`) {
        return envelope({ ...paidScan, id: 'scan-free-1', plan: 'Free' as const }, 201);
      }
      if (path.startsWith('/scans/')) return envelope({ ...paidScan, plan: 'Free' as const });
      return envelope(null);
    });

    expect(
      await screen.findByText(/Paid checkout is not configured for this environment yet/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Complete · $120')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Run free check' }));
    await waitFor(() => expect(called(fetchMock, `/profiles/${profile.id}/free-check`)).toBe(true));
    expect(called(fetchMock, '/billing/checkout-session')).toBe(false);
    expect(called(fetchMock, '/billing/dev-checkout')).toBe(false);
  });

  // A provider that is set up but broken is an operator problem, and the server
  // says so with a closed code and nothing else. The buyer is told the truth —
  // this is temporary — without learning which variable is wrong.
  it('distinguishes a broken provider from one that was never switched on', async () => {
    await openNewScan((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans/active') return envelope(null);
      if (path === '/billing/checkout-config') {
        return envelope({
          ...checkoutConfig,
          available: false,
          mode: null,
          unavailableReason: 'misconfigured',
        });
      }
      return envelope(null);
    });

    expect(await screen.findByText(/Paid checkout is temporarily unavailable/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Paid checkout is not configured for this environment yet/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Complete · $120')).not.toBeInTheDocument();
  });

  // An unreachable config endpoint says nothing about the deployment, so the
  // neutral sentence stands — and paid plans stay off, never "assume paid".
  it('falls back to the neutral sentence when the config cannot be read', async () => {
    await openNewScan((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans/active') return envelope(null);
      if (path === '/billing/checkout-config') return envelope(null, 503);
      return envelope(null);
    });

    expect(
      await screen.findByText(/Paid scans will be available when checkout is enabled/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Complete · $120')).not.toBeInTheDocument();
  });

  it('keeps the internal free allowlist on the dev-checkout path', async () => {
    const fetchMock = await openNewScan((path) => {
      if (path === '/auth/me') return envelope({ ...account, internalFreeAccess: true });
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans/active') return envelope(null);
      if (path === '/billing/dev-checkout') return envelope({ scanId: paidScan.id }, 201);
      if (path === `/scans/${paidScan.id}`) return envelope(paidScan);
      return envelope(null);
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /Allow sending public pages/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Run internal scan' }));

    await waitFor(() => expect(called(fetchMock, '/billing/dev-checkout')).toBe(true));
    // Internal accounts never touch the paid provider, and never ask for config.
    expect(called(fetchMock, '/billing/checkout-session')).toBe(false);
    expect(called(fetchMock, '/billing/checkout-config')).toBe(false);
  });

  // The buyer pays in a second tab, so the tab that started the checkout is very
  // likely to be reloaded before the provider webhook lands. Losing the reference
  // would leave them with a real charge and no screen that can confirm it.
  it('keeps confirming the payment after the page is reloaded', async () => {
    vi.stubGlobal(
      'open',
      vi.fn(() => ({}) as Window),
    );
    const handler = (path: string): Response => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans/active') return envelope(null);
      if (path === '/billing/checkout-config') return envelope(checkoutConfig);
      if (path === '/billing/checkout-session') return envelope(session, 201);
      if (path === `/billing/checkout-session/${session.reference}`) {
        return envelope({
          reference: session.reference,
          plan: 'Complete',
          status: 'created',
          reasonCode: null,
          scanId: null,
          purchaseId: null,
          expiresAt: null,
        });
      }
      return envelope(null);
    };
    await openNewScan(handler);
    await screen.findByText('Complete · $120');
    selectPlan('Complete');
    fireEvent.click(screen.getByRole('checkbox', { name: /Allow sending public pages/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Pay and run scan' }));
    await screen.findByText('Payment — confirming');

    // A reload: everything React held is gone, only storage survives.
    cleanup();
    stubApi(handler);
    render(<App />);
    await screen.findByText(account.email);

    expect(await screen.findByText('Payment — confirming')).toBeInTheDocument();
    expect(screen.getByText(`checkout ${session.reference}`)).toBeInTheDocument();
  });

  // The confirming window lives in App, which re-renders for reasons that have
  // nothing to do with the payment and hands down freshly allocated callbacks
  // each time. If the watch were keyed on those, every unrelated render would
  // clear the pending timer and fire another status request — the poll would
  // effectively run at the parent's render rate while the buyer is paying.
  it('does not restart the payment watch when the parent re-renders', async () => {
    let statusCalls = 0;
    stubApi((path) => {
      if (path === `/billing/checkout-session/${session.reference}`) {
        statusCalls += 1;
        return envelope({
          reference: session.reference,
          plan: 'Complete',
          status: 'created',
          reasonCode: null,
          scanId: null,
          purchaseId: null,
          expiresAt: null,
        });
      }
      return envelope(null);
    });

    // Inline callbacks on purpose: this is the shape App.tsx passes down.
    const host = (tick: number) => (
      <div>
        <span>tick {tick}</span>
        <CheckoutPending
          language="en"
          checkout={hostedCheckout(session.reference)}
          onConfirmed={() => undefined}
          onCancel={() => undefined}
          onError={() => undefined}
        />
      </div>
    );
    const { rerender } = render(host(0));
    await waitFor(() => expect(statusCalls).toBe(1));

    for (let tick = 1; tick <= 5; tick += 1) {
      rerender(host(tick));
      await screen.findByText(`tick ${tick}`);
    }

    expect(statusCalls).toBe(1);
  });

  // The reference is restored from local storage, which anything on this origin
  // can write. Putting it into the path unencoded would let a crafted value
  // point the poll at a different endpoint entirely.
  it('sends the checkout reference as a single encoded path segment', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        requested.push(new URL(String(input)).pathname);
        return Promise.resolve(
          envelope({
            reference: 'x',
            plan: 'Complete',
            status: 'created',
            reasonCode: null,
            scanId: null,
            purchaseId: null,
            expiresAt: null,
          }),
        );
      }),
    );

    render(
      <CheckoutPending
        language="en"
        checkout={hostedCheckout('../../scans/someone-elses-scan')}
        onConfirmed={() => undefined}
        onCancel={() => undefined}
        onError={() => undefined}
      />,
    );

    await waitFor(() => expect(requested).toHaveLength(1));
    expect(requested[0]).toBe('/billing/checkout-session/..%2F..%2Fscans%2Fsomeone-elses-scan');
  });

  // The contract every caller depends on: "false" must mean the browser refused
  // to open the tab, and nothing else.
  describe('openCheckoutWindow', () => {
    it('reports success and severs the opener when the tab opens', () => {
      const opened = { opener: {} as unknown } as Window;
      const open = vi.fn(() => opened);
      vi.stubGlobal('open', open);

      expect(openCheckoutWindow(session.checkoutUrl)).toBe(true);
      expect(open).toHaveBeenCalledWith(session.checkoutUrl, '_blank');
      // Reverse tabnabbing: the checkout page must not reach back into this one.
      expect(opened.opener).toBeNull();
    });

    it('reports a blocked popup only when the browser returned no window', () => {
      vi.stubGlobal(
        'open',
        vi.fn(() => null),
      );
      expect(openCheckoutWindow(session.checkoutUrl)).toBe(false);

      vi.stubGlobal(
        'open',
        vi.fn(() => undefined),
      );
      expect(openCheckoutWindow(session.checkoutUrl)).toBe(false);
    });

    it('still reports success when the opener cannot be cleared', () => {
      const opened = {
        set opener(_value: unknown) {
          throw new Error('cross-origin WindowProxy');
        },
      } as unknown as Window;
      vi.stubGlobal(
        'open',
        vi.fn(() => opened),
      );

      expect(openCheckoutWindow(session.checkoutUrl)).toBe(true);
    });
  });

  // Local storage is shared with everything else on this origin and survives
  // across sessions. A `javascript:` entry in that slot would turn "continue
  // your payment" into a script the buyer clicks themselves, so a restored URL
  // is validated rather than trusted because we once wrote it.
  it('refuses a stored checkout URL that is not an http(s) address', async () => {
    window.localStorage.setItem(
      'fluxradar.pendingCheckout',
      JSON.stringify({
        accountId: account.accountId,
        reference: session.reference,
        sessionId: session.sessionId,
        checkoutUrl: 'javascript:alert(document.cookie)',
        popupBlocked: true,
      }),
    );
    stubApi((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans/active') return envelope(null);
      return envelope(null);
    });
    render(<App />);
    await screen.findByText(account.email);

    expect(screen.queryByText('Payment — confirming')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open the checkout page' })).not.toBeInTheDocument();
  });

  it('does not hand a restored checkout to a different account', async () => {
    window.localStorage.setItem(
      'fluxradar.pendingCheckout',
      JSON.stringify({
        accountId: 'someone-else',
        reference: session.reference,
        sessionId: session.sessionId,
        checkoutUrl: session.checkoutUrl,
        popupBlocked: false,
      }),
    );
    stubApi((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans/active') return envelope(null);
      return envelope(null);
    });
    render(<App />);
    await screen.findByText(account.email);

    expect(screen.queryByText('Payment — confirming')).not.toBeInTheDocument();
  });
});
