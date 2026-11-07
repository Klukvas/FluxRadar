import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveCookieConsent } from './browser-consent';
import { resolveBrowserLanguage } from './browser-language';
import { readInitialLanguage, readStoredLanguage, storeLanguage } from './i18n';

// The UI default when neither the URL nor a stored choice names a language
// (W1): only a Ukrainian browser language opens Ukrainian.

const WORKSPACE_PATH = '/app';

function browserLanguages(languages: readonly string[] | undefined): void {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(
    languages as unknown as readonly string[],
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('resolveBrowserLanguage', () => {
  it.each([
    [['uk-UA'], 'uk'],
    [['uk'], 'uk'],
    [['UK-ua'], 'uk'],
    [['en-US', 'uk-UA'], 'en'],
    [['ru-RU', 'uk-UA'], 'uk'],
    [['de-DE', 'ru', 'en-GB', 'uk'], 'en'],
    [['ru-UA'], 'en'],
    [['ukr'], 'en'],
    [['ru-RU', 'ru'], 'en'],
    [['en-GB'], 'en'],
    [[], 'en'],
    [undefined, 'en'],
  ] as const)('maps %o to %s', (languages, expected) => {
    expect(resolveBrowserLanguage(languages)).toBe(expected);
  });

  it('reads navigator.languages by default', () => {
    browserLanguages(['uk-UA', 'en']);
    expect(resolveBrowserLanguage()).toBe('uk');
    browserLanguages(['ru-UA']);
    expect(resolveBrowserLanguage()).toBe('en');
  });

  it('falls back to navigator.language when the list is empty or missing', () => {
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('uk-UA');
    browserLanguages([]);
    expect(resolveBrowserLanguage()).toBe('uk');
    browserLanguages(undefined);
    expect(resolveBrowserLanguage()).toBe('uk');
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('ru-RU');
    expect(resolveBrowserLanguage()).toBe('en');
  });

  it('answers en when there is no navigator at all (prerendering)', () => {
    vi.stubGlobal('navigator', undefined);
    try {
      expect(resolveBrowserLanguage()).toBe('en');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('language precedence with the browser fallback', () => {
  it('falls back to the browser language when nothing is stored', () => {
    saveCookieConsent({ preferences: true, analytics: false });
    browserLanguages(['uk-UA']);
    expect(readStoredLanguage()).toBe('uk');
    window.history.replaceState(null, '', WORKSPACE_PATH);
    expect(readInitialLanguage()).toBe('uk');
  });

  it('falls back to the browser language when storage consent is declined', () => {
    saveCookieConsent({ preferences: false, analytics: false });
    localStorage.setItem('fluxradar.language', 'en');
    browserLanguages(['uk']);
    expect(readStoredLanguage()).toBe('uk');
    // The declined preference is still removed, as before.
    expect(localStorage.getItem('fluxradar.language')).toBeNull();
  });

  it('lets a stored choice beat the browser language', () => {
    saveCookieConsent({ preferences: true, analytics: false });
    storeLanguage('en');
    browserLanguages(['uk-UA']);
    expect(readStoredLanguage()).toBe('en');
    window.history.replaceState(null, '', WORKSPACE_PATH);
    expect(readInitialLanguage()).toBe('en');
  });

  it('lets a URL parameter beat the browser language', () => {
    browserLanguages(['uk-UA']);
    window.history.replaceState(null, '', `${WORKSPACE_PATH}?lang=en`);
    expect(readInitialLanguage()).toBe('en');
    browserLanguages(['en-GB']);
    window.history.replaceState(null, '', `${WORKSPACE_PATH}?lang=uk`);
    expect(readInitialLanguage()).toBe('uk');
  });

  it('keeps a canonical public path over the browser language (no hydration mismatch)', () => {
    browserLanguages(['uk-UA']);
    window.history.replaceState(null, '', '/');
    expect(readInitialLanguage()).toBe('en');
    browserLanguages(['en-GB']);
    window.history.replaceState(null, '', '/uk/privacy');
    expect(readInitialLanguage()).toBe('uk');
  });

  it('still writes nothing without storage consent', () => {
    saveCookieConsent({ preferences: false, analytics: false });
    browserLanguages(['uk-UA']);
    window.history.replaceState(null, '', `${WORKSPACE_PATH}?lang=uk`);
    expect(readInitialLanguage()).toBe('uk');
    expect(localStorage.getItem('fluxradar.language')).toBeNull();
  });
});
