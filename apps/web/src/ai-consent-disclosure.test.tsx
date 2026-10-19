// What a buyer is told about AI before paying, and what the request records.
//
// Both paid plans run AI SEO / GEO, so both get the GEO notice and the optional
// recipients; Free sends nothing to a provider. These claims are what a buyer
// acts on, so they are worth a test rather than a careful reading.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AI_PROCESSING_PROVIDERS } from './ai-processing-notice';
import type { SiteProfile } from './api';
import { LaunchSummary } from './LaunchSummary';
import { NewScanScreen } from './NewScanScreen';
import { copy, type Language } from './i18n';
import { DEFAULT_SCOPE_FORM } from './scan-scope';
import { checkedPlan, choosePlanCard, queryPlanRadio } from './new-scan-test-support';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function launchSummaryFor(plan: 'Free' | 'Basic' | 'Complete') {
  render(
    <LaunchSummary
      language="en"
      plan={plan}
      labelledBy="technical-rows"
      scope={DEFAULT_SCOPE_FORM}
      egressLocation={null}
      egressDirect
    />,
  );
  const row = screen.getByText(copy.en.newScan.launchSummaryAi).closest('div');
  if (row === null) throw new Error('the AI row has no field');
  return row.textContent ?? '';
}

describe('what the launch summary promises about AI', () => {
  it('calls AI visibility enabled only on the plans that run it', () => {
    expect(launchSummaryFor('Complete')).toContain(copy.en.newScan.launchSummaryEnabled);
    cleanup();
    expect(launchSummaryFor('Basic')).toContain(copy.en.newScan.launchSummaryEnabled);
  });

  it('says AI is off on Free, which sends nothing to a provider', () => {
    expect(launchSummaryFor('Free')).toContain(copy.en.newScan.launchSummaryDisabled);
  });
});

describe('the AI processing notice', () => {
  it.each(['en', 'uk'] as const)('describes the GEO discovery questions in %s', (language) => {
    const geoNotice = copy[language].newScan.aiConsentBody;
    expect(geoNotice).toMatch(language === 'en' ? /discovery questions/i : /discovery-запит/i);
  });

  // The plain summary over the notice has to count the same recipients the
  // notice does.
  it.each(['en', 'uk'] as const)('counts the recipients the %s notice names', (language) => {
    const t = copy[language].newScan;
    expect(t.aiConsentSummary).toMatch(/Anthropic/);
    expect(t.aiConsentSummary).toMatch(/OpenAI/);
    expect(t.aiConsentBody).toMatch(/OpenAI/);
  });
});

// The optional recipients, on the screen and in the request.
//
// Gemini and Perplexity are offered to answer AI SEO / GEO's visibility
// questions, which every paid plan asks.
//
// These render the screen and read the request, rather than asserting on the
// copy constants: what is being pinned is the gate and the payload, and neither
// is a string.

const PROFILE: SiteProfile = {
  id: 'profile-1',
  name: 'My Site',
  domain: 'https://example.com',
};

const CHECKOUT_SESSION = {
  reference: 'ref-1',
  sessionId: 'session-1',
  checkoutUrl: 'https://checkout.example/session-1',
  plan: 'Complete',
  amount: 8700,
  currency: 'USD',
  mode: 'test' as const,
  expiresAt: null,
};

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A deployment that can sell every plan and can reach both optional providers.
 *
 * The offer is stated here rather than assumed: with no `optInAiProviders` in
 * the checkout configuration the block is hidden on every plan, and a test that
 * forgot it would pass while proving nothing.
 */
function stubApi(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = new URL(String(input));
    if (pathname === '/billing/checkout-config') {
      return Promise.resolve(
        envelope({
          provider: 'creem',
          available: true,
          mode: 'test',
          unavailableReason: null,
          plans: ['Basic', 'Complete'].map((plan) => ({
            plan,
            priceUsd: 49,
            currency: 'USD',
            available: true,
          })),
          optInAiProviders: ['google', 'perplexity'],
        }),
      );
    }
    // Already checked and sellable, so the paid launch is not gated on a probe.
    if (pathname.endsWith('/reachability')) {
      return Promise.resolve(
        envelope({ state: 'reachable', checkedAt: '2026-09-20T00:00:00.000Z', canPurchase: true }),
      );
    }
    if (pathname === '/billing/checkout-session')
      return Promise.resolve(envelope(CHECKOUT_SESSION));
    // No egress list: the launch is not blocked on a location it was not offered.
    if (pathname === '/scans/launch-config') return Promise.resolve(envelope(null));
    if (init?.method === 'PATCH')
      return Promise.resolve(envelope({ ...PROFILE, scanConfigVersion: 1 }));
    return Promise.resolve(envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderNewScan(language: Language) {
  const fetchMock = stubApi();
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
      onCreateProfile={() => undefined}
    />,
  );
  /**
   * Picks a plan once the picker actually offers it.
   *
   * The paid options only appear after the checkout configuration arrives, and
   * a `change` naming an option that is not there yet selects nothing at all —
   * so the wait is what makes this a plan change rather than a no-op.
   */
  const choosePlan = async (plan: string): Promise<void> => {
    await waitFor(() => expect(queryPlanRadio(plan, view.container)).not.toBeNull());
    choosePlanCard(plan, view.container);
    expect(checkedPlan(view.container)).toBe(plan);
  };
  return { fetchMock, choosePlan };
}

/** The optional block as a whole: its heading, and the two controls under it. */
function optInBlockShown(language: Language): boolean {
  const t = copy[language].newScan;
  return (
    screen.queryByText(t.aiConsentOptInTitle) !== null ||
    screen.queryByLabelText(t.aiConsentOptIn.google) !== null ||
    screen.queryByLabelText(t.aiConsentOptIn.perplexity) !== null
  );
}

describe('the optional GEO recipients', () => {
  it.each(['en', 'uk'] as const)(
    'offers them on Basic and Complete in %s, where the questions are asked',
    async (language) => {
      const { choosePlan } = renderNewScan(language);
      // Nothing is offered until the deployment has answered which recipients
      // it can reach, so the first assertion waits for that answer.
      await choosePlan('Complete');
      await waitFor(() => expect(optInBlockShown(language)).toBe(true));

      await choosePlan('Basic');
      expect(optInBlockShown(language)).toBe(true);
    },
  );

  it('keeps offering them when the deployment names only one recipient', async () => {
    // The plan gate is an extra condition, not a replacement for the old one.
    const { choosePlan } = renderNewScan('en');
    await choosePlan('Complete');
    await waitFor(() =>
      expect(screen.queryByLabelText(copy.en.newScan.aiConsentOptIn.google)).not.toBeNull(),
    );
    expect(screen.queryByLabelText(copy.en.newScan.aiConsentOptIn.perplexity)).not.toBeNull();
  });
});

describe('what a checkout records as AI consent', () => {
  function aiConsentProvidersOf(fetchMock: ReturnType<typeof vi.fn>): readonly string[] {
    const call = fetchMock.mock.calls.find(
      ([input]) => new URL(String(input)).pathname === '/billing/checkout-session',
    );
    if (call === undefined) throw new Error('no checkout session was opened');
    const body = JSON.parse(String((call[1] as RequestInit).body)) as {
      plan: string;
      aiConsent: { providers: readonly string[] };
    };
    return body.aiConsent.providers;
  }

  async function launch(language: Language = 'en'): Promise<void> {
    // The pay button names the price of whichever plan is chosen.
    const pay = language === 'en' ? /^Pay \$\d+ and start$/ : /^Оплатити \$\d+ і запустити$/;
    fireEvent.click(await screen.findByRole('button', { name: pay }));
  }

  it('still records the tick on Complete, which does ask those questions', async () => {
    const { fetchMock, choosePlan } = renderNewScan('en');
    await choosePlan('Complete');
    fireEvent.click(await screen.findByLabelText(copy.en.newScan.aiConsentOptIn.google));

    await launch();

    await waitFor(() =>
      expect(aiConsentProvidersOf(fetchMock)).toEqual([...AI_PROCESSING_PROVIDERS, 'google']),
    );
  });
});
