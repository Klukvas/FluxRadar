// Where each funnel step is sent from, through the real screens: the home hero,
// the new-scan form and its checkout, the payment confirmation, the report and
// its upgrade buttons, and the dashboard's next step.

import { StrictMode, type ReactElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { resetAnalyticsForTests, startAnalytics } from './analytics';
import type { CheckoutConfig, IssueSummary, Scan, SiteProfile } from './api';
import { EVERYTHING_ALLOWED, NECESSARY_ONLY, saveCookieConsent } from './browser-consent';
import { CheckoutPending } from './Checkout';
import { resetCheckoutAnalyticsForTests } from './checkout-analytics';
import { resetFunnelAnalyticsForTests } from './funnel-analytics';
import { HomeScreen } from './HomeScreen';
import { choosePlanCard } from './new-scan-test-support';
import { requestScan, type ScanRequest } from './new-scan-request';
import { NextStepActions } from './NextStep';
import { ResultsScreen } from './Report';
import { ReportNextStepsWithSummary } from './ReportNextSteps';
import type { ScanScopePayload } from './scan-scope';

type HappyWindow = { happyDOM: { setURL: (url: string) => void } };

function visit(url: string): void {
  (window as unknown as HappyWindow).happyDOM.setURL(url);
}

function eventsNamed(name: string): Record<string, unknown>[] {
  return (window.dataLayer ?? [])
    .map((entry) => Array.from(entry as ArrayLike<unknown>))
    .filter((call) => call[0] === 'event' && call[1] === name)
    .map((call) => call[2] as Record<string, unknown>);
}

function envelope<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(handler: (path: string, init?: RequestInit) => Response | null) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    return Promise.resolve(handler(path, init) ?? envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function strictRender(element: ReactElement) {
  return render(<StrictMode>{element}</StrictMode>);
}

const SITE = 'https://customer-site.example';

function scanOf(plan: Scan['plan'], overrides: Partial<Scan> = {}): Scan {
  return {
    id: `scan-${plan}`,
    profileId: 'profile-1',
    plan,
    domain: SITE,
    status: 'Completed',
    statusReason: null,
    scope: { includeSubdomains: false },
    rulesetVersion: 'rules-v1',
    progress: { completedModules: 1, totalModules: 1 },
    startedAt: '2026-10-17T00:00:00.000Z',
    completedAt: '2026-10-17T00:01:00.000Z',
    createdAt: '2026-10-17T00:00:00.000Z',
    modules: [],
    ...overrides,
  } as Scan;
}

const profile: SiteProfile = { id: 'profile-1', name: 'Dental Smile', domain: SITE };

const liveConfig: CheckoutConfig = {
  provider: 'creem',
  available: true,
  mode: 'live',
  unavailableReason: null,
  plans: [
    { plan: 'Basic', priceUsd: 39, currency: 'USD' },
    { plan: 'Complete', priceUsd: 87, currency: 'USD' },
  ],
};

const liveSession = {
  reference: 'frcs_live_1',
  sessionId: 'sess_live_1',
  checkoutUrl: 'https://www.creem.io/checkout/sess_live_1',
  plan: 'Complete',
  amount: 87,
  currency: 'USD',
  mode: 'live' as const,
  expiresAt: null,
};

const summaryWithOpenIssues: IssueSummary = {
  total: 3,
  open: 3,
  bySeverity: {},
  groups: [{ ruleId: 'SEO-ONPAGE-001', module: 'SEO', severity: 'High', issues: 3, openIssues: 3 }],
};

function allowAnalytics(): void {
  saveCookieConsent(EVERYTHING_ALLOWED);
  startAnalytics();
}

function scanRequest(plan: ScanRequest['plan']): ScanRequest {
  return {
    accountId: 'account-1',
    profileId: profile.id,
    plan,
    scope: {} as ScanScopePayload,
    expectedProfileConfigVersion: undefined,
    optInAiProviders: [],
    internalFreeAccess: false,
    onCheckoutStarted: vi.fn(),
  };
}

beforeEach(() => {
  resetAnalyticsForTests();
  resetFunnelAnalyticsForTests();
  resetCheckoutAnalyticsForTests();
  window.localStorage.clear();
  visit('https://fluxradar.net/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetAnalyticsForTests();
  window.localStorage.clear();
  visit('http://localhost:3000/');
});

describe('free_check_requested from the home hero', () => {
  function renderHome(signedIn: boolean) {
    const onStartSite = vi.fn();
    strictRender(
      <HomeScreen
        signedIn={signedIn}
        onStart={vi.fn()}
        onStartSite={onStartSite}
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
    return { input, form, onStartSite };
  }

  it('fires once for a valid address, without the address', () => {
    allowAnalytics();
    const { input, form, onStartSite } = renderHome(false);
    fireEvent.change(input, { target: { value: 'customer-site.example' } });
    fireEvent.submit(form);

    expect(onStartSite).toHaveBeenCalledTimes(1);
    expect(eventsNamed('free_check_requested')).toEqual([{ signed_in: false }]);
    expect(JSON.stringify(window.dataLayer)).not.toContain('customer-site');
  });

  it('says a signed-in owner was signed in', () => {
    allowAnalytics();
    const { input, form } = renderHome(true);
    fireEvent.change(input, { target: { value: 'customer-site.example' } });
    fireEvent.submit(form);

    expect(eventsNamed('free_check_requested')).toEqual([{ signed_in: true }]);
  });

  it('does not fire for an empty or invalid address, or without consent', () => {
    allowAnalytics();
    const { input, form } = renderHome(false);
    fireEvent.submit(form);
    fireEvent.change(input, { target: { value: 'not a site' } });
    fireEvent.submit(form);
    expect(eventsNamed('free_check_requested')).toEqual([]);

    saveCookieConsent(NECESSARY_ONLY);
    fireEvent.change(input, { target: { value: 'customer-site.example' } });
    fireEvent.submit(form);
    expect(eventsNamed('free_check_requested')).toEqual([]);
  });
});

describe('scan_started and begin_checkout from the scan request', () => {
  it('reports a free check once the server created it', async () => {
    allowAnalytics();
    stubApi((path) =>
      path === `/profiles/${profile.id}/free-check` ? envelope(scanOf('Free'), 201) : null,
    );

    await requestScan(scanRequest('Free'));

    expect(eventsNamed('scan_started')).toEqual([{ plan: 'Free' }]);
  });

  it('reports nothing when the server refuses the free check', async () => {
    allowAnalytics();
    stubApi(() => new Response(JSON.stringify({ success: false, data: null }), { status: 409 }));

    await expect(requestScan(scanRequest('Free'))).rejects.toThrow();
    expect(eventsNamed('scan_started')).toEqual([]);
  });

  it('reports the checkout the server opened, and no scan start yet', async () => {
    allowAnalytics();
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    stubApi((path) => (path === '/billing/checkout-session' ? envelope(liveSession, 201) : null));

    await requestScan(scanRequest('Complete'));

    // gtag.js never loads here, so the fallback timer is what redirects.
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign).toHaveBeenCalledWith(liveSession.checkoutUrl);
    expect(eventsNamed('begin_checkout')).toEqual([
      {
        currency: 'USD',
        value: 87,
        items: [{ item_id: 'Complete', item_name: 'FluxRadar Complete' }],
        transport_type: 'beacon',
        event_callback: expect.any(Function),
      },
    ]);
    expect(eventsNamed('scan_started')).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('reports no checkout from a test-mode store', async () => {
    allowAnalytics();
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    stubApi((path) =>
      path === '/billing/checkout-session' ? envelope({ ...liveSession, mode: 'test' }, 201) : null,
    );

    await requestScan(scanRequest('Complete'));

    expect(assign).toHaveBeenCalledTimes(1);
    expect(eventsNamed('begin_checkout')).toEqual([]);
  });
});

describe('purchase and scan_started from the payment confirmation', () => {
  const PURCHASE_ID = 'purchase_live_1';

  type ConfigAnswer = 'ready' | 'failed' | Promise<void>;

  function renderPending(
    scanId: string | null,
    {
      config = 'ready',
      closeOnConfirm = false,
    }: { config?: ConfigAnswer; closeOnConfirm?: boolean } = {},
  ) {
    let close = (): void => undefined;
    const onConfirmed = vi.fn(() => {
      // What the parent does: the confirmation ends the checkout window.
      if (closeOnConfirm) close();
    });
    const answer = (path: string): Response | Promise<Response> | null => {
      if (path === '/billing/checkout-config') {
        if (config === 'ready') return envelope(liveConfig);
        if (config === 'failed') return new Response('{}', { status: 500 });
        // A fresh body per request: StrictMode asks twice.
        return config.then(() => envelope(liveConfig));
      }
      if (path === `/billing/checkout-session/${liveSession.reference}`) {
        return envelope({
          reference: liveSession.reference,
          plan: 'Complete',
          status: scanId === null ? 'created' : 'completed',
          reasonCode: null,
          scanId,
          purchaseId: scanId === null ? null : PURCHASE_ID,
          expiresAt: null,
        });
      }
      if (scanId !== null && path === `/scans/${scanId}`) return envelope(scanOf('Complete'));
      return null;
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(answer(new URL(String(input)).pathname) ?? envelope(null)),
      ),
    );
    const view = strictRender(
      <CheckoutPending
        language="en"
        checkout={{
          accountId: 'account-1',
          reference: liveSession.reference,
          checkoutUrl: null,
          restored: false,
          returned: true,
        }}
        onConfirmed={onConfirmed}
        onCancel={vi.fn()}
        onError={vi.fn()}
        onNotFound={vi.fn()}
      />,
    );
    close = () => view.unmount();
    return onConfirmed;
  }

  it('reports the confirmed order and the paid scan once each, through StrictMode', async () => {
    allowAnalytics();
    const onConfirmed = renderPending('scan-Complete');

    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    await waitFor(() => expect(eventsNamed('purchase')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Check payment status' }));
    await waitFor(() => expect(onConfirmed.mock.calls.length).toBeGreaterThan(1));

    expect(eventsNamed('purchase')).toEqual([
      {
        transaction_id: PURCHASE_ID,
        currency: 'USD',
        value: 87,
        items: [{ item_id: 'Complete', item_name: 'FluxRadar Complete' }],
      },
    ]);
    expect(eventsNamed('scan_started')).toEqual([{ plan: 'Complete' }]);
  });

  it('reports the order once with its price when the config arrives after the window closed', async () => {
    allowAnalytics();
    let answerConfig: () => void = () => undefined;
    const lateConfig = new Promise<void>((resolve) => {
      answerConfig = resolve;
    });
    const onConfirmed = renderPending('scan-Complete', {
      config: lateConfig,
      closeOnConfirm: true,
    });

    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(eventsNamed('purchase')).toEqual([]);
    answerConfig();

    await waitFor(() => expect(eventsNamed('purchase')).toHaveLength(1));
    expect(eventsNamed('purchase')[0]).toMatchObject({
      transaction_id: PURCHASE_ID,
      currency: 'USD',
      value: 87,
    });
  });

  it('confirms the scan at once and sends no purchase when the config cannot be read', async () => {
    allowAnalytics();
    const onConfirmed = renderPending('scan-Complete', { config: 'failed', closeOnConfirm: true });

    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(eventsNamed('purchase')).toEqual([]);
    expect(eventsNamed('scan_started')).toEqual([{ plan: 'Complete' }]);
  });

  it('reports nothing for a return the server has not confirmed', async () => {
    allowAnalytics();
    renderPending(null);

    await screen.findByText(/status\s+created/);
    expect(eventsNamed('purchase')).toEqual([]);
    expect(eventsNamed('scan_started')).toEqual([]);
  });
});

describe('report_viewed from the report screen', () => {
  function renderReport(scan: Scan) {
    stubApi((path) =>
      path === `/scans/${scan.id}/dashboard`
        ? envelope({
            scan,
            overall: {
              verdict: 'insufficient_data',
              score: null,
              weightedCoverage: 0,
              moduleWeights: [],
            },
            modules: [],
          })
        : null,
    );
    return strictRender(
      <ResultsScreen
        scan={scan}
        language="en"
        onScan={() => {}}
        onIssues={() => {}}
        onReports={() => {}}
        onError={() => {}}
      />,
    );
  }

  it('fires once with the plan and status, through StrictMode and a re-render', async () => {
    allowAnalytics();
    const scan = scanOf('Free');
    const view = renderReport(scan);
    await waitFor(() => expect(eventsNamed('report_viewed')).toHaveLength(1));
    view.rerender(
      <StrictMode>
        <ResultsScreen
          scan={{ ...scan }}
          language="uk"
          onScan={() => {}}
          onIssues={() => {}}
          onReports={() => {}}
          onError={() => {}}
        />
      </StrictMode>,
    );

    expect(eventsNamed('report_viewed')).toEqual([{ plan: 'Free', status: 'Completed' }]);
  });

  it('does not fire without consent', async () => {
    saveCookieConsent(NECESSARY_ONLY);
    startAnalytics();
    renderReport(scanOf('Free'));

    await screen.findAllByText(/customer-site\.example/);
    expect(window.dataLayer).toBeUndefined();
  });
});

describe('upgrade_clicked from its three buttons', () => {
  function renderNextSteps(scan: Scan, onUpgrade = vi.fn()) {
    stubApi(() => null);
    strictRender(
      <ReportNextStepsWithSummary
        scan={scan}
        summary={summaryWithOpenIssues}
        language="en"
        onOpenProblem={vi.fn()}
        onAllProblems={vi.fn()}
        onUpgrade={onUpgrade}
      />,
    );
    return onUpgrade;
  }

  it('reports the free report upsell', () => {
    allowAnalytics();
    const onUpgrade = renderNextSteps(scanOf('Free'));
    const upsell = document.querySelector('.upsell .button-row button');
    if (!(upsell instanceof HTMLButtonElement)) throw new Error('no upsell button');
    fireEvent.click(upsell);

    expect(onUpgrade).toHaveBeenCalledWith('Basic');
    expect(eventsNamed('upgrade_clicked')).toEqual([{ plan: 'Basic', source: 'free_report' }]);
  });

  it('reports the locked Action Plan button', async () => {
    allowAnalytics();
    const onUpgrade = renderNextSteps(scanOf('Basic'));
    fireEvent.click(await screen.findByRole('button', { name: 'Run a Complete scan' }));

    expect(onUpgrade).toHaveBeenCalledWith('Complete');
    expect(eventsNamed('upgrade_clicked')).toEqual([{ plan: 'Complete', source: 'action_plan' }]);
  });

  it('reports the dashboard next step after a free check, and not its other steps', () => {
    allowAnalytics();
    const onNewScan = vi.fn();
    const props = {
      language: 'en' as const,
      locked: false,
      profile,
      onAddSite: vi.fn(),
      onNewScan,
      onOpenScan: vi.fn(),
      onRetryScan: vi.fn(async () => undefined),
    };
    const view = strictRender(<NextStepActions {...props} kind="noScans" latest={null} />);
    fireEvent.click(screen.getAllByRole('button')[0]!);
    expect(eventsNamed('upgrade_clicked')).toEqual([]);

    view.rerender(
      <StrictMode>
        <NextStepActions {...props} kind="freeDone" latest={scanOf('Free')} />
      </StrictMode>,
    );
    fireEvent.click(screen.getAllByRole('button')[0]!);

    expect(onNewScan).toHaveBeenLastCalledWith(profile, 'Basic');
    expect(eventsNamed('upgrade_clicked')).toEqual([{ plan: 'Basic', source: 'dashboard' }]);
  });

  it('sends nothing without consent', () => {
    saveCookieConsent(NECESSARY_ONLY);
    startAnalytics();
    renderNextSteps(scanOf('Free'));
    const upsell = document.querySelector('.upsell .button-row button');
    if (!(upsell instanceof HTMLButtonElement)) throw new Error('no upsell button');
    fireEvent.click(upsell);

    expect(window.dataLayer).toBeUndefined();
  });
});

describe('plan_selected and begin_checkout on the new-scan screen', () => {
  const account = { accountId: 'account-1', email: 'operator@example.com' };

  it('reports the chosen paid plan once and the checkout it opens', async () => {
    allowAnalytics();
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    stubApi((path) => {
      if (path === '/auth/me') return envelope(account);
      if (path === '/profiles') return envelope([profile]);
      if (path === '/scans/active') return envelope(null);
      if (path === '/billing/checkout-config') return envelope(liveConfig);
      if (path === '/billing/checkout-session') return envelope(liveSession, 201);
      if (path.endsWith('/reachability')) {
        return envelope({
          state: 'reachable',
          startStatus: 200,
          accessControlSignals: [],
          checkedAt: new Date().toISOString(),
          expired: false,
          canPurchase: true,
        });
      }
      return null;
    });
    render(<App />);
    await screen.findByText(account.email);
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Check this site' }));
    await screen.findByRole('radio', { name: /^Complete/ });
    choosePlanCard('Complete');

    await waitFor(() => expect(eventsNamed('plan_selected')).toEqual([{ plan: 'Complete' }]), {
      timeout: 3000,
    });
    const pay = screen.getByRole('button', { name: 'Pay $87 and start' });
    await waitFor(() => expect(pay).toBeEnabled());
    fireEvent.click(pay);
    await waitFor(() => expect(eventsNamed('begin_checkout')).toHaveLength(1));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));

    expect(eventsNamed('plan_selected')).toEqual([{ plan: 'Complete' }]);
    expect(eventsNamed('scan_started')).toEqual([]);
    expect(JSON.stringify(window.dataLayer)).not.toContain('customer-site');
    expect(JSON.stringify(window.dataLayer)).not.toContain(account.email);
  });
});
