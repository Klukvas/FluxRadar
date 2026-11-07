import type { Language } from './i18n';

/** The languages a browser preference may select; Russian is opt-in only (see below). */
const SUPPORTED: readonly Language[] = ['en', 'uk'];

/**
 * The UI language a first visit opens in when the URL and storage say nothing.
 *
 * Standard negotiation over the browser's preference list, in order: the first
 * entry whose primary subtag is a supported language decides. Unsupported
 * entries — Russian included — are skipped, and a list with nothing supported
 * falls back to English. Russian is an interface language, but only by an
 * explicit choice (the switcher, a `/ru` path or `?lang=ru`); it is never
 * negotiated from the browser. Safe on the server and in prerendering, where
 * `navigator` does not exist.
 */
export function resolveBrowserLanguage(
  languages: readonly string[] | undefined = browserLanguages(),
): Language {
  for (const tag of languages ?? []) {
    const primary = tag.toLowerCase().split('-')[0];
    const supported = SUPPORTED.find((language) => language === primary);
    if (supported !== undefined) return supported;
  }
  return 'en';
}

/** `navigator.languages`, or `[navigator.language]` when the list is empty or missing. */
function browserLanguages(): readonly string[] | undefined {
  if (typeof navigator === 'undefined') return undefined;
  if (navigator.languages !== undefined && navigator.languages.length > 0) {
    return navigator.languages;
  }
  return navigator.language ? [navigator.language] : undefined;
}
