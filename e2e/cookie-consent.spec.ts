import { expect, test } from '@playwright/test';

test.describe('cookie choices on public legal pages', () => {
  test('opens centred on a suggested choice, stores nothing until saved, and reopens settings', async ({
    page,
  }) => {
    await page.goto('/terms?lang=en');

    const banner = page.getByRole('region', { name: 'Cookies & storage' });
    const master = banner.getByRole('checkbox', { name: 'All optional storage' });
    const save = banner.getByRole('button', { name: 'Save choice' });
    await expect(banner).toBeVisible();
    await expect(master).toBeChecked();
    await expect(banner.getByRole('checkbox', { name: 'Preferences' })).toBeChecked();
    await expect(banner.getByRole('checkbox', { name: 'Analytics' })).toBeChecked();
    await expect(save).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Cookie details' })).toHaveAttribute(
      'href',
      '/cookies?lang=en',
    );
    // Suggested, not applied: nothing is in storage before Save is pressed.
    expect(await page.evaluate(() => localStorage.getItem('fluxradar.cookieConsent'))).toBeNull();

    // Centred on the viewport, within a few pixels of both axes: the panel used
    // to sit in the bottom-right corner, where it read as a badge.
    const [box, viewport] = await Promise.all([
      banner.boundingBox(),
      page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      })),
    ]);
    expect(box).not.toBeNull();
    const centre = {
      x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
      y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
    };
    expect(Math.abs(centre.x - viewport.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(centre.y - viewport.height / 2)).toBeLessThanOrEqual(2);

    // The banner floats: at this desktop width choosing does not change the
    // length of the page. Desktop only — at 600px and below the lone settings
    // launcher joins the page flow under the footer, so the document grows by
    // its height.
    const heightWithBanner = await page.evaluate(() => document.documentElement.scrollHeight);
    await master.click();
    await save.click();
    await expect(banner).toBeHidden();
    await expect(page.getByRole('button', { name: 'Cookie settings' }).first()).toBeVisible();
    const heightAfterChoice = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(heightAfterChoice).toBe(heightWithBanner);
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem('fluxradar.cookieConsent') ?? 'null'),
      ),
    ).toMatchObject({ version: 'v2', preferences: false, analytics: false });

    await page.reload();
    await expect(banner).toBeHidden();
    await page.getByRole('button', { name: 'Cookie settings' }).first().click();
    await expect(banner).toBeVisible();
    // The refusal comes back as a refusal, not as the suggestion again.
    await expect(banner.getByRole('checkbox', { name: 'All optional storage' })).not.toBeChecked();
  });

  test('stays usable on a narrow viewport without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/privacy?lang=en');

    const banner = page.getByRole('region', { name: 'Cookies & storage' });
    const master = banner.getByRole('checkbox', { name: 'All optional storage' });
    const save = banner.getByRole('button', { name: 'Save choice' });
    await expect(banner).toBeVisible();
    await expect(master).toBeVisible();
    await expect(save).toBeVisible();

    const [bannerBox, saveBox, overflow] = await Promise.all([
      banner.boundingBox(),
      save.boundingBox(),
      page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      })),
    ]);
    expect(bannerBox).not.toBeNull();
    expect(saveBox).not.toBeNull();
    expect(overflow.horizontal).toBe(false);
    // The panel fits the phone it is centred on, and the one control that
    // commits the choice is on screen without scrolling the page.
    expect((bannerBox?.height ?? 0) <= overflow.height).toBe(true);
    expect((saveBox?.y ?? 0) + (saveBox?.height ?? 0)).toBeLessThanOrEqual(overflow.height);
    // A 44px tap target, the size every other control on a phone keeps here.
    expect(saveBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    // The individual categories are still reachable on the small screen.
    await banner.getByRole('checkbox', { name: 'Analytics' }).click();
    await expect(banner.getByRole('checkbox', { name: 'Preferences' })).toBeChecked();
    await expect(master).not.toBeChecked();
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
