import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import {
  AlertDialog,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  FieldRow,
  LoadingState,
  MenuBar,
  Panel,
  ScoreDial,
  SelectField,
  StatusChip,
  Terminal,
  Window,
} from './components';
import {
  apiRequest,
  type Account,
  type CheckoutConfig,
  type CheckoutSession,
  type Scan,
  type SiteProfile,
} from './api';
import {
  normalizeWebsiteInput,
  WEBSITE_INPUT_HINT,
  WEBSITE_INPUT_LABEL,
  WEBSITE_INPUT_PLACEHOLDER,
} from './website-input';
import {
  CheckoutPending,
  clearPendingCheckout,
  openCheckoutWindow,
  readPendingCheckout,
  storePendingCheckout,
  useCheckoutConfig,
  type PendingCheckout,
} from './Checkout';
import { copy, readInitialLanguage, storeLanguage, type Language } from './i18n';
import { applyPageMetadata, type SeoPageId } from './seo';
import { OnboardingTour } from './OnboardingTour';
import { FaqScreen } from './Faq';
import { AuditCoverageScreen } from './Checks';
import { PricingCards, PricingExplainer } from './Pricing';
import { IntegrationsScreen } from './Integrations';
import { IssuesScreen } from './Issues';
import { ResultsScreen } from './Report';
import { ScanScreen } from './ScanProgress';
import { ReportsScreen } from './Reports';
import { isTerminalScanStatus } from './scan-status';
import { BASIC_PRICE, COMPLETE_PRICE } from './tariff-prices';
import './styles/base.css';

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
  | 'checks'
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
];

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
      return '/profiles';
    case 'new-scan':
      return '/scan';
    case 'reports':
      return '/reports';
    case 'integrations':
      return '/integrations';
    case 'checks':
      return '/checks';
    case 'faq':
      return '/faq';
    case 'privacy':
      return '/privacy';
    case 'terms':
      return '/terms';
    case 'scan':
    case 'results':
      // A report screen without a scan is the reports list, not a broken URL.
      return scanId === null ? '/reports' : `/scans/${encodeURIComponent(scanId)}`;
    case 'issues':
      return scanId === null ? '/reports' : `/scans/${encodeURIComponent(scanId)}/issues`;
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

/** Workspace paths that carry no identifier, in the order they are matched. */
const WORKSPACE_PATHS: Readonly<Record<string, Screen>> = {
  '/profiles': 'desktop',
  '/scan': 'new-scan',
  '/reports': 'reports',
  '/integrations': 'integrations',
};

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
  if (path === '/checks') return publicRoute('checks');
  if (path === '/faq') return publicRoute('faq');
  // The standalone plans screen was folded into the home pricing section. Old
  // /plans links keep working by landing there instead of on an unknown route.
  if (path === '/plans')
    return { screen: 'home', scanId: null, emailAction: null, scrollTo: 'pricing' };
  const workspaceScreen = WORKSPACE_PATHS[path];
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

/** `/scans/:id` and `/scans/:id/issues`, or null when the path is neither. */
function readScanRoute(path: string): InitialRoute | null {
  const match = /^\/scans\/([^/]+)(\/issues)?$/.exec(path);
  if (match?.[1] === undefined) return null;
  try {
    const scanId = decodeURIComponent(match[1]);
    if (scanId.length === 0) return null;
    return {
      screen: match[2] === undefined ? 'scan' : 'issues',
      scanId,
      emailAction: null,
      scrollTo: null,
    };
  } catch {
    // Treat a malformed deep link like any other unknown public route.
    return null;
  }
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
    default:
      return 'workspace';
  }
}

export function App() {
  const [entryRoute] = useState<InitialRoute>(readInitialRoute);
  const [screen, setScreen] = useState<Screen>(entryRoute.screen);
  const [emailAction, setEmailAction] = useState(entryRoute.emailAction);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [account, setAccount] = useState<Account | null>(null);
  const [profiles, setProfiles] = useState<SiteProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<SiteProfile | null>(null);
  // Which website the reports list is scoped to; null lists the whole account.
  const [reportsProfile, setReportsProfile] = useState<SiteProfile | null>(null);
  const [selectedScan, setSelectedScan] = useState<Scan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [language, setLanguage] = useState<Language>(readInitialLanguage);
  const [tourOpen, setTourOpen] = useState(false);
  // Held here, not inside the new-scan screen: the buyer pays in another tab and
  // may reload or navigate away before the provider webhook lands, and the
  // "confirming payment" window has to survive that from any screen.
  const [pendingCheckout, setPendingCheckout] = useState<PendingCheckout | null>(null);
  const updateSelectedScan = useCallback((scan: Scan) => setSelectedScan(scan), []);
  const changeLanguage = useCallback((next: Language) => {
    setLanguage(next);
    storeLanguage(next);
  }, []);

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
    async (scanId: string, preferred: 'auto' | 'issues' = 'auto'): Promise<void> => {
      try {
        const scan = await apiRequest<Scan>(`/scans/${scanId}`);
        setSelectedScan(scan);
        const target: Screen =
          preferred === 'issues' ? 'issues' : isTerminalScan(scan) ? 'results' : 'scan';
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
    if (['privacy', 'terms', 'checks', 'faq'].includes(entryRoute.screen)) {
      setBooting(false);
      return;
    }
    apiRequest<Account>('/auth/me')
      .then(async (value) => {
        setAccount(value);
        try {
          await loadProfiles(setProfiles);
          if (entryRoute.scanId !== null) {
            await openScanById(
              entryRoute.scanId,
              entryRoute.screen === 'issues' ? 'issues' : 'auto',
            );
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
  }, [entryRoute.scanId, entryRoute.screen, openScanById]);

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
        void openScanById(route.scanId, route.screen === 'issues' ? 'issues' : 'auto');
        return;
      }
      // `/scans/:id` is the report once the scan has one and the progress window
      // while it is still running — the same rule the deep link is resolved by,
      // so going back to a URL shows what going forward to it showed.
      setScreen(
        route.screen === 'issues' ? 'issues' : isTerminalScan(loaded) ? 'results' : 'scan',
      );
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [openScanById]);

  const onAuthed = async (value: Account) => {
    setEmailAction(null);
    setAccount(value);
    setError(null);
    await loadProfiles(setProfiles);
    if (entryRoute.scanId !== null) {
      await openScanById(entryRoute.scanId, entryRoute.screen === 'issues' ? 'issues' : 'auto');
      return;
    }
    // Sign-in is a detour, not a destination: whoever followed a workspace link
    // gets that screen, and everyone else gets the workspace they signed in for.
    navigate(isWorkspaceScreen(entryRoute.screen) ? entryRoute.screen : 'desktop');
    if (value.onboarding?.status === 'pending') setTourOpen(true);
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

  const onScanCreated = (scan: Scan) => {
    setSelectedScan(scan);
    navigate('scan', scan.id);
  };

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
  if (screen === 'privacy' || screen === 'terms') {
    return (
      <LegalDocumentScreen kind={screen} language={language} onLanguageChange={changeLanguage} />
    );
  }
  if (screen === 'checks') {
    return <AuditCoverageScreen language={language} onLanguageChange={changeLanguage} />;
  }
  if (screen === 'faq') {
    return <FaqScreen language={language} onLanguageChange={changeLanguage} />;
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
  if (account === null) {
    return (
      <HomeScreen
        signedIn={false}
        onStart={() => {
          // A new owner starting a free check needs an account first, so the
          // "run a free homepage check" CTA opens registration (not sign in).
          setError(null);
          setAuthMode('register');
          navigate('auth');
        }}
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
        onOpenIntegrations={() => undefined}
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
          navigate('home');
        }}
      />
    );
  }

  if (screen === 'home') {
    return (
      <HomeScreen
        signedIn
        accountEmail={account.email}
        onStart={() => navigate('desktop')}
        onLogin={() => undefined}
        onRegister={() => undefined}
        onOpenWorkspace={() => navigate('desktop')}
        onOpenIntegrations={() => navigate('integrations')}
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

  return (
    <div className="app-shell">
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
            <span className="technical">{account.email}</span>
            <Button
              onClick={() => {
                void apiRequest<null>('/auth/logout', { method: 'POST' }).then(() => {
                  setAccount(null);
                  setProfiles([]);
                  setSelectedScan(null);
                  setReportsProfile(null);
                  // Back to the public home: staying on a workspace URL with no
                  // account would render the marketing page under /profiles.
                  navigate('home');
                });
              }}
              variant="danger"
            >
              {copy[language].workspace.logOut}
            </Button>
          </div>
        </header>
        {error ? <AlertDialog message={error} onClose={() => setError(null)} /> : null}
        {screen === 'desktop' ? (
          <DesktopScreen
            profiles={profiles}
            onRefresh={async () => {
              await loadProfiles(setProfiles);
            }}
            onSelectProfile={(profile) => {
              setSelectedProfile(profile);
              setReportsProfile(profile);
              navigate('reports');
            }}
            onNewScan={(profile) => {
              setSelectedProfile(profile);
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
            onNewScan={() => navigate('new-scan')}
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
            onCheckoutStarted={startCheckout}
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
            onIssues={() =>
              selectedScan ? navigate('issues', selectedScan.id) : navigate('reports')
            }
            onReports={() => navigate('reports')}
            onError={setError}
          />
        ) : null}
        {screen === 'issues' ? (
          <IssuesScreen scan={selectedScan} language={language} onError={setError} />
        ) : null}
        {screen === 'integrations' ? (
          <IntegrationsScreen
            profiles={profiles}
            language={language}
            onClose={() => navigate('desktop')}
            onError={setError}
          />
        ) : null}
        {tourOpen && screen === 'desktop' ? (
          <OnboardingTour language={language} onFinish={finishOnboarding} onSkip={skipOnboarding} />
        ) : null}
      </div>
    </div>
  );
}

type LegalDocumentKind = 'privacy' | 'terms';

function LegalDocumentScreen(props: {
  kind: LegalDocumentKind;
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  const isPrivacy = props.kind === 'privacy';
  const t = copy[props.language].legal;
  const document = isPrivacy ? t.privacy : t.terms;
  const other = isPrivacy ? t.terms : t.privacy;

  return (
    <div className="app-shell legal-shell">
      <MenuBar
        active="home"
        onNavigate={(next) => {
          if (next === 'home') window.location.assign('/');
        }}
        signedIn={false}
        language={props.language}
        onLanguageChange={props.onLanguageChange}
      />
      <main className="legal-main">
        <header className="legal-header">
          <div>
            <div className="legal-kicker">
              <span className="legal-kicker__mark">{isPrivacy ? 'P' : 'T'}</span>
              {t.kicker}
            </div>
            <div className="legal-meta">
              {t.meta.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <h1>{document.title}</h1>
            <p className="legal-lede">{document.lede}</p>
          </div>
          <a className="legal-back" href="/">
            {t.back}
          </a>
        </header>

        <div className="legal-layout">
          <nav className="legal-index" aria-label={t.contentsLabel}>
            <div className="legal-index__label">{t.contents}</div>
            {document.sections.map((section) => (
              <a key={section.id} href={`#${section.id}`}>
                {section.label}
              </a>
            ))}
            <div className="legal-index__rule" />
            <a href={isPrivacy ? '/terms' : '/privacy'}>{other.crossLink}</a>
          </nav>

          <div className="legal-document-column">
            {/* The binding text is not machine-translated: a policy has to say
                the same thing in every language it claims to be written in, so
                the reader is told which version applies instead. */}
            {props.language === 'en' ? null : (
              <p className="legal-language-notice" lang={props.language}>
                {t.englishNotice}
              </p>
            )}
            {isPrivacy ? <PrivacyPolicy /> : <TermsOfService />}
          </div>
        </div>

        <footer className="legal-footer">
          <span>{t.footerBrand}</span>
          <span>
            {t.questions}{' '}
            <a href="mailto:pavlenkoandrey56@gmail.com">pavlenkoandrey56@gmail.com</a>
          </span>
        </footer>
      </main>
    </div>
  );
}

function PrivacyPolicy() {
  return (
    <article className="legal-document" lang="en">
      <div className="legal-document__notice">
        <strong>Effective date: September 4, 2026</strong>
        <span>FluxRadar is a public-site audit service operated by FluxLab.</span>
      </div>

      <section id="privacy-scope" className="legal-section">
        <span className="legal-section__label">01 / SCOPE</span>
        <h2>What this policy covers</h2>
        <p>
          This policy explains how FluxLab handles information when you use FluxRadar, create an
          account, run a website audit, connect a supported data source or contact us. FluxRadar is
          designed for public website checks. It does not ask for a client website password or CMS
          credentials for the audit modules described on the public site.
        </p>
      </section>

      <section id="privacy-data" className="legal-section">
        <span className="legal-section__label">02 / INPUTS</span>
        <h2>Data we handle</h2>
        <ul>
          <li>
            <strong>Account data:</strong> your email address, a one-way password hash and session
            records needed to keep you signed in.
          </li>
          <li>
            <strong>Audit data:</strong> the public origin you submit, scan scope and options,
            public pages fetched by the crawler, findings, scores, fingerprints and exports.
          </li>
          <li>
            <strong>Abuse-prevention data:</strong> a normalized public origin and claim timestamp
            used to prevent repeated free checks across accounts. This minimal record is retained
            independently of your account and contains no report content, credentials or tokens.
          </li>
          <li>
            <strong>Connected-source data:</strong> when you authorize Google or Bing, FluxRadar
            stores encrypted access/refresh tokens and the granted scopes so the connection can be
            maintained. The raw tokens are not shown in the product interface.
          </li>
          <li>
            <strong>Purchase data:</strong> payment and transaction metadata supplied by FastSpring,
            our payment provider and merchant of record — such as order ID, plan, amount, currency
            and payment status. FluxRadar does not store your payment-card number.
          </li>
          <li>
            <strong>Required technical data:</strong> security and operational records needed to
            protect the service, enforce rate limits and diagnose failures.
          </li>
        </ul>
      </section>

      <section id="privacy-google" className="legal-section">
        <span className="legal-section__label">03 / GOOGLE DATA</span>
        <h2>How Google user data is used</h2>
        <p>
          FluxRadar requests read-only Google authorization for Search Console and Google Analytics
          data. The current authorization asks for these API scopes:
        </p>
        <div className="legal-code-block">
          <code>https://www.googleapis.com/auth/webmasters.readonly</code>
          <code>https://www.googleapis.com/auth/analytics.readonly</code>
        </div>
        <p>
          We use connected Google data only to provide the Google-related audit and reporting
          features you request. We do not sell Google user data or use it for advertising. We do not
          give Google access tokens to AI providers. You can disconnect Google at any time;
          disconnecting removes the stored connection tokens.
        </p>
        <p>
          FluxRadar requests the minimum read-only access needed for these integrations. If Google
          data is used in a report, it remains associated with your account and selected site
          profile and is not made public by FluxRadar.
        </p>
      </section>

      <section id="privacy-use" className="legal-section">
        <span className="legal-section__label">04 / PROCESSING</span>
        <h2>How we use information</h2>
        <ul>
          <li>to authenticate your account and maintain your workspace;</li>
          <li>to fetch and analyze public website signals you ask us to review;</li>
          <li>to generate scores, findings, evidence and requested exports;</li>
          <li>to process purchases, enforce plan limits and prevent duplicate transactions;</li>
          <li>to secure, troubleshoot and improve the reliability of the service.</li>
        </ul>
        <p>
          AI-assisted audit features run only when the scan has the required consent. Before an AI
          request, FluxRadar applies its redaction rules to the audit context. Anthropic is used as
          a platform provider for those requests when the feature is enabled.
        </p>
      </section>

      <section id="privacy-retention" className="legal-section">
        <span className="legal-section__label">05 / LIFECYCLE</span>
        <h2>Storage, providers and deletion</h2>
        <p>
          FluxRadar stores application data in PostgreSQL on Hetzner infrastructure. Complete report
          artifacts may be stored in a private, account-scoped Hetzner Object Storage bucket. Google
          and Bing tokens are encrypted before they are stored. FastSpring, Google, Bing and
          Anthropic process information under their own terms and privacy documentation when you use
          the corresponding integration or make a purchase.
        </p>
        <p>
          You can disconnect an integration from the Integrations screen. You can request account
          deletion from the product; this removes account-linked operational data according to the
          service retention workflow. A minimal deletion audit record and the abuse-prevention
          origin claim may remain: the former demonstrates that the request was processed, while the
          latter prevents repeated free checks. Neither retains your account content.
        </p>
      </section>

      <section id="privacy-rights" className="legal-section">
        <span className="legal-section__label">06 / CONTROL</span>
        <h2>Your choices and contact</h2>
        <p>
          You can choose not to connect Google or Bing and still use public-site checks. You can
          disconnect a provider, stop using the service or contact us about access, correction or
          deletion requests. For privacy questions, contact{' '}
          <a href="mailto:pavlenkoandrey56@gmail.com">pavlenkoandrey56@gmail.com</a>.
        </p>
        <p>
          We may update this policy when the service or its data practices change. The effective
          date at the top will be updated when a new version is published.
        </p>
      </section>
    </article>
  );
}

function TermsOfService() {
  return (
    <article className="legal-document" lang="en">
      <div className="legal-document__notice">
        <strong>Effective date: September 4, 2026</strong>
        <span>By using FluxRadar, you agree to these terms.</span>
      </div>

      <section id="terms-service" className="legal-section">
        <span className="legal-section__label">01 / SERVICE</span>
        <h2>What FluxRadar does</h2>
        <p>
          FluxRadar is a website audit service operated by FluxLab. It analyzes public web pages and
          presents technical, SEO, AI-discoverability, security, accessibility, reliability, content
          and privacy signals. The audit is read-only: you authorize us to fetch public resources,
          not to change your website.
        </p>
      </section>

      <section id="terms-account" className="legal-section">
        <span className="legal-section__label">02 / ACCESS</span>
        <h2>Accounts and workspace</h2>
        <p>
          You are responsible for the email address and password used for your account and for
          activity performed through your session. Keep your credentials private and contact us if
          you believe your account has been used without permission. You must provide accurate
          information and may use FluxRadar only if you are legally able to agree to these terms.
        </p>
      </section>

      <section id="terms-paid" className="legal-section">
        <span className="legal-section__label">03 / PURCHASES</span>
        <h2>Free and paid scans</h2>
        <p>
          FluxRadar offers one limited free homepage check and one-time paid scans. The free check
          is available once per account and once per normalized public origin across all accounts.
          The Basic and Complete plans are pay-per-scan products, not recurring subscriptions. The
          applicable scope, features and price are shown before purchase. Payment is processed by
          FastSpring, which acts as merchant of record; payment-card data is handled by FastSpring
          rather than stored by FluxRadar. A paid scan starts only after FastSpring confirms the
          payment to our server.
        </p>
        <p>
          A paid scan grants the report and product access described for the purchased plan. If a
          payment, refund or dispute changes the transaction status, FluxRadar may suspend the
          related entitlement or scan according to the billing state shown in the workspace.
        </p>
      </section>

      <section id="terms-use" className="legal-section">
        <span className="legal-section__label">04 / BOUNDARIES</span>
        <h2>Acceptable use</h2>
        <p>
          You may submit only websites and public resources you are authorized to review. You must
          not:
        </p>
        <ul>
          <li>use FluxRadar to attack, overload, probe or bypass controls on a website;</li>
          <li>
            submit private URLs, credentials, secrets or personal data that you do not have a right
            to process;
          </li>
          <li>use reports to misrepresent a legal, security or accessibility certification;</li>
          <li>
            interfere with the service, evade plan limits or resell access without permission.
          </li>
        </ul>
      </section>

      <section id="terms-results" className="legal-section">
        <span className="legal-section__label">05 / OUTPUT</span>
        <h2>Reports are decision support</h2>
        <p>
          Audit findings are automated technical signals and recommendations. They can be
          incomplete, delayed or incorrect, especially when a page requires JavaScript, a provider
          has no data or a site changes after the scan. AI-generated output may also be inaccurate.
          FluxRadar does not promise rankings, traffic, security, legal compliance, WCAG conformance
          or a particular business result.
        </p>
        <p>
          You keep the rights to information you submit and may use reports for your internal work.
          FluxLab retains the rights to the FluxRadar service, software, rules, scoring methods and
          branding. Do not publish another person’s private data or confidential material through an
          export.
        </p>
      </section>

      <section id="terms-ending" className="legal-section">
        <span className="legal-section__label">06 / EXIT</span>
        <h2>Availability and ending use</h2>
        <p>
          We may change, pause or discontinue parts of FluxRadar, including third-party
          integrations, when needed for security, maintenance or provider changes. We may suspend
          access for abuse, unlawful use, fraud or material breach of these terms. You can stop
          using the service and request account deletion at any time.
        </p>
        <p>
          To the maximum extent permitted by law, FluxRadar is provided without guarantees of
          uninterrupted availability or error-free results. Nothing in these terms excludes rights
          that cannot lawfully be excluded. Questions about a purchase or these terms can be sent to{' '}
          <a href="mailto:pavlenkoandrey56@gmail.com">pavlenkoandrey56@gmail.com</a>.
        </p>
      </section>
    </article>
  );
}

// ─── /checks — public audit coverage page ────────────────────────────────────

// ─── /integrations ────────────────────────────────────────────────────────────

function AuthScreen(props: {
  onAuthed: (account: Account) => Promise<void>;
  error: string | null;
  onError: (value: string | null) => void;
  onBack: () => void;
  initialMode: 'login' | 'register';
  emailAction: { readonly kind: 'verify' | 'reset'; readonly token: string } | null;
}) {
  const [mode, setMode] = useState<'login' | 'register'>(props.initialMode);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'working' | 'verified'>(
    'idle',
  );
  const verificationStarted = useRef(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const isReset = props.emailAction?.kind === 'reset';
  const isVerification = props.emailAction?.kind === 'verify';

  useEffect(() => {
    if (!isVerification || props.emailAction === null || verificationStarted.current) return;
    verificationStarted.current = true;
    setVerificationStatus('working');
    void apiRequest<{ status: string }>(
      `/auth/verify-email?token=${encodeURIComponent(props.emailAction.token)}`,
    )
      .then(() => setVerificationStatus('verified'))
      .catch((caught) =>
        props.onError(caught instanceof Error ? caught.message : 'Verification failed'),
      );
  }, [isVerification, props.emailAction, props.onError]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    props.onError(null);
    try {
      if (forgotPassword) {
        await apiRequest<{ status: string }>('/auth/password-reset/request', {
          method: 'POST',
          body: JSON.stringify({ email }),
        });
        setSent(true);
        return;
      }
      if (isReset && props.emailAction !== null) {
        await apiRequest<{ status: string }>('/auth/password-reset/confirm', {
          method: 'POST',
          body: JSON.stringify({ token: props.emailAction.token, password }),
        });
        setResetDone(true);
        return;
      }
      const account = await apiRequest<Account>(`/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      await props.onAuthed(account);
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Window
      title={
        isVerification
          ? 'FluxRadar — Verify email'
          : isReset
            ? 'FluxRadar — Set password'
            : forgotPassword
              ? 'FluxRadar — Reset password'
              : mode === 'login'
                ? 'FluxRadar — Sign in'
                : 'FluxRadar — Create account'
      }
      className="window--dialog"
      onClose={props.onBack}
    >
      <form className="stack" onSubmit={submit}>
        <div>
          <h1 id="auth-title" className="section-heading">
            {isVerification
              ? verificationStatus === 'verified'
                ? 'Email verified'
                : 'Verify your email'
              : isReset
                ? resetDone
                  ? 'Password updated'
                  : 'Set a new password'
                : forgotPassword
                  ? 'Reset your password'
                  : 'Public web audit station'}
          </h1>
          <p className="muted">
            {isVerification
              ? verificationStatus === 'working'
                ? 'Checking your one-time link…'
                : verificationStatus === 'verified'
                  ? 'Your email is verified. You can return to FluxRadar.'
                  : 'The verification link is being checked.'
              : isReset
                ? resetDone
                  ? 'Your password was changed. Sign in again with the new password.'
                  : 'Choose a new password for your FluxRadar account.'
                : forgotPassword
                  ? sent
                    ? 'If an account exists, a reset link has been sent. Check your inbox.'
                    : 'Enter your account email. We never reveal whether an address is registered.'
                  : 'Sign in to keep scan results and issue history in one workspace.'}
          </p>
        </div>
        {!isVerification && !isReset ? (
          <Field
            label="Email"
            value={email}
            onChange={setEmail}
            type="email"
            placeholder="operator@example.com"
          />
        ) : null}
        {!isVerification && !forgotPassword && !sent && !resetDone ? (
          <Field
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
            placeholder="8+ characters"
          />
        ) : null}
        {!isVerification && isReset && !resetDone ? (
          <Field
            label="New password"
            value={password}
            onChange={setPassword}
            type="password"
            placeholder="8+ characters"
          />
        ) : null}
        <div className="button-row">
          {!isVerification && !sent && !resetDone ? (
            <Button type="submit" variant="primary" disabled={busy}>
              {busy
                ? 'Working…'
                : isReset
                  ? 'Update password'
                  : forgotPassword
                    ? 'Send reset link'
                    : mode === 'login'
                      ? 'Sign in'
                      : 'Create account'}
            </Button>
          ) : null}
          {isVerification || isReset || resetDone ? null : !forgotPassword ? (
            <Button onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? 'Create account' : 'Back to sign in'}
            </Button>
          ) : (
            <Button
              onClick={() => {
                setForgotPassword(false);
                setSent(false);
              }}
            >
              Back to sign in
            </Button>
          )}
          <Button onClick={props.onBack}>Back to home</Button>
        </div>
        {mode === 'login' && !forgotPassword && !isVerification && !isReset ? (
          <button
            className="home__text-action"
            type="button"
            onClick={() => {
              setForgotPassword(true);
              props.onError(null);
            }}
          >
            Forgot password?
          </button>
        ) : null}
        {props.error ? (
          <AlertDialog message={props.error} onClose={() => props.onError(null)} />
        ) : null}
      </form>
    </Window>
  );
}

function HomeScreen(props: {
  signedIn: boolean;
  accountEmail?: string;
  onStart: () => void;
  onLogin: () => void;
  onRegister: () => void;
  onOpenWorkspace: () => void;
  onOpenIntegrations: () => void;
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
        onNavigate={(next) =>
          next === 'home'
            ? scrollTo('top')
            : next === 'desktop'
              ? props.onOpenWorkspace()
              : next === 'integrations'
                ? props.onOpenIntegrations()
                : undefined
        }
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
            <h1 id="home-title">
              {t.home.hero.titleLine1}
              <br />
              <em>{t.home.hero.titleEm}</em>
            </h1>
            <p className="home__lede">{t.home.hero.lede}</p>
            <div className="home__actions">
              <Button variant="primary" onClick={props.onStart}>
                {t.home.freeCta}
              </Button>
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

        <div className="home__ticker" aria-label={t.home.ticker.ariaLabel}>
          <span>{t.home.ticker.seo}</span>
          <span>{t.home.ticker.aiSeo}</span>
          <span>{t.home.ticker.security}</span>
          <span>{t.home.ticker.accessibility}</span>
          <span>{t.home.ticker.reliability}</span>
          <span>{t.home.ticker.privacy}</span>
        </div>

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
          <PricingCards language={props.language} onChoose={props.onStart} />
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
            <a href="/blog">{t.home.footer.fieldNotes}</a>
            <span>{t.nav.system}</span>
          </span>
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
              onAuthed={props.onAuthed}
              error={props.authError}
              onError={props.onAuthError}
              onBack={props.onCloseAuth}
              initialMode={props.authMode}
              emailAction={props.authAction}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DesktopScreen(props: {
  profiles: readonly SiteProfile[];
  onRefresh: () => Promise<void>;
  onSelectProfile: (profile: SiteProfile) => void;
  onNewScan: (profile: SiteProfile) => void;
  onError: (value: string) => void;
  onOnboarding: () => void;
  language: Language;
}) {
  const t = copy[props.language];
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [domainError, setDomainError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeWebsiteInput(domain);
    if (!normalized.ok) {
      setDomainError(normalized.error);
      return;
    }
    setDomainError(null);
    setBusy(true);
    try {
      await apiRequest<SiteProfile>('/profiles', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), domain: normalized.origin }),
      });
      setName('');
      setDomain('');
      await props.onRefresh();
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Profile creation failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="desktop__grid">
        <Window title={t.workspace.sites}>
          <Panel title={t.workspace.registered}>
            <div>
              {props.profiles.length === 0 ? (
                <EmptyState
                  title={t.workspace.noSites}
                  description={t.workspace.noSitesHelp}
                  action={
                    <Button
                      variant="primary"
                      onClick={() =>
                        document
                          .querySelector<HTMLInputElement>(
                            '[data-tour-target="profile-domain"] input',
                          )
                          ?.focus()
                      }
                    >
                      {t.workspace.addSite}
                    </Button>
                  }
                />
              ) : (
                props.profiles.map((profile) => (
                  <div className="profile-row" key={profile.id}>
                    <div>
                      <strong>{profile.name}</strong>
                      <span className="profile-row__domain">{profile.domain}</span>
                    </div>
                    <div className="profile-row__actions">
                      <Button onClick={() => props.onNewScan(profile)} variant="primary">
                        {t.workspace.newScan}
                      </Button>
                      <Button onClick={() => props.onSelectProfile(profile)}>
                        {t.workspace.inspect}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>
          <Panel title={t.workspace.addSite}>
            <form className="stack" onSubmit={create}>
              <p className="muted panel-help">{t.workspace.addSiteHelp}</p>
              <Field
                label={t.workspace.displayName}
                value={name}
                onChange={setName}
                placeholder={t.workspace.displayNamePlaceholder}
              />
              <Field
                label={WEBSITE_INPUT_LABEL}
                value={domain}
                onChange={(value) => {
                  setDomain(value);
                  if (domainError !== null) setDomainError(null);
                }}
                placeholder={WEBSITE_INPUT_PLACEHOLDER}
                hint={WEBSITE_INPUT_HINT}
                error={domainError ?? undefined}
                data-tour-target="profile-domain"
              />
              <Button
                type="submit"
                variant="primary"
                disabled={busy || name.trim() === ''}
                data-tour-target="save-profile"
              >
                {busy ? t.workspace.saving : t.workspace.saveProfile}
              </Button>
            </form>
          </Panel>
        </Window>
        <Window title={t.workspace.notes} terminal>
          <Terminal
            lines={[
              'ready: public-origin mode',
              'free: one homepage check',
              'basic: seo + ai seo / geo',
              'complete: all available modules + export',
            ]}
          />
          <Panel title="Subscription model">
            <FieldRow label={t.workspace.billing} value={t.workspace.payPerScan} />
            <FieldRow label="Basic" value={`${BASIC_PRICE} · SEO + AI SEO / GEO`} />
            <FieldRow label="Complete" value={`${COMPLETE_PRICE} · full report`} />
          </Panel>
          <div className="button-row">
            <Button variant="primary" onClick={props.onOnboarding}>
              {t.workspace.guide}
            </Button>
          </div>
        </Window>
      </div>
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

function NewScanScreen(props: {
  accountId: string;
  onCheckoutStarted: (pending: PendingCheckout) => void;
  profiles: readonly SiteProfile[];
  selectedProfile: SiteProfile | null;
  internalFreeAccess: boolean;
  language: Language;
  onCreated: (scan: Scan) => void;
  onClose: () => void;
  onError: (value: string) => void;
}) {
  const t = copy[props.language];
  // Whether a real checkout exists is a server fact, not a build-time flag: an
  // unreachable or unconfigured provider must never look like a working one.
  const checkout = useCheckoutConfig(!props.internalFreeAccess);
  const checkoutConfig = checkout.status === 'ready' ? checkout.config : null;
  const paidAvailable = props.internalFreeAccess || checkoutConfig?.available === true;
  // Until the server has answered, the screen says it is still asking rather
  // than announcing an absence it cannot yet know about.
  const checkoutPending = checkout.status === 'loading';
  const [profileId, setProfileId] = useState(
    props.selectedProfile?.id ?? props.profiles[0]?.id ?? '',
  );
  // A paying owner opens this form on the free check and chooses to pay; nothing
  // is pre-selected for them. An internal account cannot be charged and is here
  // to exercise the full report, so it starts on Complete.
  const [plan, setPlan] = useState<'Free' | 'Basic' | 'Complete'>(
    props.internalFreeAccess ? 'Complete' : 'Free',
  );
  const [maxPages, setMaxPages] = useState('15');
  const [maxDepth, setMaxDepth] = useState('5');
  const [includeSubdomains, setIncludeSubdomains] = useState(false);
  const [includePatterns, setIncludePatterns] = useState('');
  const [excludePatterns, setExcludePatterns] = useState('');
  const [queryPolicy, setQueryPolicy] = useState<'include' | 'ignore'>('ignore');
  const [respectRobots, setRespectRobots] = useState(true);
  const [robotsOverrideConfirmed, setRobotsOverrideConfirmed] = useState(false);
  const [userAgent, setUserAgent] = useState<'desktop' | 'mobile'>('desktop');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const selected = props.profiles.find((profile) => profile.id === profileId);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      let scan: Scan;
      const asPatterns = (value: string) =>
        value
          .split(',')
          .map((pattern) => pattern.trim())
          .filter(Boolean);
      const scope = {
        includeSubdomains,
        maxPages: Number(maxPages),
        maxDepth: Number(maxDepth),
        ...(asPatterns(includePatterns).length > 0
          ? { urlPatterns: asPatterns(includePatterns) }
          : {}),
        ...(asPatterns(excludePatterns).length > 0
          ? { excludePatterns: asPatterns(excludePatterns) }
          : {}),
        queryPolicy,
        respectRobots,
        robotsOverrideConfirmed,
        userAgent,
      };
      const aiConsent = consent
        ? { aiConsent: { providers: ['anthropic'], noticeVersion: 'v1' } }
        : {};
      if (plan === 'Free') {
        scan = await apiRequest<Scan>(`/profiles/${profileId}/free-check`, {
          method: 'POST',
          body: JSON.stringify({ scope }),
        });
      } else if (props.internalFreeAccess) {
        // Internal allowlist only: creates a scan without a purchase, and is
        // refused for everyone else (and in production).
        scan = await apiRequest<{ scanId: string } & Record<string, unknown>>(
          '/billing/dev-checkout',
          {
            method: 'POST',
            body: JSON.stringify({ siteProfileId: profileId, plan, scope, ...aiConsent }),
          },
        ).then((value) => apiRequest<Scan>(`/scans/${value.scanId}`));
      } else {
        // Paid plans hand off to the provider. No scan exists until the signed
        // provider webhook creates one, so nothing is created here.
        const session = await apiRequest<CheckoutSession>('/billing/checkout-session', {
          method: 'POST',
          body: JSON.stringify({ siteProfileId: profileId, plan, scope, ...aiConsent }),
        });
        // With a popup checkout configured, the FastSpring iframe opens over this
        // page from `CheckoutPending` and the hosted URL is never opened by us —
        // it stays only as the link the buyer clicks if the popup could not load.
        // Without one (the older hosted storefront), the provider page opens in a
        // tab as before.
        const storefront = checkoutConfig?.popup?.storefront ?? null;
        props.onCheckoutStarted({
          accountId: props.accountId,
          reference: session.reference,
          sessionId: session.sessionId,
          checkoutUrl: session.checkoutUrl,
          storefront,
          restored: false,
          popupBlocked: storefront === null && !openCheckoutWindow(session.checkoutUrl),
        });
        return;
      }
      props.onCreated(scan);
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Scan could not be created');
    } finally {
      setBusy(false);
    }
  };
  const planOptions = [
    { value: 'Free', label: t.newScan.planFree },
    ...(paidAvailable
      ? [
          {
            value: 'Basic',
            label: props.internalFreeAccess ? t.newScan.planBasicInternal : t.newScan.planBasicPaid,
          },
          {
            value: 'Complete',
            label: props.internalFreeAccess
              ? t.newScan.planCompleteInternal
              : t.newScan.planCompletePaid,
          },
        ]
      : []),
  ];
  if (props.profiles.length === 0)
    return (
      <Window title={t.newScan.windowTitleEmpty} onClose={props.onClose}>
        <EmptyState
          title={t.newScan.emptyTitle}
          description={t.newScan.emptyBody}
          action={
            <Button variant="primary" onClick={props.onClose}>
              {t.newScan.emptyAction}
            </Button>
          }
        />
      </Window>
    );
  return (
    <Window title={t.newScan.windowTitle} className="window--dialog" onClose={props.onClose}>
      <form className="stack" onSubmit={submit}>
        <Panel title={t.newScan.panelTarget}>
          <SelectField
            label={t.newScan.labelOrigin}
            value={profileId}
            onChange={setProfileId}
            options={props.profiles.map((profile) => ({
              value: profile.id,
              label: `${profile.name} · ${profile.domain}`,
            }))}
          />
          <Checkbox
            label={t.newScan.labelSubdomains}
            checked={includeSubdomains}
            onChange={setIncludeSubdomains}
          />
          <SelectField
            label={t.newScan.labelUserAgent}
            value={userAgent}
            onChange={(value) => setUserAgent(value as typeof userAgent)}
            options={[
              { value: 'desktop', label: t.newScan.userAgentDesktop },
              { value: 'mobile', label: t.newScan.userAgentMobile },
            ]}
          />
        </Panel>
        <Panel title={t.newScan.panelDepth}>
          <SelectField
            label={t.newScan.labelScanPlan}
            value={plan}
            onChange={(value) => setPlan(value as typeof plan)}
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
          {plan !== 'Free' ? (
            <>
              <Field
                label={t.newScan.labelMaxPages}
                value={maxPages}
                onChange={setMaxPages}
                type="number"
              />
              <Field
                label={t.newScan.labelMaxDepth}
                value={maxDepth}
                onChange={setMaxDepth}
                type="number"
              />
              <Field
                label={t.newScan.labelIncludePatterns}
                value={includePatterns}
                onChange={setIncludePatterns}
                placeholder="/docs/*, /blog/*"
              />
              <Field
                label={t.newScan.labelExcludePatterns}
                value={excludePatterns}
                onChange={setExcludePatterns}
                placeholder="/admin/*, /private/*"
              />
              <SelectField
                label={t.newScan.labelQueryPolicy}
                value={queryPolicy}
                onChange={(value) => setQueryPolicy(value as typeof queryPolicy)}
                options={[
                  { value: 'ignore', label: t.newScan.queryIgnore },
                  { value: 'include', label: t.newScan.queryInclude },
                ]}
              />
            </>
          ) : null}
          <Checkbox
            label={t.newScan.labelRespectRobots}
            checked={respectRobots}
            onChange={setRespectRobots}
          />
          {!respectRobots ? (
            <Checkbox
              label={t.newScan.labelRobotsOverride}
              checked={robotsOverrideConfirmed}
              onChange={setRobotsOverrideConfirmed}
            />
          ) : null}
          {plan !== 'Free' ? (
            <Checkbox label={t.newScan.labelAiConsent} checked={consent} onChange={setConsent} />
          ) : null}
        </Panel>
        <div className="split">
          <span className="muted">
            {selected?.domain ?? t.newScan.noProfile} {t.newScan.publicSiteOnly}
          </span>
          <Button
            type="submit"
            variant="primary"
            disabled={
              busy ||
              profileId === '' ||
              (!respectRobots && !robotsOverrideConfirmed) ||
              (plan !== 'Free' && !consent)
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
              <ScoreDial score={96.5} verdict="normal" coverage={0.87} />
              <ScoreDial score={null} verdict="insufficient_data" coverage={0.2} />
            </div>
          </Window>
          <Window title="Controls">
            <div className="form-grid">
              <Field label="Technical URL" value="https://example.com" onChange={() => undefined} />
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
