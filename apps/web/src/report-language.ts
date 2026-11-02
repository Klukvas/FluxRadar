// Where the Russian interface stops and the Ukrainian report begins.
//
// The interface speaks three languages; an audit report speaks two. A finding's
// title, its evidence and its recommendation are written by the API, which
// renders them in English or Ukrainian (`FINDING_LANGUAGES` in
// `packages/rules`), and the PDF and the emails are built from the same two.
//
// The owner's decision, and the line this module exists to hold:
//   * CHROME is Russian. Everything the app itself writes around the data is
//     translated, the report screen and the Issue Center included: window
//     titles, buttons, empty, loading and error states, section headings,
//     column headers, filter labels, the sentences that explain why a section
//     could not be measured. It lives in `i18n.ru.report.ts` and
//     `i18n.ru.issues.ts`.
//   * CONTENT is Ukrainian. Anything that comes from the findings, the
//     evidence or the rule catalogues stays in the report's language: rule
//     names and their not-applicable reasons (`copy.*.report.checks.titles`
//     and `.notApplicableReasons`, taken from the Ukrainian branch by
//     reference in `i18n.ts`), the finding catalogues built with
//     `ukrainianReportCopy` below, and the GEO and Bing observation texts.
//   * The PRINTED report, the PDF and every email are Ukrainian end to end.
//     `PrintReport.tsx` maps once, at the top of the document, and hands
//     `ReportLanguage` down; every request that asks the API for report text,
//     a PDF or an email sends `reportLanguage(language)`, never the interface
//     language.
//
// Translating the labels beside an API sentence without translating the
// sentence would produce a half-Russian paragraph, so the split is drawn at
// what the app owns rather than at what is easy to translate.

import type { Language } from './i18n';

/** The languages an audit report, a PDF and an email exist in. */
export type ReportLanguage = 'en' | 'uk';

/**
 * The language the report side of the product answers a reader in.
 *
 * Russian maps to Ukrainian rather than to English: a Russian-speaking owner of
 * a Ukrainian site is the reader this locale exists for, and Ukrainian is the
 * language their own site, their customers and this report are in.
 */
export function reportLanguage(language: Language): ReportLanguage {
  return language === 'ru' ? 'uk' : language;
}

/**
 * Gives a two-language report catalogue its `ru` entry, pointing at Ukrainian.
 *
 * Used instead of a translated third branch, so that `copy[language]` keeps
 * working everywhere while the report text itself stays in one language.
 */
export function ukrainianReportCopy<T>(
  copy: Readonly<Record<ReportLanguage, T>>,
): Readonly<Record<Language, T>> {
  return { ...copy, ru: copy.uk };
}
