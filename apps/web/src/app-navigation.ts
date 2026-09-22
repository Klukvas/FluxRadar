// How the app moves between screens: opening a scan on the screen it has,
// pushing a screen onto the history, and following Back and Forward.

import { useCallback, useEffect, useRef } from 'react';

import { apiRequest, type Account, type Scan } from './api';
import {
  isTerminalScan,
  isWorkspaceScreen,
  pathForScreen,
  readInitialRoute,
  scanRoutePreference,
  type Screen,
} from './app-routes';
import type { AppState } from './app-state';

/** Opens a scan by id, on the screen it has or on the one its address asked for. */
export type OpenScanById = (
  scanId: string,
  preferred?: 'auto' | 'issues' | 'print',
) => Promise<void>;

/** Moves to a screen and records it in the history. */
export type Navigate = (next: string, scanId?: string, search?: string) => void;

/**
 * Opens a scan by id and lands on the screen that scan actually has.
 *
 * A running scan opens on its progress window and a finished one on its
 * report, so the same URL is correct before and after the scan ends. A scan
 * that cannot be read (deleted, or another account's) falls back to the
 * reports list, which explains itself, rather than to a blank screen.
 */
export function useOpenScanById({
  setError,
  setScreen,
  setSelectedScan,
}: Pick<AppState, 'setError' | 'setScreen' | 'setSelectedScan'>): OpenScanById {
  return useCallback(
    async (scanId: string, preferred: 'auto' | 'issues' | 'print' = 'auto'): Promise<void> => {
      try {
        const scan = await apiRequest<Scan>(`/scans/${scanId}`);
        setSelectedScan(scan);
        const target: Screen =
          preferred === 'issues' || preferred === 'print'
            ? preferred
            : isTerminalScan(scan)
              ? 'results'
              : 'scan';
        setScreen(target);
        // The print view reads its plan language from `?plan=`; every other
        // scan screen's address is the path alone.
        const search = target === 'print' ? window.location.search : '';
        window.history.replaceState(null, '', pathForScreen(target, scan.id) + search);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Scan could not be restored');
        window.history.replaceState(null, '', pathForScreen('reports', null));
        setScreen('reports');
      }
    },
    [],
  );
}

export function useNavigate({
  setScreen,
  setTourOpen,
}: Pick<AppState, 'setScreen' | 'setTourOpen'>): Navigate {
  // `search` rides along for the one screen that reads a query: the print view's
  // plan language.
  return useCallback((next: string, scanId?: string, search = '') => {
    if (next === 'styleguide') {
      window.location.hash = 'styleguide';
      setScreen('styleguide');
      return;
    }
    // 'onboarding' is a virtual route: it opens the tour and lands on desktop.
    if (next === 'onboarding') setTourOpen(true);
    const requested = next === 'onboarding' ? 'desktop' : next;
    const valid: Screen = [
      'home',
      'auth',
      'desktop',
      'new-scan',
      'reports',
      'scan',
      'results',
      'issues',
      'integrations',
      'checks',
      'account',
      'admin-stats',
      'print',
    ].includes(requested)
      ? (requested as Screen)
      : 'desktop';
    const path = pathForScreen(valid, scanId ?? null);
    // Pushed, not replaced, so that Back returns to the previous screen instead
    // of leaving the workspace entirely. Re-entering the screen you are already
    // on replaces instead, so a repeated tab click does not fill the history.
    if (path === window.location.pathname) window.history.replaceState(null, '', path + search);
    else window.history.pushState(null, '', path + search);
    setScreen(valid);
  }, []);
}

/** Keeps Back and Forward inside the app, on the screen each address names. */
export function useBackAndForward(
  { account, selectedScan, setScreen }: Pick<AppState, 'account' | 'selectedScan' | 'setScreen'>,
  openScanById: OpenScanById,
): void {
  // Read by the history listener below, which is registered once and must not
  // see the account and scan as they were when it was registered.
  const accountRef = useRef<Account | null>(null);
  const selectedScanRef = useRef<Scan | null>(null);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);
  useEffect(() => {
    selectedScanRef.current = selectedScan;
  }, [selectedScan]);

  // Back and Forward have to move between workspace screens, not out of the app:
  // every navigation above pushes an entry, so each of those entries needs a
  // screen to return to. The URL is the single source of truth here.
  useEffect(() => {
    function onPopState(): void {
      const route = readInitialRoute();
      if (accountRef.current === null && isWorkspaceScreen(route.screen)) {
        setScreen('home');
        return;
      }
      if (route.scanId === null) {
        setScreen(route.screen);
        return;
      }
      const loaded = selectedScanRef.current;
      if (loaded === null || loaded.id !== route.scanId) {
        void openScanById(route.scanId, scanRoutePreference(route.screen));
        return;
      }
      // `/scans/:id` is the report once the scan has one and the progress window
      // while it is still running — the same rule the deep link is resolved by,
      // so going back to a URL shows what going forward to it showed.
      setScreen(
        route.screen === 'issues' || route.screen === 'print'
          ? route.screen
          : isTerminalScan(loaded)
            ? 'results'
            : 'scan',
      );
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [openScanById]);
}
