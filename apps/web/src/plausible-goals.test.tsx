// Where each of the three cookieless counters is sent from, through the real
// call sites: the sign-up form, the home hero and the payment confirmation.
//
// `plausible.test.ts` holds what a counter may carry. This file holds the other
// half, which is the half that decides whether the owner's numbers mean
// anything: that a counter fires once, on the milestone it is named after, and
// for the visitors GA4 never sees.
//
// So every test here runs with cookies REFUSED. GA4 sends nothing in that
// state, and the count has to be complete anyway — that is the whole reason
// these three exist beside the GA4 events, which keep their own consent gate
// and are left alone.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAnalyticsForTests, startAnalytics } from './analytics';
import { ANALYTICS_HOSTNAME } from './analytics-config';
import type { CheckoutConfig, CheckoutStatus } from './api';
import { AuthScreen } from './AuthScreen';
import { NECESSARY_ONLY, saveCookieConsent } from './browser-consent';
import {
  reportPurchaseWhenConfigReady,
  resetCheckoutAnalyticsForTests,
} from './checkout-analytics';
import {
  resetFunnelAnalyticsForTests,
  trackFreeCheckRequested,
  trackScanStarted,
  trackUpgradeClicked,
} from './funnel-analytics';
import { HomeScreen } from './HomeScreen';
import { resetPlausibleForTests, startPlausible } from './plausible';

/** One call as `plausible(...)` received it. */
type Call = readonly unknown[];

const PRODUCTION = `https://${ANALYTICS_HOSTNAME}`;
const SITE_SCRIPT = 'pa-7Ab3Kd9';

function visit(url: string): void {
  (window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(url);
}

/** A tracker that has "loaded", replacing the queueing stub as the real script does. */
function installLoadedTracker(): Call[] {
  const calls: Call[] = [];
  calls.push(...((window.plausible?.q ?? []) as Call[]));
  const tracker = ((...args: unknown[]) => {
    calls.push(args);
  }) as NonNullable<typeof window.plausible>;
  tracker.init = () => {};
  tracker.o = window.plausible?.o;
  window.plausible = tracker;
  return calls;
}

/** Every counter sent, as [name, url]; a page view is not one. */
function counters(calls: readonly Call[]): readonly (readonly [string, string])[] {
  return calls
    .filter((call) => call[0] !== 'pageview')
    .map((call) => [call[0] as string, (call[1] as { readonly url?: string }).url ?? ''] as const);
}

/** Every GA4 event handed to gtag, by name. */
function gaEvents(): readonly string[] {
  return (window.dataLayer ?? [])
    .map((entry) => Array.from(entry as ArrayLike<unknown>))
    .filter((call) => call[0] === 'event')
    .map((call) => call[1] as string);
}

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(handler: (path: string) => unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const { pathname } = new URL(String(input));
      return Promise.resolve(envelope(handler(pathname)));
    }),
  );
}

let calls: Call[] = [];

beforeEach(() => {
  resetPlausibleForTests();
  resetAnalyticsForTests();
  resetFunnelAnalyticsForTests();
  resetCheckoutAnalyticsForTests();
  window.localStorage.clear();
  visit(`${PRODUCTION}/`);
  // Cookies refused, and analytics started anyway: GA4 must stay silent while
  // every counter below still fires.
  saveCookieConsent(NECESSARY_ONLY);
  startAnalytics();
  startPlausible(SITE_SCRIPT);
  calls = installLoadedTracker();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetPlausibleForTests();
  resetAnalyticsForTests();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  sessionStorage.clear();
  visit('http://localhost:3000/');
});

describe('sign_up from the account form', () => {
  function renderAuth(initialMode: 'register' | 'login') {
    const onAuthed = vi.fn(async () => undefined);
    render(
      <AuthScreen
        language="en"
        onAuthed={onAuthed}
        error={null}
        onError={() => {}}
        onBack={() => {}}
        initialMode={initialMode}
        emailAction={null}
      />,
    );
    return onAuthed;
  }

  async function submitCredentials(): Promise<void> {
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'owner@customer-site.example' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password' } });
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
  }

  beforeEach(() => {
    stubApi((path) =>
      path === '/auth/google/status' ? { enabled: false } : { accountId: 'account-1' },
    );
  });

  it('counts a completed registration once, with cookies refused', async () => {
    const onAuthed = renderAuth('register');

    await submitCredentials();
    await waitFor(() => expect(onAuthed).toHaveBeenCalled());

    expect(counters(calls)).toEqual([['sign_up', `${PRODUCTION}/`]]);
    // The GA4 half is untouched and still waiting for the analytics category.
    expect(gaEvents()).toEqual([]);
  });

  // A sign-in is a returning account, not a new one, and `login` is not one of
  // the three names Plausible is given.
  it('counts nothing when the same form signs an account in', async () => {
    const onAuthed = renderAuth('login');

    await submitCredentials();
    await waitFor(() => expect(onAuthed).toHaveBeenCalled());

    expect(counters(calls)).toEqual([]);
  });

  it('counts nothing when the server refuses the registration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const { pathname } = new URL(String(input));
        if (pathname === '/auth/google/status')
          return Promise.resolve(envelope({ enabled: false }));
        return Promise.resolve(
          new Response(
            JSON.stringify({ success: false, data: null, error: 'that email is taken' }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
        );
      }),
    );
    const onAuthed = renderAuth('register');

    await submitCredentials();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled(),
    );

    expect(onAuthed).not.toHaveBeenCalled();
    expect(counters(calls)).toEqual([]);
  });
});

describe('free_check_requested from the home hero', () => {
  it('counts a check asked for from the hero form, with cookies refused', () => {
    render(
      <HomeScreen
        signedIn={false}
        onStart={vi.fn()}
        onStartSite={vi.fn()}
        onChoosePlan={vi.fn()}
        onLogin={vi.fn()}
        onRegister={vi.fn()}
        onOpenWorkspace={vi.fn()}
        language="en"
        onLanguageChange={vi.fn()}
        authOpen={false}
        authAction={null}
        authMode="register"
        authError={null}
        onAuthError={vi.fn()}
        onAuthed={vi.fn(async () => undefined)}
        onCloseAuth={vi.fn()}
      />,
    );
    const input = document.querySelector<HTMLInputElement>('.home__site-input');
    const form = document.querySelector<HTMLFormElement>('.home__site-form');
    if (input === null || form === null) throw new Error('the hero form is not on screen');

    fireEvent.change(input, { target: { value: 'customer-site.example' } });
    fireEvent.submit(form);

    expect(counters(calls)).toEqual([['free_check_requested', `${PRODUCTION}/`]]);
    expect(gaEvents()).toEqual([]);
    // The address the visitor typed is the thing this form must never forward.
    expect(JSON.stringify(calls)).not.toContain('customer-site');
  });

  // The step the visitor asked for, not the one the form rejected.
  it('counts nothing for an address the form will not accept', () => {
    render(
      <HomeScreen
        signedIn={false}
        onStart={vi.fn()}
        onStartSite={vi.fn()}
        onChoosePlan={vi.fn()}
        onLogin={vi.fn()}
        onRegister={vi.fn()}
        onOpenWorkspace={vi.fn()}
        language="en"
        onLanguageChange={vi.fn()}
        authOpen={false}
        authAction={null}
        authMode="register"
        authError={null}
        onAuthError={vi.fn()}
        onAuthed={vi.fn(async () => undefined)}
        onCloseAuth={vi.fn()}
      />,
    );
    const input = document.querySelector<HTMLInputElement>('.home__site-input');
    const form = document.querySelector<HTMLFormElement>('.home__site-form');
    if (input === null || form === null) throw new Error('the hero form is not on screen');

    fireEvent.submit(form);
    fireEvent.change(input, { target: { value: 'not a site' } });
    fireEvent.submit(form);

    expect(counters(calls)).toEqual([]);
  });

  // The hero is the one counter with no dedupe, exactly as its GA4 event has
  // none: a visitor who asks twice asked twice.
  it('counts a second request from the same visitor', () => {
    trackFreeCheckRequested(false);
    trackFreeCheckRequested(true);

    expect(counters(calls)).toEqual([
      ['free_check_requested', `${PRODUCTION}/`],
      ['free_check_requested', `${PRODUCTION}/`],
    ]);
  });
});

describe('purchase from the payment confirmation', () => {
  const confirmed: CheckoutStatus = {
    reference: 'ref_1',
    plan: 'Complete',
    status: 'completed',
    reasonCode: null,
    scanId: 'scan_1',
    purchaseId: 'purchase_1',
    expiresAt: null,
  };

  function config(mode: 'test' | 'live'): CheckoutConfig {
    return {
      provider: 'creem',
      available: true,
      mode,
      unavailableReason: null,
      plans: [
        { plan: 'Basic', priceUsd: 39, currency: 'USD' },
        { plan: 'Complete', priceUsd: 87, currency: 'USD' },
      ],
    };
  }

  /** Reports a confirmation the way `CheckoutPending` does, and waits for it. */
  async function reportWithConfig(
    status: CheckoutStatus,
    configRequest: Promise<CheckoutConfig | null>,
  ): Promise<void> {
    reportPurchaseWhenConfigReady(status, configRequest);
    // The report is sent from a `then` on the config promise, so the queued
    // microtasks have to drain before anything has been counted.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function report(status: CheckoutStatus, value: CheckoutConfig | null): Promise<void> {
    await reportWithConfig(status, Promise.resolve(value));
  }

  // The dedupe that cannot be built on the GA4 answer: `trackEvent` returns
  // false with cookies refused, so a guard reading it would never close and
  // every poll of the confirmation would count the same order again.
  //
  // What closes it is a set in memory (`countedPurchases`), which reaches
  // exactly as far as this page load — the only distance a guard can reach
  // while writing nothing to the device, and the counter writes nothing.
  it('counts one order once however often this page load confirms it', async () => {
    await report(confirmed, config('live'));
    await report(confirmed, config('live'));
    await report(confirmed, config('live'));

    expect(counters(calls)).toEqual([['purchase', `${PRODUCTION}/`]]);
  });

  // The whole reason this counter sits beside the GA4 purchase event: the buyer
  // refused cookies (the `beforeEach` above), so GA4 sends nothing, and the
  // order still has to reach the owner's numbers exactly once.
  it('counts the order of a buyer who refused cookies, as GA4 does not', async () => {
    await report(confirmed, config('live'));

    expect(counters(calls)).toEqual([['purchase', `${PRODUCTION}/`]]);
    expect(gaEvents()).toEqual([]);
  });

  // The guard is about one confirmation seen twice, not about a browser that
  // has bought once already.
  it('counts two different orders once each', async () => {
    await report(confirmed, config('live'));
    await report({ ...confirmed, purchaseId: 'purchase_2' }, config('live'));

    expect(counters(calls)).toEqual([
      ['purchase', `${PRODUCTION}/`],
      ['purchase', `${PRODUCTION}/`],
    ]);
  });

  // A test-card order is not a purchase in either tag.
  it('counts nothing for a test-mode store, an unknown config or an unconfirmed order', async () => {
    await report(confirmed, config('test'));
    await report(confirmed, null);
    await report({ ...confirmed, purchaseId: null }, config('live'));
    await report({ ...confirmed, scanId: null }, config('live'));

    expect(counters(calls)).toEqual([]);
  });

  // A report that cannot be made is not a count: the store config is fetched
  // over the network, and a rejected request must leave the numbers alone
  // rather than credit an order nobody confirmed the mode or price of.
  it('counts nothing when the confirmation report itself fails', async () => {
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {});

    await reportWithConfig(confirmed, Promise.reject(new Error('the config request failed')));

    expect(counters(calls)).toEqual([]);
    expect(failed).toHaveBeenCalled();
  });

  // The confirmed order is credited to the page the buyer is standing on, with
  // the Creem return query and the scan id cleaned off it.
  it('credits the order to the cleaned confirmation page', async () => {
    visit(`${PRODUCTION}/scans/7f3c1b9e-aaaa-bbbb-cccc-1234567890ab?checkout_id=ch_1`);

    await report(confirmed, config('live'));

    expect(counters(calls)).toEqual([['purchase', `${PRODUCTION}/scans/:id`]]);
  });
});

describe('the funnel steps that are not counters', () => {
  // The three are a closed list the Privacy Policy names, and the funnel they
  // sit in has five more steps. Those stay GA4-only: a step wired up here
  // without a policy change would show up as a fourth name.
  it('sends nothing to Plausible for the GA4-only steps beside them', () => {
    trackScanStarted({ id: 'scan_1', plan: 'Complete' });
    trackUpgradeClicked('Complete', 'dashboard');
    trackFreeCheckRequested(false);

    expect(counters(calls).map(([name]) => name)).toEqual(['free_check_requested']);
  });
});
