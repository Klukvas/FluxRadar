// What a Website Audit buyer is told before paying.
//
// The plan runs UX/Conversion — which sends bounded page evidence to Anthropic
// — and no AI SEO / GEO at all. Both halves are claims a buyer acts on, and the
// screen used to make exactly one statement for every paid plan: "AI visibility:
// Enabled", under a notice describing brand and domain questions this plan never
// asks. Neither sentence is true here, and both are the kind of accuracy that is
// worth a test rather than a careful reading.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AI_PROCESSING_PROVIDERS } from './ai-processing-notice';
import type { SiteProfile } from './api';
import { LaunchSummary } from './LaunchSummary';
import { NewScanScreen } from './NewScanScreen';
import { copy, type Language } from './i18n';
import { DEFAULT_SCOPE_FORM } from './scan-scope';
import { PLAN_MODULES } from './plan-modules';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function launchSummaryFor(plan: 'Free' | 'Basic' | 'WebsiteAudit' | 'Complete') {
  render(
    <LaunchSummary
      language="en"
      site="https://example.com"
      plan={plan}
      planLabel={plan}
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

  it('does not promise AI visibility on Website Audit, which never runs it', () => {
    const row = launchSummaryFor('WebsiteAudit');
    expect(PLAN_MODULES.WebsiteAudit).not.toContain('AI SEO / GEO');
    expect(row).toContain(copy.en.newScan.launchSummaryAiUxOnly);
    expect(row).not.toBe(copy.en.newScan.launchSummaryAi + copy.en.newScan.launchSummaryEnabled);
  });

  it('does not call Website Audit AI-free either: the UX review is AI-assisted', () => {
    expect(PLAN_MODULES.WebsiteAudit).toContain('UX/Conversion');
    expect(launchSummaryFor('WebsiteAudit')).not.toContain(copy.en.newScan.launchSummaryDisabled);
  });

  it('says AI is off on Free, which sends nothing to a provider', () => {
    expect(launchSummaryFor('Free')).toContain(copy.en.newScan.launchSummaryDisabled);
  });
});

describe('the AI processing notice, per plan', () => {
  // The GEO notice describes two transfers — neutralized discovery questions and
  // brand/domain awareness questions — that a plan without AI SEO / GEO never
  // makes. Disclosing processing that does not happen is worse than not
  // disclosing it: the buyer is told their brand went somewhere it did not.
  //
  // The UX-only notice may still *name* those questions, because the accurate
  // sentence is "none of them is sent" — so what is pinned is the denial, not
  // the absence of the words.
  const DENIES_GEO_TRANSFER = {
    en: /runs no AI SEO \/ GEO, so no discovery or brand-awareness question about your site is sent/i,
    uk: /не запускає AI SEO \/ GEO, тому жодного discovery- чи brand-запиту про ваш сайт[^.]*не надсилається/i,
  } as const;

  it.each(['en', 'uk'] as const)('denies any GEO transfer in the %s UX-only notice', (language) => {
    const uxOnly = copy[language].newScan.aiConsentBodyUxOnly;
    expect(uxOnly).toMatch(/UX/);
    expect(uxOnly).toMatch(DENIES_GEO_TRANSFER[language]);
  });

  it.each(['en', 'uk'] as const)(
    'keeps the %s GEO notice for the plans that do send those questions',
    (language) => {
      // The two notices have to stay distinguishable: the plans that run
      // AI SEO / GEO must keep the disclosure that describes the transfer.
      const geoNotice = copy[language].newScan.aiConsentBody;
      expect(geoNotice).not.toMatch(DENIES_GEO_TRANSFER[language]);
      expect(geoNotice).toMatch(language === 'en' ? /discovery questions/i : /discovery-запит/i);
    },
  );

  it.each(['en', 'uk'] as const)('still names Anthropic and the evidence in %s', (language) => {
    const uxOnly = copy[language].newScan.aiConsentBodyUxOnly;
    expect(uxOnly).toMatch(/Anthropic/);
    // The two promises the GEO notice makes and this one must keep.
    expect(uxOnly).toMatch(/Google\/Bing/);
  });
});

// The optional recipients, on the screen and in the request.
//
// Gemini and Perplexity are offered to answer AI SEO / GEO's visibility
// questions, and Website Audit asks none of them. The offer used to be gated on
// the deployment's keys alone, so it rendered directly under the notice that had
// just said no such question is sent — a choice with nothing behind it. The
// selection also survived a plan change, so a tick made on Complete was still in
// the request after switching to Website Audit: consent recorded for a recipient
// that scan never contacts.
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
  plan: 'WebsiteAudit',
  amount: 4900,
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
          provider: 'fastspring',
          available: true,
          mode: 'test',
          unavailableReason: null,
          popup: null,
          plans: ['Basic', 'WebsiteAudit', 'Complete'].map((plan) => ({
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
    />,
  );
  const planSelect = (): HTMLSelectElement => {
    const select = view.container.querySelector<HTMLSelectElement>('select[name="scan-plan"]');
    if (select === null) throw new Error('the plan picker is not on screen');
    return select;
  };
  /**
   * Picks a plan once the picker actually offers it.
   *
   * The paid options only appear after the checkout configuration arrives, and
   * a `change` naming an option that is not there yet selects nothing at all —
   * so the wait is what makes this a plan change rather than a no-op.
   */
  const choosePlan = async (plan: string): Promise<void> => {
    await waitFor(() =>
      expect(planSelect().querySelector(`option[value="${plan}"]`)).not.toBeNull(),
    );
    fireEvent.change(planSelect(), { target: { value: plan } });
    expect(planSelect()).toHaveValue(plan);
  };
  return { fetchMock, choosePlan, planSelect };
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

describe('the optional GEO recipients are offered only where GEO runs', () => {
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

  it.each(['en', 'uk'] as const)(
    'offers none of them on Website Audit in %s, which runs no AI SEO / GEO',
    async (language) => {
      const { choosePlan } = renderNewScan(language);
      await choosePlan('Complete');
      await waitFor(() => expect(optInBlockShown(language)).toBe(true));

      await choosePlan('WebsiteAudit');

      expect(PLAN_MODULES.WebsiteAudit).not.toContain('AI SEO / GEO');
      expect(optInBlockShown(language)).toBe(false);
      // The UX-only notice is still there: the block went, the disclosure did not.
      expect(screen.getByText(copy[language].newScan.aiConsentTitle)).toBeInTheDocument();
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

describe('what a Website Audit checkout records as AI consent', () => {
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
    fireEvent.click(await screen.findByRole('button', { name: copy[language].newScan.runPaid }));
  }

  it('drops a tick made on Complete when the buyer switches to Website Audit', async () => {
    const { fetchMock, choosePlan } = renderNewScan('en');
    await choosePlan('Complete');
    const google = await screen.findByLabelText(copy.en.newScan.aiConsentOptIn.google);
    fireEvent.click(google);
    expect(google).toBeChecked();

    await choosePlan('WebsiteAudit');
    await launch();

    await waitFor(() =>
      expect(aiConsentProvidersOf(fetchMock)).toEqual([...AI_PROCESSING_PROVIDERS]),
    );
    // The selection the screen stopped showing is not consent this scan carries.
    expect(aiConsentProvidersOf(fetchMock)).not.toContain('google');
  });

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
