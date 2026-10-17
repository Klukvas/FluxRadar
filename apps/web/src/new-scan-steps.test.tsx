// The simplified new-scan screen, as a buyer reads it: three numbered steps, a
// card per plan, an order summary with one button, and everything technical
// folded under "For advanced users". Four persona reviews rated the old screen
// the hardest in the product; these pin the shape that replaced it, and the
// reachability check that now runs by itself — once, and never on Free.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SiteProfile } from './api';
import { copy, type Language } from './i18n';
import { newScanCopy } from './new-scan-copy';
import { checkedPlan, choosePlanCard, offeredPlans, planRadio } from './new-scan-test-support';
import { NewScanScreen } from './NewScanScreen';
import type { Plan } from './plan-modules';
import { PLAN_PRICE } from './tariff-prices';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SALON: SiteProfile = {
  id: 'profile-salon',
  name: 'Salon',
  domain: 'https://mysalon.com.ua',
} as SiteProfile;
const SHOP: SiteProfile = {
  id: 'profile-shop',
  name: 'Shop',
  domain: 'https://shop.example',
} as SiteProfile;

const NEVER_CHECKED = { state: null, checkedAt: null, expired: false, canPurchase: false };
const REACHABLE = {
  state: 'reachable',
  startStatus: 200,
  accessControlSignals: [],
  checkedAt: '2026-10-17T12:00:00.000Z',
  expired: false,
  canPurchase: true,
};

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

interface ServerOptions {
  /** Whether the deployment sells paid plans at all. */
  readonly sells?: boolean;
  /** The stored reachability answer per profile id; default never checked. */
  readonly stored?: Readonly<Record<string, unknown>>;
  /** What a fresh probe answers. */
  readonly probe?: unknown;
}

function stubApi(options: ServerOptions = {}): ReturnType<typeof vi.fn> {
  const { sells = true, stored = {}, probe = REACHABLE } = options;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    if (pathname === '/billing/checkout-config') {
      return Promise.resolve(
        envelope({
          provider: 'creem',
          available: sells,
          mode: 'live',
          unavailableReason: sells ? null : 'not-configured',
          plans: sells
            ? ['Basic', 'WebsiteAudit', 'Complete'].map((plan) => ({ plan, available: true }))
            : [],
        }),
      );
    }
    const reach = /^\/profiles\/([^/]+)\/reachability$/.exec(pathname);
    if (reach !== null) {
      const profileId = decodeURIComponent(reach[1] ?? '');
      return Promise.resolve(
        envelope(method === 'POST' ? probe : (stored[profileId] ?? NEVER_CHECKED)),
      );
    }
    if (pathname === '/scans/launch-config') return Promise.resolve(envelope(null));
    return Promise.resolve(envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderScreen(
  options: {
    language?: Language;
    profiles?: readonly SiteProfile[];
    initialPlan?: Plan | null;
    internalFreeAccess?: boolean;
  } = {},
) {
  const profiles = options.profiles ?? [SALON];
  return render(
    <NewScanScreen
      accountId="account-1"
      profiles={profiles}
      selectedProfile={profiles[0] ?? null}
      internalFreeAccess={options.internalFreeAccess ?? false}
      language={options.language ?? 'en'}
      initialPlan={options.initialPlan ?? null}
      onCreated={() => undefined}
      onCheckoutStarted={() => undefined}
      onProfilesChanged={() => Promise.resolve()}
      onClose={() => undefined}
      onError={() => undefined}
      onCreateProfile={() => undefined}
    />,
  );
}

function probes(fetchMock: ReturnType<typeof vi.fn>, profileId?: string): number {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const { pathname } = new URL(String(input));
    return (
      (init as RequestInit | undefined)?.method === 'POST' &&
      pathname.endsWith('/reachability') &&
      (profileId === undefined || pathname.includes(profileId))
    );
  }).length;
}

/** A row of the order summary, by its label. */
function orderValue(label: string, language: Language = 'en'): HTMLElement {
  const order = screen.getByRole('region', { name: newScanCopy[language].summary.title });
  const value = within(order).getByText(label).nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`no value beside ${label}`);
  return value;
}

/** Waits for the paid cards, which appear once the checkout configuration has arrived. */
async function paidCardsOffered(): Promise<void> {
  await waitFor(() => expect(offeredPlans()).toContain('Complete'));
}

describe.each(['en', 'uk'] as const)('the steps in %s', (language) => {
  it('reads as three numbered steps under one window title', async () => {
    stubApi();
    renderScreen({ language });
    const c = newScanCopy[language];

    expect(
      await screen.findByText(copy[language].newScan.windowTitle, {
        selector: '.window__titlebar > span',
      }),
    ).toBeInTheDocument();
    // The numbers are drawn beside the headings and hidden from their names.
    for (const title of [c.steps.site, c.steps.plan, c.steps.reach]) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeVisible();
    }
    expect(screen.getByText(c.site.hint)).toBeVisible();
  });

  it('names the saved site as a site, without the scheme', async () => {
    stubApi();
    renderScreen({ language });
    const picker = await screen.findByRole('combobox', {
      name: new RegExp(`^${newScanCopy[language].site.label}`),
    });
    expect(within(picker).getByRole('option', { name: 'Salon · mysalon.com.ua' })).toBeTruthy();
    expect(screen.queryByText(/Profile configuration|Конфігурація профілю/)).toBeNull();
  });
});

describe('the plan cards', () => {
  it('offers a card per sellable plan, priced from the price list, with Basic recommended', async () => {
    stubApi();
    renderScreen();
    await paidCardsOffered();

    expect(offeredPlans()).toEqual(['Free', 'Basic', 'WebsiteAudit', 'Complete']);
    for (const plan of ['Free', 'Basic', 'WebsiteAudit', 'Complete'] as const) {
      const card = planRadio(plan).closest('label') as HTMLElement;
      expect(card).toHaveTextContent(PLAN_PRICE[plan]);
      expect(card).toHaveTextContent(newScanCopy.en.planCards[plan].line);
    }
    expect(planRadio('Basic').closest('label')).toHaveTextContent('GOOD PLACE TO START');
    expect(planRadio('Complete').closest('label')).not.toHaveTextContent('GOOD PLACE TO START');
    expect(screen.queryByRole('combobox', { name: /plan/i })).toBeNull();
  });

  it('offers Free alone where the deployment sells nothing', async () => {
    stubApi({ sells: false });
    renderScreen();
    await screen.findByText(copy.en.checkout.unavailable);
    expect(offeredPlans()).toEqual(['Free']);
  });

  it('opens on the plan an upgrade link chose', async () => {
    stubApi();
    renderScreen({ initialPlan: 'Complete' });
    await waitFor(() => expect(checkedPlan()).toBe('Complete'));
    expect(planRadio('Complete')).toBeChecked();
  });
});

describe('the order summary', () => {
  it('says what a paid plan buys, its one-time price, and one button naming it', async () => {
    stubApi({ stored: { [SALON.id]: REACHABLE } });
    renderScreen();
    await paidCardsOffered();
    choosePlanCard('Basic');

    expect(orderValue('Site')).toHaveTextContent(/^mysalon\.com\.ua$/);
    expect(orderValue('Plan')).toHaveTextContent('Basic');
    expect(orderValue('Pages')).toHaveTextContent('all, up to 5,000');
    expect(orderValue('We check')).toHaveTextContent('Google and AI assistants');
    const order = screen.getByRole('region', { name: 'Your report' });
    expect(within(order).getByText('Total, one-time').nextElementSibling).toHaveTextContent(
      PLAN_PRICE.Basic,
    );
    expect(within(order).getByText('no subscription')).toBeVisible();
    expect(within(order).queryByText(/грн|UAH|₴/)).toBeNull();
    const buttons = within(order).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(`Pay ${PLAN_PRICE.Basic} and start`);
    expect(within(order).getByRole('note', { name: 'Purchase terms' })).toHaveTextContent(
      `By selecting “Pay ${PLAN_PRICE.Basic} and start”`,
    );

    choosePlanCard('WebsiteAudit');
    expect(orderValue('We check')).toHaveTextContent('the health of the site itself');
    expect(orderValue('Pages')).toHaveTextContent('all, up to 50,000');
    choosePlanCard('Complete');
    expect(orderValue('We check')).toHaveTextContent('everything together');
  });

  it('says Free costs nothing and runs the free check', async () => {
    stubApi();
    renderScreen({ language: 'uk' });
    await waitFor(() => expect(checkedPlan()).toBe('Free'));

    expect(orderValue('Тариф', 'uk')).toHaveTextContent('Безкоштовно');
    expect(orderValue('Сторінок', 'uk')).toHaveTextContent('лише головна');
    expect(orderValue('Перевіримо', 'uk')).toHaveTextContent('головну сторінку');
    const order = screen.getByRole('region', { name: 'Ваш звіт' });
    expect(within(order).getByText('Разом, один раз').nextElementSibling).toHaveTextContent(
      'Безкоштовно',
    );
    expect(within(order).getByRole('button')).toHaveAccessibleName(
      'Запустити безкоштовну перевірку',
    );
    expect(within(order).queryByText('без підписки')).toBeNull();
  });

  it('holds the pay button until the API says the site can be bought', async () => {
    stubApi({
      stored: { [SALON.id]: { ...REACHABLE, state: 'access-denied', canPurchase: false } },
    });
    renderScreen();
    await paidCardsOffered();
    choosePlanCard('Basic');

    const pay = screen.getByRole('button', { name: `Pay ${PLAN_PRICE.Basic} and start` });
    await screen.findByText(copy.en.reachability.states.accessDenied.label);
    expect(pay).toBeDisabled();
  });
});

describe('the advanced section', () => {
  it('starts folded and holds the technical rows, the settings status and the save action', async () => {
    stubApi();
    renderScreen();
    const summary = await screen.findByText('For advanced users');
    const section = summary.closest('details') as HTMLDetailsElement;

    expect(section.open).toBe(false);
    const rows = within(section).getByRole('group', { name: 'What the crawler will do' });
    for (const label of ['Maximum depth', 'Subdomains', 'robots.txt', 'URL parameters']) {
      expect(within(rows).getByText(label)).not.toBeVisible();
    }
    expect(within(rows).getByText('User agent')).toBeInTheDocument();
    expect(within(section).getByText('Site settings')).toBeInTheDocument();
    expect(
      within(section).getByRole('button', { name: 'Save these settings for the site' }),
    ).not.toBeVisible();

    fireEvent.click(summary);
    await waitFor(() => expect(section.open).toBe(true));
    expect(within(rows).getByText('Maximum depth')).toBeVisible();
  });
});

describe('the pre-purchase disclosures', () => {
  it('stay open on a paid plan', async () => {
    stubApi({ stored: { [SALON.id]: REACHABLE } });
    renderScreen();
    await paidCardsOffered();
    choosePlanCard('Complete');

    const ai = screen.getByRole('group', { name: copy.en.newScan.aiConsentTitle });
    expect(within(ai).getByText(/By starting this paid audit/)).toBeVisible();
    const performance = screen.getByRole('group', { name: copy.en.newScan.performanceInfoTitle });
    expect(within(performance).getByText(/You do not connect a Google account/)).toBeVisible();
  });
});

describe('the reachability step', () => {
  it('probes a never-checked site by itself, once, on a paid plan', async () => {
    const fetchMock = stubApi();
    renderScreen();
    await paidCardsOffered();
    choosePlanCard('Basic');

    expect(
      await screen.findByText(copy.en.reachability.states.reachable.label),
    ).toBeInTheDocument();
    expect(probes(fetchMock)).toBe(1);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: `Pay ${PLAN_PRICE.Basic} and start` }),
      ).toBeEnabled(),
    );
    expect(screen.getByRole('button', { name: copy.en.reachability.again })).toBeVisible();
  });

  it('does not probe on Free', async () => {
    const fetchMock = stubApi();
    renderScreen();
    await paidCardsOffered();
    await screen.findByText(newScanCopy.en.reach.freeNote);

    expect(probes(fetchMock)).toBe(0);
  });

  it('does not probe again when the plan goes to Free and back', async () => {
    // A probe that fails leaves nothing stored, so the read after every toggle
    // says "never checked" again: only the screen's own memory stops a repeat.
    const fetchMock = stubApi({ probe: null });
    renderScreen();
    await paidCardsOffered();
    choosePlanCard('Basic');
    await screen.findByText(copy.en.reachability.failed);

    choosePlanCard('Free');
    choosePlanCard('Complete');
    choosePlanCard('Free');
    choosePlanCard('Basic');
    await screen.findByText(copy.en.reachability.unchecked);

    expect(probes(fetchMock)).toBe(1);
    expect(screen.getByRole('button', { name: copy.en.reachability.check })).toBeVisible();
  });

  it('probes once more for a newly chosen site, and only for it', async () => {
    const fetchMock = stubApi();
    renderScreen({ profiles: [SALON, SHOP] });
    await paidCardsOffered();
    choosePlanCard('Basic');
    await waitFor(() => expect(probes(fetchMock, SALON.id)).toBe(1));

    fireEvent.change(screen.getByRole('combobox', { name: /^Site/ }), {
      target: { value: SHOP.id },
    });
    await waitFor(() => expect(probes(fetchMock, SHOP.id)).toBe(1));
    expect(probes(fetchMock)).toBe(2);
  });

  it('leaves a site that has an answer alone', async () => {
    const fetchMock = stubApi({
      stored: { [SALON.id]: { ...REACHABLE, expired: true, canPurchase: false } },
    });
    renderScreen();
    await paidCardsOffered();
    choosePlanCard('Basic');

    await screen.findByText(copy.en.reachability.states.expired.label);
    expect(probes(fetchMock)).toBe(0);
  });

  it('treats an answer of the wrong shape as a failed check, never as a sale', async () => {
    stubApi({ probe: { id: 'scan-1', status: 'Completed' } });
    renderScreen();
    await paidCardsOffered();
    choosePlanCard('Basic');

    expect(await screen.findByText(copy.en.reachability.failed)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `Pay ${PLAN_PRICE.Basic} and start` }),
    ).toBeDisabled();
  });
});
