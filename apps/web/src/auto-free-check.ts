// The free homepage check a visitor asked for by typing an address on the
// public page, started the moment they have an account.
//
// The address used to open the add-a-site form instead, and most new accounts
// stopped there: of the first twenty-one, eleven never saved a site at all.
// Typing an address and pressing "check" was the request; a form between that
// and the result asked for it a second time.
//
// Two things that form did for the visitor are kept:
//
//   - An account whose free check is spent gets the form, as before, and
//     nothing is saved for it: a check that would only be refused is not a
//     reason to create a site behind the owner's back.
//   - The site is asked whether it will answer before anything is spent on it.
//     The free check is once per account and once per site and is claimed the
//     moment it starts, so a typo that started a check of a site that does not
//     exist would use it up for good. The question is the reachability probe
//     the paid scan form asks — the crawler's own user agent, from the country
//     the scan would leave from — not the profile-autofill read, which reads
//     the whole homepage and asks an AI model about it.
//
// What starts here is the check alone. No AI question is sent — its consent box
// lives on the scan form this path skips — so the progress screen asks instead
// (FreeAiAsk.tsx), and the report keeps its own "add the answer" button.

import { apiRequest, type Account, type Scan, type SiteProfile } from './api';
import { trackScanStarted } from './funnel-analytics';
import { copy, type Language } from './i18n';
import { codedLaunchRefusal } from './launch-errors';
import { reachVerdictCopy } from './SiteReachability';
import { readSiteReachability } from './site-reachability-response';

export type AutoFreeCheck =
  | { readonly kind: 'started'; readonly profile: SiteProfile; readonly scan: Scan }
  /** The account's free check is spent: nothing was asked or saved, the form is next. */
  | { readonly kind: 'free-check-used' }
  /** The site could not be saved: nothing exists yet, the add-a-site form is next. */
  | { readonly kind: 'profile-failed'; readonly message: string }
  /**
   * The site is saved but did not answer, or could not be asked: nothing was
   * spent, and the scan form for it is next with the reason on top.
   */
  | { readonly kind: 'unreadable'; readonly profile: SiteProfile; readonly message: string }
  /** The site is saved but its free check was refused: the scan form says why. */
  | { readonly kind: 'refused'; readonly profile: SiteProfile; readonly message: string };

/**
 * How long each request of the automatic start may take. The window over the
 * screen has no close button, so a request that never answers must not keep
 * it up: past these, the start takes its cautious way out and spends nothing.
 * The probe gets the most, as it may wait on the site twice (robots.txt, then
 * the page).
 */
const SAVE_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 35_000;
const START_TIMEOUT_MS = 20_000;

/** The sentences for a refusal the API did not name, in the reader's language. */
const fallbackCopy: Readonly<Record<Language, { saveFailed: string; startFailed: string }>> = {
  en: {
    saveFailed: 'The site could not be saved. Add it here and try again.',
    startFailed: 'The free check could not start. Try again from this form.',
  },
  uk: {
    saveFailed: 'Не вдалося зберегти сайт. Додайте його тут і спробуйте ще раз.',
    startFailed: 'Не вдалося запустити безкоштовну перевірку. Спробуйте ще раз із цієї форми.',
  },
  ru: {
    saveFailed: 'Не удалось сохранить сайт. Добавьте его здесь и попробуйте ещё раз.',
    startFailed: 'Не удалось запустить бесплатную проверку. Попробуйте ещё раз из этой формы.',
  },
};

/** Whether the site answers the crawler; the reason in the reader's language when not. */
async function readabilityProblem(
  profile: SiteProfile,
  language: Language,
): Promise<string | null> {
  try {
    const result = readSiteReachability(
      await apiRequest<unknown>(`/profiles/${encodeURIComponent(profile.id)}/reachability`, {
        method: 'POST',
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      }),
    );
    if (result === null) throw new Error('Unreadable reachability answer');
    if (result.state === 'reachable') return null;
    const verdict = reachVerdictCopy(language, result.state);
    return `${verdict.label}. ${verdict.body}`;
  } catch (caught) {
    // Rate-limited, the egress location down, or an answer we cannot read: not
    // knowing is not "reachable", so nothing is spent on it.
    console.error('FluxRadar could not ask the site before its free check', caught);
    // A coded refusal — the egress location down, for one — keeps its own
    // sentence in the reader's language; anything else gets the panel's, not
    // the API's English message.
    return codedLaunchRefusal(caught, language) ?? copy[language].reachability.failed;
  }
}

export async function startFreeCheckForSite(
  site: string,
  language: Language,
  account: Pick<Account, 'freeCheckUsed'>,
): Promise<AutoFreeCheck> {
  if (account.freeCheckUsed === true) return { kind: 'free-check-used' };
  let profile: SiteProfile;
  try {
    const resolved = await apiRequest<{ profile: SiteProfile; created: boolean }>(
      '/profiles/resolve',
      {
        method: 'POST',
        body: JSON.stringify({ domain: site }),
        signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
      },
    );
    profile = resolved.profile;
  } catch (caught) {
    console.error('FluxRadar could not save the site typed on the home page', caught);
    return {
      kind: 'profile-failed',
      // A coded refusal keeps its own sentence; anything else is said in the
      // reader's language rather than as the API's English message.
      message: codedLaunchRefusal(caught, language) ?? fallbackCopy[language].saveFailed,
    };
  }
  const problem = await readabilityProblem(profile, language);
  if (problem !== null) return { kind: 'unreadable', profile, message: problem };
  let scan: Scan;
  try {
    scan = await apiRequest<Scan>(`/profiles/${encodeURIComponent(profile.id)}/free-check`, {
      method: 'POST',
      // The language a later AI question is asked in is fixed at launch, as on
      // the form. No `aiConsent`: nobody has been shown its disclosure yet.
      body: JSON.stringify({ aiLanguage: language }),
      signal: AbortSignal.timeout(START_TIMEOUT_MS),
    });
  } catch (caught) {
    // Once per account and once per site, and refused while the location it
    // would leave from is down. The scan form for this site is the next useful
    // place, with the reason on top of it.
    console.error('FluxRadar could not start the free check', caught);
    return {
      kind: 'refused',
      profile,
      message: codedLaunchRefusal(caught, language) ?? fallbackCopy[language].startFailed,
    };
  }
  // Outside the try: a check that started is reported as started, whatever
  // the analytics call does.
  trackScanStarted(scan);
  return { kind: 'started', profile, scan };
}
