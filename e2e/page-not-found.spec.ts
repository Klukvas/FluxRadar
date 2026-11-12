import { expect, test } from '@playwright/test';

// A visitor who is not signed in. Anything but the app's own files is blocked,
// so the page can only show what it computes from the address.
test.beforeEach(async ({ page, baseURL }) => {
  const appOrigin = new URL(baseURL ?? '').origin;
  await page.context().route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === appOrigin && request.method() === 'GET') {
      await route.continue();
    } else if (url.pathname === '/auth/me') {
      await route.fulfill({
        status: 401,
        json: { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Sign in' } },
      });
    } else if (url.pathname === '/auth/google/status') {
      await route.fulfill({ json: { success: true, data: { enabled: false }, error: null } });
    } else {
      await route.abort('blockedbyclient');
    }
  });
});

test('an address that names nothing says the page was not found', async ({ page }) => {
  await page.goto('/no-such-page');

  await expect(page.getByText('Page not found')).toBeVisible();
  await page.getByRole('button', { name: 'Go to the home page' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('/login opens the sign-in dialog', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a private scan address asks a visitor to sign in', async ({ page }) => {
  await page.goto('/scans/abc');

  await expect(page.getByRole('dialog')).toBeVisible();
});
