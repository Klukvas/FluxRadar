// Where each screen of the app lives in the address bar, and how an address is
// read back into a screen.
//
// A reload, a bookmark, a shared link and the Back button all depend on these
// rules agreeing with each other, so they sit together here rather than
// spread through the component that renders the screens.

import { ADMIN_STATS_PATH } from './admin-stats';
import type { Scan } from './api';
import { isTerminalScanStatus } from './scan-status';
import type { SeoPageId } from './seo';
import { WORKSPACE_PATHS, type WorkspaceTabScreen } from './workspace-paths';

export type Screen =
  | 'home'
  | 'auth'
  | 'desktop'
  | 'new-scan'
  | 'reports'
  | 'scan'
  | 'results'
  | 'issues'
  | 'integrations'
  | 'faq'
  | 'privacy'
  | 'terms'
  | 'cookies'
  | 'checks'
  | 'bot'
  | 'account'
  | 'admin-stats'
  | 'print'
  | 'styleguide';

/**
 * Screens that only exist for a signed-in account.
 *
 * A signed-out visitor who follows one of their URLs is asked to sign in and is
 * then taken to the screen they asked for, rather than being dropped on the
 * marketing home page with no explanation of where their link went.
 */
const WORKSPACE_SCREENS: readonly Screen[] = [
  'desktop',
  'new-scan',
  'reports',
  'scan',
  'results',
  'issues',
  'integrations',
  'account',
  'admin-stats',
  'print',
];

/** The account screen's URL. Not a menu tab: it is reached from the header's address. */
const ACCOUNT_PATH = '/account';

export function isWorkspaceScreen(screen: Screen): boolean {
  return WORKSPACE_SCREENS.includes(screen);
}

/**
 * The URL a screen lives at.
 *
 * Every workspace screen has one, which is the whole point: a reload, a
 * bookmark, a shared link and the browser's back button all have to land the
 * owner where they were, and a screen that shares `/` with another one cannot
 * do that.
 */
export function pathForScreen(screen: Screen, scanId: string | null): string {
  switch (screen) {
    case 'desktop':
    case 'new-scan':
    case 'reports':
    case 'integrations':
      return WORKSPACE_PATHS[screen];
    case 'checks':
      return '/checks';
    case 'bot':
      return '/bot';
    case 'faq':
      return '/faq';
    case 'privacy':
      return '/privacy';
    case 'terms':
      return '/terms';
    case 'cookies':
      return '/cookies';
    case 'scan':
    case 'results':
      // A report screen without a scan is the reports list, not a broken URL.
      return scanId === null ? '/reports' : `/scans/${encodeURIComponent(scanId)}`;
    case 'issues':
      return scanId === null ? '/reports' : `/scans/${encodeURIComponent(scanId)}/issues`;
    case 'print':
      return scanId === null ? '/reports' : `/scans/${encodeURIComponent(scanId)}/report`;
    case 'account':
      return ACCOUNT_PATH;
    case 'admin-stats':
      return ADMIN_STATS_PATH;
    default:
      return '/';
  }
}

export interface InitialRoute {
  readonly screen: Screen;
  readonly scanId: string | null;
  readonly emailAction: { readonly kind: 'verify' | 'reset'; readonly token: string } | null;
  /** Home section to scroll to on entry, used by legacy links such as /plans. */
  readonly scrollTo: 'pricing' | null;
}

/**
 * Workspace paths that carry no identifier, read back to their screens. Built
 * from `WorkspaceTabScreen`, so an entry in the table that is not a `Screen`
 * fails to compile here instead of routing to nothing.
 */
const SCREEN_BY_WORKSPACE_PATH: Readonly<Record<string, Screen>> = Object.fromEntries(
  (Object.keys(WORKSPACE_PATHS) as WorkspaceTabScreen[]).map(
    (screen) => [WORKSPACE_PATHS[screen], screen] as const,
  ),
);

export function readInitialRoute(): InitialRoute {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(window.location.search);
  const verifyToken = params.get('verify_email');
  const resetToken = params.get('reset_token');
  const emailAction =
    verifyToken !== null
      ? { kind: 'verify' as const, token: verifyToken }
      : resetToken !== null
        ? { kind: 'reset' as const, token: resetToken }
        : null;
  const publicRoute = (screen: Screen): InitialRoute => ({
    screen,
    scanId: null,
    emailAction: null,
    scrollTo: null,
  });
  if (path === '/privacy') return publicRoute('privacy');
  if (path === '/terms') return publicRoute('terms');
  if (path === '/cookies') return publicRoute('cookies');
  if (path === '/checks') return publicRoute('checks');
  if (path === '/bot') return publicRoute('bot');
  if (path === '/faq') return publicRoute('faq');
  if (path === ACCOUNT_PATH)
    return { screen: 'account', scanId: null, emailAction: null, scrollTo: null };
  // Owner-only and linked from no menu; the API decides who sees numbers.
  if (path === ADMIN_STATS_PATH)
    return { screen: 'admin-stats', scanId: null, emailAction: null, scrollTo: null };
  // The standalone plans screen was folded into the home pricing section. Old
  // /plans links keep working by landing there instead of on an unknown route.
  if (path === '/plans')
    return { screen: 'home', scanId: null, emailAction: null, scrollTo: 'pricing' };
  const workspaceScreen = SCREEN_BY_WORKSPACE_PATH[path];
  if (workspaceScreen !== undefined)
    return { screen: workspaceScreen, scanId: null, emailAction: null, scrollTo: null };
  const scanRoute = readScanRoute(path);
  if (scanRoute !== null) return scanRoute;
  const route = window.location.hash.slice(1);
  return {
    screen:
      emailAction !== null
        ? 'auth'
        : route === 'styleguide'
          ? 'styleguide'
          : route === 'integrations'
            ? 'integrations'
            : 'home',
    scanId: null,
    emailAction,
    scrollTo: null,
  };
}

/** `/scans/:id`, `/scans/:id/issues` and `/scans/:id/report`, or null when the path is none. */
function readScanRoute(path: string): InitialRoute | null {
  const match = /^\/scans\/([^/]+)(\/issues|\/report)?$/.exec(path);
  if (match?.[1] === undefined) return null;
  try {
    const scanId = decodeURIComponent(match[1]);
    if (scanId.length === 0) return null;
    return {
      screen: match[2] === undefined ? 'scan' : match[2] === '/report' ? 'print' : 'issues',
      scanId,
      emailAction: null,
      scrollTo: null,
    };
  } catch {
    // Treat a malformed deep link like any other unknown public route.
    return null;
  }
}

/** Which screen of a scan a scan URL asked for. */
export function scanRoutePreference(screen: Screen): 'auto' | 'issues' | 'print' {
  return screen === 'issues' || screen === 'print' ? screen : 'auto';
}

export function isTerminalScan(scan: Scan): boolean {
  return isTerminalScanStatus(scan.status);
}

/**
 * Which public document a screen is, for search engines.
 *
 * `auth` is the home page with a modal over it, and `styleguide` is an internal
 * reference; everything else that is not a listed public page sits behind
 * sign-in and is marked as not indexable rather than described as something it
 * is not.
 */
export function seoPageForScreen(screen: Screen): SeoPageId {
  switch (screen) {
    case 'home':
    case 'auth':
      return 'home';
    case 'faq':
      return 'faq';
    case 'checks':
      return 'checks';
    case 'bot':
      return 'bot';
    case 'privacy':
      return 'privacy';
    case 'terms':
      return 'terms';
    case 'cookies':
      return 'cookies';
    default:
      return 'workspace';
  }
}
