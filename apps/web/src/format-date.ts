import type { Language } from './i18n';

/**
 * A calendar date in the reader's language — "18 September 2026",
 * "18 вересня 2026 р." — or a dash when there is none.
 *
 * One helper for every screen that shows a date on its own: the account, the
 * report blocks and the client report each had a copy, and the copies had
 * already drifted apart in month style and null handling.
 */
export function formatDate(
  value: string | null,
  language: Language,
  month: 'long' | 'short' = 'long',
): string {
  if (value === null) return '—';
  return new Date(value).toLocaleDateString(language === 'uk' ? 'uk-UA' : 'en-GB', {
    day: 'numeric',
    month,
    year: 'numeric',
  });
}
