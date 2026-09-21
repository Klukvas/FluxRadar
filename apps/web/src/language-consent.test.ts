import { afterEach, describe, expect, it } from 'vitest';

import { saveCookieConsent } from './browser-consent';
import { readInitialLanguage, readStoredLanguage, storeLanguage } from './i18n';

afterEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('language preference requires optional storage permission', () => {
  it('ignores a legacy preference and never persists language without consent', () => {
    localStorage.setItem('fluxradar.language', 'uk');
    expect(readStoredLanguage()).toBe('en');
    storeLanguage('uk');
    expect(localStorage.getItem('fluxradar.language')).toBeNull();
  });

  it('honours a language link in memory without writing optional storage', () => {
    window.history.replaceState(null, '', '/privacy?lang=uk');
    expect(readInitialLanguage()).toBe('uk');
    expect(localStorage.getItem('fluxradar.language')).toBeNull();
  });

  it('persists only after allow and stops after withdrawal', () => {
    saveCookieConsent({ preferences: true, analytics: false });
    storeLanguage('uk');
    expect(readStoredLanguage()).toBe('uk');
    saveCookieConsent({ preferences: false, analytics: false });
    storeLanguage('uk');
    expect(localStorage.getItem('fluxradar.language')).toBeNull();
  });
});
