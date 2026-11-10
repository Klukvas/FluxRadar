import { expect, test } from '@playwright/test';

// Desktop browser emulation cannot reproduce native iPhone keyboard zoom.
// Guard its CSS trigger at the actual focused login fields instead.
for (const scenario of [
  { name: 'phone portrait', viewport: { width: 390, height: 844 }, hasTouch: true },
  { name: 'phone landscape', viewport: { width: 844, height: 390 }, hasTouch: true },
  { name: 'tablet', viewport: { width: 820, height: 1180 }, hasTouch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, hasTouch: false },
]) {
  test.describe(scenario.name, () => {
    test.use({ viewport: scenario.viewport, hasTouch: scenario.hasTouch });

    test('keeps login fields readable without restricting page zoom', async ({ page, baseURL }) => {
      const appOrigin = new URL(baseURL ?? '').origin;
      await page.context().route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === appOrigin && request.method() === 'GET') {
          await route.continue();
        } else if (url.pathname === '/auth/me') {
          await route.fulfill({
            status: 401,
            json: {
              success: false,
              data: null,
              error: { code: 'UNAUTHORIZED', message: 'Sign in' },
            },
          });
        } else if (url.pathname === '/auth/google/status') {
          await route.fulfill({ json: { success: true, data: { enabled: false }, error: null } });
        } else {
          await route.abort('blockedbyclient');
        }
      });

      await page.goto('/');
      await page.getByRole('button', { name: 'Only necessary', exact: true }).click();
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      for (const name of ['email', 'password']) {
        const field = dialog.locator(`input[name="${name}"]`);
        await field.click();
        await expect(field).toBeFocused();
        await expect(field).toHaveCSS('font-size', scenario.hasTouch ? '16px' : '13px');
      }

      expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(
        scenario.hasTouch,
      );
      const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
      expect(viewport).toContain('width=device-width');
      expect(viewport).not.toMatch(/user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=/i);
    });
  });
}
