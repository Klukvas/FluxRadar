import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AlertDialog,
  Button,
  Notice,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  FieldRow,
  LoadingState,
  MenuBar,
  Panel,
  CreatedByFluxLab,
  ScoreDial,
  SelectField,
  StatusChip,
  Terminal,
  TextAreaField,
  Window,
} from './components';
import {
  apiRequest,
  ApiRequestError,
  type Account,
  type CheckoutConfig,
  type Scan,
  type SiteProfile,
} from './api';
import { AccountScreen, resendVerification } from './AccountScreen';
import { AdminStatsScreen } from './AdminStats';
import { ADMIN_STATS_PATH } from './admin-stats';
import { accountCopy } from './account-copy';
import { trackPageView } from './analytics';
import { AuthScreen } from './AuthScreen';
import { authCopy } from './auth-copy';
import {
  CheckoutPending,
  clearPendingCheckout,
  readPendingCheckout,
  storePendingCheckout,
  type PendingCheckout,
} from './Checkout';
import { CoverageTicker } from './CoverageTicker';
import { CookieConsent } from './CookieConsent';
import { DesktopScreen } from './DesktopScreen';
import { EgressLocationField } from './EgressLocationField';
import { LaunchSummary } from './LaunchSummary';
import { ScanCallout } from './ScanCallout';
import { HeroSiteForm } from './HeroSiteForm';
import { HeroTitle } from './HeroTitle';
import { copy, readInitialLanguage, storeLanguage, type Language } from './i18n';
import { applyPageMetadata, type SeoPageId } from './seo';
import { OnboardingTour } from './OnboardingTour';
import { FaqScreen } from './Faq';
import { AuditCoverageScreen } from './Checks';
import { BotScreen } from './Bot';
import { SiteReachabilityPanel } from './SiteReachability';
import { PricingCards, PricingExplainer, type ChosenPlan } from './Pricing';
import { PrintReport } from './PrintReport';
import { IntegrationsScreen } from './Integrations';
import { IssuesScreen } from './Issues';
import { ResultsScreen } from './Report';
import { LegalDocumentScreen } from './LegalDocuments';
import { ScanScreen } from './ScanProgress';
import { ReportsScreen } from './Reports';
import { SupportWidget } from './SupportWidget';
import { NEW_ADDRESS_TARGET, useNewScanForm, type NewScanFormProps } from './new-scan-form';
import { isTerminalScanStatus } from './scan-status';
import { clampScopeToPlan, invalidScopeFields, type ScanScopeForm } from './scan-scope';
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

  // One page view per screen the visitor lands on, sent after the metadata above
  // so it carries this screen's title. Until the visitor allows analytics the
  // call does nothing at all.
  const selectedScanId = selectedScan?.id ?? null;
  useEffect(() => {
    trackPageView();
  }, [screen, selectedScanId]);

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
        window.history.replaceState(null, '', pathForScreen(target, scan.id));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Scan could not be restored');
        window.history.replaceState(null, '', pathForScreen('reports', null));
        setScreen('reports');
      }
    },
    [],
  );

  useEffect(() => {
    if (['privacy', 'terms', 'cookies', 'checks', 'faq', 'bot'].includes(entryRoute.screen)) {
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
      'admin-stats',
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
  if (screen === 'bot') {
    return (
      <BotScreen
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
        {screen === 'admin-stats' ? <AdminStatsScreen /> : null}
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
            <a href="/bot">{copy[language].home.footer.crawlerLink}</a>
            <a href="/blog">{copy[language].home.footer.fieldNotes}</a>
          </span>
          <CreatedByFluxLab language={language} />
        </footer>
      </div>
    </div>
  );
}

// ─── /checks — public audit coverage page ────────────────────────────────────

// ─── /integrations ────────────────────────────────────────────────────────────

function HomeScreen(props: {
  signedIn: boolean;
  accountEmail?: string;
  onStart: () => void;
  /** The hero form: the site the visitor typed, or null for an empty field. */
  onStartSite: (site: string | null) => void;
  onChoosePlan: (plan: ChosenPlan) => void;
  /** The site the visitor typed, named in the registration dialog. */
  pendingSite?: string | null;
  onLogin: () => void;
  onRegister: () => void;
  onOpenWorkspace: () => void;
  /**
   * Opens the workspace screen a header tab names. The header enables all four
   * tabs for a signed-in reader, so each of them needs somewhere to go.
   */
  onOpenScreen?: (screen: string) => void;
  /** Section to reveal on entry when an old link pointed at a folded-in page. */
  scrollTo?: 'pricing' | null;
  language: Language;
  onLanguageChange: (language: Language) => void;
  authOpen: boolean;
  authAction: { readonly kind: 'verify' | 'reset'; readonly token: string } | null;
  authMode: 'login' | 'register';
  authError: string | null;
  onAuthError: (value: string | null) => void;
  onAuthed: (account: Account) => Promise<void>;
  onCloseAuth: () => void;
}) {
  const authDialogRef = useRef<HTMLDivElement>(null);
  const t = copy[props.language];
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start' });
  const entrySection = props.scrollTo ?? null;
  // A visitor arriving from an old /plans link should land on the pricing block
  // and keep a clean URL, not stay on a path the app no longer serves.
  useEffect(() => {
    if (entrySection === null) return;
    if (window.location.pathname !== '/') window.history.replaceState(null, '', '/');
    document.getElementById(entrySection)?.scrollIntoView({ block: 'start' });
  }, [entrySection]);
  useEffect(() => {
    if (!props.authOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onCloseAuth();
      if (event.key !== 'Tab') return;
      const focusable = authDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], select:not([disabled])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    window.requestAnimationFrame(() =>
      authDialogRef.current?.querySelector<HTMLElement>('input, button')?.focus(),
    );
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [props.authOpen, props.onCloseAuth]);
  return (
    <div className="app-shell home-shell">
      <MenuBar
        active="home"
        onNavigate={(next) => (next === 'home' ? scrollTo('top') : props.onOpenScreen?.(next))}
        signedIn={props.signedIn}
        language={props.language}
        onLanguageChange={props.onLanguageChange}
      />
      <main className="home" id="top">
        <div className="home__account-bar">
          <span className="home__account-label">{t.home.accountBar}</span>
          {props.signedIn ? (
            <div className="home__account-actions">
              <span className="home__account-email technical">{props.accountEmail}</span>
              <Button variant="primary" onClick={props.onOpenWorkspace}>
                {t.home.openWorkspace}
              </Button>
            </div>
          ) : (
            <div className="home__account-actions">
              <Button onClick={props.onLogin}>{t.home.signIn}</Button>
              <Button variant="primary" onClick={props.onRegister}>
                {t.home.createAccount}
              </Button>
            </div>
          )}
        </div>
        <section className="home__hero" aria-labelledby="home-title">
          <div className="home__hero-copy">
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">01</span> {t.home.hero.eyebrow}
            </div>
            {/* Keyed by language so a switch retypes the new title from the
                start instead of leaving half of it already revealed. */}
            <HeroTitle
              key={props.language}
              id="home-title"
              line={t.home.hero.titleLine1}
              emphasis={t.home.hero.titleEm}
            />
            <p className="home__lede">{t.home.hero.lede}</p>
            <HeroSiteForm
              language={props.language}
              submitLabel={t.home.freeCta}
              onStart={props.onStartSite}
            />
            <div className="home__actions">
              <button
                className="home__text-action"
                type="button"
                onClick={() => scrollTo('pricing')}
              >
                {t.home.seePricing} <span aria-hidden="true">↓</span>
              </button>
            </div>
            <div className="home__proof" aria-label={t.home.hero.proofAriaLabel}>
              <span>
                <strong>01</strong> {t.home.hero.proofScan}
              </span>
              <span>
                <strong>06</strong> {t.home.hero.proofSignals}
              </span>
              <span>
                <strong>02</strong> {t.home.hero.proofTiers}
              </span>
            </div>
          </div>
          <div className="home__instrument" aria-label={t.home.instrument.previewAriaLabel}>
            <div className="home__instrument-bar">
              <span className="home__live-dot" /> {t.home.instrument.live}{' '}
              <span className="home__instrument-mode">{t.home.instrument.mode}</span>
            </div>
            <div className="home__instrument-body">
              <div className="home__origin">
                <span className="home__label">{t.home.instrument.originLabel}</span>
                <strong className="technical">https://your-site.com</strong>
                <StatusChip status="Running" label={t.home.instrument.statusRunning} />
              </div>
              <div className="home__readout">
                <div className="home__readout-cell">
                  <span className="home__label">{t.home.instrument.signalScore}</span>
                  <strong>—</strong>
                  <small>{t.home.instrument.signalScoreHint}</small>
                </div>
                <div className="home__readout-cell">
                  <span className="home__label">{t.home.instrument.coverage}</span>
                  <strong>—</strong>
                  <small>{t.home.instrument.coverageHint}</small>
                </div>
                <div className="home__readout-cell">
                  <span className="home__label">{t.home.instrument.findings}</span>
                  <strong>—</strong>
                  <small>{t.home.instrument.findingsHint}</small>
                </div>
              </div>
              <Terminal lines={[...t.home.instrument.terminalLines]} active />
              <div className="home__module-list" aria-label={t.home.instrument.modulesAriaLabel}>
                <span>
                  <i className="home__module-mark home__module-mark--green" />{' '}
                  {t.home.instrument.moduleSeo}
                </span>
                <span>
                  <i className="home__module-mark home__module-mark--cyan" />{' '}
                  {t.home.instrument.moduleAiSeo}
                </span>
                <span>
                  <i className="home__module-mark home__module-mark--amber" />{' '}
                  {t.home.instrument.moduleSecurity}
                </span>
                <span>
                  <i className="home__module-mark home__module-mark--dim" />{' '}
                  {t.home.instrument.moduleMore}
                </span>
              </div>
            </div>
          </div>
        </section>

        <CoverageTicker
          label={t.home.ticker.ariaLabel}
          items={[
            t.home.ticker.seo,
            t.home.ticker.aiSeo,
            t.home.ticker.security,
            t.home.ticker.accessibility,
            t.home.ticker.reliability,
            t.home.ticker.privacy,
          ]}
        />

        <section className="home__section" id="capabilities" aria-labelledby="capabilities-title">
          <div className="home__section-head">
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">02</span> {t.home.capabilities.eyebrow}
            </div>
            <h2 id="capabilities-title">{t.home.capabilities.title}</h2>
            <p>{t.home.capabilities.lead}</p>
          </div>
          <div className="home__capability-grid">
            <article className="home__capability home__capability--green">
              <span className="home__card-index">{t.home.capabilities.seo.index}</span>
              <h3>{t.home.capabilities.seo.title}</h3>
              <p>{t.home.capabilities.seo.body}</p>
              <span className="home__card-foot">{t.home.capabilities.seo.foot}</span>
            </article>
            <article className="home__capability home__capability--cyan">
              <span className="home__card-index">{t.home.capabilities.ai.index}</span>
              <h3>{t.home.capabilities.ai.title}</h3>
              <p>{t.home.capabilities.ai.body}</p>
              <span className="home__card-foot">{t.home.capabilities.ai.foot}</span>
            </article>
            <article className="home__capability home__capability--amber">
              <span className="home__card-index">{t.home.capabilities.integrity.index}</span>
              <h3>{t.home.capabilities.integrity.title}</h3>
              <p>{t.home.capabilities.integrity.body}</p>
              <span className="home__card-foot">{t.home.capabilities.integrity.foot}</span>
            </article>
          </div>
        </section>

        <section className="home__coverage-entry" aria-labelledby="coverage-entry-title">
          <div className="home__coverage-entry-inner">
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">02b</span> {t.home.coverageEntry.eyebrow}
            </div>
            <h2 id="coverage-entry-title">{t.home.coverageEntry.title}</h2>
            <p>{t.home.coverageEntry.body}</p>
            <a className="home__coverage-link" href="/checks">
              {t.pricing.coverageLink}
            </a>
          </div>
        </section>

        <section className="home__workflow" aria-labelledby="workflow-title">
          <div className="home__workflow-copy">
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">03</span> {t.home.workflow.eyebrow}
            </div>
            <h2 id="workflow-title">{t.home.workflow.title}</h2>
            <p>{t.home.workflow.lead}</p>
            <Button onClick={props.onStart}>{t.home.startPublicSite}</Button>
          </div>
          <div className="home__steps">
            <div className="home__step">
              <strong>01</strong>
              <div>
                <h3>{t.home.workflow.step1Title}</h3>
                <p>{t.home.workflow.step1Body}</p>
              </div>
            </div>
            <div className="home__step">
              <strong>02</strong>
              <div>
                <h3>{t.home.workflow.step2Title}</h3>
                <p>{t.home.workflow.step2Body}</p>
              </div>
            </div>
            <div className="home__step">
              <strong>03</strong>
              <div>
                <h3>{t.home.workflow.step3Title}</h3>
                <p>{t.home.workflow.step3Body}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="home__pricing" id="pricing" aria-labelledby="pricing-title">
          <div className="home__section-head">
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">04</span> {t.home.pricingEyebrow}
            </div>
            <h2 id="pricing-title">{t.home.pricingTitle}</h2>
            <p>{t.home.pricingLead}</p>
            <span className="home__pricing-note home__pricing-note--public">
              {t.pricing.publicOnly}
            </span>
          </div>
          <PricingCards language={props.language} onChoose={props.onChoosePlan} />
          <PricingExplainer language={props.language} />
        </section>

        <section className="home__last-call" aria-labelledby="last-call-title">
          <div>
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">05</span> {t.home.lastCall.eyebrow}
            </div>
            <h2 id="last-call-title">
              {t.home.lastCall.titleLine1}
              <br />
              <em>{t.home.lastCall.titleEm}</em>
            </h2>
          </div>
          <Button variant="primary" onClick={props.onStart}>
            {t.home.lastCall.cta} <span aria-hidden="true">→</span>
          </Button>
        </section>
        <footer className="home__footer">
          <span>{t.home.footer.brand}</span>
          <span className="home__footer-links">
            <a href="/checks">{t.home.footer.coverageLink}</a>
            <a href="/faq">{t.nav.faq}</a>
            <a href="/privacy">{t.home.footer.privacyLink}</a>
            <a href="/terms">{t.home.footer.termsLink}</a>
            <a href="/terms#terms-paid">{t.home.footer.refundLink}</a>
            <a href="/cookies">{t.legal.cookies.title}</a>
            <a href="/bot">{t.home.footer.crawlerLink}</a>
            <a href="/blog">{t.home.footer.fieldNotes}</a>
            <span>{t.nav.system}</span>
          </span>
          <CreatedByFluxLab language={props.language} />
        </footer>
      </main>
      {props.authOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) props.onCloseAuth();
          }}
        >
          <div
            ref={authDialogRef}
            className="auth-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-title"
          >
            <AuthScreen
              language={props.language}
              onAuthed={props.onAuthed}
              error={props.authError}
              onError={props.onAuthError}
              onBack={props.onCloseAuth}
              initialMode={props.authMode}
              emailAction={props.authAction}
              pendingSite={props.pendingSite ? new URL(props.pendingSite).hostname : null}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What to tell a buyer who cannot pay yet.
 *
 * The server answers with a closed code and never with its configuration, so the
 * distinction the buyer sees is made here: "this deployment does not sell scans"
 * reads differently from "payments are set up and currently broken", and a
 * config we could not read at all says neither.
 */
function paidUnavailableCopy(t: (typeof copy)[Language], config: CheckoutConfig | null): string {
  if (config === null) return t.newScan.paidUnavailable;
  return config.unavailableReason === 'misconfigured'
    ? t.checkout.unavailableTemporary
    : t.checkout.unavailable;
}

function NewScanScreen(props: NewScanFormProps) {
  const t = copy[props.language];
  // The form's state, its saved-configuration sync and its submission live in
  // new-scan-form.ts. Destructured rather than read off an object, so what this
  // screen renders reads the same as when the two were one function.
  const {
    address,
    addressError,
    advancedOpen,
    aiIndustry,
    aiOfferings,
    busy,
    carriedOver,
    checkoutConfig,
    checkoutPending,
    configurationState,
    configurationStatusLabel,
    egressBlocked,
    egressLocation,
    invalidScope,
    launchConfig,
    launchSite,
    paidAvailable,
    paidScopeControls,
    plan,
    planLabel,
    planOptions,
    robotsUnconfirmed,
    resolveTargetProfileId,
    saveConfiguration,
    savingConfiguration,
    scope,
    setAddress,
    setAddressError,
    setAdvancedChoice,
    setAiIndustry,
    setAiOfferings,
    setInvalidScope,
    setSiteReachable,
    setPlan,
    setScope,
    setTarget,
    siteReachable,
    submit,
    target,
    targetLabel,
    unavailablePlanFallback,
    updateScope,
    usingSavedProfile,
  } = useNewScanForm(props);
  return (
    <Window
      title={t.newScan.windowTitle}
      className="window--dialog window--launch"
      onClose={props.onClose}
    >
      {/* Two columns from 1100px: the settings on the left, and on the right a
          sticky launch column holding the summary, the purchase terms and the
          buttons. The screen was a 520px ribbon 2300px tall with the pay button
          under every word of it; below 1100px it collapses back to that single
          stack, which is the right shape for a phone. */}
      <form className="launch-form" onSubmit={submit}>
        <div className="launch-form__controls">
          <Panel title={t.newScan.panelTarget}>
            {/* The field picks a saved profile, so it is named after what it
                picks. The public-site semantics the old "Public origin" label
                carried live in the hint, where they describe the scan rather than
                renaming the thing being chosen. The last option is the way out of
                the list entirely: an address nobody has saved yet. */}
            {props.profiles.length === 0 ? (
              <p className="muted panel-help">{t.newScan.noProfilesLead}</p>
            ) : (
              <SelectField
                label={t.newScan.labelProfile}
                name="scan-profile"
                autoComplete="off"
                // The hint describes a saved profile, so it goes away with the
                // profile: the address field below states its own terms.
                {...(usingSavedProfile ? { hint: t.newScan.hintProfile } : {})}
                value={target}
                onChange={setTarget}
                options={[
                  ...props.profiles.map((profile) => ({
                    value: profile.id,
                    label: `${profile.name} · ${profile.domain}`,
                  })),
                  { value: NEW_ADDRESS_TARGET, label: t.newScan.optionNewAddress },
                ]}
              />
            )}
            {usingSavedProfile ? null : (
              <Field
                label={t.newScan.labelAddress}
                name="scan-address"
                autoComplete="url"
                technical
                value={address}
                onChange={(value) => {
                  setAddress(value);
                  if (addressError !== null) setAddressError(null);
                }}
                placeholder={t.newScan.addressPlaceholder}
                hint={t.newScan.hintAddress}
                error={addressError ?? undefined}
              />
            )}
            {carriedOver ? <p className="muted panel-help">{t.newScan.prefillNote}</p> : null}
            <section
              className={`configuration-status configuration-status--${configurationState}`}
              aria-live="polite"
            >
              <div className="configuration-status__header">
                <strong>{t.newScan.configurationTitle}</strong>
                <StatusChip
                  status={
                    configurationState === 'dirty'
                      ? 'warning'
                      : configurationState === 'saved'
                        ? 'Completed'
                        : 'info'
                  }
                  label={configurationStatusLabel}
                />
              </div>
              {configurationState === 'dirty' ? (
                <p>{t.newScan.configurationUnsavedBody}</p>
              ) : configurationState === 'new' ? (
                <p>{t.newScan.configurationNewBody}</p>
              ) : null}
            </section>
            {paidScopeControls ? (
              <Checkbox
                name="scan-include-subdomains"
                label={t.newScan.labelSubdomains}
                checked={scope.includeSubdomains}
                onChange={(checked) => updateScope({ includeSubdomains: checked })}
              />
            ) : null}
            <SelectField
              label={t.newScan.labelUserAgent}
              name="scan-user-agent"
              autoComplete="off"
              value={scope.userAgent}
              onChange={(value) => updateScope({ userAgent: value as ScanScopeForm['userAgent'] })}
              options={[
                { value: 'desktop', label: t.newScan.userAgentDesktop },
                { value: 'mobile', label: t.newScan.userAgentMobile },
              ]}
            />
            {/* Free does not choose a country: it leaves from the default one,
                which the launch summary names. */}
            {paidScopeControls ? (
              <EgressLocationField
                language={props.language}
                config={launchConfig}
                selected={egressLocation}
                onChange={(value) => updateScope({ egressLocation: value })}
              />
            ) : null}
          </Panel>
          <Panel title={t.newScan.panelDepth}>
            <SelectField
              label={t.newScan.labelScanPlan}
              name="scan-plan"
              autoComplete="off"
              value={plan}
              onChange={(value) => {
                const chosen = value as typeof plan;
                setPlan(chosen);
                // A site last checked on Complete opens on Complete-sized limits;
                // carrying those into Basic asks for more pages than Basic sells,
                // which the API refuses. The numbers move to the chosen plan here,
                // where the owner can see what they are about to buy.
                setScope((current) => clampScopeToPlan(current, chosen));
                setInvalidScope([]);
              }}
              options={planOptions}
            />
            {paidAvailable ? null : checkoutPending ? (
              <p className="muted">{t.newScan.paidChecking}</p>
            ) : (
              <p className="muted">{paidUnavailableCopy(t, checkoutConfig)}</p>
            )}
            {paidAvailable && checkoutConfig?.mode === 'test' ? (
              <p className="muted">{t.checkout.testMode}</p>
            ) : null}
            {paidScopeControls ? (
              <>
                <Field
                  label={t.newScan.labelMaxPages}
                  name="scan-max-pages"
                  autoComplete="off"
                  technical
                  value={scope.maxPages}
                  onChange={(value) => updateScope({ maxPages: value })}
                  type="number"
                  error={invalidScope.includes('maxPages') ? t.newScan.maxPagesError : undefined}
                />
                <Field
                  label={t.newScan.labelMaxDepth}
                  name="scan-max-depth"
                  autoComplete="off"
                  technical
                  value={scope.maxDepth}
                  onChange={(value) => updateScope({ maxDepth: value })}
                  type="number"
                  error={invalidScope.includes('maxDepth') ? t.newScan.maxDepthError : undefined}
                />
                {/* Path patterns and the query policy shape which URLs the
                    crawler takes, and most scans ship with the defaults. They
                    stay behind a disclosure so the plan and its two limits —
                    the numbers being bought — are what the panel opens on. */}
                <details
                  className="scan-advanced"
                  open={advancedOpen}
                  onToggle={(event) => setAdvancedChoice(event.currentTarget.open)}
                >
                  <summary className="scan-advanced__summary">{t.newScan.advancedTitle}</summary>
                  <div className="scan-advanced__fields">
                    <Field
                      label={t.newScan.labelIncludePatterns}
                      name="scan-include-patterns"
                      autoComplete="off"
                      technical
                      value={scope.includePatterns}
                      onChange={(value) => updateScope({ includePatterns: value })}
                      placeholder="/docs/*, /blog/*"
                    />
                    <Field
                      label={t.newScan.labelExcludePatterns}
                      name="scan-exclude-patterns"
                      autoComplete="off"
                      technical
                      value={scope.excludePatterns}
                      onChange={(value) => updateScope({ excludePatterns: value })}
                      placeholder="/admin/*, /private/*"
                    />
                    <SelectField
                      label={t.newScan.labelQueryPolicy}
                      name="scan-query-policy"
                      autoComplete="off"
                      value={scope.queryPolicy}
                      onChange={(value) =>
                        updateScope({ queryPolicy: value as ScanScopeForm['queryPolicy'] })
                      }
                      options={[
                        { value: 'ignore', label: t.newScan.queryIgnore },
                        { value: 'include', label: t.newScan.queryInclude },
                      ]}
                    />
                  </div>
                </details>
                <ScanCallout
                  eyebrow="robots.txt"
                  title={t.newScan.robotsInfoTitle}
                  titleId="robots-info-title"
                  mode={t.newScan.robotsInfoMode}
                  bodyId="robots-info-description"
                >
                  {t.newScan.robotsInfoBody}
                </ScanCallout>
                <Checkbox
                  name="scan-respect-robots"
                  label={t.newScan.labelRespectRobots}
                  checked={scope.respectRobots}
                  describedBy="robots-info-description"
                  onChange={(checked) =>
                    updateScope({
                      respectRobots: checked,
                      // Turning the rule back on withdraws the override with it.
                      ...(checked ? { robotsOverrideConfirmed: false } : {}),
                    })
                  }
                />
                {scope.respectRobots ? null : (
                  <Checkbox
                    label={t.newScan.labelRobotsOverride}
                    name="scan-robots-override"
                    checked={scope.robotsOverrideConfirmed}
                    describedBy="robots-info-description"
                    onChange={(checked) => updateScope({ robotsOverrideConfirmed: checked })}
                  />
                )}
                {/* Open, unlike the robots.txt explanation above it: this one
                    and the performance disclosure below say what leaves the
                    site and who processes it, and the buyer agrees to both by
                    paying. Folding them would trade a guarantee for height. */}
                <ScanCallout
                  eyebrow="AI SEO / GEO · UX"
                  title={t.newScan.aiConsentTitle}
                  titleId="ai-consent-title"
                  mode={t.newScan.aiConsentOptional}
                  bodyId="ai-consent-description"
                  defaultOpen
                >
                  {t.newScan.aiConsentBody}{' '}
                  <a href={`/privacy?lang=${props.language}`}>{t.newScan.aiConsentPrivacy}</a>
                  {' · '}
                  <a href={`/terms?lang=${props.language}`}>{t.newScan.aiConsentTerms}</a>
                </ScanCallout>
                {plan === 'Complete' ? (
                  <ScanCallout
                    eyebrow="PERFORMANCE · GOOGLE"
                    title={t.newScan.performanceInfoTitle}
                    titleId="performance-info-title"
                    mode={t.newScan.performanceInfoMode}
                    defaultOpen
                  >
                    {t.newScan.performanceInfoBody}
                  </ScanCallout>
                ) : null}
              </>
            ) : null}
          </Panel>
          {/* What Free actually is, in place of the controls it does not have.
              The two rows are the enforced settings, not suggestions: the crawler
              reads the homepage and obeys robots.txt on this plan whatever the
              request says. */}
          {paidScopeControls ? null : (
            <Panel title={t.newScan.freeScopeTitle}>
              <p className="muted panel-help">{t.newScan.freeScopeNote}</p>
              <FieldRow label={t.newScan.freeScopePages} value={t.newScan.freeScopePagesValue} />
              <FieldRow label={t.newScan.freeScopeRobots} value={t.newScan.freeScopeRobotsValue} />
              <p className="muted panel-help">{t.newScan.freeScopeLocked}</p>
            </Panel>
          )}
          {/* What the AI visibility section needs before it can ask anything
              neutral. Without either field `neutralContext` has no topic, the
              discovery questions are never generated, and the section falls
              back to two questions that name the brand — which measure nothing.
              The fields are optional; what is not optional is saying so first.
              With the settings rather than in the launch column: these are
              inputs the owner fills, not a summary of what they chose. */}
          {plan === 'Free' ? null : (
            <Panel title={t.newScan.aiContextTitle}>
              <p className="muted panel-help">
                {/* Either field is enough for `neutralContext` to build a topic,
                    so the warning is only true when both are empty. */}
                {aiIndustry.trim() === '' && aiOfferings.trim() === ''
                  ? t.newScan.aiContextMissing
                  : t.newScan.aiContextHelp}
              </p>
              <Field
                label={t.workspace.businessType}
                name="scan-ai-industry"
                autoComplete="off"
                value={aiIndustry}
                onChange={setAiIndustry}
                placeholder={t.workspace.businessTypePlaceholder}
                hint={t.workspace.businessTypeHint}
              />
              <TextAreaField
                label={t.workspace.offerings}
                name="scan-ai-offerings"
                autoComplete="off"
                value={aiOfferings}
                onChange={setAiOfferings}
                placeholder={t.workspace.offeringsPlaceholder}
                hint={t.workspace.offeringsHint}
              />
            </Panel>
          )}
        </div>
        {/* Not an `aside`: a complementary landmark is content beside the page,
            and this column carries the form's own submit. */}
        <div className="launch-form__launch">
          {/* The part that may scroll inside the pinned column, so the actions
              below it cannot be pushed off a short viewport. */}
          <div className="launch-form__review">
            <LaunchSummary
              language={props.language}
              site={launchSite}
              plan={plan}
              planLabel={planLabel}
              scope={scope}
              egressLocation={egressLocation}
              egressDirect={
                launchConfig.status === 'ready' && launchConfig.egress.mode === 'direct'
              }
            />
            {/* In the launch column, directly above the button it gates: this
                is the one thing on the form that can stop the purchase, and a
                buyer should meet it here rather than as a 409 after pressing
                pay. Free is not a purchase, so it is not gated. */}
            {plan === 'Free' || props.internalFreeAccess ? null : (
              <SiteReachabilityPanel
                language={props.language}
                profileId={usingSavedProfile ? target : null}
                egressLocationId={egressLocation?.id ?? null}
                resolveProfileId={resolveTargetProfileId}
                onResult={setSiteReachable}
              />
            )}
            {plan === 'Free' || props.internalFreeAccess ? null : (
              <p
                className="muted checkout-legal-note"
                role="note"
                aria-label={t.newScan.purchaseTermsLabel}
              >
                {t.newScan.purchaseTermsPrefix}{' '}
                <a href={`/terms?lang=${props.language}`}>{t.newScan.aiConsentTerms}</a>{' '}
                {t.newScan.purchaseTermsJoin}{' '}
                <a href={`/privacy?lang=${props.language}`}>{t.newScan.aiConsentPrivacy}</a>
                {' · '}
                <a href={`/cookies?lang=${props.language}`}>{t.legal.cookies.title}</a>
                {t.newScan.purchaseTermsSuffix}
              </p>
            )}
          </div>
          {/* The buy button first, then the way to keep the settings without
              buying anything. They used to sit the other way round, with the
              secondary action spanning the full width under the primary one. */}
          <div className="launch-form__actions">
            <span className="muted">
              {targetLabel} {t.newScan.publicSiteOnly}
            </span>
            {robotsUnconfirmed ? (
              <p className="muted launch-form__blocked" id="launch-blocked" role="note">
                {t.newScan.blockedByRobots}
              </p>
            ) : egressBlocked ? (
              <p className="muted launch-form__blocked" id="launch-blocked" role="note">
                {t.newScan.blockedByEgress}
              </p>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              {...(robotsUnconfirmed || egressBlocked
                ? { 'aria-describedby': 'launch-blocked' }
                : {})}
              disabled={
                busy ||
                savingConfiguration ||
                (usingSavedProfile ? target === '' : address.trim() === '') ||
                robotsUnconfirmed ||
                egressBlocked ||
                // A paid scan of a site the crawler cannot read is a refund
                // waiting to happen, and the server refuses to sell it.
                (plan !== 'Free' && !props.internalFreeAccess && !siteReachable)
              }
            >
              {busy
                ? plan !== 'Free' && !props.internalFreeAccess
                  ? t.newScan.openingCheckout
                  : t.newScan.creating
                : plan === 'Free'
                  ? t.newScan.runFree
                  : props.internalFreeAccess
                    ? t.newScan.runInternal
                    : t.newScan.runPaid}
            </Button>
            <Button
              type="button"
              disabled={
                unavailablePlanFallback ||
                busy ||
                savingConfiguration ||
                (usingSavedProfile ? target === '' : address.trim() === '') ||
                invalidScopeFields(scope, plan).length > 0 ||
                robotsUnconfirmed
              }
              onClick={() => void saveConfiguration()}
            >
              {savingConfiguration ? t.newScan.savingConfiguration : t.newScan.saveConfiguration}
            </Button>
          </div>
        </div>
      </form>
    </Window>
  );
}

function Styleguide(props: {
  onNavigate: (screen: string) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  const lines = [
    'loading… ▮',
    'GET https://example.com/ → 200 (312 ms)',
    'warning: missing CSP',
    'completed: 34 findings',
  ];
  return (
    <div className="app-shell">
      <MenuBar
        active="styleguide"
        onNavigate={props.onNavigate}
        signedIn={false}
        language={props.language}
        onLanguageChange={props.onLanguageChange}
      />
      <div className="desktop">
        <div className="desktop__intro">
          <div>
            <h1>FluxRadar / styleguide</h1>
            <p>Macintosh Platinum + terminal controls.</p>
          </div>
        </div>
        <div className="styleguide">
          <Window title="Status and score">
            <div className="button-row">
              <StatusChip status="Completed" />
              <StatusChip status="Partial" />
              <StatusChip status="Failed" />
              <StatusChip status="Running" />
              <StatusChip status="Unavailable" />
            </div>
            <div className="split" style={{ marginTop: 16 }}>
              <ScoreDial score={96.5} language={props.language} verdict="normal" coverage={0.87} />
              <ScoreDial
                score={null}
                language={props.language}
                verdict="insufficient_data"
                coverage={0.2}
              />
            </div>
          </Window>
          <Window title="Controls">
            <div className="form-grid">
              <Field
                label="Technical URL"
                technical
                value="https://example.com"
                onChange={() => undefined}
              />
              <SelectField
                label="Module"
                value="SEO"
                onChange={() => undefined}
                options={[
                  { value: 'SEO', label: 'SEO' },
                  { value: 'Security', label: 'Security' },
                ]}
              />
            </div>
            <div className="button-row" style={{ marginTop: 12 }}>
              <Button variant="primary">Default action</Button>
              <Button>Secondary</Button>
              <Button variant="danger">Danger</Button>
              <Checkbox label="Consent recorded" checked onChange={() => undefined} />
            </div>
          </Window>
          <Window title="Terminal output" terminal>
            <Terminal lines={lines} active />
          </Window>
          <Window title="Data table">
            <DataTable>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-label="Field">Status</td>
                  <td data-label="Value">
                    <StatusChip status="Completed" />
                  </td>
                </tr>
                <tr>
                  <td data-label="Field">Fingerprint</td>
                  <td data-label="Value" className="technical">
                    fluxradar-fp-v1:cedea5…
                  </td>
                </tr>
              </tbody>
            </DataTable>
          </Window>
          <Window title="Empty and error">
            <div className="form-grid">
              <EmptyState
                title="No scans yet"
                action={<Button variant="primary">New scan</Button>}
              />
              <AlertDialog message="The scan could not be completed." details="NoUsableOutput" />
            </div>
          </Window>
        </div>
      </div>
    </div>
  );
}

async function loadProfiles(setter: (profiles: SiteProfile[]) => void): Promise<SiteProfile[]> {
  const profiles = await apiRequest<SiteProfile[]>('/profiles');
  setter(profiles);
  return profiles;
}
