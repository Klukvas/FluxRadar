// How a session starts: reading who is signed in and putting them on the screen
// their address asked for, including a confirmation link opened in a browser
// that is already signed in.

import { useCallback, useEffect, useRef } from 'react';

import { apiRequest, ApiRequestError, type Account, type Scan, type SiteProfile } from './api';
import type { OpenScanById } from './app-navigation';
import {
  isPublicDocument,
  isTerminalScan,
  isWorkspaceScreen,
  newScanPath,
  pathForScreen,
  scanRoutePreference,
  type Screen,
} from './app-routes';
import type { AppState } from './app-state';
import { authCopy } from './auth-copy';
import { consumeGoogleReturn } from './google-auth-return';
import type { Language } from './i18n';

type ConfirmEmailSignedIn = (token: string, current: Account) => Promise<void>;

type SessionBoot = Pick<
  AppState,
  | 'entryRoute'
  | 'setAccount'
  | 'setBooting'
  | 'setSessionError'
  | 'sessionAttempt'
  | 'setProfiles'
  | 'setScreen'
  | 'setSelectedProfile'
  | 'setSelectedScan'
  | 'setTourOpen'
  | 'setNewScanPlan'
> & {
  readonly openScanById: OpenScanById;
  readonly confirmEmailSignedIn: ConfirmEmailSignedIn;
};

export async function loadProfiles(
  setter: (profiles: SiteProfile[]) => void,
): Promise<SiteProfile[]> {
  const profiles = await apiRequest<SiteProfile[]>('/profiles');
  setter(profiles);
  return profiles;
}

/**
 * Confirms the address in a verification link opened in a browser that is
 * already signed in, and shows the owner their workspace.
 */
export function useConfirmEmailSignedIn(
  language: Language,
  {
    setAccount,
    setEmailAction,
    setError,
    setNotice,
    setScreen,
  }: Pick<AppState, 'setAccount' | 'setEmailAction' | 'setError' | 'setNotice' | 'setScreen'>,
): ConfirmEmailSignedIn {
  // Read by the boot effect, which runs once and must not re-run on a language switch.
  const languageRef = useRef(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  return useCallback(async (token: string, current: Account) => {
    setEmailAction(null);
    setScreen('desktop');
    window.history.replaceState(null, '', pathForScreen('desktop', null));
    try {
      await apiRequest<{ status: string }>(`/auth/verify-email?token=${encodeURIComponent(token)}`);
      setAccount({ ...current, emailVerified: true });
      setNotice(authCopy[languageRef.current].leads.verified);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Verification failed');
    }
  }, []);
}

/**
 * Reads the session once, on mount. A public document never waits for it; any
 * other screen waits, and a visitor who followed a workspace link is asked to
 * sign in.
 */
export function useSessionBoot(boot: SessionBoot): void {
  const { entryRoute, setAccount, setBooting, setScreen, setSessionError, sessionAttempt } = boot;
  const { openScanById, confirmEmailSignedIn } = boot;
  useEffect(() => {
    if (isPublicDocument(entryRoute.screen)) {
      // A public document renders at once for anyone and never waits on the API.
      // The session is read alongside only so its header can offer the workspace
      // to a signed-in reader, as the header on every other page does.
      setBooting(false);
      apiRequest<Account>('/auth/me')
        .then(setAccount)
        .catch((caught: unknown) => {
          // Either way the header keeps its visitor state. A visitor with no
          // session is the ordinary answer; anything else is worth a console line.
          if (caught instanceof ApiRequestError && caught.status === 401) return;
          console.error('FluxRadar session unavailable', caught);
        });
      return;
    }
    apiRequest<Account>('/auth/me')
      .then((value) => restoreSignedInSession(value, boot))
      .catch((caught: unknown) => {
        // Authentication is required before any workspace screen is fetched. The
        // same home surface then presents the login modal without exposing
        // whether another account owns the requested scan.
        if (caught instanceof ApiRequestError && caught.status === 401) {
          if (entryRoute.scanId !== null || isWorkspaceScreen(entryRoute.screen)) setScreen('auth');
          return;
        }
        console.error('FluxRadar session unavailable', caught);
        setSessionError(
          caught instanceof Error ? caught.message : 'FluxRadar is temporarily unavailable.',
        );
      })
      .finally(() => setBooting(false));
  }, [
    entryRoute.scanId,
    entryRoute.screen,
    entryRoute.emailAction,
    openScanById,
    confirmEmailSignedIn,
    sessionAttempt,
  ]);
}

/** Puts a signed-in owner on the screen their address asked for, or on their running scan. */
async function restoreSignedInSession(value: Account, boot: SessionBoot): Promise<void> {
  const { entryRoute, confirmEmailSignedIn, openScanById, setProfiles } = boot;
  const { setAccount, setScreen, setSelectedProfile, setSelectedScan, setTourOpen } = boot;
  setAccount(value);
  try {
    const profiles = await loadProfiles(setProfiles);
    // The site a new-scan address names. Matched against the owner's own
    // profiles, so an id that was edited, deleted or simply made up selects
    // nothing and the form falls back to its first site as before.
    if (entryRoute.profileId !== null) {
      const named = profiles.find((profile) => profile.id === entryRoute.profileId);
      if (named !== undefined) setSelectedProfile(named);
    }
    // The confirmation link is usually opened in the browser the owner is
    // already signed in to. That session used to land on an empty
    // workspace — the sign-in dialog that confirms the link is only drawn
    // for visitors — and the address stayed unconfirmed.
    if (entryRoute.emailAction?.kind === 'verify') {
      await confirmEmailSignedIn(entryRoute.emailAction.token, value);
      return;
    }
    if (entryRoute.emailAction?.kind === 'reset') return;
    const googleLanguage = new URLSearchParams(window.location.search).get('lang');
    const languageSearch =
      googleLanguage === 'uk' || googleLanguage === 'en' ? `?lang=${googleLanguage}` : '';
    const googleReturn = consumeGoogleReturn();
    if (new URLSearchParams(window.location.search).get('google_auth') === 'success') {
      const pending = googleReturn?.intent;
      boot.setNewScanPlan(pending?.plan ?? null);
      if (googleReturn?.route.scanId) {
        window.history.replaceState(
          null,
          '',
          pathForScreen(googleReturn.route.screen, googleReturn.route.scanId) + languageSearch,
        );
        await openScanById(
          googleReturn.route.scanId,
          scanRoutePreference(googleReturn.route.screen),
        );
        if (googleLanguage === 'uk' || googleLanguage === 'en') {
          const restoredUrl = new URL(window.location.href);
          restoredUrl.searchParams.set('lang', googleLanguage);
          window.history.replaceState(
            null,
            '',
            restoredUrl.pathname + restoredUrl.search + restoredUrl.hash,
          );
        }
      } else if (pending?.site) {
        setScreen('desktop');
        window.history.replaceState(
          null,
          '',
          `/profiles?add=${encodeURIComponent(pending.site)}${languageSearch ? `&lang=${googleLanguage}` : ''}`,
        );
      } else if (pending?.plan) {
        setScreen('new-scan');
        window.history.replaceState(null, '', '/scan' + languageSearch);
      } else {
        const target =
          googleReturn !== null && isWorkspaceScreen(googleReturn.route.screen)
            ? googleReturn.route.screen
            : 'desktop';
        setScreen(target);
        const requestedProfileId = googleReturn?.route.profileId ?? null;
        const requestedProfile = profiles.find((profile) => profile.id === requestedProfileId);
        if (target === 'new-scan' && requestedProfile !== undefined)
          setSelectedProfile(requestedProfile);
        const targetUrl = new URL(
          target === 'new-scan'
            ? newScanPath(requestedProfile?.id ?? null)
            : pathForScreen(target, null),
          window.location.origin,
        );
        if (googleLanguage === 'uk' || googleLanguage === 'en')
          targetUrl.searchParams.set('lang', googleLanguage);
        window.history.replaceState(null, '', targetUrl.pathname + targetUrl.search);
        if (value.onboarding?.status === 'pending') setTourOpen(true);
      }
      return;
    }
    if (entryRoute.scanId !== null) {
      await openScanById(entryRoute.scanId, scanRoutePreference(entryRoute.screen));
      return;
    }
    if (value.onboarding?.status === 'pending') {
      setScreen('desktop');
      window.history.replaceState(null, '', pathForScreen('desktop', null));
      setTourOpen(true);
      return;
    }
    // A workspace URL is an explicit request for that screen, so the
    // active-scan shortcut below must not overrule it — someone who opened
    // their reports did not ask to be moved to a running scan.
    if (isWorkspaceScreen(entryRoute.screen)) return;
    const active = await apiRequest<Scan | null>('/scans/active');
    if (active !== null) {
      setSelectedScan(active);
      const target: Screen = isTerminalScan(active) ? 'results' : 'scan';
      window.history.replaceState(null, '', pathForScreen(target, active.id));
      setScreen(target);
    }
  } catch (caught: unknown) {
    console.error('FluxRadar boot data unavailable', caught);
  }
}
