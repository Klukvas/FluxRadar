// The funnel steps as they reach gtag: once, with a fixed parameter set, and
// only while the visitor allows analytics. The last block runs every step the
// app sends through one recorder and checks that nothing a visitor typed or a
// scan identifies ever rides along.

import { StrictMode, createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAnalyticsForTests, startAnalytics } from './analytics';
import type { CheckoutConfig, CheckoutSession, CheckoutStatus } from './api';
import { EVERYTHING_ALLOWED, NECESSARY_ONLY, saveCookieConsent } from './browser-consent';
import {
  BEGIN_CHECKOUT_DELIVERY_MS,
  reportPurchaseWhenConfigReady,
  resetCheckoutAnalyticsForTests,
  trackBeginCheckout,
  trackPurchase,
} from './checkout-analytics';
import {
  PLAN_SETTLE_MS,
  resetFunnelAnalyticsForTests,
  trackFreeCheckRequested,
  trackScanStarted,
  trackUpgradeClicked,
  usePlanSelected,
  useReportViewed,
} from './funnel-analytics';
import type { Plan } from './plan-modules';

type HappyWindow = { happyDOM: { setURL: (url: string) => void } };

function visit(url: string): void {
  (window as unknown as HappyWindow).happyDOM.setURL(url);
}

/** Every event gtag was handed, as [name, params]. */
function sentEvents(): [string, Record<string, unknown>][] {
  return (window.dataLayer ?? [])
    .map((entry) => Array.from(entry as ArrayLike<unknown>))
    .filter((call) => call[0] === 'event')
    .map((call) => [call[1] as string, call[2] as Record<string, unknown>]);
}

function eventsNamed(name: string): Record<string, unknown>[] {
  return sentEvents()
    .filter(([sent]) => sent === name)
    .map(([, params]) => params);
}

function strict({ children }: { children: ReactNode }) {
  return createElement(StrictMode, null, children);
}

const PURCHASE_ID = '7d6f1c1e-4b5a-4c7e-9a51-3f0e2b8c9d10';
const SCAN_ID = '0f9a8b7c-6d5e-4f3a-8b2c-1d0e9f8a7b6c';

const scan = {
  id: SCAN_ID,
  plan: 'Free',
  status: 'Completed',
  domain: 'https://customer-site.example',
};

const liveConfig: CheckoutConfig = {
  provider: 'creem',
  available: true,
  mode: 'live',
  unavailableReason: null,
  plans: [{ plan: 'Basic', priceUsd: 55, currency: 'USD' }],
};

const liveSession: CheckoutSession = {
  reference: 'frcs_live_1',
  sessionId: 'sess_live_1',
  checkoutUrl: 'https://www.creem.io/checkout/sess_live_1',
  plan: 'Basic',
  amount: 55,
  currency: 'USD',
  mode: 'live',
  expiresAt: null,
};

const confirmed: CheckoutStatus = {
  reference: 'frcs_live_1',
  plan: 'Basic',
  status: 'completed',
  reasonCode: null,
  scanId: SCAN_ID,
  purchaseId: PURCHASE_ID,
  expiresAt: null,
};

function allowAnalytics(): void {
  saveCookieConsent(EVERYTHING_ALLOWED);
  startAnalytics();
}

beforeEach(() => {
  resetAnalyticsForTests();
  resetFunnelAnalyticsForTests();
  resetCheckoutAnalyticsForTests();
  window.localStorage.clear();
  visit('https://fluxradar.net/');
});

afterEach(() => {
  vi.useRealTimers();
  resetAnalyticsForTests();
  window.localStorage.clear();
  visit('http://localhost:3000/');
});

describe('funnel steps before and after consent', () => {
  it('sends no step at all before the visitor allows analytics', () => {
    saveCookieConsent({ preferences: true, analytics: false });
    startAnalytics();
    trackFreeCheckRequested(false);
    trackScanStarted(scan);
    trackUpgradeClicked('Basic', 'free_report');
    trackBeginCheckout(liveSession, () => undefined);
    trackPurchase(confirmed, liveConfig);
    renderHook(() => useReportViewed(scan));

    expect(window.dataLayer).toBeUndefined();
  });

  it('stops sending steps once the visitor withdraws mid-visit', () => {
    allowAnalytics();
    trackFreeCheckRequested(true);
    saveCookieConsent(NECESSARY_ONLY);
    trackUpgradeClicked('Basic', 'dashboard');
    trackScanStarted(scan);

    expect(sentEvents().map(([name]) => name)).toEqual(['free_check_requested']);
  });

  // A start the visitor had not allowed measuring is not marked as reported, so
  // the guard does not swallow a later, allowed one.
  it('reports a scan start that happens after a late allowance', () => {
    saveCookieConsent(NECESSARY_ONLY);
    startAnalytics();
    trackScanStarted(scan);
    saveCookieConsent(EVERYTHING_ALLOWED);
    trackScanStarted(scan);

    expect(eventsNamed('scan_started')).toEqual([{ plan: 'Free' }]);
  });
});

describe('each step, once, with its fixed parameters', () => {
  it('free_check_requested says only whether the visitor was signed in', () => {
    allowAnalytics();
    trackFreeCheckRequested(false);

    expect(eventsNamed('free_check_requested')).toEqual([{ signed_in: false }]);
  });

  it('scan_started names the plan, once per scan however often it is confirmed', () => {
    allowAnalytics();
    trackScanStarted({ ...scan, plan: 'Complete' });
    trackScanStarted({ ...scan, plan: 'Complete' });
    trackScanStarted({ id: 'another-scan', plan: 'Basic' });

    expect(eventsNamed('scan_started')).toEqual([{ plan: 'Complete' }, { plan: 'Basic' }]);
  });

  it('scan_started drops a plan the tariff table does not know', () => {
    allowAnalytics();
    trackScanStarted({ id: 'odd', plan: 'customer-site.example' });

    expect(eventsNamed('scan_started')).toEqual([]);
  });

  it('upgrade_clicked names the plan and where the button was', () => {
    allowAnalytics();
    trackUpgradeClicked('Complete', 'action_plan');

    expect(eventsNamed('upgrade_clicked')).toEqual([{ plan: 'Complete', source: 'action_plan' }]);
  });

  it('report_viewed fires once per scan, through StrictMode and re-renders', () => {
    allowAnalytics();
    const { rerender, unmount } = renderHook(({ value }) => useReportViewed(value), {
      initialProps: { value: scan },
      wrapper: strict,
    });
    rerender({ value: { ...scan } });
    unmount();
    renderHook(() => useReportViewed(scan), { wrapper: strict });

    expect(eventsNamed('report_viewed')).toEqual([{ plan: 'Free', status: 'Completed' }]);
  });

  it('report_viewed waits for a finished scan', () => {
    allowAnalytics();
    const { rerender } = renderHook(({ value }) => useReportViewed(value), {
      initialProps: { value: { ...scan, status: 'Running' } as typeof scan | null },
    });
    expect(eventsNamed('report_viewed')).toEqual([]);
    rerender({ value: null });
    rerender({ value: { ...scan, status: 'Partial' } });

    expect(eventsNamed('report_viewed')).toEqual([{ plan: 'Free', status: 'Partial' }]);
  });

  it('begin_checkout fires once per created session, purchase once per order', () => {
    allowAnalytics();
    trackBeginCheckout(liveSession, () => undefined);
    trackBeginCheckout(liveSession, () => undefined);
    trackPurchase(confirmed, liveConfig);
    trackPurchase(confirmed, liveConfig);

    expect(eventsNamed('begin_checkout')).toHaveLength(1);
    expect(eventsNamed('purchase')).toEqual([
      {
        transaction_id: PURCHASE_ID,
        currency: 'USD',
        value: 55,
        items: [{ item_id: 'Basic', item_name: 'FluxRadar Basic' }],
      },
    ]);
  });

  it('purchase never fires before the webhook created the scan', () => {
    allowAnalytics();
    trackPurchase({ ...confirmed, scanId: null }, liveConfig);

    expect(eventsNamed('purchase')).toEqual([]);
  });
});

describe('begin_checkout before the redirect to the provider', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  function deliveryCallback(): () => void {
    const [params] = eventsNamed('begin_checkout');
    expect(params).toMatchObject({ transport_type: 'beacon' });
    return params?.event_callback as () => void;
  }

  it('redirects once, when gtag has handed the event over', () => {
    allowAnalytics();
    const proceed = vi.fn();
    trackBeginCheckout(liveSession, proceed);
    expect(proceed).not.toHaveBeenCalled();

    const delivered = deliveryCallback();
    delivered();
    delivered();
    vi.advanceTimersByTime(BEGIN_CHECKOUT_DELIVERY_MS * 2);

    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('redirects once after the fallback when gtag never calls back', () => {
    allowAnalytics();
    const proceed = vi.fn();
    trackBeginCheckout(liveSession, proceed);
    vi.advanceTimersByTime(BEGIN_CHECKOUT_DELIVERY_MS - 1);
    expect(proceed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    deliveryCallback()();

    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('redirects at once when nothing is sent', () => {
    saveCookieConsent(NECESSARY_ONLY);
    startAnalytics();
    const proceed = vi.fn();
    trackBeginCheckout(liveSession, proceed);
    expect(proceed).toHaveBeenCalledTimes(1);

    allowAnalytics();
    const testMode = vi.fn();
    trackBeginCheckout({ ...liveSession, mode: 'test' }, testMode);
    expect(testMode).toHaveBeenCalledTimes(1);
    expect(eventsNamed('begin_checkout')).toEqual([]);
  });
});

describe('purchase once the store config is known', () => {
  it('waits for a late config and reports the order once, with its price', async () => {
    allowAnalytics();
    let resolveConfig: (value: CheckoutConfig | null) => void = () => undefined;
    const config = new Promise<CheckoutConfig | null>((resolve) => {
      resolveConfig = resolve;
    });
    reportPurchaseWhenConfigReady(confirmed, config);
    reportPurchaseWhenConfigReady(confirmed, config);
    expect(eventsNamed('purchase')).toEqual([]);

    resolveConfig(liveConfig);
    await config;
    await Promise.resolve();

    expect(eventsNamed('purchase')).toEqual([expect.objectContaining({ value: 55 })]);
  });

  it('sends no purchase when the config could not be read', async () => {
    allowAnalytics();
    const config = Promise.resolve(null);
    reportPurchaseWhenConfigReady(confirmed, config);
    await config;
    await Promise.resolve();

    expect(eventsNamed('purchase')).toEqual([]);
  });
});

describe('plan_selected on the new-scan form', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  async function settle(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLAN_SETTLE_MS);
    });
  }

  function renderForm(plan: Plan, offered = true) {
    return renderHook(
      ({ value, isOffered }: { value: Plan; isOffered: boolean }) =>
        usePlanSelected(value, isOffered),
      { initialProps: { value: plan, isOffered: offered }, wrapper: strict },
    );
  }

  it('counts the preselected paid plan once, and each change to another paid plan', async () => {
    allowAnalytics();
    const { rerender } = renderForm('Basic');
    await settle();
    rerender({ value: 'Basic', isOffered: true });
    await settle();
    rerender({ value: 'Complete', isOffered: true });
    await settle();
    rerender({ value: 'Free', isOffered: true });
    await settle();
    rerender({ value: 'Complete', isOffered: true });
    await settle();

    expect(eventsNamed('plan_selected')).toEqual([{ plan: 'Basic' }, { plan: 'Complete' }]);
  });

  // The form shows the profile's saved plan for a render before the plan picked
  // on a pricing card replaces it; only the second is anybody's choice.
  it('ignores a plan the form held only in passing', async () => {
    allowAnalytics();
    const { rerender } = renderForm('Basic');
    rerender({ value: 'Complete', isOffered: true });
    await settle();

    expect(eventsNamed('plan_selected')).toEqual([{ plan: 'Complete' }]);
  });

  it('waits until the plan is actually on offer, and never counts Free', async () => {
    allowAnalytics();
    const { rerender } = renderForm('Free');
    await settle();
    rerender({ value: 'Complete', isOffered: false });
    await settle();
    expect(eventsNamed('plan_selected')).toEqual([]);
    rerender({ value: 'Complete', isOffered: true });
    await settle();

    expect(eventsNamed('plan_selected')).toEqual([{ plan: 'Complete' }]);
  });

  it('does not report the same plan again when the form is opened again', async () => {
    allowAnalytics();
    renderForm('Basic').unmount();
    await settle();
    expect(eventsNamed('plan_selected')).toEqual([]);
    renderForm('Basic').unmount();
    renderForm('Basic');
    await settle();
    renderForm('Basic');
    await settle();
    renderForm('Complete');
    await settle();

    expect(eventsNamed('plan_selected')).toEqual([{ plan: 'Basic' }, { plan: 'Complete' }]);
  });

  it('sends nothing without consent', async () => {
    saveCookieConsent(NECESSARY_ONLY);
    startAnalytics();
    renderForm('Basic');
    await settle();

    expect(window.dataLayer).toBeUndefined();
  });
});

describe('what a funnel step may carry', () => {
  const EMAIL = /@/;
  const URL_SCHEME = /:\/\//;
  const DOT_DOMAIN = /[a-z0-9-]+\.[a-z]{2,}/i;
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  /** Every leaf value of a param object, nested items included. */
  function leaves(value: unknown): unknown[] {
    if (Array.isArray(value)) return value.flatMap(leaves);
    if (value !== null && typeof value === 'object') return Object.values(value).flatMap(leaves);
    return [value];
  }

  it('sends no address, email, domain or id other than the purchase transaction id', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    allowAnalytics();
    const storageBefore = JSON.stringify({ ...window.localStorage });
    const sessionBefore = JSON.stringify({ ...window.sessionStorage });
    const cookiesBefore = document.cookie;

    trackFreeCheckRequested(true);
    trackScanStarted({ ...scan, plan: 'Basic' });
    renderHook(() => useReportViewed(scan));
    trackUpgradeClicked('Basic', 'free_report');
    trackUpgradeClicked('Basic', 'dashboard');
    trackUpgradeClicked('Complete', 'action_plan');
    renderHook(() => usePlanSelected('WebsiteAudit', true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLAN_SETTLE_MS);
    });
    trackBeginCheckout(liveSession, () => undefined);
    trackPurchase(confirmed, liveConfig);

    const funnel = sentEvents().filter(([name]) => name !== 'page_view');
    expect(funnel.map(([name]) => name)).toEqual([
      'free_check_requested',
      'scan_started',
      'report_viewed',
      'upgrade_clicked',
      'upgrade_clicked',
      'upgrade_clicked',
      'plan_selected',
      'begin_checkout',
      'purchase',
    ]);
    for (const [name, params] of funnel) {
      // How gtag delivers the event, not what it says (begin_checkout only).
      const delivery = name === 'begin_checkout' ? ['transport_type', 'event_callback'] : [];
      for (const [key, value] of Object.entries(params).filter(([k]) => !delivery.includes(k))) {
        const values = leaves(value).map(String);
        for (const text of values) {
          expect(text, `${name}.${key}`).not.toMatch(EMAIL);
          expect(text, `${name}.${key}`).not.toMatch(URL_SCHEME);
          expect(text, `${name}.${key}`).not.toMatch(DOT_DOMAIN);
          if (!(name === 'purchase' && key === 'transaction_id')) {
            expect(text, `${name}.${key}`).not.toMatch(UUID);
          }
        }
      }
    }
    expect(JSON.stringify(window.dataLayer)).not.toContain(SCAN_ID);
    expect(JSON.stringify({ ...window.localStorage })).toBe(storageBefore);
    expect(JSON.stringify({ ...window.sessionStorage })).toBe(sessionBefore);
    expect(document.cookie).toBe(cookiesBefore);
  });
});
