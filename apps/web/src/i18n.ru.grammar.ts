// How Russian writes a number: the noun form it selects, and its digit grouping.
//
// Its own module so that the three Russian copy files and the two halves of the
// interface can all reach it without importing one another, and so that nothing
// has to reach `i18n.ts` for a locale tag — that file imports this locale, and
// the cycle would run the copy before the helpers it calls exist.

import { countForm } from './plural-forms';

/**
 * The locale tag `INTL_LOCALES.ru` carries, named again here rather than
 * imported, for the reason above.
 */
export const RU_INTL_LOCALE = 'ru-RU';

/**
 * Whether a Russian numeral takes the singular form of the noun after it:
 * «21 страница», but «11 страниц».
 */
export function takesRuSingular(count: number): boolean {
  return Math.abs(count) % 10 === 1 && Math.abs(count) % 100 !== 11;
}

/**
 * The three Russian forms after a numeral — «1 проверка», «2 проверки»,
 * «5 проверок» — with 11–14 taking the many form however they end
 * («11 проверок», «21 проверка»).
 */
export function ruCountForm(count: number, one: string, few: string, many: string): string {
  return countForm(count, one, few, many);
}

/** Genitive, after «с» or «до»: «с 21 страницы», «до 5 000 страниц». */
export const ruPagesOf = (count: number): string =>
  takesRuSingular(count) ? 'страницы' : 'страниц';

/** Accusative, as the direct object of a verb: «1 страницу», «2 страницы», «5 страниц». */
export const ruPagesAccusative = (count: number): string =>
  ruCountForm(count, 'страницу', 'страницы', 'страниц');
