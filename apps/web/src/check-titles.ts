// What one check is called on a report, in the reader's language.
//
// A module row stores the registry's own title — `meta description`,
// `index/noindex` — which is an English engineering label. The section card,
// the plan footnote and the check list all print check names, and they used to
// disagree: the list translated, the card and the footnote printed the stored
// title into a Ukrainian report. One lookup, so they say the same thing.

import { copy, type Language } from './i18n';

/** The report's own name for a rule's check, or undefined when it has none. */
export function checkCopyTitle(ruleId: string, language: Language): string | undefined {
  const titles: Readonly<Record<string, string | undefined>> = copy[language].report.checks.titles;
  return titles[ruleId];
}

/**
 * The check's localized name, or the stored title — capitalized, as the head
 * of a row — when the report has no copy for that rule.
 */
export function localizedCheckTitle(
  ruleId: string,
  storedTitle: string,
  language: Language,
): string {
  return (
    checkCopyTitle(ruleId, language) ?? storedTitle.charAt(0).toUpperCase() + storedTitle.slice(1)
  );
}
