import { afterEach, describe, expect, it } from 'vitest';

import { saveCookieConsent } from './browser-consent';
import { readInitialLanguage, readLanguagePath, readStoredLanguage, storeLanguage } from './i18n';

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

  it('opens /uk in Ukrainian without consent and without writing optional storage', () => {
    for (const path of ['/uk', '/uk/']) {
      window.history.replaceState(null, '', path);
      expect(readInitialLanguage()).toBe('uk');
    }
    expect(localStorage.getItem('fluxradar.language')).toBeNull();
  });

  it('lets ?lang= overrule the /uk address', () => {
    window.history.replaceState(null, '', '/uk?lang=en');
    expect(readInitialLanguage()).toBe('en');
  });

  it('reads only the exact /uk path as Ukrainian', () => {
    expect(readLanguagePath('/')).toBeNull();
    expect(readLanguagePath('/ukraine')).toBeNull();
    expect(readLanguagePath('/blog/uk')).toBeNull();
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
