import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COOKIE_CONSENT_CHANGE_EVENT,
  preferencesAllowed,
  readCookieConsent,
  saveCookieConsent,
} from './browser-consent';

function replaceStorageMethod(
  method: 'getItem' | 'setItem' | 'removeItem',
  replacement: unknown,
): void {
  const storage = window.localStorage;
  vi.spyOn(window, 'localStorage', 'get').mockReturnValue(
    new Proxy(storage, {
      get: (target, property) =>
        property === method ? replacement : Reflect.get(target, property),
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  saveCookieConsent(false);
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.cookie = 'consent-test-session=; Max-Age=0; path=/';
});

describe('browser storage consent', () => {
  it('denies preferences on a first visit without reading the saved language', () => {
    window.localStorage.setItem('fluxradar.language', 'uk');
    const getItem = vi.fn(window.localStorage.getItem.bind(window.localStorage));
    replaceStorageMethod('getItem', getItem);

    expect(readCookieConsent()).toBeNull();
    expect(preferencesAllowed()).toBe(false);
    expect(getItem.mock.calls.some(([key]) => key === 'fluxradar.language')).toBe(false);
  });

  it('stores an explicit choice for exactly 180 days and makes it readable', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));

    expect(saveCookieConsent(true)).toBe(true);
    expect(readCookieConsent()).toEqual({
      version: 'v1',
      preferences: true,
      updatedAt: Date.parse('2026-09-10T12:00:00Z'),
      expiresAt: Date.parse('2027-03-09T12:00:00Z'),
    });
    expect(preferencesAllowed()).toBe(true);
  });

  it('withdraws language storage while preserving checkout and login storage', () => {
    saveCookieConsent(true);
    window.localStorage.setItem('fluxradar.language', 'uk');
    window.localStorage.setItem('fluxradar.pendingCheckout', 'pending-test');
    window.sessionStorage.setItem('fluxradar.pendingCheckout', 'session-pending-test');
    document.cookie = 'consent-test-session=present; path=/';

    expect(saveCookieConsent(false)).toBe(true);
    expect(preferencesAllowed()).toBe(false);
    expect(window.localStorage.getItem('fluxradar.language')).toBeNull();
    expect(window.localStorage.getItem('fluxradar.pendingCheckout')).toBe('pending-test');
    expect(window.sessionStorage.getItem('fluxradar.pendingCheckout')).toBe('session-pending-test');
    expect(document.cookie.includes('consent-test-session=present')).toBe(true);
  });

  it('notifies local consumers after a saved choice without emitting events on reads', () => {
    const observed: boolean[] = [];
    const listener = () => observed.push(preferencesAllowed());
    window.addEventListener(COOKIE_CONSENT_CHANGE_EVENT, listener);
    try {
      saveCookieConsent(true);
      readCookieConsent();
      preferencesAllowed();
      saveCookieConsent(false);
      expect(observed).toEqual([true, false]);
    } finally {
      window.removeEventListener(COOKIE_CONSENT_CHANGE_EVENT, listener);
    }
  });

  it('fails closed after a withdrawal cannot overwrite a previous allowance', () => {
    saveCookieConsent(true);
    window.localStorage.setItem('fluxradar.language', 'uk');
    replaceStorageMethod('setItem', () => {
      throw new DOMException('Storage is blocked', 'SecurityError');
    });
    expect(saveCookieConsent(false)).toBe(false);
    expect(preferencesAllowed()).toBe(false);
    expect(window.localStorage.getItem('fluxradar.language')).toBeNull();
  });

  it('reports failure when the choice cannot actually be written', () => {
    replaceStorageMethod('setItem', () => undefined);
    expect(saveCookieConsent(true)).toBe(false);
    expect(preferencesAllowed()).toBe(false);
  });

  it('reports withdrawal cleanup failure without allowing preferences', () => {
    saveCookieConsent(true);
    window.localStorage.setItem('fluxradar.language', 'uk');
    replaceStorageMethod('removeItem', () => {
      throw new DOMException('Storage blocked');
    });
    expect(saveCookieConsent(false)).toBe(false);
    expect(preferencesAllowed()).toBe(false);
  });

  it.each([
    'null',
    '[]',
    '{broken',
    '{}',
    JSON.stringify({
      version: 'v0',
      preferences: true,
      updatedAt: 1789041600000,
      expiresAt: 1804593600000,
    }),
    JSON.stringify({
      version: 'v1',
      preferences: 'true',
      updatedAt: 1789041600000,
      expiresAt: 1804593600000,
    }),
    JSON.stringify({
      version: 'v1',
      preferences: true,
      updatedAt: 1789041600001,
      expiresAt: 1804593600001,
    }),
    JSON.stringify({
      version: 'v1',
      preferences: true,
      updatedAt: 1789041600000,
      expiresAt: 1804593600001,
    }),
    JSON.stringify({ version: 'v1', preferences: true, updatedAt: 0, expiresAt: 1804593600000 }),
    JSON.stringify({
      version: 'v1',
      preferences: true,
      updatedAt: '1789041600000',
      expiresAt: 1804593600000,
    }),
  ])('ignores malformed, old or future-dated consent: %s', (stored) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));
    window.localStorage.setItem('fluxradar.cookieConsent', stored);
    expect(readCookieConsent()).toBeNull();
    expect(preferencesAllowed()).toBe(false);
  });

  it('expires at the 180-day boundary without refreshing on reads', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));
    saveCookieConsent(true);
    vi.setSystemTime(new Date('2027-03-09T11:59:59.999Z'));
    expect(preferencesAllowed()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(readCookieConsent()).toBeNull();
    expect(preferencesAllowed()).toBe(false);
  });

  it('denies preferences when storage cannot be read', () => {
    saveCookieConsent(true);
    replaceStorageMethod('getItem', () => {
      throw new DOMException('Storage is blocked', 'SecurityError');
    });
    expect(readCookieConsent()).toBeNull();
    expect(preferencesAllowed()).toBe(false);
  });
});
