// Copy helpers shared by the Google properties panel and its domain overview.

import type { copy, Language } from './i18n';
import type { SearchConsoleOriginProblem } from './search-console-origin';

export type GoogleCopy = (typeof copy)[Language]['integrations']['google'];

/** Why a Search Console property cannot become an address FluxRadar audits, in the reader's words. */
export function originProblemCopy(t: GoogleCopy, problem: SearchConsoleOriginProblem): string {
  return problem === 'insecure_scheme' ? t.createInsecure : t.createUnsupported;
}
