// The Russian interface, in the shape `i18n.ts` merges into `copy.ru`.
//
// Split out of `i18n.ts` on size alone: the shared file was past five thousand
// lines, and this is one locale read as one document. It then outgrew a single
// file itself, so the copy lives in two halves beside this one —
// `i18n.ru.site.ts` for what a visitor and a site owner read, `i18n.ru.scan.ts`
// for everything from configuring a check to paying for it. The report screen
// and the Issue Center keep their own files (`i18n.ru.report.ts`,
// `i18n.ru.issues.ts`), which `i18n.ts` merges in, and `checks-copy.ru.ts` is
// the same split for the coverage page. Only the merge is here.
//
// Nothing in this locale may import `i18n.ts`: that file imports this one, so
// the Russian number grammar lives in `i18n.ru.grammar.ts` and the arithmetic
// it shares with Ukrainian in `plural-forms.ts`, rather than across the cycle.

import { russianScanCopy } from './i18n.ru.scan';
import { russianSiteCopy } from './i18n.ru.site';

// Re-exported from here as well as from their own module: the copy files and
// the locale tests have always asked `i18n.ru` for the Russian noun forms.
export {
  RU_INTL_LOCALE,
  ruCountForm,
  ruPagesAccusative,
  ruPagesOf,
  takesRuSingular,
} from './i18n.ru.grammar';

/**
 * Every section a Russian reader gets in Russian, as one object again.
 *
 * The two halves are merged rather than nested, so `copy.ru` keeps the shape
 * `i18n.ts` checks it against and no screen has to know which file its words
 * came from.
 *
 * Written from the Ukrainian meaning rather than translated word for word, and
 * both halves keep the Ukrainian copy's three habits: no dash construction
 * carrying a sentence, no accent on what the Free check costs, and nothing
 * about how the AI visibility questions are built beyond what the Ukrainian
 * text already discloses.
 */
export const russianInterfaceCopy = {
  ...russianSiteCopy,
  ...russianScanCopy,
} as const;
