import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

const API = 'http://127.0.0.1:3310';
const account = {
  accountId: 'profile-autofill',
  email: 'owner@example.test',
  emailVerified: true,
  onboarding: { status: 'completed' },
};
const profile = { id: 'existing', name: 'Existing site', domain: 'https://existing.example' };

function json(route: Route, data: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ success: status < 400, data: status < 400 ? data : null, error: null }),
  });
}

/** The envelope the API answers with when the site itself refused to be read. */
function refusal(route: Route, code: string, message: string, status = 409): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ success: false, data: null, error: { code, message } }),
  });
}

async function isolate(
  page: Page,
  appOrigin: string,
  handler: (route: Route) => Promise<void>,
): Promise<void> {
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin && route.request().method() === 'GET') return route.continue();
    if (url.origin === API) return handler(route);
    return route.abort('blockedbyclient');
  });
}

async function dismissCookies(page: Page): Promise<void> {
  const banner = page.getByRole('region', { name: 'Cookies & storage' });
  if (await banner.isVisible()) {
    // Optional storage is suggested on, so refusing it is a switch and a save.
    await banner.getByRole('checkbox', { name: 'All optional storage' }).click();
    await banner.getByRole('button', { name: 'Save choice' }).click();
  }
}

function baseApi(route: Route): Promise<void> {
  const path = new URL(route.request().url()).pathname;
  if (path === '/auth/me') return json(route, account);
  if (path === '/profiles') return json(route, [profile]);
  if (path === '/scans') return json(route, []);
  if (path.endsWith('/active')) return json(route, null);
  return json(route, []);
}

test('desktop offers grounded details without saving and keeps a gap before the form', async ({
  page,
  baseURL,
}) => {
  let profileWrites = 0;
  await isolate(page, new URL(baseURL!).origin, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/profiles/suggestions') {
      // The shape the reported page produces: a served market and two published
      // languages from its JSON-LD, and no business type or audience anywhere.
      return json(route, {
        name: 'Public title',
        businessDescription: 'Public description',
        offerings: 'Service one, Service two',
        region: 'United States, Ukraine',
        targetLanguages: 'en, uk',
      });
    }
    if (path === '/profiles' && route.request().method() !== 'GET') profileWrites += 1;
    return baseApi(route);
  });
  await page.goto('/profiles');
  await dismissCookies(page);
  await page.getByRole('button', { name: '+ Add a site' }).click();
  await page.getByRole('textbox', { name: /Site address/ }).fill('public.example');
  await page.getByText(/Describe the site for AI visibility checks/).click();
  await page.getByRole('button', { name: 'Fill from site' }).click();
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('Public title');
  await expect(
    page.getByText('Suggested from the public homepage. Review and edit before saving.'),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder('A private dental clinic helping families in Kyiv…'),
  ).toHaveValue('Public description');
  await expect(
    page.getByPlaceholder('Dental implants, cleanings, emergency appointments'),
  ).toHaveValue('Service one, Service two');
  await expect(page.getByPlaceholder('Kyiv and Kyiv region, Ukraine')).toHaveValue(
    'United States, Ukraine',
  );
  await expect(page.locator('.language-picker__summary')).toHaveText(
    '2 chosen: English, Ukrainian',
  );
  await expect(
    page.getByText(
      'We could not identify the business or site type and who it is for in the homepage’s public metadata, so those stay empty — fill them in yourself.',
    ),
  ).toBeVisible();
  await expect.poll(() => profileWrites).toBe(0);
  const profilePanels = page.locator('.desktop__grid > .window').first().locator('.panel');
  const [listBox, formBox] = await Promise.all([
    profilePanels.nth(0).boundingBox(),
    profilePanels.nth(1).boundingBox(),
  ]);
  expect(listBox).not.toBeNull();
  expect(formBox).not.toBeNull();
  expect(formBox!.y - (listBox!.y + listBox!.height)).toBeGreaterThanOrEqual(15);
  await page.screenshot({
    path: '.agent-tmp/profile-autofill/desktop-success.png',
    fullPage: true,
  });
});

// The picker used to open inside the form, walking the fields under it down the
// page every time. Anchored, it must leave them where they are — and still let
// more than one language be chosen before it closes.
test('the language dropdown floats over the form and takes several choices', async ({
  page,
  baseURL,
}) => {
  await isolate(page, new URL(baseURL!).origin, baseApi);
  await page.goto('/profiles');
  await dismissCookies(page);
  await page.getByRole('button', { name: '+ Add a site' }).click();
  await page.getByText(/Describe the site for AI visibility checks/).click();
  const audience = page.getByPlaceholder('Adults and families looking for a dentist in Kyiv');
  // Page coordinates, not viewport ones: clicking the trigger scrolls it into
  // view, which would move every viewport-relative box on its own.
  const pageTop = (locator: Locator): Promise<number> =>
    locator.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);

  const trigger = page.locator('.language-picker__summary');
  await trigger.scrollIntoViewIfNeeded();
  const before = await pageTop(audience);
  await trigger.click();
  const popup = page.locator('.language-picker__popup');
  await expect(popup).toBeVisible();
  expect(await pageTop(audience)).toBeCloseTo(before, 0);
  // The three supported choices can fit above the next field. Its location is
  // the invariant: the popup is anchored and does not reflow the form.

  await page.getByRole('checkbox', { name: 'Ukrainian' }).click();
  await expect(popup).toBeVisible();
  await page.getByRole('checkbox', { name: 'English' }).click();
  await expect(popup).toBeVisible();
  await expect(trigger).toHaveText('2 chosen: Ukrainian, English');

  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText('2 chosen: Ukrainian, English');
});

test('a late public proposal cannot replace a manual profile name', async ({ page, baseURL }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await isolate(page, new URL(baseURL!).origin, async (route) => {
    if (new URL(route.request().url()).pathname === '/profiles/suggestions') {
      await pending;
      return json(route, { name: 'Late public title' });
    }
    return baseApi(route);
  });
  await page.goto('/profiles');
  await dismissCookies(page);
  await page.getByRole('button', { name: '+ Add a site' }).click();
  // The name is written first: the form holds that field while it reads the
  // site, so the owner's own answer is the one that was already there.
  await page.getByRole('textbox', { name: 'Display name' }).fill('Manual title');
  await page.getByRole('textbox', { name: /Site address/ }).fill('manual.example');
  await page.getByText(/Describe the site for AI visibility checks/).click();
  await page.getByRole('button', { name: 'Fill from site' }).click();
  await expect(page.getByRole('textbox', { name: 'Display name' })).toBeDisabled();
  release();
  await expect(page.getByRole('textbox', { name: 'Display name' })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('Manual title');
});

test('the language dropdown stays inside a narrow screen', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    isMobile: true,
    hasTouch: true,
    viewport: { width: 360, height: 780 },
  });
  const page = await context.newPage();
  try {
    await isolate(page, new URL(baseURL!).origin, baseApi);
    await page.goto('/profiles');
    await dismissCookies(page);
    await page.getByRole('button', { name: '+ Add a site' }).click();
    await page.getByText(/Describe the site for AI visibility checks/).click();
    await page.locator('.language-picker__summary').click();
    const popup = await page.locator('.language-picker__popup').boundingBox();
    expect(popup!.x).toBeGreaterThanOrEqual(0);
    expect(popup!.x + popup!.width).toBeLessThanOrEqual(360);
    // The list scrolls inside the pop-up instead of running off the screen.
    expect(popup!.height).toBeLessThanOrEqual(300);
    await page.screenshot({
      path: '.agent-tmp/profile-autofill/mobile-language-dropdown.png',
      fullPage: false,
    });
  } finally {
    await context.close();
  }
});

test('mobile surfaces a failed suggestion while retaining a saveable manual form', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await isolate(page, new URL(baseURL!).origin, async (route) => {
      if (new URL(route.request().url()).pathname === '/profiles/suggestions')
        return json(route, null, 503);
      return baseApi(route);
    });
    await page.goto('/profiles');
    await dismissCookies(page);
    await page.getByRole('button', { name: '+ Add a site' }).click();
    await page.getByRole('textbox', { name: 'Display name' }).fill('Manual profile');
    await page.getByRole('textbox', { name: /Site address/ }).fill('manual.example');
    await page.getByText(/Describe the site for AI visibility checks/).click();
    await page.getByRole('button', { name: 'Fill from site' }).click();
    await expect(
      page.getByText(
        'Could not read public details from this site. You can still save it manually.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save profile' })).toBeEnabled();
    await page.screenshot({
      path: '.agent-tmp/profile-autofill/mobile-failure.png',
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

// The form reads the site on its own once an address is complete. In a real
// browser that means: the fields fill with nothing pressed, the request goes out
// once however the address was typed, nothing is saved, and a site that refuses
// us says so where the address was typed rather than in a silent failure.
test('fills the form from a pasted address with no button pressed, and saves nothing', async ({
  page,
  baseURL,
}) => {
  let reads = 0;
  let writes = 0;
  await isolate(page, new URL(baseURL!).origin, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/profiles/suggestions') {
      reads += 1;
      return json(route, { name: 'Public title', industry: 'Dental clinic' });
    }
    if (method !== 'GET' && (url.pathname === '/profiles' || url.pathname.startsWith('/scans')))
      writes += 1;
    return baseApi(route);
  });
  await page.goto('/profiles');
  await dismissCookies(page);
  await page.getByRole('button', { name: '+ Add a site' }).click();
  await page.getByRole('textbox', { name: /Site address/ }).fill('public.example');

  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('Public title');
  await expect(
    page.getByText(
      'Filled in what this site’s homepage states. Review it in the section below before saving.',
    ),
  ).toBeVisible();
  await page.getByText(/Describe the site for AI visibility checks/).click();
  await expect(
    page.getByPlaceholder('Dental clinic, recruiting platform, online store'),
  ).toHaveValue('Dental clinic');
  expect(reads).toBe(1);
  expect(writes).toBe(0);
  await page.screenshot({
    path: '.agent-tmp/profile-autofill/auto-success.png',
    fullPage: true,
  });
});

test('asks the site once for an address typed a character at a time', async ({ page, baseURL }) => {
  const asked: string[] = [];
  await isolate(page, new URL(baseURL!).origin, async (route) => {
    if (new URL(route.request().url()).pathname === '/profiles/suggestions') {
      asked.push(JSON.parse(route.request().postData() ?? '{}').domain as string);
      return json(route, { industry: 'Dental clinic' });
    }
    return baseApi(route);
  });
  await page.goto('/profiles');
  await dismissCookies(page);
  await page.getByRole('button', { name: '+ Add a site' }).click();
  // Every keystroke from "typed.e" onwards is a complete address on its own,
  // which is what the delay in front of the read exists for.
  await page
    .getByRole('textbox', { name: /Site address/ })
    .pressSequentially('typed.example', { delay: 40 });

  await expect(
    page.getByPlaceholder('Dental clinic, recruiting platform, online store'),
  ).toHaveValue('Dental clinic');
  // Given a moment more, a second read would have shown up by now.
  await page.waitForTimeout(1_200);
  expect(asked).toEqual(['https://typed.example']);
});

// Typing a path after the address, or pasting it again, is the same site: the
// read already running stays, and what it filled in is not taken away and not
// asked for twice.
test('keeps the read and the filled fields when the address is edited inside one site', async ({
  page,
  baseURL,
}) => {
  const asked: string[] = [];
  await isolate(page, new URL(baseURL!).origin, async (route) => {
    if (new URL(route.request().url()).pathname === '/profiles/suggestions') {
      asked.push(JSON.parse(route.request().postData() ?? '{}').domain as string);
      return json(route, { name: 'Public title', industry: 'Dental clinic' });
    }
    return baseApi(route);
  });
  await page.goto('/profiles');
  await dismissCookies(page);
  await page.getByRole('button', { name: '+ Add a site' }).click();
  const address = page.getByRole('textbox', { name: /Site address/ });
  await address.fill('public.example');
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('Public title');

  await address.fill('public.example/pricing');
  await page.waitForTimeout(1_200);

  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('Public title');
  await expect(
    page.getByText(
      'Filled in what this site’s homepage states. Review it in the section below before saving.',
    ),
  ).toBeVisible();
  await page.getByText(/Describe the site for AI visibility checks/).click();
  await expect(
    page.getByPlaceholder('Dental clinic, recruiting platform, online store'),
  ).toHaveValue('Dental clinic');
  expect(asked).toEqual(['https://public.example']);
});

// The owner pastes one site, then another: the first site's answer must not be
// left behind in the fields of a profile that is now about the second.
test('replaces one site’s filled-in answer when the address moves to another', async ({
  page,
  baseURL,
}) => {
  await isolate(page, new URL(baseURL!).origin, async (route) => {
    if (new URL(route.request().url()).pathname === '/profiles/suggestions') {
      const asked = JSON.parse(route.request().postData() ?? '{}').domain as string;
      return json(
        route,
        asked === 'https://first.example'
          ? { name: 'First title', industry: 'Dental clinic', region: 'Kyiv' }
          : { name: 'Second title', industry: 'Product studio', region: 'United States' },
      );
    }
    return baseApi(route);
  });
  await page.goto('/profiles');
  await dismissCookies(page);
  await page.getByRole('button', { name: '+ Add a site' }).click();
  const address = page.getByRole('textbox', { name: /Site address/ });
  await address.fill('first.example');
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('First title');
  await page.getByText(/Describe the site for AI visibility checks/).click();
  await expect(page.getByPlaceholder('Kyiv and Kyiv region, Ukraine')).toHaveValue('Kyiv');

  await address.fill('second.example');

  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('Second title');
  await expect(
    page.getByPlaceholder('Dental clinic, recruiting platform, online store'),
  ).toHaveValue('Product studio');
  await expect(page.getByPlaceholder('Kyiv and Kyiv region, Ukraine')).toHaveValue('United States');
  await page.screenshot({
    path: '.agent-tmp/profile-autofill/auto-resite.png',
    fullPage: true,
  });
});

// The owner asked for the form to stop taking actions until the check has
// finished. In a real browser that means the fields and the row actions are
// genuinely unusable — not styled as if they were — and that there is one
// deliberate way out of the wait, offered for as long as it lasts.
test('holds the form and the row actions while it reads a site, and takes Cancel', async ({
  page,
  baseURL,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await isolate(page, new URL(baseURL!).origin, async (route) => {
    if (new URL(route.request().url()).pathname === '/profiles/suggestions') {
      await held;
      return json(route, { name: 'Public title', industry: 'Dental clinic' });
    }
    return baseApi(route);
  });
  await page.goto('/profiles');
  await dismissCookies(page);
  await page.getByRole('button', { name: '+ Add a site' }).click();
  await page.getByRole('textbox', { name: /Site address/ }).fill('public.example');
  await page.getByText(/Describe the site for AI visibility checks/).click();

  await expect(page.getByText(/Checking whether we can read this site/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Display name' })).toBeDisabled();
  await expect(
    page.getByPlaceholder('Dental clinic, recruiting platform, online store'),
  ).toBeDisabled();
  await expect(page.getByPlaceholder('Acme Dental, Bright Smile Clinic')).toBeDisabled();
  await expect(page.locator('.language-picker__summary')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  // The saved site's own row cannot replace the form under it either.
  await expect(page.getByRole('button', { name: 'New scan' })).toBeDisabled();
  await page.getByRole('button', { name: 'Actions for Existing site' }).click();
  await expect(page.getByRole('menuitem', { name: 'Edit profile' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Reports' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.screenshot({
    path: '.agent-tmp/profile-autofill/pending-lock.png',
    fullPage: true,
  });

  // The address stays writable: editing it is not a race with the read but the
  // end of it, and Cancel is the deliberate way out of the wait.
  await expect(page.getByRole('textbox', { name: /Site address/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Cancel editing' })).toBeEnabled();

  release();
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('Public title');
  await expect(page.getByRole('textbox', { name: 'Display name' })).toBeEnabled();
  await expect(
    page.getByPlaceholder('Dental clinic, recruiting platform, online store'),
  ).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'New scan' })).toBeEnabled();
  await page.screenshot({
    path: '.agent-tmp/profile-autofill/settled-form.png',
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Cancel editing' }).click();
  await expect(page.getByRole('textbox', { name: /Site address/ })).toHaveCount(0);
});

// A homepage that states nothing is still a finished check: the fields it could
// not fill are the owner's to write, and folded away they read as a form with
// nothing left to do.
test('unfolds the context section for a homepage that states nothing', async ({
  page,
  baseURL,
}) => {
  await isolate(page, new URL(baseURL!).origin, async (route) => {
    if (new URL(route.request().url()).pathname === '/profiles/suggestions') return json(route, {});
    return baseApi(route);
  });
  await page.goto('/profiles');
  await dismissCookies(page);
  await page.getByRole('button', { name: '+ Add a site' }).click();
  await expect(page.locator('details.profile-context')).not.toHaveAttribute('open', '');
  await page.getByRole('textbox', { name: /Site address/ }).fill('empty.example');

  await expect(page.getByText(/states nothing we could reuse/)).toBeVisible();
  await expect(page.locator('details.profile-context')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeEnabled();
});

test('names a site that refused our crawler and still allows a manual save', async ({
  page,
  baseURL,
}) => {
  await isolate(page, new URL(baseURL!).origin, async (route) => {
    if (new URL(route.request().url()).pathname === '/profiles/suggestions')
      return refusal(route, 'SITE_ACCESS_DENIED', 'this site refused our crawler');
    return baseApi(route);
  });
  await page.goto('/profiles');
  await dismissCookies(page);
  await page.getByRole('button', { name: '+ Add a site' }).click();
  await page.getByRole('textbox', { name: /Site address/ }).fill('walled.example');

  await expect(
    page.getByText(/We could not read this site, so nothing was filled in\./),
  ).toBeVisible();
  await expect(page.getByText(/Allow FluxRadarBot and the address it comes from/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeEnabled();
  await page.getByText(/Describe the site for AI visibility checks/).click();
  await expect(
    page.getByPlaceholder('Dental clinic, recruiting platform, online store'),
  ).toHaveValue('');
  await page.screenshot({
    path: '.agent-tmp/profile-autofill/auto-blocked.png',
    fullPage: true,
  });
});

test('fills localized context in one request without changing target languages', async ({
  page,
  baseURL,
}) => {
  await isolate(page, new URL(baseURL!).origin, async (route) => {
    if (new URL(route.request().url()).pathname === '/profiles/suggestions')
      return json(route, { industry: 'Localized studio' });
    return baseApi(route);
  });
  await page.goto('/profiles');
  await dismissCookies(page);
  await page.getByRole('button', { name: '+ Add a site' }).click();
  await page.getByRole('textbox', { name: /Site address/ }).fill('studio.example');
  await page.getByText(/Describe the site for AI visibility checks/).click();
  const industry = page.getByPlaceholder('Dental clinic, recruiting platform, online store');
  await page.getByRole('button', { name: 'Fill from site' }).click();
  await expect(industry).toHaveValue('Localized studio');
  await expect(page.getByRole('button', { name: /Translate context/ })).toHaveCount(0);
  await expect(page.locator('.language-picker__summary')).toHaveText('Choose languages');
  await expect(page.getByRole('button', { name: 'Restore original text' })).toHaveCount(0);
});

// The reload that used to throw a half-written profile away, in a real browser:
// what the form held comes back, the context section it filled comes back open,
// and a read that was still running when the page went is started again rather
// than left as a form that is quietly waiting for nothing.
test('a half-written profile and the read it was waiting for survive a reload', async ({
  page,
  baseURL,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  await isolate(page, new URL(baseURL!).origin, async (route) => {
    if (new URL(route.request().url()).pathname === '/profiles/suggestions') {
      reads += 1;
      // No read answers until the test lets it: the first one is the request the
      // reload kills, and the second is the resumed one, which has to be caught
      // still running rather than already finished.
      await held;
      return json(route, { industry: 'Dentist' });
    }
    return baseApi(route);
  });
  await page.goto('/profiles');
  await dismissCookies(page);
  await page.getByRole('button', { name: '+ Add a site' }).click();
  // The name first, the address second: writing in a field the read could fill
  // is how the owner calls it off, so the order is what leaves a read owed and
  // a value of the owner's own in the same form.
  await page.getByRole('textbox', { name: 'Display name' }).fill('Written by hand');
  await page.getByRole('textbox', { name: /Site address/ }).fill('clinic.example');
  await expect(page.getByText(/Checking whether we can read this site/)).toBeVisible();
  // Saving is held while the read is owed, so a profile cannot be stored a
  // keystroke before the form fills itself in.
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  // The wait is shown as soon as the address is complete, but the request only
  // leaves after the debounce. Reloading before it does would make the resumed
  // read the first one the handler ever sees, and the count below would stop at
  // one. Wait for the request the reload is supposed to kill to exist.
  await expect.poll(() => reads, { timeout: 15_000 }).toBe(1);

  await page.reload();
  await dismissCookies(page);

  // The address and the owner's own name are back, and so is the wait.
  await expect(page.getByRole('textbox', { name: /Site address/ })).toHaveValue('clinic.example');
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('Written by hand');
  await expect(page.getByText(/Checking whether we can read this site/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  // Asked again: a request cannot survive a page, so the resumed wait is a new
  // one rather than a spinner over nothing. More than one resumed read is the
  // dev server's StrictMode double-mount, not a second site read the owner
  // caused, so the invariant is "the read came back", not an exact count. The
  // budget is wide because the reload reopens the page against the dev server,
  // which under a full parallel suite can take longer than the default poll.
  await expect.poll(() => reads, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

  release();
  // The resumed read answers, and what it wrote is unfolded for review rather
  // than left behind a closed disclosure.
  await expect(
    page.getByPlaceholder('Dental clinic, recruiting platform, online store'),
  ).toHaveValue('Dentist');
  await expect(page.locator('details.profile-context')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeEnabled();
  // The name the owner typed is theirs, before the reload and after it.
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('Written by hand');
  await page.screenshot({
    path: '.agent-tmp/profile-autofill/reload-resumes.png',
    fullPage: true,
  });
});
