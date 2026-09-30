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
  if (await banner.isVisible())
    await banner.getByRole('button', { name: 'Only necessary' }).click();
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
  await page.getByRole('textbox', { name: /Site address/ }).fill('manual.example');
  await page.getByText(/Describe the site for AI visibility checks/).click();
  await page.getByRole('button', { name: 'Fill from site' }).click();
  await page.getByRole('textbox', { name: 'Display name' }).fill('Manual title');
  release();
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
    await page.getByRole('textbox', { name: /Site address/ }).fill('manual.example');
    await page.getByRole('textbox', { name: 'Display name' }).fill('Manual profile');
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
