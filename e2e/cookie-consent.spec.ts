import { expect, test } from '@playwright/test';

test.describe('cookie choices on public legal pages', () => {
  test('offers equal first-visit choices, persists refusal, and reopens settings', async ({
    page,
  }) => {
    await page.goto('/terms?lang=en');

    const banner = page.getByRole('region', { name: 'Cookies & storage' });
    const necessary = banner.getByRole('button', { name: 'Only necessary' });
    const preferences = banner.getByRole('button', { name: 'Allow all' });
    await expect(banner).toBeVisible();
    await expect(necessary).toBeVisible();
    await expect(preferences).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Cookie details' })).toHaveAttribute(
      'href',
      '/cookies?lang=en',
    );

    const necessaryBox = await necessary.boundingBox();
    const preferencesBox = await preferences.boundingBox();
    expect(necessaryBox?.width).toBe(preferencesBox?.width);

    const heightWithBanner = await page.evaluate(() => document.documentElement.scrollHeight);
    await necessary.click();
    await expect(banner).toBeHidden();
    await expect(page.getByRole('button', { name: 'Cookie settings' })).toBeVisible();
    const heightAfterChoice = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(heightAfterChoice).toBe(heightWithBanner);

    await page.reload();
    await expect(banner).toBeHidden();
    await page.getByRole('button', { name: 'Cookie settings' }).click();
    await expect(banner).toBeVisible();
  });

  test('stacks the choices on a narrow viewport without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/privacy?lang=en');

    const banner = page.getByRole('region', { name: 'Cookies & storage' });
    const necessary = banner.getByRole('button', { name: 'Only necessary' });
    const preferences = banner.getByRole('button', { name: 'Allow all' });
    await expect(banner).toBeVisible();
    await expect(necessary).toBeVisible();
    await expect(preferences).toBeVisible();

    const [necessaryBox, preferencesBox, hasHorizontalOverflow] = await Promise.all([
      necessary.boundingBox(),
      preferences.boundingBox(),
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ]);
    expect(necessaryBox).not.toBeNull();
    expect(preferencesBox).not.toBeNull();
    expect((preferencesBox?.y ?? 0) > (necessaryBox?.y ?? 0)).toBe(true);
    expect(hasHorizontalOverflow).toBe(false);
  });

  test('uses the same localized, mobile-safe choices on the static blog', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/blog?lang=uk');

    const banner = page.getByRole('region', { name: 'Cookies і сховище' });
    const necessary = banner.getByRole('button', { name: 'Лише необхідні' });
    const preferences = banner.getByRole('button', { name: 'Дозволити все' });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Докладніше про cookies' })).toHaveAttribute(
      'href',
      '/cookies?lang=uk',
    );

    const [necessaryBox, preferencesBox, hasHorizontalOverflow] = await Promise.all([
      necessary.boundingBox(),
      preferences.boundingBox(),
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ]);
    expect((preferencesBox?.y ?? 0) > (necessaryBox?.y ?? 0)).toBe(true);
    expect(hasHorizontalOverflow).toBe(false);

    await preferences.click();
    await expect(banner).toBeHidden();
    await expect(page.getByRole('button', { name: 'Налаштування cookies' })).toBeVisible();
    expect(
      await page.evaluate(() => ({
        language: localStorage.getItem('fluxradar.language'),
        consent: JSON.parse(localStorage.getItem('fluxradar.cookieConsent') ?? 'null'),
      })),
    ).toMatchObject({
      language: 'uk',
      consent: { version: 'v2', preferences: true, analytics: true },
    });
  });
});
