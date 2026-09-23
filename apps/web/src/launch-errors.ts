import { ApiRequestError } from './api';
import { copy, type Language } from './i18n';

type NewScanCopy = (typeof copy)[Language]['newScan'];

// Refusals the API names by code get a sentence in the page's language. Any
// other failure keeps the API's own message, which api.ts has already swapped
// for a friendly one when it was technical. The API writes its messages in
// English only, so a code missing here reaches a Ukrainian page in English.
const LAUNCH_REFUSALS = new Map<string, (t: NewScanCopy) => string>([
  ['EGRESS_LOCATION_UNAVAILABLE', (t) => t.egressUnavailableError],
  ['EGRESS_LOCATION_UNKNOWN', (t) => t.egressUnknownError],
  ['FREE_CHECK_USED', (t) => t.freeCheckUsedError],
  ['FREE_CHECK_DOMAIN_USED', (t) => t.freeCheckDomainUsedError],
]);

/** What to tell the owner when a scan they asked for did not start. */
export function launchErrorMessage(caught: unknown, language: Language, fallback: string): string {
  if (caught instanceof ApiRequestError && caught.code !== null) {
    const refusal = LAUNCH_REFUSALS.get(caught.code);
    if (refusal !== undefined) return refusal(copy[language].newScan);
  }
  return caught instanceof Error ? caught.message : fallback;
}
