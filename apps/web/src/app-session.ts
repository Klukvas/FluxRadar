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
  pathForScreen,
  scanRoutePreference,
  type Screen,
} from './app-routes';
import type { AppState } from './app-state';
import { authCopy } from './auth-copy';
import type { Language } from './i18n';

type ConfirmEmailSignedIn = (token: string, current: Account) => Promise<void>;

type SessionBoot = Pick<
  AppState,
  | 'entryRoute'
  | 'setAccount'
  | 'setBooting'
  | 'setProfiles'
  | 'setScreen'
  | 'setSelectedScan'
  | 'setTourOpen'
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
  const { entryRoute, setAccount, setBooting, setScreen } = boot;
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
      .catch(() => {
        // Authentication is required before any workspace screen is fetched. The
        // same home surface then presents the login modal without exposing
        // whether another account owns the requested scan.
        if (entryRoute.scanId !== null || isWorkspaceScreen(entryRoute.screen)) setScreen('auth');
      })
      .finally(() => setBooting(false));
  }, [
    entryRoute.scanId,
    entryRoute.screen,
    entryRoute.emailAction,
    openScanById,
    confirmEmailSignedIn,
  ]);
}

/** Puts a signed-in owner on the screen their address asked for, or on their running scan. */
async function restoreSignedInSession(value: Account, boot: SessionBoot): Promise<void> {
  const { entryRoute, confirmEmailSignedIn, openScanById, setProfiles } = boot;
  const { setAccount, setScreen, setSelectedScan, setTourOpen } = boot;
  setAccount(value);
  try {
    await loadProfiles(setProfiles);
    // The confirmation link is usually opened in the browser the owner is
    // already signed in to. That session used to land on an empty
    // workspace — the sign-in dialog that confirms the link is only drawn
    // for visitors — and the address stayed unconfirmed.
    if (entryRoute.emailAction?.kind === 'verify') {
      await confirmEmailSignedIn(entryRoute.emailAction.token, value);
      return;
    }
    if (entryRoute.emailAction?.kind === 'reset') return;
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
