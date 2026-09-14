import { expect, test, type Page, type Route } from '@playwright/test';

const API_URL = 'http://127.0.0.1:3310';
const APP_URL = 'http://127.0.0.1:4173';

type Binding = {
  readonly siteProfileId: string;
  readonly searchConsoleSiteUrl: string | null;
  readonly ga4PropertyId: string | null;
  readonly ga4PropertyName: string | null;
  readonly updatedAt: string;
};

const profiles = [
  { id: 'profile-jobber', name: 'jobber-app.com', domain: 'https://jobber-app.com' },
  { id: 'profile-clinic', name: 'clinic.example', domain: 'https://clinic.example' },
  { id: 'profile-shop', name: 'shop.example', domain: 'https://shop.example' },
] as const;

const bindings = {
  'profile-jobber': {
    siteProfileId: 'profile-jobber',
    searchConsoleSiteUrl: 'sc-domain:jobber-app.com',
    ga4PropertyId: '1001',
    ga4PropertyName: 'Jobber Analytics',
    updatedAt: '2026-09-10T08:00:00.000Z',
  },
  'profile-clinic': {
    siteProfileId: 'profile-clinic',
    searchConsoleSiteUrl: 'https://clinic.example/',
    ga4PropertyId: '1002',
    ga4PropertyName: 'Clinic Analytics',
    updatedAt: '2026-09-10T08:01:00.000Z',
  },
  'profile-shop': {
    siteProfileId: 'profile-shop',
    searchConsoleSiteUrl: null,
    ga4PropertyId: '1003',
    ga4PropertyName: 'Shop Analytics',
    updatedAt: '2026-09-10T08:02:00.000Z',
  },
} as const;

const discovery = {
  connection: { state: 'connected', detail: 'Data was received.' },
  searchConsole: {
    state: 'connected',
    detail: 'Data was received.',
    items: profiles.map((profile) => ({
      siteUrl: bindings[profile.id].searchConsoleSiteUrl ?? `sc-domain:${profile.name}`,
      permissionLevel: 'siteOwner',
    })),
  },
  analytics: {
    state: 'connected',
    detail: 'Data was received.',
    items: profiles.map((profile, index) => ({
      propertyId: String(1001 + index),
      displayName: bindings[profile.id].ga4PropertyName,
      accountName: 'FluxRadar E2E fixture',
    })),
  },
};

function json(route: Route, data: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data, error: null }),
  });
}

async function installGoogleFixtures(
  page: Page,
  beforeBindingResponse?: (route: Route) => Promise<void>,
): Promise<void> {
  let savedBindings: Readonly<Record<string, Binding>> = bindings;
  await page.context().routeWebSocket('**/*', async (socket) => {
    if (new URL(socket.url()).origin === 'ws://127.0.0.1:4173') {
      socket.connectToServer();
      return;
    }
    await socket.close();
  });
  await page.context().route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (url.origin === APP_URL && request.method() === 'GET') {
      await route.continue();
      return;
    }
    if (url.origin !== API_URL) {
      await route.abort('blockedbyclient');
      return;
    }

    if (path === '/auth/me' && request.method() === 'GET') {
      await json(route, {
        accountId: 'account-e2e',
        email: 'e2e@example.test',
        emailVerified: true,
        onboarding: { status: 'completed' },
      });
      return;
    }
    if (path === '/profiles' && request.method() === 'GET') {
      await json(route, profiles);
      return;
    }
    if (path === '/integrations' && request.method() === 'GET') {
      await json(route, [
        {
          provider: 'google',
          label: 'Google data',
          kind: 'user',
          status: 'connected',
          services: ['Google Search Console', 'Google Analytics 4'],
          canConnect: true,
          lastCheckedAt: null,
          lastError: null,
        },
        {
          provider: 'bing',
          label: 'Bing Webmaster Tools',
          kind: 'user',
          status: 'available',
          services: ['Bing Webmaster Tools'],
          canConnect: true,
          lastCheckedAt: null,
          lastError: null,
        },
      ]);
      return;
    }
    if (path === '/integrations/google/properties' && request.method() === 'GET') {
      await json(route, discovery);
      return;
    }
    if (path === '/integrations/google/bindings' && request.method() === 'GET') {
      await json(route, Object.values(savedBindings));
      return;
    }
    const bindingMatch = /^\/profiles\/([^/]+)\/google-binding$/.exec(path);
    if (bindingMatch !== null) {
      const profileId = bindingMatch[1];
      const current = profileId === undefined ? undefined : savedBindings[profileId];
      if (profileId === undefined || current === undefined) {
        await json(route, null, 404);
        return;
      }
      await beforeBindingResponse?.(route);
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as Pick<
          Binding,
          'searchConsoleSiteUrl' | 'ga4PropertyId'
        >;
        const updated = {
          ...current,
          searchConsoleSiteUrl: body.searchConsoleSiteUrl,
          ga4PropertyId: body.ga4PropertyId,
          ga4PropertyName:
            discovery.analytics.items.find((property) => property.propertyId === body.ga4PropertyId)
              ?.displayName ?? null,
        };
        savedBindings = { ...savedBindings, [profileId]: updated };
        await json(route, updated);
        return;
      }
      if (request.method() === 'GET') {
        await json(route, current);
        return;
      }
    }
    await route.abort('blockedbyclient');
  });
}

async function failNextRequest(page: Page, path: string, method: 'GET' | 'PUT'): Promise<void> {
  await page.route(
    `${API_URL}${path}`,
    async (route) => {
      if (route.request().method() !== method) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          data: null,
          error: { code: 'TEMPORARILY_UNAVAILABLE', message: 'Mock service unavailable.' },
        }),
      });
    },
    { times: 1 },
  );
}

function delayNextBindingResponse(
  path: string,
  method: 'GET' | 'PUT',
): {
  beforeResponse: (route: Route) => Promise<void>;
  receive: () => Promise<Route>;
  release: () => void;
} {
  let pendingRoute: Route | undefined;
  let release: () => void = () => {
    throw new Error('The response delay was not initialized.');
  };
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    beforeResponse: async (route) => {
      const request = route.request();
      if (
        pendingRoute !== undefined ||
        request.url() !== `${API_URL}${path}` ||
        request.method() !== method
      )
        return;
      pendingRoute = route;
      await gate;
    },
    receive: async () => {
      await expect.poll(() => pendingRoute !== undefined).toBe(true);
      if (pendingRoute === undefined)
        throw new Error('The expected mock request was not received.');
      return pendingRoute;
    },
    release,
  };
}

async function releaseResponse(page: Page, route: Route, release: () => void): Promise<void> {
  release();
  const response = await route.request().response();
  if (response !== null) await response.finished();
  // Let the browser render the completed response before checking for stale UI.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test.describe('Google bindings for every saved profile', () => {
  test('loads the distinct Search Console and GA4 binding for every profile', async ({ page }) => {
    await installGoogleFixtures(page);
    await page.goto('/integrations');

    await expect(page.getByText('Google properties', { exact: true })).toBeVisible();
    const profilePicker = page.getByRole('combobox', { name: 'Profile' });
    await expect(profilePicker.locator('option')).toHaveCount(profiles.length);

    for (const profile of profiles) {
      await profilePicker.selectOption(profile.id);
      await expect(page.getByRole('combobox', { name: 'Search Console property' })).toHaveValue(
        bindings[profile.id].searchConsoleSiteUrl ?? '',
      );
      await expect(page.getByRole('combobox', { name: 'Analytics property' })).toHaveValue(
        bindings[profile.id].ga4PropertyId ?? '',
      );
    }
  });

  test('persists changes to multiple profiles without changing the other mappings', async ({
    page,
  }) => {
    await installGoogleFixtures(page);
    await page.goto('/integrations');

    const profilePicker = page.getByRole('combobox', { name: 'Profile' });
    await profilePicker.selectOption('profile-shop');
    await page
      .getByRole('combobox', { name: 'Search Console property' })
      .selectOption('sc-domain:shop.example');
    await page.getByRole('combobox', { name: 'Analytics property' }).selectOption('1001');
    const saveRequest = page.waitForRequest((request) => request.method() === 'PUT');
    await page.getByRole('button', { name: 'Save selection' }).click();

    const request = await saveRequest;
    expect(request.url()).toBe(`${API_URL}/profiles/profile-shop/google-binding`);
    expect(request.postDataJSON()).toEqual({
      searchConsoleSiteUrl: 'sc-domain:shop.example',
      ga4PropertyId: '1001',
    });
    await expect(page.getByRole('status')).toContainText('Saved.');

    await profilePicker.selectOption('profile-clinic');
    await expect(page.getByRole('combobox', { name: 'Analytics property' })).toHaveValue('1002');
    await page.getByRole('combobox', { name: 'Search Console property' }).selectOption('');
    await page.getByRole('combobox', { name: 'Analytics property' }).selectOption('1003');
    const clinicSave = page.waitForRequest((request) => request.method() === 'PUT');
    await page.getByRole('button', { name: 'Save selection' }).click();
    const clinicRequest = await clinicSave;
    expect(clinicRequest.url()).toBe(`${API_URL}/profiles/profile-clinic/google-binding`);
    expect(clinicRequest.postDataJSON()).toEqual({
      searchConsoleSiteUrl: null,
      ga4PropertyId: '1003',
    });
    await expect(page.getByRole('status')).toContainText('Saved.');
    await page.reload();
    await profilePicker.selectOption('profile-shop');
    await expect(page.getByRole('combobox', { name: 'Search Console property' })).toHaveValue(
      'sc-domain:shop.example',
    );
    await expect(page.getByRole('combobox', { name: 'Analytics property' })).toHaveValue('1001');
    await profilePicker.selectOption('profile-clinic');
    await expect(page.getByRole('combobox', { name: 'Search Console property' })).toHaveValue('');
    await expect(page.getByRole('combobox', { name: 'Analytics property' })).toHaveValue('1003');
    await profilePicker.selectOption('profile-jobber');
    await expect(page.getByRole('combobox', { name: 'Search Console property' })).toHaveValue(
      'sc-domain:jobber-app.com',
    );
    await expect(page.getByRole('combobox', { name: 'Analytics property' })).toHaveValue('1001');
  });

  for (const failedPath of [
    '/profiles/profile-clinic/google-binding',
    '/integrations/google/properties',
  ]) {
    test(`retries a failed GET ${failedPath} for the selected profile`, async ({ page }) => {
      await installGoogleFixtures(page);
      await page.goto('/integrations');
      await expect(page.getByRole('combobox', { name: 'Analytics property' })).toHaveValue('1001');

      await failNextRequest(page, failedPath, 'GET');
      await page.getByRole('combobox', { name: 'Profile' }).selectOption('profile-clinic');
      await expect(page.getByRole('status')).toHaveText(
        'Google properties could not be loaded. Refresh the list to try again.',
      );
      await expect(page.getByRole('status')).not.toContainText('Saved.');

      await page.getByRole('button', { name: 'Refresh list' }).click();
      await expect(page.getByRole('combobox', { name: 'Profile' })).toHaveValue('profile-clinic');
      await expect(page.getByRole('combobox', { name: 'Search Console property' })).toHaveValue(
        'https://clinic.example/',
      );
      await expect(page.getByRole('combobox', { name: 'Analytics property' })).toHaveValue('1002');
      await expect(
        page.getByText('Google properties could not be loaded.', { exact: false }),
      ).toHaveCount(0);
    });
  }

  test('keeps a failed save unpersisted and retries the same profile successfully', async ({
    page,
  }) => {
    await installGoogleFixtures(page);
    await page.goto('/integrations');
    await page.getByRole('combobox', { name: 'Profile' }).selectOption('profile-shop');
    const searchConsole = page.getByRole('combobox', { name: 'Search Console property' });
    const analytics = page.getByRole('combobox', { name: 'Analytics property' });
    await expect(analytics).toHaveValue('1003');
    await searchConsole.selectOption('sc-domain:shop.example');
    await analytics.selectOption('1002');
    await failNextRequest(page, '/profiles/profile-shop/google-binding', 'PUT');

    const failedSave = page.waitForRequest((request) => request.method() === 'PUT');
    await page.getByRole('button', { name: 'Save selection' }).click();
    const failedRequest = await failedSave;
    expect(failedRequest.url()).toBe(`${API_URL}/profiles/profile-shop/google-binding`);
    expect(failedRequest.postDataJSON()).toEqual({
      searchConsoleSiteUrl: 'sc-domain:shop.example',
      ga4PropertyId: '1002',
    });
    await expect(page.getByRole('status')).toHaveText(
      'The selection could not be saved. Try again in a moment.',
    );
    await expect(searchConsole).toHaveValue('sc-domain:shop.example');
    await expect(analytics).toHaveValue('1002');
    await expect(page.getByRole('button', { name: 'Save selection' })).toBeEnabled();

    await page.getByRole('button', { name: 'Refresh list' }).click();
    await expect(searchConsole).toHaveValue('');
    await expect(analytics).toHaveValue('1003');
    await searchConsole.selectOption('sc-domain:shop.example');
    await analytics.selectOption('1002');
    const retry = page.waitForRequest((request) => request.method() === 'PUT');
    await page.getByRole('button', { name: 'Save selection' }).click();
    const retryRequest = await retry;
    expect(retryRequest.url()).toBe(`${API_URL}/profiles/profile-shop/google-binding`);
    expect(retryRequest.postDataJSON()).toEqual({
      searchConsoleSiteUrl: 'sc-domain:shop.example',
      ga4PropertyId: '1002',
    });
    await expect(page.getByRole('status')).toContainText('Saved.');

    await page.reload();
    await page.getByRole('combobox', { name: 'Profile' }).selectOption('profile-shop');
    await expect(searchConsole).toHaveValue('sc-domain:shop.example');
    await expect(analytics).toHaveValue('1002');
  });

  test('ignores a delayed binding GET after switching to another profile', async ({ page }) => {
    const { beforeResponse, receive, release } = delayNextBindingResponse(
      '/profiles/profile-clinic/google-binding',
      'GET',
    );
    await installGoogleFixtures(page, beforeResponse);
    await page.goto('/integrations');
    await expect(page.getByRole('combobox', { name: 'Analytics property' })).toHaveValue('1001');
    const profilePicker = page.getByRole('combobox', { name: 'Profile' });
    await profilePicker.selectOption('profile-clinic');
    const delayed = await receive();
    expect(delayed.request().method()).toBe('GET');

    await profilePicker.selectOption('profile-shop');
    await expect(page.getByRole('combobox', { name: 'Analytics property' })).toHaveValue('1003');
    await releaseResponse(page, delayed, release);
    await expect(profilePicker).toHaveValue('profile-shop');
    await expect(page.getByRole('combobox', { name: 'Search Console property' })).toHaveValue('');
    await expect(page.getByRole('combobox', { name: 'Analytics property' })).toHaveValue('1003');
  });

  test('does not show a delayed save confirmation on a different profile', async ({ page }) => {
    const { beforeResponse, receive, release } = delayNextBindingResponse(
      '/profiles/profile-clinic/google-binding',
      'PUT',
    );
    await installGoogleFixtures(page, beforeResponse);
    await page.goto('/integrations');
    const profilePicker = page.getByRole('combobox', { name: 'Profile' });
    await profilePicker.selectOption('profile-clinic');
    await expect(page.getByRole('combobox', { name: 'Analytics property' })).toHaveValue('1002');
    await page.getByRole('combobox', { name: 'Search Console property' }).selectOption('');
    await page.getByRole('combobox', { name: 'Analytics property' }).selectOption('');
    await page.getByRole('button', { name: 'Save selection' }).click();
    const delayed = await receive();
    expect(delayed.request().method()).toBe('PUT');
    expect(delayed.request().url()).toBe(`${API_URL}/profiles/profile-clinic/google-binding`);
    expect(delayed.request().postDataJSON()).toEqual({
      searchConsoleSiteUrl: null,
      ga4PropertyId: null,
    });

    await profilePicker.selectOption('profile-shop');
    await expect(page.getByRole('combobox', { name: 'Analytics property' })).toHaveValue('1003');
    await releaseResponse(page, delayed, release);
    await expect(profilePicker).toHaveValue('profile-shop');
    await expect(page.getByRole('combobox', { name: 'Search Console property' })).toHaveValue('');
    await expect(page.getByRole('combobox', { name: 'Analytics property' })).toHaveValue('1003');
    await expect(page.getByRole('status')).toHaveCount(0);

    await page.reload();
    await profilePicker.selectOption('profile-clinic');
    await expect(page.getByRole('combobox', { name: 'Search Console property' })).toHaveValue('');
    await expect(page.getByRole('combobox', { name: 'Analytics property' })).toHaveValue('');
  });
});
