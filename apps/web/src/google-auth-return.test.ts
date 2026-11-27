import { renderHook, waitFor } from '@testing-library/react';
import { apiRequest } from './api';
import { useAppState } from './app-state';
import { useSessionBoot } from './app-session';
import { useOpenScanById } from './app-navigation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consumeGoogleReturn,
  googleRetryIntent,
  prepareGoogleReturn,
  rememberGoogleIntent,
} from './google-auth-return';
import { readInitialRoute } from './app-routes';
import { copy } from './i18n';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  apiRequest: vi.fn(),
}));

const route = {
  screen: 'reports',
  scanId: null,
  profileId: null,
  emailAction: null,
  scrollTo: null,
  checkoutReturn: null,
} as const;
afterEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('navigation across Google login', () => {
  it('preserves site and selected plan only for the successful return and consumes once', () => {
    const intent = { site: 'shop.example.com', plan: 'Complete' } as const;
    rememberGoogleIntent(intent);
    prepareGoogleReturn(route);
    expect(consumeGoogleReturn()).toBeNull();
    window.history.replaceState(null, '', '/profiles?google_auth=success');
    expect(consumeGoogleReturn()).toEqual({
      intent,
      route: { screen: 'reports', scanId: null, profileId: null },
    });
    expect(consumeGoogleReturn()).toBeNull();
  });

  it('preserves a scan deep link', () => {
    prepareGoogleReturn({ ...route, screen: 'issues', scanId: 'scan-id' });
    window.history.replaceState(null, '', '/profiles?google_auth=success');
    expect(consumeGoogleReturn()?.route).toEqual({
      screen: 'issues',
      scanId: 'scan-id',
      profileId: null,
    });
  });

  it('rejects expired hints and malformed storage', () => {
    vi.useFakeTimers();
    rememberGoogleIntent({ site: 'example.com', plan: null });
    prepareGoogleReturn(route);
    vi.advanceTimersByTime(11 * 60_000);
    window.history.replaceState(null, '', '/profiles?google_auth=success');
    expect(consumeGoogleReturn()).toBeNull();
    sessionStorage.setItem('fluxradar.google-return', '{bad json');
    expect(consumeGoogleReturn()).toBeNull();
  });

  it('rejects an unrecognized route or plan', () => {
    sessionStorage.setItem(
      'fluxradar.google-return',
      JSON.stringify({
        expiresAt: Date.now() + 60_000,
        intent: { site: null, plan: 'Admin' },
        route: { screen: 'https://attacker.example', scanId: null },
      }),
    );
    window.history.replaceState(null, '', '/profiles?google_auth=success');
    expect(consumeGoogleReturn()).toBeNull();
  });

  it('reopens authentication on a callback error and retains retry intent', () => {
    rememberGoogleIntent({ site: 'example.com', plan: 'Basic' });
    window.history.replaceState(null, '', '/?google_auth_error=email_exists');
    expect(readInitialRoute().screen).toBe('auth');
    expect(googleRetryIntent()).toEqual({ site: 'example.com', plan: 'Basic' });
  });
});

describe('Google return through the actual session and scan hooks', () => {
  it.each(['issues', 'scan', 'print'] as const)(
    'keeps Ukrainian after restoring a %s deep link',
    async (screen) => {
      prepareGoogleReturn({ ...route, screen, scanId: 'qa-scan' });
      window.history.replaceState(null, '', '/profiles?google_auth=success&lang=uk');
      vi.mocked(apiRequest).mockImplementation(async (path) => {
        if (path === '/auth/me')
          return { accountId: 'qa-account', email: 'owner@gmail.com', emailVerified: true };
        if (path === '/profiles') return [];
        if (path === '/scans/qa-scan') return { id: 'qa-scan', status: 'queued' };
        throw new Error(`Unexpected local test request ${path}`);
      });
      const confirmEmailSignedIn = vi.fn();
      const hook = renderHook(() => {
        const state = useAppState();
        const openScanById = useOpenScanById(state);
        useSessionBoot({ ...state, openScanById, confirmEmailSignedIn });
        return state;
      });
      await waitFor(() => expect(hook.result.current.booting).toBe(false));
      expect(window.location.pathname).toBe(
        `/scans/qa-scan${screen === 'issues' ? '/issues' : screen === 'print' ? '/report' : ''}`,
      );
      expect(window.location.search).toBe('?lang=uk');
      expect(hook.result.current.screen).toBe(screen);
      hook.unmount();
    },
  );
});

// Nine of the eleven accounts that never saved a site had signed in with
// Google: the address they typed came back from the redirect as a form to fill.
describe('Google return with an address typed on the public page', () => {
  function bootApp() {
    const confirmEmailSignedIn = vi.fn();
    return renderHook(() => {
      const state = useAppState();
      const openScanById = useOpenScanById(state);
      useSessionBoot({ ...state, openScanById, confirmEmailSignedIn });
      return state;
    });
  }
  const profile = { id: 'new-site', domain: 'https://shop.example.com' };
  const account = { accountId: 'qa-account', email: 'owner@gmail.com', emailVerified: true };
  const reachable = { state: 'reachable', canPurchase: true, checkedAt: null };

  /** The API as the automatic start meets it; `posts` records every write in order. */
  function api(options: {
    readonly me?: Record<string, unknown>;
    readonly reach?: unknown;
    readonly freeCheck?: () => unknown;
    readonly resolve?: () => unknown;
  }) {
    const posts: { path: string; body: unknown }[] = [];
    vi.mocked(apiRequest).mockImplementation(async (path, init) => {
      if (path === '/auth/me') return options.me ?? account;
      if (path === '/profiles') return [profile];
      if (init?.method !== 'POST') throw new Error(`Unexpected local test request ${path}`);
      posts.push({ path, body: JSON.parse(String(init.body)) });
      if (path === '/profiles/resolve')
        return options.resolve ? options.resolve() : { profile, created: true };
      if (path === '/profiles/new-site/reachability') return options.reach ?? reachable;
      if (path === '/profiles/new-site/free-check')
        return options.freeCheck
          ? options.freeCheck()
          : { id: 'auto-scan', plan: 'Free', status: 'Pending' };
      throw new Error(`Unexpected local test request ${path}`);
    });
    return posts;
  }

  function returnFromGoogle(site: string, plan: 'Complete' | null, search = ''): void {
    rememberGoogleIntent({ site, plan });
    prepareGoogleReturn(route);
    window.history.replaceState(null, '', `/profiles?google_auth=success${search}`);
  }

  it('starts the free check at once and opens its progress screen, language kept', async () => {
    returnFromGoogle('https://shop.example.com', null, '&lang=uk');
    const posts = api({});
    const hook = bootApp();
    await waitFor(() => expect(hook.result.current.screen).toBe('scan'));

    expect(posts).toEqual([
      { path: '/profiles/resolve', body: { domain: 'https://shop.example.com' } },
      // Asked before anything is spent: the free check is claimed when it starts.
      { path: '/profiles/new-site/reachability', body: {} },
      // In the visitor's language, and with no AI consent: nobody was shown it.
      { path: '/profiles/new-site/free-check', body: { aiLanguage: 'uk' } },
    ]);
    expect(hook.result.current.screen).toBe('scan');
    expect(hook.result.current.selectedScan?.id).toBe('auto-scan');
    expect(hook.result.current.freeAiAskScanId).toBe('auto-scan');
    expect(hook.result.current.account?.freeCheckUsed).toBe(true);
    expect(window.location.pathname + window.location.search).toBe('/scans/auto-scan?lang=uk');
    hook.unmount();
  });

  it('keeps the checking window up until the progress screen is in place', async () => {
    returnFromGoogle('https://shop.example.com', null);
    let release: (value: unknown) => void = () => {};
    const slowProbe = new Promise((resolve) => {
      release = resolve;
    });
    vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path === '/auth/me') return account;
      if (path === '/profiles') return [profile];
      if (path === '/profiles/resolve') return { profile, created: true };
      if (path === '/profiles/new-site/reachability') return slowProbe;
      if (path === '/profiles/new-site/free-check')
        return { id: 'auto-scan', plan: 'Free', status: 'Pending' };
      throw new Error(`Unexpected local test request ${path}`);
    });
    const hook = bootApp();

    // Out of the boot loader at once, under the window.
    await waitFor(() =>
      expect(hook.result.current.startingCheckFor).toBe('https://shop.example.com'),
    );
    expect(hook.result.current.booting).toBe(false);

    release(reachable);
    await waitFor(() => expect(hook.result.current.startingCheckFor).toBeNull());
    expect(hook.result.current.screen).toBe('scan');
    hook.unmount();
  });

  it('still opens the add-a-site form when a paid plan was picked', async () => {
    returnFromGoogle('https://shop.example.com', 'Complete');
    const posts = api({});
    const hook = bootApp();
    await waitFor(() => expect(hook.result.current.booting).toBe(false));

    expect(posts).toEqual([]);
    expect(hook.result.current.screen).toBe('desktop');
    expect(hook.result.current.newScanPlan).toBe('Complete');
    expect(new URLSearchParams(window.location.search).get('add')).toBe('https://shop.example.com');
    hook.unmount();
  });

  // A returning owner whose free check is spent: a check that would only be
  // refused is no reason to save a site behind their back.
  it('saves nothing for an account whose free check is already used', async () => {
    returnFromGoogle('https://shop.example.com', null);
    const posts = api({ me: { ...account, freeCheckUsed: true } });
    const hook = bootApp();
    await waitFor(() => expect(hook.result.current.booting).toBe(false));

    expect(posts).toEqual([]);
    expect(hook.result.current.screen).toBe('desktop');
    expect(new URLSearchParams(window.location.search).get('add')).toBe('https://shop.example.com');
    hook.unmount();
  });

  it('spends nothing on a site that does not answer, and says why on its scan form', async () => {
    returnFromGoogle('https://shop.exmaple.com', null);
    const posts = api({ reach: { state: 'unreachable', canPurchase: false, checkedAt: null } });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hook = bootApp();
    await waitFor(() => expect(hook.result.current.screen).toBe('new-scan'));

    expect(posts.map((post) => post.path)).toEqual([
      '/profiles/resolve',
      '/profiles/new-site/reachability',
    ]);
    expect(hook.result.current.screen).toBe('new-scan');
    expect(hook.result.current.selectedScan).toBeNull();
    expect(hook.result.current.account?.freeCheckUsed).toBeUndefined();
    expect(hook.result.current.error).toContain(copy.en.reachability.states.unreachable.label);
    expect(window.location.search).toContain('new-site');
    errorLog.mockRestore();
    hook.unmount();
  });

  it('spends nothing when the site cannot be asked at all', async () => {
    returnFromGoogle('https://shop.example.com', null);
    vi.mocked(apiRequest).mockImplementation(async (path, init) => {
      if (path === '/auth/me') return account;
      if (path === '/profiles') return [profile];
      if (path === '/profiles/resolve' && init?.method === 'POST')
        return { profile, created: true };
      if (path === '/profiles/new-site/reachability') throw new Error('Too many requests');
      throw new Error(`Unexpected local test request ${path}`);
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hook = bootApp();
    await waitFor(() => expect(hook.result.current.screen).toBe('new-scan'));

    expect(hook.result.current.error).toBe(copy.en.reachability.failed);
    expect(vi.mocked(apiRequest).mock.calls.map(([path]) => path)).not.toContain(
      '/profiles/new-site/free-check',
    );
    errorLog.mockRestore();
    hook.unmount();
  });

  it('opens the add-a-site form, address kept, when the site cannot be saved', async () => {
    returnFromGoogle('https://shop.example.com', null);
    api({
      resolve: () => {
        throw new Error('The site could not be saved');
      },
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hook = bootApp();
    await waitFor(() => expect(hook.result.current.error).not.toBeNull());

    expect(hook.result.current.screen).toBe('desktop');
    expect(hook.result.current.startingCheckFor).toBeNull();
    // In the reader's language, not the API's English message.
    expect(hook.result.current.error).toBe(
      'The site could not be saved. Add it here and try again.',
    );
    expect(new URLSearchParams(window.location.search).get('add')).toBe('https://shop.example.com');
    errorLog.mockRestore();
    hook.unmount();
  });

  it('opens the scan form on the site, with the reason, when the check is refused', async () => {
    returnFromGoogle('https://shop.example.com', null);
    api({
      freeCheck: () => {
        throw new Error('The free check is used');
      },
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hook = bootApp();
    await waitFor(() => expect(hook.result.current.screen).toBe('new-scan'));

    expect(hook.result.current.error).toBe(
      'The free check could not start. Try again from this form.',
    );
    expect(hook.result.current.selectedScan).toBeNull();
    expect(window.location.search).toContain('new-site');
    errorLog.mockRestore();
    hook.unmount();
  });
});

describe('Google return preserves production selected-profile navigation', () => {
  it('selects the requested own profile rather than the first profile', async () => {
    prepareGoogleReturn({ ...route, screen: 'new-scan', profileId: 'second-site' });
    window.history.replaceState(null, '', '/profiles?google_auth=success&lang=uk');
    const profiles = [
      { id: 'first-site', domain: 'https://first.example' },
      { id: 'second-site', domain: 'https://second.example' },
    ];
    vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path === '/auth/me')
        return { accountId: 'qa-account', email: 'owner@gmail.com', emailVerified: true };
      if (path === '/profiles') return profiles;
      throw new Error(`Unexpected local test request ${path}`);
    });
    const confirmEmailSignedIn = vi.fn();
    const hook = renderHook(() => {
      const state = useAppState();
      const openScanById = useOpenScanById(state);
      useSessionBoot({ ...state, openScanById, confirmEmailSignedIn });
      return state;
    });
    await waitFor(() => expect(hook.result.current.booting).toBe(false));
    expect(hook.result.current.screen).toBe('new-scan');
    expect(hook.result.current.selectedProfile?.id).toBe('second-site');
    expect(window.location.pathname).toBe('/scan');
    expect(new URLSearchParams(window.location.search).get('profile')).toBe('second-site');
    expect(new URLSearchParams(window.location.search).get('lang')).toBe('uk');
    hook.unmount();
  });
});

describe('Google navigation hints during production public-page rendering', () => {
  it('does not access a browser window while server-rendering', () => {
    const browserWindow = globalThis.window;
    vi.stubGlobal('window', undefined);
    try {
      expect(googleRetryIntent()).toBeNull();
    } finally {
      vi.stubGlobal('window', browserWindow);
    }
  });
});
