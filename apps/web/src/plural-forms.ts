// The arithmetic behind a numeral, shared by the locales that need it: which
// noun form it selects, and how its digits are grouped.
//
// Promoted out of `i18n.ts` when the Russian copy moved to `i18n.ru.ts`: both
// files name their own forms, and neither may import the other's module to get
// the sum right.

/**
 * Which of the three forms a numeral selects in Ukrainian and in Russian.
 *
 * The arithmetic is the same in both: 1 takes the singular, 2–4 take the few
 * form, 5 and up take the many form, and 11–14 take the many form however they
 * end. It is written once here; the words differ per language, so each locale
 * keeps its own named helper.
 */
export function countForm(count: number, one: string, few: string, many: string): string {
  const teens = Math.abs(count) % 100;
  if (teens >= 11 && teens <= 14) return many;
  const last = Math.abs(count) % 10;
  if (last === 1) return one;
  return last >= 2 && last <= 4 ? few : many;
}

/**
 * A whole number with its digits grouped the way `locale` writes them.
 *
 * Ukrainian and Russian group with a narrow no-break space, which this UI font
 * draws as a full-width gap ("5  000"); a plain no-break space reads right.
 * `format-count.ts` is the call site that holds an interface language;
 * `i18n.ru.ts` calls it directly, because it may not import `i18n.ts`.
 */
export function groupDigits(value: number, locale: string): string {
  return value.toLocaleString(locale).replace(/\u202f/g, '\u00a0');
}
