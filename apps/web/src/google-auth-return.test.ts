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
    expect(consumeGoogleReturn()?.route).toEqual({ screen: 'issues', scanId: 'scan-id', profileId: null });
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
    try { expect(googleRetryIntent()).toBeNull(); }
    finally { vi.stubGlobal('window', browserWindow); }
  });
});
