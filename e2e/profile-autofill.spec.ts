import { expect, test, type Page, type Route } from '@playwright/test';

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
      return json(route, {
        name: 'Public title',
        businessDescription: 'Public description',
        offerings: 'Service one, Service two',
        targetLanguages: 'en',
      });
    }
    if (path === '/profiles' && route.request().method() !== 'GET') profileWrites += 1;
    return baseApi(route);
  });
  await page.goto('/profiles');
  await dismissCookies(page);
  await page.getByRole('button', { name: '+ Add a site' }).click();
  await page.getByRole('textbox', { name: /Site address/ }).fill('public.example');
  await page.getByRole('button', { name: 'Get details from site' }).click();
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('Public title');
  await expect(
    page.getByText('Suggested from the public homepage. Review and edit before saving.'),
  ).toBeVisible();
  await page.getByText(/Describe the site for AI visibility checks/).click();
  await expect(
    page.getByPlaceholder('A private dental clinic helping families in Kyiv…'),
  ).toHaveValue('Public description');
  await expect(
    page.getByPlaceholder('Dental implants, cleanings, emergency appointments'),
  ).toHaveValue('Service one, Service two');
  await expect(page.locator('.language-picker__summary')).toHaveText('English');
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
  await page.getByRole('button', { name: 'Get details from site' }).click();
  await page.getByRole('textbox', { name: 'Display name' }).fill('Manual title');
  release();
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('Manual title');
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
    await page.getByRole('button', { name: 'Get details from site' }).click();
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
