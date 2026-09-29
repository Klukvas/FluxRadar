// Browser checks for the customer paths that cross the application boundary.
// The API is a stateful local fixture; every other origin is blocked so consent,
// analytics, payment and provider scripts cannot perform a real side effect.

import { expect, test, type Page, type Route } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:3310';
const EMAIL = 'owner@example.test';

function response(route: Route, data: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ success: status < 400, data: status < 400 ? data : null, error: null }),
  });
}

function failure(route: Route, status: number, message: string): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({
      success: false,
      data: null,
      error: { code: 'TEST_ERROR', message },
    }),
  });
}

async function isolate(
  page: Page,
  appOrigin: string,
  api: (route: Route) => Promise<void>,
): Promise<void> {
  await page.context().routeWebSocket('**/*', async (socket) => {
    if (new URL(socket.url()).origin === appOrigin) socket.connectToServer();
    else await socket.close();
  });
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin && route.request().method() === 'GET') {
      await route.continue();
      return;
    }
    if (url.origin === API_ORIGIN) {
      await api(route);
      return;
    }
    await route.abort('blockedbyclient');
  });
}

async function dismissCookies(page: Page): Promise<void> {
  const banner = page.getByRole('region', { name: 'Cookies & storage' });
  if (await banner.isVisible())
    await banner.getByRole('button', { name: 'Only necessary' }).click();
}

test.describe('critical customer journeys', () => {
  test('registration surfaces an email provider failure without claiming delivery', async ({
    page,
    baseURL,
  }) => {
    await isolate(page, new URL(baseURL ?? '').origin, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/auth/me') return failure(route, 401, 'session required');
      if (path === '/auth/register') {
        return response(
          route,
          {
            accountId: 'account-e2e',
            email: EMAIL,
            emailVerified: false,
            emailVerification: { status: 'provider-error' },
          },
          201,
        );
      }
      if (path === '/profiles') return response(route, []);
      return failure(route, 404, `unexpected API request: ${path}`);
    });

    await page.goto('/');
    await dismissCookies(page);
    await page.getByRole('button', { name: 'Run a free homepage check' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Email' }).fill(EMAIL);
    await dialog.getByRole('textbox', { name: 'Password' }).fill('valid-password');
    await dialog.getByRole('button', { name: 'Create account' }).click();

    await expect(
      page.getByText('The confirmation email could not be delivered. Try again later.'),
    ).toBeVisible();
    await expect(page.getByText(`we sent a link to ${EMAIL}`, { exact: false })).toHaveCount(0);
    await page.screenshot({ path: '.agent-tmp/email-provider-failure.png', fullPage: true });
  });

  test('retries a temporary session bootstrap failure and returns to a usable home screen', async ({
    page,
    baseURL,
  }) => {
    let sessionReads = 0;
    await isolate(page, new URL(baseURL ?? '').origin, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/auth/me') {
        sessionReads += 1;
        return sessionReads === 1
          ? failure(route, 503, 'FluxRadar is temporarily unavailable. Try again in a moment.')
          : failure(route, 401, 'session required');
      }
      return failure(route, 404, `unexpected API request: ${path}`);
    });

    await page.goto('/');
    await expect(page.getByText('FluxRadar is unavailable')).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'One URL. Every signal.' })).toBeVisible();
    expect(sessionReads).toBeGreaterThanOrEqual(2);
  });
});
