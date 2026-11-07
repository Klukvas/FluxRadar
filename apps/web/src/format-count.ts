// A whole number of things, grouped the way the reader's language writes it.

import { INTL_LOCALES, type Language } from './i18n';
import { groupDigits } from './plural-forms';

/** «5 000» in Ukrainian and Russian, "5,000" in English. */
export function formatCount(value: number, language: Language): string {
  return groupDigits(value, INTL_LOCALES[language]);
}
