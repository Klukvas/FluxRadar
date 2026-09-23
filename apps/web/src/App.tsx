import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AlertDialog,
  Button,
  Notice,
  LoadingState,
  MenuBar,
  CreatedByFluxLab,
  Window,
} from './components';
import { apiRequest, ApiRequestError, type Account, type Scan, type SiteProfile } from './api';
import { AccountScreen, resendVerification } from './AccountScreen';
import { accountCopy } from './account-copy';
import { AuthScreen } from './AuthScreen';
import { authCopy } from './auth-copy';
import {
  CheckoutPending,
  clearPendingCheckout,
  readPendingCheckout,
  storePendingCheckout,
  type PendingCheckout,
} from './Checkout';
import { CookieConsent } from './CookieConsent';
import { DesktopScreen } from './DesktopScreen';
import { HomeScreen } from './HomeScreen';
import { NewScanScreen } from './NewScanScreen';
import { Styleguide } from './Styleguide';
import { copy, readInitialLanguage, storeLanguage, type Language } from './i18n';
import { applyPageMetadata, type SeoPageId } from './seo';
import { OnboardingTour } from './OnboardingTour';
import { FaqScreen } from './Faq';
import { AuditCoverageScreen } from './Checks';
import { type ChosenPlan } from './Pricing';
import { PrintReport } from './PrintReport';
import { IntegrationsScreen } from './Integrations';
import { IssuesScreen } from './Issues';
import { ResultsScreen } from './Report';
import { LegalDocumentScreen } from './LegalDocuments';
import { ScanScreen } from './ScanProgress';
import { ReportsScreen } from './Reports';
import { SupportWidget } from './SupportWidget';
import { isTerminalScanStatus } from './scan-status';
import { WORKSPACE_PATHS, type WorkspaceTabScreen } from './workspace-paths';
import './styles/base.css';
import './styles/account.css';

type Screen =
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
  | 'account'
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
  'print',
];

/** The account screen's URL. Not a menu tab: it is reached from the header's address. */
const ACCOUNT_PATH = '/account';

function isWorkspaceScreen(screen: Screen): boolean {
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
function pathForScreen(screen: Screen, scanId: string | null): string {
  switch (screen) {
    case 'desktop':
    case 'new-scan':
    case 'reports':
    case 'integrations':
      return WORKSPACE_PATHS[screen];
    case 'checks':
      return '/checks';
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
    default:
      return '/';
  }
}

interface InitialRoute {
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

function readInitialRoute(): InitialRoute {
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
  if (path === '/faq') return publicRoute('faq');
  if (path === ACCOUNT_PATH)
    return { screen: 'account', scanId: null, emailAction: null, scrollTo: null };
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

/**
 * Which Action Plan `/scans/:id/report?plan=xx` asked to print, or null for the
 * reader's own language. Read from the URL rather than routed state: it is a
 * property of the link someone was handed, not of the workspace's navigation.
 */
function printPlanLanguage(): string | null {
  if (typeof window === 'undefined') return null;
  const requested = new URLSearchParams(window.location.search).get('plan');
  return requested === null || requested === '' ? null : requested;
}

/**
 * The address a restored scan screen is shown at, keeping `?plan=` on the
 * client report.
 *
 * Opening a deep link normalises the address to its canonical path, which would
 * otherwise drop the plan language before the document is drawn: someone handed
 * a Ukrainian plan to print would get it in their own language instead, and a
 * refresh would not bring it back.
 */
function restoredScanPath(screen: Screen, scanId: string): string {
  const path = pathForScreen(screen, scanId);
  const plan = screen === 'print' ? printPlanLanguage() : null;
  return plan === null ? path : `${path}?plan=${encodeURIComponent(plan)}`;
}

/** Which screen of a scan a scan URL asked for. */
function scanRoutePreference(screen: Screen): 'auto' | 'issues' | 'print' {
  return screen === 'issues' || screen === 'print' ? screen : 'auto';
}

function isTerminalScan(scan: Scan): boolean {
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
function seoPageForScreen(screen: Screen): SeoPageId {
  switch (screen) {
    case 'home':
    case 'auth':
      return 'home';
    case 'faq':
      return 'faq';
    case 'checks':
      return 'checks';
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

export function App() {
  const [language, setLanguage] = useState<Language>(readInitialLanguage);
  const changeLanguage = useCallback((next: Language) => {
    setLanguage(next);
    storeLanguage(next);
  }, []);
  // The support form floats over every screen, so it lives beside the screens
  // rather than in each of them; all it needs from the session is whose
  // address a reply goes to.
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const changeAccount = useCallback((next: Account | null) => {
    setAccountEmail(next?.email ?? null);
  }, []);
  return (
    <>
      <AppContent
        language={language}
        changeLanguage={changeLanguage}
        onAccountChange={changeAccount}
      />
      <SupportWidget language={language} accountEmail={accountEmail} />
      <CookieConsent language={language} />
    </>
  );
}

function AppContent({
  language,
  changeLanguage,
  onAccountChange,
}: {
  language: Language;
  changeLanguage: (language: Language) => void;
  onAccountChange: (account: Account | null) => void;
}) {
  const [entryRoute] = useState<InitialRoute>(readInitialRoute);
  const [screen, setScreen] = useState<Screen>(entryRoute.screen);
  const [emailAction, setEmailAction] = useState(entryRoute.emailAction);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [account, setAccount] = useState<Account | null>(null);
  const [profiles, setProfiles] = useState<SiteProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<SiteProfile | null>(null);
  // Which profile the reports list is scoped to; null lists the whole account.
  const [reportsProfile, setReportsProfile] = useState<SiteProfile | null>(null);
  const [selectedScan, setSelectedScan] = useState<Scan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [tourOpen, setTourOpen] = useState(false);
  // Held here, not inside the new-scan screen: the buyer pays in another tab and
  // may reload or navigate away before the provider webhook lands, and the
  // "confirming payment" window has to survive that from any screen.
  const [pendingCheckout, setPendingCheckout] = useState<PendingCheckout | null>(null);
  // A confirmation for what just worked — "Password changed", "Status saved" —
  // pinned where the owner is looking, like the error alert.
  const [notice, setNotice] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  // The problem the Issue Center opens on, when "Fix these first" sent the owner there.
  const [issueRuleFilter, setIssueRuleFilter] = useState<string | null>(null);
  // The plan the scan form opens on: chosen on the pricing cards, or from a Free
  // report's "Run Complete for this site".
  const [newScanPlan, setNewScanPlan] = useState<'Free' | 'Basic' | 'Complete' | null>(null);
  // What a visitor asked for before they had an account — the site typed on the
  // home page, or a plan picked on its pricing cards. Kept in memory only:
  // registration happens in a dialog over the same page, so nothing is stored.
  const [intent, setIntent] = useState<{
    readonly site: string | null;
    readonly plan: ChosenPlan | null;
  } | null>(null);
  const [verifyBannerHidden, setVerifyBannerHidden] = useState(false);
  const updateSelectedScan = useCallback((scan: Scan) => setSelectedScan(scan), []);
  // Read by the boot effect, which runs once and must not re-run on a language switch.
  const languageRef = useRef(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const confirmEmailSignedIn = useCallback(async (token: string, current: Account) => {
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

  useEffect(() => {
    onAccountChange(account);
  }, [account, onAccountChange]);

  // The document language is what a screen reader announces the page in and what
  // a browser offers to translate; leaving it on the served default silently
  // mislabels every Ukrainian session.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // Title, description, canonical, social cards and `hreflang` alternates are
  // per screen and per language: `index.html` is served for every route, so a
  // page that does not state its own metadata silently claims to be the home
  // page — including its canonical, which would keep it out of the index.
  useEffect(() => {
    applyPageMetadata(seoPageForScreen(screen), language);
  }, [screen, language]);

  /**
   * Opens a scan by id and lands on the screen that scan actually has.
   *
   * A running scan opens on its progress window and a finished one on its
   * report, so the same URL is correct before and after the scan ends. A scan
   * that cannot be read (deleted, or another account's) falls back to the
   * reports list, which explains itself, rather than to a blank screen.
   */
  const openScanById = useCallback(
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
        window.history.replaceState(null, '', restoredScanPath(target, scan.id));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Scan could not be restored');
        window.history.replaceState(null, '', pathForScreen('reports', null));
        setScreen('reports');
      }
    },
    [],
  );

  useEffect(() => {
    if (['privacy', 'terms', 'cookies', 'checks', 'faq'].includes(entryRoute.screen)) {
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
      .then(async (value) => {
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
      })
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

  useEffect(() => {
    const restored = account === null ? null : readPendingCheckout(account.accountId);
    setPendingCheckout(restored);
    // A buyer who reloaded mid-payment lands on the marketing home screen, where
    // the confirming window is not rendered. Put them back in the workspace so
    // the payment they already made is visibly still being confirmed.
    if (restored !== null) {
      setScreen((current) => (current === 'home' || current === 'auth' ? 'desktop' : current));
    }
  }, [account]);

  // Stable across renders so the confirming window is never handed a new
  // identity mid-payment; `CheckoutPending` guards its own polling as well.
  const startCheckout = useCallback((pending: PendingCheckout): void => {
    storePendingCheckout(pending);
    setPendingCheckout(pending);
  }, []);
  const endCheckout = useCallback((): void => {
    clearPendingCheckout();
    setPendingCheckout(null);
  }, []);

  const navigate = useCallback((next: string, scanId?: string) => {
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
      'print',
    ].includes(requested)
      ? (requested as Screen)
      : 'desktop';
    const path = pathForScreen(valid, scanId ?? null);
    // Pushed, not replaced, so that Back returns to the previous screen instead
    // of leaving the workspace entirely. Re-entering the screen you are already
    // on replaces instead, so a repeated tab click does not fill the history.
    if (path === window.location.pathname) window.history.replaceState(null, '', path);
    else window.history.pushState(null, '', path);
    setScreen(valid);
  }, []);

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

  /**
   * Carries out what the visitor asked for before they had an account.
   *
   * A typed site becomes a profile and, unless a paid plan was picked, its free
   * homepage check starts at once — that is the promise the home page's form
   * made. A picked plan opens the scan form on that plan. Returns false when
   * there was nothing to carry out.
   */
  const followIntent = async (pending: NonNullable<typeof intent>): Promise<boolean> => {
    if (pending.site === null) {
      if (pending.plan === null) return false;
      setNewScanPlan(pending.plan);
      navigate('new-scan');
      return true;
    }
    let profile: SiteProfile;
    try {
      const resolved = await apiRequest<{ profile: SiteProfile; created: boolean }>(
        '/profiles/resolve',
        { method: 'POST', body: JSON.stringify({ domain: pending.site }) },
      );
      profile = resolved.profile;
      await loadProfiles(setProfiles);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Profile creation failed');
      navigate('desktop');
      return true;
    }
    setSelectedProfile(profile);
    if (pending.plan !== null) {
      setNewScanPlan(pending.plan);
      navigate('new-scan');
      return true;
    }
    try {
      const scan = await apiRequest<Scan>(`/profiles/${profile.id}/free-check`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      onScanCreated(scan);
    } catch (caught) {
      // The free check is once per account and once per site. When it is
      // spent, the scan form for this site is the next useful place — with
      // the reason on top of it.
      setError(caught instanceof Error ? caught.message : 'The free check could not start');
      setNewScanPlan(null);
      navigate('new-scan');
    }
    return true;
  };

  const onAuthed = async (value: Account) => {
    setEmailAction(null);
    setAccount(value);
    setError(null);
    await loadProfiles(setProfiles);
    if (entryRoute.scanId !== null) {
      await openScanById(entryRoute.scanId, scanRoutePreference(entryRoute.screen));
      return;
    }
    const pending = intent;
    setIntent(null);
    // The owner is in the middle of something they asked for; the tour waits
    // for their next visit (the account stays "pending" until it is seen).
    if (pending !== null && (await followIntent(pending))) return;
    // Sign-in is a detour, not a destination: whoever followed a workspace link
    // gets that screen, and everyone else gets the workspace they signed in for.
    navigate(isWorkspaceScreen(entryRoute.screen) ? entryRoute.screen : 'desktop');
    if (value.onboarding?.status === 'pending') setTourOpen(true);
  };

  /**
   * Runs a Partial scan's unfinished section once more and follows it on the
   * progress screen. The API refuses a second retry and one after the purchase
   * window, in words the alert can show as they are.
   */
  const retryScan = async (scanId: string): Promise<void> => {
    try {
      await apiRequest<{ scanId: string; status: string }>(
        `/scans/${encodeURIComponent(scanId)}/retry`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      await openScanById(scanId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The retry could not start');
    }
  };

  const signOutLocally = (): void => {
    setAccount(null);
    setProfiles([]);
    setSelectedScan(null);
    setReportsProfile(null);
    setSelectedProfile(null);
    setVerifyBannerHidden(false);
    // Back to the public home: staying on a workspace URL with no account
    // would render the marketing page under /profiles.
    navigate('home');
  };

  const resendFromBanner = async (): Promise<void> => {
    if (account === null) return;
    try {
      await resendVerification(account.email);
      setNotice(accountCopy[language].email.resent(account.email));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Email could not be sent');
    }
  };

  const finishOnboarding = async (): Promise<void> => {
    try {
      const updated = await apiRequest<Account>('/account/onboarding', {
        method: 'PATCH',
        body: JSON.stringify({ completed: true }),
      });
      setAccount(updated);
      setTourOpen(false);
      navigate('desktop');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Onboarding could not be saved');
    }
  };

  const skipOnboarding = async (): Promise<void> => {
    try {
      // The backend records `completed: false` as a durable "skipped" status
      // (onboardingSkippedAt). Boot and sign-in only auto-open the tour for a
      // 'pending' account, so a skipped tour never reappears on later logins.
      const updated = await apiRequest<Account>('/account/onboarding', {
        method: 'PATCH',
        body: JSON.stringify({ completed: false }),
      });
      setAccount(updated);
      setTourOpen(false);
      navigate('desktop');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Onboarding could not be skipped');
    }
  };

  function onScanCreated(scan: Scan): void {
    setSelectedScan(scan);
    setNewScanPlan(null);
    navigate('scan', scan.id);
  }

  /** Opens a scan from the reports list, on whichever screen that scan has. */
  const openReport = (scan: Scan) => {
    setSelectedScan(scan);
    navigate(isTerminalScan(scan) ? 'results' : 'scan', scan.id);
  };

  if (screen === 'styleguide') {
    return (
      <Styleguide onNavigate={navigate} language={language} onLanguageChange={changeLanguage} />
    );
  }
  if (screen === 'privacy' || screen === 'terms' || screen === 'cookies') {
    return (
      <LegalDocumentScreen
        kind={screen}
        language={language}
        onLanguageChange={changeLanguage}
        signedIn={account !== null}
      />
    );
  }
  if (screen === 'checks') {
    return (
      <AuditCoverageScreen
        language={language}
        onLanguageChange={changeLanguage}
        signedIn={account !== null}
      />
    );
  }
  if (screen === 'faq') {
    return (
      <FaqScreen
        language={language}
        onLanguageChange={changeLanguage}
        signedIn={account !== null}
      />
    );
  }
  if (booting) {
    return (
      <div className="app-shell">
        <MenuBar
          active="desktop"
          onNavigate={navigate}
          signedIn={false}
          language={language}
          onLanguageChange={changeLanguage}
        />
        <div className="desktop">
          <Window title={copy[language].workspace.booting} terminal>
            <LoadingState />
          </Window>
        </div>
      </div>
    );
  }
  // Shown over whichever surface is current: "your account was deleted" is said
  // on the home page the owner lands on.
  const noticeElement = notice ? (
    <Notice
      message={notice}
      onClose={clearNotice}
      closeLabel={accountCopy[language].banner.dismiss}
    />
  ) : null;

  if (account === null) {
    return (
      <>
        {noticeElement}
        <HomeScreen
          signedIn={false}
          onStart={() => {
            // A new owner starting a free check needs an account first, so the
            // "run a free homepage check" CTA opens registration (not sign in).
            setError(null);
            setIntent(null);
            setAuthMode('register');
            navigate('auth');
          }}
          onStartSite={(site) => {
            setError(null);
            setIntent(site === null ? null : { site, plan: null });
            setAuthMode('register');
            navigate('auth');
          }}
          onChoosePlan={(plan) => {
            setError(null);
            setIntent({ site: null, plan });
            setAuthMode('register');
            navigate('auth');
          }}
          pendingSite={intent?.site ?? null}
          onLogin={() => {
            setError(null);
            setAuthMode('login');
            navigate('auth');
          }}
          onRegister={() => {
            setError(null);
            setAuthMode('register');
            navigate('auth');
          }}
          onOpenWorkspace={() => undefined}
          scrollTo={entryRoute.scrollTo}
          language={language}
          onLanguageChange={changeLanguage}
          authOpen={screen === 'auth'}
          authAction={emailAction}
          authMode={authMode}
          authError={error}
          onAuthError={setError}
          onAuthed={onAuthed}
          onCloseAuth={() => {
            setError(null);
            setEmailAction(null);
            setIntent(null);
            navigate('home');
          }}
        />
      </>
    );
  }

  if (screen === 'home') {
    return (
      <HomeScreen
        signedIn
        accountEmail={account.email}
        onStart={() => navigate('desktop')}
        onStartSite={(site) => {
          if (site === null) {
            navigate('desktop');
            return;
          }
          void followIntent({ site, plan: null });
        }}
        onChoosePlan={(plan) => {
          setNewScanPlan(plan);
          navigate('new-scan');
        }}
        onLogin={() => undefined}
        onRegister={() => undefined}
        onOpenWorkspace={() => navigate('desktop')}
        onOpenScreen={navigate}
        scrollTo={entryRoute.scrollTo}
        language={language}
        onLanguageChange={changeLanguage}
        authOpen={false}
        authAction={null}
        authMode="login"
        authError={null}
        onAuthError={setError}
        onAuthed={onAuthed}
        onCloseAuth={() => navigate('home')}
      />
    );
  }

  // The client report is a document, not a workspace window: it is drawn on its
  // own so what prints is the report and nothing around it.
  if (screen === 'print') {
    const printScanId = selectedScan?.id ?? entryRoute.scanId;
    if (printScanId !== null) {
      return (
        <>
          {error ? (
            <AlertDialog
              message={error}
              language={language}
              floating
              onClose={() => setError(null)}
            />
          ) : null}
          <PrintReport
            scanId={printScanId}
            language={language}
            planLanguage={printPlanLanguage()}
            onBack={() => navigate('results', printScanId)}
            onError={setError}
          />
        </>
      );
    }
  }

  const ac = accountCopy[language];
  return (
    // `workspace-shell` makes the shell a column the desktop stretches to fill,
    // which is what gives the footer below a floor to sink to on a report short
    // enough not to fill the viewport.
    <div className="app-shell workspace-shell">
      <MenuBar
        active={screen}
        onNavigate={navigate}
        signedIn
        language={language}
        onLanguageChange={changeLanguage}
      />
      <div className="desktop">
        <header className="desktop__intro">
          <div>
            <h1>FluxRadar</h1>
            <p>{copy[language].workspace.intro}</p>
          </div>
          <div className="button-row">
            {/* The address is the way into the account: it is what the owner
                recognises as "me", and the menu bar's width is already spent. */}
            <button
              type="button"
              className={
                screen === 'account'
                  ? 'desktop__account-link technical is-active'
                  : 'desktop__account-link technical'
              }
              aria-label={`${ac.navLabel}: ${account.email}`}
              aria-current={screen === 'account' ? 'page' : undefined}
              onClick={() => navigate('account')}
            >
              {account.email}
            </button>
            <Button
              onClick={() => {
                void apiRequest<null>('/auth/logout', { method: 'POST' }).then(signOutLocally);
              }}
              variant="danger"
            >
              {copy[language].workspace.logOut}
            </Button>
          </div>
        </header>
        {account.emailVerified === false && !verifyBannerHidden && screen !== 'account' ? (
          <div className="verify-banner" role="status">
            <p>{ac.banner.body(account.email)}</p>
            <div className="button-row">
              <Button onClick={() => void resendFromBanner()}>{ac.banner.resend}</Button>
              <Button onClick={() => setVerifyBannerHidden(true)}>{ac.banner.dismiss}</Button>
            </div>
          </div>
        ) : null}
        {error ? (
          <AlertDialog
            message={error}
            language={language}
            floating
            onClose={() => setError(null)}
          />
        ) : null}
        {noticeElement}
        {screen === 'auth' && emailAction?.kind === 'reset' ? (
          <AuthScreen
            language={language}
            onAuthed={onAuthed}
            error={null}
            onError={setError}
            onBack={() => {
              setEmailAction(null);
              // A reset ends every session, this one included.
              void apiRequest<Account>('/auth/me')
                .then(() => navigate('desktop'))
                .catch(signOutLocally);
            }}
            initialMode="login"
            emailAction={emailAction}
          />
        ) : null}
        {screen === 'account' ? (
          <AccountScreen
            account={account}
            language={language}
            onOpenScan={(scanId) => void openScanById(scanId)}
            onDeleted={() => {
              signOutLocally();
              setNotice(ac.deletion.deleted);
            }}
            onNotice={setNotice}
            onError={setError}
          />
        ) : null}
        {screen === 'desktop' ? (
          <DesktopScreen
            profiles={profiles}
            onOpenScan={(scanId) => void openScanById(scanId)}
            onRetryScan={retryScan}
            onNotice={setNotice}
            tourActive={tourOpen}
            onRefresh={async () => {
              await loadProfiles(setProfiles);
            }}
            onProfileDeleted={(deleted) => {
              // A deleted site must not stay the target of a new scan or the open report list.
              setSelectedProfile((current) => (current?.id === deleted.id ? null : current));
              setReportsProfile((current) => (current?.id === deleted.id ? null : current));
            }}
            onSelectProfile={(profile) => {
              setSelectedProfile(profile);
              setReportsProfile(profile);
              navigate('reports');
            }}
            onNewScan={(profile, plan) => {
              setSelectedProfile(profile);
              setNewScanPlan(plan ?? null);
              navigate('new-scan');
            }}
            onError={setError}
            onOnboarding={() => {
              setTourOpen(true);
              navigate('desktop');
            }}
            language={language}
          />
        ) : null}
        {screen === 'reports' ? (
          <ReportsScreen
            language={language}
            profile={reportsProfile}
            onOpenScan={openReport}
            onNewScan={() => {
              setNewScanPlan(null);
              navigate('new-scan');
            }}
            onShowAll={() => {
              setReportsProfile(null);
              navigate('reports');
            }}
          />
        ) : null}
        {pendingCheckout !== null ? (
          <CheckoutPending
            language={language}
            checkout={pendingCheckout}
            onConfirmed={(scan) => {
              endCheckout();
              onScanCreated(scan);
            }}
            onCancel={endCheckout}
            onError={setError}
          />
        ) : null}
        {screen === 'new-scan' && pendingCheckout === null ? (
          <NewScanScreen
            profiles={profiles}
            selectedProfile={selectedProfile}
            accountId={account.accountId}
            internalFreeAccess={account.internalFreeAccess === true}
            language={language}
            onCreated={onScanCreated}
            initialPlan={newScanPlan}
            onCheckoutStarted={startCheckout}
            onProfilesChanged={async () => {
              await loadProfiles(setProfiles);
            }}
            onClose={() => navigate('desktop')}
            onError={setError}
          />
        ) : null}
        {screen === 'scan' ? (
          <ScanScreen
            scan={selectedScan}
            language={language}
            onUpdate={setSelectedScan}
            onDone={() =>
              selectedScan ? navigate('results', selectedScan.id) : navigate('reports')
            }
            onReports={() => navigate('reports')}
            onError={setError}
          />
        ) : null}
        {screen === 'results' ? (
          <ResultsScreen
            scan={selectedScan}
            language={language}
            targetLanguages={
              profiles.find((candidate) => candidate.id === selectedScan?.profileId)
                ?.targetLanguages ?? null
            }
            onScan={updateSelectedScan}
            onIssues={() => {
              setIssueRuleFilter(null);
              if (selectedScan) navigate('issues', selectedScan.id);
              else navigate('reports');
            }}
            onOpenProblem={(ruleId) => {
              setIssueRuleFilter(ruleId);
              if (selectedScan) navigate('issues', selectedScan.id);
            }}
            onUpgrade={(scan) => {
              const profile = profiles.find((candidate) => candidate.id === scan.profileId);
              if (profile) setSelectedProfile(profile);
              setNewScanPlan('Complete');
              navigate('new-scan');
            }}
            onPrint={(scan) => navigate('print', scan.id)}
            onRetry={(scan) => retryScan(scan.id)}
            onReports={() => navigate('reports')}
            onError={setError}
          />
        ) : null}
        {screen === 'issues' ? (
          <IssuesScreen
            // Remounted per report and per problem, so a filter from one never
            // leaks into another.
            key={`${selectedScan?.id ?? 'none'}:${issueRuleFilter ?? ''}`}
            scan={selectedScan}
            language={language}
            initialRuleId={issueRuleFilter}
            onError={setError}
            onNotice={setNotice}
          />
        ) : null}
        {screen === 'integrations' ? (
          <IntegrationsScreen
            profiles={profiles}
            language={language}
            onClose={() => navigate('desktop')}
            onAddProfile={() => navigate('desktop')}
            onProfilesChanged={async () => {
              await loadProfiles(setProfiles);
            }}
            onError={setError}
          />
        ) : null}
        {tourOpen && screen === 'desktop' ? (
          <OnboardingTour language={language} onFinish={finishOnboarding} onSkip={skipOnboarding} />
        ) : null}
        {/* The site footer, in the one place the workspace has for it. Every
            public page ends with the brand, the standing links and the studio
            attribution; a signed-in screen ended with the attribution alone, so
            a report was the only page on the site with no way out to the
            coverage page, the policies or the field notes. One element in the
            shell, shared by every workspace screen — the report does not get a
            second copy of its own. */}
        <footer className="desktop__footer">
          <span>{copy[language].home.footer.brand}</span>
          <span className="desktop__footer-links">
            <a href="/checks">{copy[language].home.footer.coverageLink}</a>
            <a href="/faq">{copy[language].nav.faq}</a>
            <a href="/privacy">{copy[language].home.footer.privacyLink}</a>
            <a href="/terms">{copy[language].home.footer.termsLink}</a>
            <a href="/terms#terms-paid">{copy[language].home.footer.refundLink}</a>
            <a href="/cookies">{copy[language].legal.cookies.title}</a>
            <a href="/blog">{copy[language].home.footer.fieldNotes}</a>
          </span>
          <CreatedByFluxLab language={language} />
        </footer>
      </div>
    </div>
  );
}

async function loadProfiles(setter: (profiles: SiteProfile[]) => void): Promise<SiteProfile[]> {
  const profiles = await apiRequest<SiteProfile[]>('/profiles');
  setter(profiles);
  return profiles;
}
