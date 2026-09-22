import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AlertDialog,
  Button,
  Notice,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  LoadingState,
  MenuBar,
  CreatedByFluxLab,
  ScoreDial,
  SelectField,
  StatusChip,
  Terminal,
  Window,
} from './components';
import { apiRequest, ApiRequestError, type Account, type Scan, type SiteProfile } from './api';
import { AccountScreen, resendVerification } from './AccountScreen';
import { AdminStatsScreen } from './AdminStats';
import {
  isTerminalScan,
  isWorkspaceScreen,
  pathForScreen,
  readInitialRoute,
  scanRoutePreference,
  seoPageForScreen,
  type InitialRoute,
  type Screen,
} from './app-routes';
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
import { CookieConsent } from './CookieConsent';
import { DesktopScreen } from './DesktopScreen';
import { NewScanScreen } from './NewScanScreen';
import { HomeScreen } from './HomeScreen';
import { copy, readInitialLanguage, storeLanguage, type Language } from './i18n';
import { applyPageMetadata } from './seo';
import { OnboardingTour } from './OnboardingTour';
import { FaqScreen } from './Faq';
import { AuditCoverageScreen } from './Checks';
import { BotScreen } from './Bot';
import type { ChosenPlan } from './Pricing';
import { PrintReport } from './PrintReport';
import { planLanguageFromSearch, planSearch } from './action-plan';
import { IntegrationsScreen } from './Integrations';
import { IssuesScreen } from './Issues';
import { ResultsScreen } from './Report';
import { LegalDocumentScreen } from './LegalDocuments';
import { ScanScreen } from './ScanProgress';
import { ReportsScreen } from './Reports';
import { SupportWidget } from './SupportWidget';
import './styles/base.css';
import './styles/account.css';

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

  // `search` rides along for the one screen that reads a query: the print view's
  // plan language.
  const navigate = useCallback((next: string, scanId?: string, search = '') => {
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
            planLanguage={planLanguageFromSearch(window.location.search) ?? language}
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
            onPrint={(scan, planLanguage) => navigate('print', scan.id, planSearch(planLanguage))}
            profileTargetLanguages={
              profiles.find((profile) => profile.id === selectedScan?.profileId)?.targetLanguages
            }
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
