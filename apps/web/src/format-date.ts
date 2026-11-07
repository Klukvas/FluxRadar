import { INTL_LOCALES, type Language } from './i18n';

/**
 * A calendar date in the reader's language — "18 September 2026",
 * «18 вересня 2026 р.», «18 сентября 2026 г.» — or a dash when there is none.
 *
 * One helper for every screen that shows a date on its own: the account, the
 * report blocks and the client report each had a copy, and the copies had
 * already drifted apart in month style and null handling.
 */
/** English dates read as "18 September 2026", so en uses the British order. */
const DATE_LOCALES: Readonly<Record<Language, string>> = { ...INTL_LOCALES, en: 'en-GB' };

export function formatDate(
  value: string | null,
  language: Language,
  month: 'long' | 'short' = 'long',
): string {
  if (value === null) return '—';
  return new Date(value).toLocaleDateString(DATE_LOCALES[language], {
    day: 'numeric',
    month,
    year: 'numeric',
  });
}
