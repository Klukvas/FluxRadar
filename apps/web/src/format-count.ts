// A whole number of things, grouped the way the reader's language writes it.

import type { Language } from './i18n';

/** «5 000» in Ukrainian, "5,000" in English. */
export function formatCount(value: number, language: Language): string {
  const locale = language === 'uk' ? 'uk-UA' : 'en-US';
  // Ukrainian groups digits with a narrow no-break space, which this UI font
  // draws as a full-width gap ("5  000"); a plain no-break space reads right.
  return value.toLocaleString(locale).replace(/\u202f/g, '\u00a0');
}
