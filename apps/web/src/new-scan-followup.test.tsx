// What a non-technical owner met on the new-scan screen, and what it says now.
//
//  · a badge reading "On by default" beside an empty box, and "Safe default"
//    beside a robots.txt rule the saved settings had switched off;
//  · "Unsaved changes — You changed the settings after the last save" on a form
//    nobody had touched;
//  · a plain `<a href="/profiles">` that reloaded the app and dropped the plan
//    picked on a pricing card;
//  · `/scan` with no identifier, so a refresh forgot which site was chosen.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { copy } from './i18n';
import { newScanCopy } from './new-scan-copy';
import { PLAN_URL_LIMIT } from './plan-modules';

const ACCOUNT = { accountId: 'account-1', email: 'owner@example.com', emailVerified: true };

const SALON = { id: 'profile-salon', name: 'Bloom Nails', domain: 'https://bloom-nails.example' };

/** A deployment that really can sell a scan, so the paid plans are on offer. */
const CHECKOUT_CONFIG = {
  provider: 'creem',
  available: true,
  mode: 'test' as const,
  unavailableReason: null,
  plans: [
    { plan: 'Basic', priceUsd: 55, currency: 'USD' },
    { plan: 'Complete', priceUsd: 120, currency: 'USD' },
  ],
};
const SHOP = { id: 'profile-shop', name: 'Bloom Shop', domain: 'https://shop.bloom.example' };

/** A saved profile holding the settings a scan of it would open on. */
function configured(
  profile: { id: string; name: string; domain: string },
  scope: Record<string, unknown>,
) {
  return {
    ...profile,
    scanConfigVersion: 2,
    scanConfig: {
      plan: 'Basic' as const,
      scope: {
        includeSubdomains: false,
        maxDepth: 5,
        renderJs: true,
        queryPolicy: 'ignore' as const,
        respectRobots: true,
        robotsOverrideConfirmed: false,
        userAgent: 'desktop' as const,
        ...scope,
      },
    },
  };
}

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    headers: { 'content-type': 'application/json' },
  });
}

function failure(status: number): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: { code: 'TEST', message: 'no' } }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

/** A signed-in workspace whose checkout is configured, so paid plans are real. */
function workspace(profiles: readonly object[]) {
  return (path: string): Response => {
    if (path === '/auth/me') return envelope(ACCOUNT);
    if (path === '/profiles') return envelope(profiles);
    if (path === '/billing/checkout-config') return envelope(CHECKOUT_CONFIG);
    if (path === '/scans/active') return envelope(null);
    if (path.endsWith('/reachability')) return failure(404);
    return envelope(null);
  };
}

function stub(profiles: readonly object[]): ReturnType<typeof vi.fn> {
  const handler = workspace(profiles);
  const fetchMock = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(handler(new URL(String(input)).pathname)),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Opens the new-scan screen at `address` and waits for the form to settle.
 *
 * Settled means more than "rendered": the form opens on Free, then the checkout
 * configuration arrives, then the saved plan is restored from it. The crawl
 * settings these tests read only exist on a paid plan, so a `profiles` list
 * whose profile saved one is waited for by its plan.
 */
async function openScanForm(
  profiles: readonly object[],
  address = '/scan',
  language: 'en' | 'uk' = 'en',
): Promise<void> {
  stub(profiles);
  window.history.replaceState(null, '', address);
  render(<App />);
  await screen.findByText(copy[language].newScan.windowTitle);
  const savedPlan = (profiles[0] as { scanConfig?: { plan?: string } } | undefined)?.scanConfig
    ?.plan;
  if (savedPlan !== undefined) {
    await waitFor(() => expect(planPicker(language)).toHaveValue(savedPlan));
  }
  await waitFor(() =>
    expect(document.body.textContent).toContain(newScanCopy[language].expertTitle),
  );
}

function planPicker(language: 'en' | 'uk' = 'en'): HTMLSelectElement {
  return screen.getByRole('combobox', {
    name: new RegExp(`^${copy[language].newScan.labelScanPlan}`),
  }) as HTMLSelectElement;
}

function profilePicker(language: 'en' | 'uk' = 'en'): HTMLSelectElement {
  return screen.getByRole('combobox', {
    name: new RegExp(`^${copy[language].newScan.labelProfile}`),
  }) as HTMLSelectElement;
}

/** The chip in the "Profile configuration" panel. */
function configurationPanel(): HTMLElement {
  const panel = document.querySelector('.configuration-status');
  if (panel === null) throw new Error('expected the configuration panel');
  return panel as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('the badges beside the expert settings', () => {
  // The two badges stated the product's default and the box beside them stated
  // the saved value, so one control said two opposite things at once.
  it('says a setting is off where the saved settings turned it off', async () => {
    await openScanForm([configured(SALON, { renderJs: false, respectRobots: false })]);

    expect(screen.getByText(copy.en.newScan.renderInfoModeOff)).toBeTruthy();
    expect(screen.getByText(copy.en.newScan.robotsInfoModeOff)).toBeTruthy();
    expect(screen.queryByText(copy.en.newScan.renderInfoMode)).toBeNull();
    expect(screen.queryByText(copy.en.newScan.robotsInfoMode)).toBeNull();
    // Both boxes are empty, which is what the badges now agree with.
    expect(screen.getByRole('checkbox', { name: copy.en.newScan.labelRenderJs })).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: copy.en.newScan.labelRespectRobots }),
    ).not.toBeChecked();
  });

  it('names the default where the setting is on', async () => {
    await openScanForm([configured(SALON, { renderJs: true, respectRobots: true })]);

    expect(screen.getByText(copy.en.newScan.renderInfoMode)).toBeTruthy();
    expect(screen.getByText(copy.en.newScan.robotsInfoMode)).toBeTruthy();
    expect(screen.queryByText(copy.en.newScan.renderInfoModeOff)).toBeNull();
    expect(screen.queryByText(copy.en.newScan.robotsInfoModeOff)).toBeNull();
  });

  it('follows the box as the owner ticks it', async () => {
    await openScanForm([configured(SALON, { renderJs: false, respectRobots: true })]);

    fireEvent.click(screen.getByRole('checkbox', { name: copy.en.newScan.labelRenderJs }));
    expect(await screen.findByText(copy.en.newScan.renderInfoMode)).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: copy.en.newScan.labelRespectRobots }));
    expect(await screen.findByText(copy.en.newScan.robotsInfoModeOff)).toBeTruthy();
  });

  it('says both states in Ukrainian', () => {
    for (const key of ['renderInfoMode', 'robotsInfoMode'] as const) {
      const off = `${key}Off` as const;
      expect(copy.uk.newScan[key]).not.toBe(copy.en.newScan[key]);
      expect(copy.uk.newScan[off]).not.toBe(copy.en.newScan[off]);
      expect(copy.uk.newScan[off]).not.toBe(copy.uk.newScan[key]);
    }
  });
});

describe('what the configuration panel claims', () => {
  // The panel said "You changed the settings after the last save" the moment
  // the screen opened: the form starts on Free, the checkout answer arrives a
  // moment later, and in between the form held Free against a saved Basic.
  it('does not tell an owner they changed something before they touched it', async () => {
    await openScanForm([configured(SALON, {})]);

    expect(
      within(configurationPanel()).queryByText(copy.en.newScan.configurationUnsaved),
    ).toBeNull();
    expect(document.body.textContent).not.toContain(copy.en.newScan.configurationUnsavedBody);
  });

  it('still says it once a setting is really changed', async () => {
    await openScanForm([configured(SALON, {})]);

    fireEvent.click(screen.getByRole('checkbox', { name: copy.en.newScan.labelRenderJs }));

    expect(
      await within(configurationPanel()).findByText(copy.en.newScan.configurationUnsaved),
    ).toBeTruthy();
    expect(screen.getByText(copy.en.newScan.configurationUnsavedBody)).toBeTruthy();
  });

  // The form never reuses a saved permission to ignore robots.txt, which is a
  // deliberate rule — so the panel explains that difference instead of letting
  // it read as something the owner did.
  it('explains the one saved setting it never reuses', async () => {
    await openScanForm([
      configured(SALON, { respectRobots: false, robotsOverrideConfirmed: true }),
    ]);

    expect(screen.getByText(copy.en.newScan.configurationRobotsNotReused)).toBeTruthy();
    expect(document.body.textContent).not.toContain(copy.en.newScan.configurationUnsavedBody);
    // And the ask itself is still beside the button that is held, with the
    // reason it is being asked again. This sentence was never pinned: the
    // launch was blocked and nothing on screen was tested to say why.
    expect(screen.getByText(newScanCopy.en.blockedByRobotsStale)).toBeTruthy();
    expect(newScanCopy.en.blockedByRobotsStale).toContain(
      'A tick from an earlier scan is never reused.',
    );
    // The warning above the box says the same thing about the setting itself.
    expect(screen.getByText(new RegExp(newScanCopy.en.robotsWarningStale))).toBeTruthy();
  });

  it('says nothing of the kind for a profile with no such permission', async () => {
    await openScanForm([configured(SALON, { respectRobots: true })]);

    expect(screen.queryByText(copy.en.newScan.configurationRobotsNotReused)).toBeNull();
  });

  it('explains it in Ukrainian too', async () => {
    await openScanForm(
      [configured(SALON, { respectRobots: false, robotsOverrideConfirmed: true })],
      '/scan?lang=uk',
      'uk',
    );

    expect(screen.getByText(copy.uk.newScan.configurationRobotsNotReused)).toBeTruthy();
    expect(copy.uk.newScan.configurationRobotsNotReused).not.toBe(
      copy.en.newScan.configurationRobotsNotReused,
    );
    expect(screen.getByText(newScanCopy.uk.blockedByRobotsStale)).toBeTruthy();
    expect(newScanCopy.uk.blockedByRobotsStale).toContain(
      'Позначка з попередньої перевірки ніколи не переноситься.',
    );
    expect(screen.getByText(new RegExp(newScanCopy.uk.robotsWarningStale))).toBeTruthy();
  });

  // A real edit that happens to put the saved values back is saved, not
  // unsaved: the panel describes the difference between the form and the last
  // save, not whether anything was ever touched.
  it('withdraws the claim when the edit is undone', async () => {
    await openScanForm([configured(SALON, {})]);
    const box = screen.getByRole('checkbox', { name: copy.en.newScan.labelRenderJs });

    fireEvent.click(box);
    expect(
      await within(configurationPanel()).findByText(copy.en.newScan.configurationUnsaved),
    ).toBeTruthy();

    fireEvent.click(box);

    await waitFor(() =>
      expect(
        within(configurationPanel()).queryByText(copy.en.newScan.configurationUnsaved),
      ).toBeNull(),
    );
    expect(document.body.textContent).not.toContain(copy.en.newScan.configurationUnsavedBody);
  });
});

// A plan chosen on a pricing card is applied to the form by the shell, and the
// launch saves it as a new configuration version before the checkout opens. The
// panel said "Saved · version 2" over a form holding Complete, so the owner was
// never told their saved settings were about to change — and then they did, in
// silence, before a payment.
describe('a plan the visitor chose on a pricing card', () => {
  /** Opens the form the way the pricing card does: choose the plan, then sign in. */
  async function chooseOnCard(
    profiles: readonly object[],
    plan: 'Basic' | 'Complete',
  ): Promise<void> {
    stub(profiles);
    render(<App />);
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });
    fireEvent.click(
      await screen.findByRole('button', {
        name: plan === 'Complete' ? copy.en.pricing.chooseComplete : copy.en.pricing.chooseBasic,
      }),
    );
    await screen.findByText(copy.en.newScan.windowTitle);
    await waitFor(() => expect(planPicker()).toHaveValue(plan));
  }

  it('says the saved settings will change when the card names another plan', async () => {
    await chooseOnCard([configured(SALON, {})], 'Complete');

    expect(
      await within(configurationPanel()).findByText(copy.en.newScan.configurationUnsaved),
    ).toBeTruthy();
    expect(screen.getByText(copy.en.newScan.configurationUnsavedBody)).toBeTruthy();
  });

  it('claims nothing when the card names the plan the site is already saved on', async () => {
    await chooseOnCard([configured(SALON, {})], 'Basic');

    expect(
      within(configurationPanel()).queryByText(copy.en.newScan.configurationUnsaved),
    ).toBeNull();
    expect(document.body.textContent).not.toContain(copy.en.newScan.configurationUnsavedBody);
  });

  // A site with nothing saved differs from every plan, so the flag went up on a
  // form nobody had touched — and closing it asked "Discard unsaved scan setup?
  // Your changes to this new scan will be lost" about a choice the visitor made
  // on a card, not here, and which the same card gives back.
  it('does not offer to discard changes nobody made, on a site with nothing saved', async () => {
    await chooseOnCard([SALON], 'Complete');
    await waitFor(() => expect(planPicker()).toHaveValue('Complete'));

    fireEvent.click(screen.getByRole('button', { name: newScanCopy.en.closeWindow }));

    await waitFor(() => expect(screen.queryByText(copy.en.newScan.windowTitle)).toBeNull());
    expect(document.body.textContent).not.toContain(newScanCopy.en.discard.title);
  });

  // And it still offers to, once there is something saved to lose.
  it('still offers to discard a plan that differs from the saved one', async () => {
    await chooseOnCard([configured(SALON, {})], 'Complete');
    await waitFor(() => expect(planPicker()).toHaveValue('Complete'));

    fireEvent.click(screen.getByRole('button', { name: newScanCopy.en.closeWindow }));

    expect(await screen.findByText(newScanCopy.en.discard.title)).toBeTruthy();
  });
});

// The form loads a profile's saved settings and brings its numbers inside the
// plan's ceiling (`clampScopeToPlan`). When the ceiling has moved since the
// save, the clamp is the thing that changed them: the form then held something
// the profile did not, the panel said "Saved · version 2" over it, and the
// launch PATCHed a new version before the checkout without the screen ever
// saying it would.
describe('a saved setting the plan no longer allows', () => {
  /** A page count above what Basic sells, as a profile saved under a higher ceiling. */
  const ABOVE_BASIC = configured(SALON, { maxPages: 50_000 });

  it('says the settings differ from the saved ones, before the launch does', async () => {
    await openScanForm([ABOVE_BASIC]);

    // The clamp brought it down to the ceiling the plan really sells.
    const pages = screen.getByLabelText(new RegExp(`^${copy.en.newScan.labelMaxPages}`));
    await waitFor(() => expect(pages).toHaveValue(PLAN_URL_LIMIT.Basic));
    expect(
      await within(configurationPanel()).findByText(copy.en.newScan.configurationUnsaved),
    ).toBeTruthy();
  });

  it('still claims nothing for a saved setting the plan does allow', async () => {
    await openScanForm([configured(SALON, { maxPages: 40 })]);

    const pages = screen.getByLabelText(new RegExp(`^${copy.en.newScan.labelMaxPages}`));
    await waitFor(() => expect(pages).toHaveValue(40));
    expect(
      within(configurationPanel()).queryByText(copy.en.newScan.configurationUnsaved),
    ).toBeNull();
    expect(document.body.textContent).not.toContain(copy.en.newScan.configurationUnsavedBody);
  });
});

describe('the site the form is set up for survives a refresh', () => {
  // `/scan` carried no identifier, so the one thing an owner does when a form
  // looks stuck — reload it — reopened the form on whichever profile came first.
  it('writes the chosen site into the address', async () => {
    await openScanForm([SALON, SHOP]);
    await waitFor(() => expect(window.location.search).toBe(`?profile=${SALON.id}`));

    fireEvent.change(profilePicker(), { target: { value: SHOP.id } });

    await waitFor(() => expect(window.location.search).toBe(`?profile=${SHOP.id}`));
    expect(window.location.pathname).toBe('/scan');
  });

  it('reopens on the site the address names', async () => {
    await openScanForm([SALON, SHOP], `/scan?profile=${SHOP.id}`);

    await waitFor(() => expect(profilePicker()).toHaveValue(SHOP.id));
  });

  // The id is whatever was typed in the address bar, so it is matched against
  // the owner's own profiles before anything is selected.
  it('falls back to the first site for an id that names nothing', async () => {
    await openScanForm([SALON, SHOP], '/scan?profile=profile-that-was-deleted');

    await waitFor(() => expect(profilePicker()).toHaveValue(SALON.id));
    expect(screen.getByText(copy.en.newScan.windowTitle)).toBeTruthy();
  });

  it('survives an empty or malformed value', async () => {
    await openScanForm([SALON, SHOP], '/scan?profile=');

    await waitFor(() => expect(profilePicker()).toHaveValue(SALON.id));
  });

  // The address was rebuilt from the profile alone, which dropped every other
  // parameter in it. `?lang=uk` is one of them, and for a visitor who declined
  // preferences storage it is the only thing carrying their language — so
  // choosing a site meant a reload came back in English.
  it('keeps the rest of the address, the language among it', async () => {
    await openScanForm([SALON, SHOP], `/scan?lang=uk&profile=${SALON.id}`, 'uk');

    fireEvent.change(profilePicker('uk'), { target: { value: SHOP.id } });

    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get('profile')).toBe(SHOP.id),
    );
    expect(new URLSearchParams(window.location.search).get('lang')).toBe('uk');
    expect(document.documentElement.lang).toBe('uk');
  });
});

describe('the first site, from an account that has none', () => {
  // The plan picked on a pricing card lives in memory. A plain
  // `<a href="/profiles">` reloaded the whole app, so the owner who chose Basic
  // came back to a form on Free with nothing saying their choice had gone.
  it('keeps the chosen plan through making the profile', async () => {
    const created = { ...SALON };
    let profiles: readonly object[] = [];
    const handler = (path: string, init?: RequestInit): Response => {
      if (path === '/auth/me') return envelope(ACCOUNT);
      if (path === '/profiles' && init?.method === 'POST') {
        profiles = [created];
        return envelope(created);
      }
      if (path === '/profiles') return envelope(profiles);
      if (path === '/billing/checkout-config') return envelope(CHECKOUT_CONFIG);
      if (path === '/scans/active') return envelope(null);
      if (path.endsWith('/reachability')) return failure(404);
      return envelope(null);
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(handler(new URL(String(input)).pathname, init)),
      ),
    );
    render(<App />);
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });

    // The plan is chosen the way a visitor chooses it: on a pricing card.
    fireEvent.click(await screen.findByRole('button', { name: copy.en.pricing.chooseBasic }));
    await screen.findByText(copy.en.newScan.windowTitle);
    // The plan the card chose is applied once the deployment has confirmed it
    // can actually be bought here.
    await waitFor(() => expect(planPicker()).toHaveValue('Basic'));

    // No profile yet, so the screen offers the way to make one.
    fireEvent.click(screen.getByRole('button', { name: newScanCopy.en.createProfile }));
    expect(window.location.pathname).toBe('/profiles');

    // Make it, and go back to the form the way the Profiles screen does.
    fireEvent.change(screen.getByRole('textbox', { name: /^Site address/ }), {
      target: { value: SALON.domain },
    });
    // The name is suggested from the address; typed here so the fixture's own
    // name is what comes back.
    fireEvent.change(screen.getByRole('textbox', { name: /^Display name/ }), {
      target: { value: SALON.name },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(screen.getByText(SALON.domain)).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: 'New scan' })[0] as HTMLElement);

    await screen.findByText(copy.en.newScan.windowTitle);
    // The plan the owner picked on the card, not the Free the form opens on.
    await waitFor(() => expect(planPicker()).toHaveValue('Basic'));
  });
});

// `/scan?profile=…` is a link an owner can be sent or can bookmark. A session
// that was already signed in reopened on the site it names; a signed-out one
// was asked to sign in and then landed on the form for whichever site came
// first, because the sign-in path dropped the id the address carried.
describe('a scan link followed before signing in', () => {
  it('opens the form on the site the address named', async () => {
    let authenticated = false;
    const handler = (path: string): Response => {
      if (path === '/auth/me') return authenticated ? envelope(ACCOUNT) : failure(401);
      if (path === '/auth/login') {
        authenticated = true;
        return envelope(ACCOUNT);
      }
      return workspace([SALON, SHOP])(path);
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(handler(new URL(String(input)).pathname)),
      ),
    );
    window.history.replaceState(null, '', `/scan?profile=${SHOP.id}`);
    render(<App />);
    await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ACCOUNT.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1234' } });
    fireEvent.click(
      screen
        .getAllByRole('button', { name: 'Sign in' })
        .filter((button) => button.getAttribute('type') === 'submit')[0] as HTMLElement,
    );

    await screen.findByText(copy.en.newScan.windowTitle);
    await waitFor(() => expect(profilePicker()).toHaveValue(SHOP.id));
  });

  // The id is whatever was in the address bar, so it is matched against this
  // account's own sites and never asked for.
  it('falls back to the first site for an id that names none of the account’s', async () => {
    let authenticated = false;
    const handler = (path: string): Response => {
      if (path === '/auth/me') return authenticated ? envelope(ACCOUNT) : failure(401);
      if (path === '/auth/login') {
        authenticated = true;
        return envelope(ACCOUNT);
      }
      return workspace([SALON, SHOP])(path);
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(handler(new URL(String(input)).pathname)),
    );
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/scan?profile=profile-someone-else');
    render(<App />);
    await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ACCOUNT.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1234' } });
    fireEvent.click(
      screen
        .getAllByRole('button', { name: 'Sign in' })
        .filter((button) => button.getAttribute('type') === 'submit')[0] as HTMLElement,
    );

    await screen.findByText(copy.en.newScan.windowTitle);
    await waitFor(() => expect(profilePicker()).toHaveValue(SALON.id));
    // And nothing was asked about it: the id is only ever compared with the
    // list of the account's own profiles.
    const asked = fetchMock.mock.calls.map(([input]) => String(input));
    expect(asked.filter((url) => url.includes('profile-someone-else'))).toEqual([]);
  });
});
