// Which Action Plan language a client-report address asks to print.
//
// It lives in the address rather than in routed state: the printable report is
// a link someone is handed, and opening it has to produce the same document for
// them as for the person who sent it. A code the picker does not list is
// ignored, so a hand-edited address falls back to the reader's own language.

import { isLanguageCode, type LanguageCode } from './target-languages';

const PLAN_QUERY_PARAMETER = 'plan';

/** The `?plan=xx` a print address carries for one plan language. */
export function planSearch(language: LanguageCode): string {
  return `?${new URLSearchParams({ [PLAN_QUERY_PARAMETER]: language }).toString()}`;
}

/** The plan language a print address names, or null when it names none the picker lists. */
export function planLanguageFromSearch(search: string): LanguageCode | null {
  const code = new URLSearchParams(search).get(PLAN_QUERY_PARAMETER);
  return isLanguageCode(code) ? code : null;
}
