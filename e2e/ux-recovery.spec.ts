import { expect, test, type Page, type Route } from '@playwright/test';

const API = 'http://127.0.0.1:3310';
const account = {
  accountId: 'account-e2e',
  email: 'e2e@example.test',
  emailVerified: true,
  onboarding: { status: 'completed' },
};
const profile = {
  id: 'profile-e2e',
  name: 'Example',
  domain: 'https://example.test',
  targetLanguages: 'en',
};
const scan = (ready: boolean) => ({
  id: 'scan-e2e',
  profileId: profile.id,
  plan: 'Complete',
  domain: profile.domain,
  status: 'Completed',
  reportReady: ready,
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'test',
  progress: { completedModules: 2, totalModules: 2 },
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:01:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  modules: [],
});

function json(route: Route, data: unknown): Promise<void> {
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data, error: null }),
  });
}
async function isolate(page: Page, app: string, handler: (route: Route) => Promise<void>) {
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === app && route.request().method() === 'GET') return route.continue();
    if (url.origin === API) return handler(route);
    return route.abort('blockedbyclient');
  });
}
async function baseApi(route: Route, reportReady = true): Promise<void> {
  const path = new URL(route.request().url()).pathname;
  if (path === '/auth/me') return json(route, account);
  if (path === '/profiles') return json(route, [profile]);
  if (path.startsWith('/billing/checkout-session/')) {
    return json(route, { status: 'pending', scanId: null, purchaseId: null, reasonCode: null });
  }
  if (path.endsWith('/active')) return json(route, null);
  if (path === '/scans') return json(route, []);
  if (path === '/scans/scan-e2e') return json(route, scan(reportReady));
  if (path === '/scans/scan-e2e/dashboard')
    return json(route, {
      scan: scan(reportReady),
      overall: { score: 70, verdict: 'good', weightedCoverage: 1, moduleWeights: [] },
      modules: [],
      geoObservations: [],
      geoEvidence: null,
    });
  return json(route, []);
}

async function dismissCookies(page: Page): Promise<void> {
  const consent = page.getByRole('region', { name: 'Cookies & storage' });
  if (await consent.isVisible())
    await consent.getByRole('button', { name: 'Only necessary' }).click();
}

test('restored checkout can resume or explicitly stop tracking', async ({ page, baseURL }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'fluxradar.pendingCheckout',
      JSON.stringify({
        accountId: 'account-e2e',
        reference: 'checkout-e2e',
        sessionId: 'session-e2e',
        checkoutUrl: 'https://checkout.example.test/pay',
        storefront: null,
      }),
    ),
  );
  await isolate(page, new URL(baseURL!).origin, (route) => baseApi(route));
  await page.goto('/profiles');
  await dismissCookies(page);
  const close = page.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeVisible();
  if (await close.isVisible()) await close.click();
  await expect(
    page.getByText('Payment confirmation is paused. Your checkout is still active.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Resume payment confirmation' }).click();
  await expect(
    page.getByText('Payment confirmation is paused. Your checkout is still active.'),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop tracking this checkout' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop tracking this checkout' }).click();
  await expect(
    page.getByText('Payment confirmation is paused. Your checkout is still active.'),
  ).toHaveCount(0);
  await expect(
    page.evaluate(() => localStorage.getItem('fluxradar.pendingCheckout')),
  ).resolves.toBeNull();
  await page.screenshot({
    path: '.agent-tmp/terra-architecture-browser/checkout-recovery.png',
    fullPage: true,
  });
});

test('terminal scan keeps progress polling until report readiness', async ({ page, baseURL }) => {
  let reads = 0;
  let ready = false;
  await isolate(page, new URL(baseURL!).origin, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/scans/scan-e2e') {
      reads += 1;
      return json(route, scan(ready));
    }
    return baseApi(route, false);
  });
  await page.goto('/scans/scan-e2e');
  await dismissCookies(page);
  await expect(page.getByText('Finalizing report…')).toBeVisible();
  await expect.poll(() => reads).toBeGreaterThan(1);
  ready = true;
  await expect(page.getByText('Finalizing report…')).toHaveCount(0, { timeout: 6_000 });
});

test('dirty scan dialog traps keyboard focus, restores it on Escape, and has touch targets', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 700 },
  });
  const page = await context.newPage();
  try {
    await isolate(page, new URL(baseURL!).origin, (route) => baseApi(route));
    await page.goto('/scan');
    await dismissCookies(page);
    await page.getByRole('combobox', { name: 'Profile' }).selectOption('new-address');
    await page.getByRole('textbox', { name: 'Site address' }).fill('dirty.example.test');
    const close = page.getByRole('button', { name: 'Close window' });
    await close.click();

    const dialog = page.getByRole('dialog', { name: 'Discard unsaved scan setup?' });
    const keep = dialog.getByRole('button', { name: 'Keep editing' });
    const discard = dialog.getByRole('button', { name: 'Discard changes' });
    await expect(keep).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(discard).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(keep).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(discard).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(keep).toBeFocused();
    await page.screenshot({
      path: '.agent-tmp/terra-architecture-browser/discard-dialog.png',
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(close).toBeFocused();

    const box = await close.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(40);
  } finally {
    await context.close();
  }
});
