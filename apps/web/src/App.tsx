import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ProgressBar,
  ScoreDial,
  SelectField,
  SkeletonRows,
  StatusChip,
  Terminal,
  Window,
} from './components';
import {
  apiRequest,
  type Account,
  type CheckoutConfig,
  type CheckoutSession,
  type Dashboard,
  type ExportPayload,
  type IntegrationStatus,
  type Issue,
  type Scan,
  type ScanModule,
  type SiteProfile,
} from './api';
import { GoogleDataPanel, googleSnapshotOf } from './GoogleDataPanel';
import { GoogleProperties } from './GoogleProperties';
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
import { copy, readStoredLanguage, storeLanguage, type Language } from './i18n';
import { OnboardingTour } from './OnboardingTour';
import { FaqScreen } from './Faq';
import { PricingCards, PricingExplainer } from './Pricing';
import { BASIC_PRICE, COMPLETE_PRICE } from './tariff-prices';
import './styles/base.css';

type Screen =
  | 'home'
  | 'auth'
  | 'desktop'
  | 'new-scan'
  | 'scan'
  | 'results'
  | 'issues'
  | 'integrations'
  | 'faq'
  | 'privacy'
  | 'terms'
  | 'checks'
  | 'styleguide';

interface InitialRoute {
  readonly screen: Screen;
  readonly scanId: string | null;
  readonly emailAction: { readonly kind: 'verify' | 'reset'; readonly token: string } | null;
  /** Home section to scroll to on entry, used by legacy links such as /plans. */
  readonly scrollTo: 'pricing' | null;
}

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
  const scanMatch = /^\/scans\/([^/]+)$/.exec(path);
  if (scanMatch?.[1] !== undefined) {
    try {
      const scanId = decodeURIComponent(scanMatch[1]);
      if (scanId.length > 0) return { screen: 'scan', scanId, emailAction: null, scrollTo: null };
    } catch {
      // Treat malformed deep links like any other unknown public route.
    }
  }
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

function isTerminalScan(scan: Scan): boolean {
  return ['Completed', 'Partial', 'Failed', 'Cancelled'].includes(scan.status);
}

export function App() {
  const [entryRoute] = useState<InitialRoute>(readInitialRoute);
  const [screen, setScreen] = useState<Screen>(entryRoute.screen);
  const [emailAction, setEmailAction] = useState(entryRoute.emailAction);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [account, setAccount] = useState<Account | null>(null);
  const [profiles, setProfiles] = useState<SiteProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<SiteProfile | null>(null);
  const [selectedScan, setSelectedScan] = useState<Scan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [language, setLanguage] = useState<Language>(readStoredLanguage);
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

  useEffect(() => {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/privacy' || path === '/terms' || path === '/checks' || path === '/faq') {
      setBooting(false);
      return;
    }
    apiRequest<Account>('/auth/me')
      .then(async (value) => {
        setAccount(value);
        try {
          await loadProfiles(setProfiles);
          if (entryRoute.scanId === null && value.onboarding?.status === 'pending') {
            setScreen('desktop');
            setTourOpen(true);
            return;
          }
          if (entryRoute.scanId !== null) {
            const scan = await apiRequest<Scan>(`/scans/${entryRoute.scanId}`);
            setSelectedScan(scan);
            setScreen(isTerminalScan(scan) ? 'results' : 'scan');
            return;
          }
          const active = await apiRequest<Scan | null>('/scans/active');
          if (active !== null) {
            setSelectedScan(active);
            window.history.replaceState(null, '', `/scans/${encodeURIComponent(active.id)}`);
            setScreen(isTerminalScan(active) ? 'results' : 'scan');
          }
        } catch (caught: unknown) {
          if (entryRoute.scanId !== null) {
            setError(caught instanceof Error ? caught.message : 'Scan could not be restored');
            window.history.replaceState(null, '', '/');
            setScreen('desktop');
          } else {
            console.error('FluxRadar boot data unavailable', caught);
          }
        }
      })
      .catch(() => {
        // Authentication is required before a deep-link scan is fetched. The
        // same home surface then presents the login modal without exposing
        // whether another account owns the requested scan.
        if (entryRoute.scanId !== null) setScreen('auth');
      })
      .finally(() => setBooting(false));
  }, [entryRoute.scanId]);

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

  const restoreScan = async (scanId: string): Promise<void> => {
    try {
      const scan = await apiRequest<Scan>(`/scans/${scanId}`);
      setSelectedScan(scan);
      setScreen(isTerminalScan(scan) ? 'results' : 'scan');
      window.history.replaceState(null, '', `/scans/${encodeURIComponent(scan.id)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Scan could not be restored');
      window.history.replaceState(null, '', '/');
      setScreen('desktop');
    }
  };

  const navigate = (next: string, scanId?: string) => {
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
      'scan',
      'results',
      'issues',
      'integrations',
      'checks',
    ].includes(requested)
      ? (requested as Screen)
      : 'desktop';
    const scanPath =
      valid === 'checks'
        ? '/checks'
        : scanId !== undefined && ['scan', 'results', 'issues'].includes(valid)
          ? `/scans/${encodeURIComponent(scanId)}`
          : '/';
    window.history.replaceState(null, '', scanPath);
    setScreen(valid);
  };

  const onAuthed = async (value: Account) => {
    setEmailAction(null);
    setAccount(value);
    setError(null);
    await loadProfiles(setProfiles);
    if (entryRoute.scanId !== null) {
      await restoreScan(entryRoute.scanId);
    } else {
      navigate('desktop');
      if (value.onboarding?.status === 'pending') setTourOpen(true);
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

  const onScanCreated = (scan: Scan) => {
    setSelectedScan(scan);
    navigate('scan', scan.id);
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
          <Window title="Boot sequence" terminal>
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
                  navigate('desktop');
                });
              }}
              variant="danger"
            >
              Log out
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
            onSelectProfile={setSelectedProfile}
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
            onUpdate={setSelectedScan}
            onDone={() =>
              selectedScan ? navigate('results', selectedScan.id) : navigate('desktop')
            }
            onError={setError}
          />
        ) : null}
        {screen === 'results' ? (
          <ResultsScreen
            scan={selectedScan}
            onScan={updateSelectedScan}
            onIssues={() =>
              selectedScan ? navigate('issues', selectedScan.id) : navigate('desktop')
            }
            onError={setError}
          />
        ) : null}
        {screen === 'issues' ? <IssuesScreen scan={selectedScan} onError={setError} /> : null}
        {screen === 'integrations' ? (
          <IntegrationsScreen
            profiles={profiles}
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
  useEffect(() => {
    const previousTitle = document.title;
    document.title = isPrivacy ? 'Privacy Policy — FluxRadar' : 'Terms of Service — FluxRadar';
    return () => {
      document.title = previousTitle;
    };
  }, [isPrivacy]);

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
              FLUXLAB / PUBLIC DOCUMENT
            </div>
            <div className="legal-meta">
              <span>FLUXRADAR.NET</span>
              <span>REV. 2026.09</span>
              <span>READ BEFORE CONNECTING</span>
            </div>
            <h1>{isPrivacy ? 'Privacy policy' : 'Terms of service'}</h1>
            <p className="legal-lede">
              {isPrivacy
                ? 'A plain-language record of what FluxRadar collects, why it uses it and how connected Google data is handled.'
                : 'The operating terms for using FluxRadar to review public websites and purchase one-time audit reports.'}
            </p>
          </div>
          <a className="legal-back" href="/">
            ← Back to FluxRadar
          </a>
        </header>

        <div className="legal-layout">
          <nav className="legal-index" aria-label="Document sections">
            <div className="legal-index__label">DOCUMENT MAP</div>
            {isPrivacy ? (
              <>
                <a href="#privacy-scope">Scope</a>
                <a href="#privacy-data">Data we handle</a>
                <a href="#privacy-google">Google user data</a>
                <a href="#privacy-use">How we use data</a>
                <a href="#privacy-retention">Storage & deletion</a>
                <a href="#privacy-rights">Your choices</a>
              </>
            ) : (
              <>
                <a href="#terms-service">The service</a>
                <a href="#terms-account">Accounts</a>
                <a href="#terms-paid">Free and paid scans</a>
                <a href="#terms-use">Acceptable use</a>
                <a href="#terms-results">Reports & limitations</a>
                <a href="#terms-ending">Ending use</a>
              </>
            )}
            <div className="legal-index__rule" />
            <a href={isPrivacy ? '/terms' : '/privacy'}>
              {isPrivacy ? 'Terms of service →' : 'Privacy policy →'}
            </a>
          </nav>

          {isPrivacy ? <PrivacyPolicy /> : <TermsOfService />}
        </div>

        <footer className="legal-footer">
          <span>FLUXRADAR / BY FLUXLAB</span>
          <span>
            Questions: <a href="mailto:pavlenkoandrey56@gmail.com">pavlenkoandrey56@gmail.com</a>
          </span>
        </footer>
      </main>
    </div>
  );
}

function PrivacyPolicy() {
  return (
    <article className="legal-document">
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
    <article className="legal-document">
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

function AuditCoverageScreen(props: {
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
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
      <main className="legal-main" aria-labelledby="checks-title">
        <header className="legal-header">
          <div>
            <div className="legal-kicker">
              <span className="legal-kicker__mark">✦</span>
              FLUXRADAR / PUBLIC WEB AUDIT STATION
            </div>
            <div className="legal-meta">
              <span>Updated 2026-09-05</span>
              <span>No login required to read this</span>
              <span>Ruleset v0.1</span>
            </div>
            <h1 id="checks-title">Audit coverage</h1>
            <p className="legal-lede">
              Exactly what FluxRadar inspects, why, and what it cannot certify — with no customer
              credentials required for the core public audit.
            </p>
          </div>
          <a className="legal-back" href="/">
            ← Back to home
          </a>
        </header>

        <div className="legal-layout">
          <nav className="legal-index" aria-label="Coverage sections">
            <span className="legal-index__label">CONTENTS</span>
            <a href="#checks-how">How it works</a>
            <a href="#checks-seo">SEO visibility</a>
            <a href="#checks-ai-seo">AI SEO / GEO</a>
            <a href="#checks-security">Security</a>
            <a href="#checks-accessibility">Accessibility</a>
            <a href="#checks-reliability">Reliability & performance</a>
            <a href="#checks-privacy">Privacy & consent</a>
            <div className="legal-index__rule" />
            <a href="#checks-evidence">Evidence</a>
            <a href="#checks-limits">What we cannot certify</a>
          </nav>

          <article className="legal-document" aria-label="Audit coverage detail">
            <div className="legal-document__notice">
              <span>
                <strong>READ-ONLY AUDIT</strong> · FluxRadar fetches only public HTTP responses. No
                CMS login, SSH access, database credentials or source-code access is required or
                requested.
              </span>
              <span>Applies to all scan tiers</span>
            </div>

            <section id="checks-how" className="legal-section">
              <span className="legal-section__label">00 / HOW IT WORKS</span>
              <h2>What the scanner does</h2>
              <p>
                FluxRadar makes ordinary HTTP(S) requests to your public website — the same requests
                a browser or search-engine crawler would make — and records the responses. It does
                not guess, estimate or infer. Every finding traces back to a byte in a real HTTP
                response.
              </p>
              <p>
                The scanner respects <code>robots.txt</code> directives. For the free homepage check
                only the root URL is fetched. Paid scans extend coverage to linked public pages
                within the configured scope.
              </p>
            </section>

            <section id="checks-seo" className="legal-section">
              <span className="legal-section__label">01 / SEO VISIBILITY</span>
              <h2>SEO — what FluxRadar checks</h2>
              <p>
                The SEO module runs up to <strong>16 deterministic checks</strong> derived from
                documented search-engine guidance (Google Search Central, Bing Webmaster Guidelines,
                schema.org). All checks are rule-based; no model inference is involved.
              </p>
              <ul>
                <li>
                  <strong>Title tag</strong> — presence, character length (≤ 60 chars recommended),
                  uniqueness across crawled pages.
                </li>
                <li>
                  <strong>Meta description</strong> — presence and recommended length window
                  (120–158 chars).
                </li>
                <li>
                  <strong>Heading hierarchy</strong> — a single H1, logical H2/H3 nesting with no
                  skipped levels.
                </li>
                <li>
                  <strong>Canonical URL</strong> — <code>&lt;link rel="canonical"&gt;</code> present
                  and self-referencing on canonical pages.
                </li>
                <li>
                  <strong>Indexing signals</strong> — <code>noindex</code> / <code>nofollow</code>{' '}
                  in meta robots and <code>X-Robots-Tag</code> headers.
                </li>
                <li>
                  <strong>robots.txt</strong> — reachable, parseable, does not inadvertently block
                  the origin.
                </li>
                <li>
                  <strong>XML sitemap</strong> — declared in robots.txt, reachable, well-formed.
                </li>
                <li>
                  <strong>Structured data / JSON-LD</strong> — syntax validity, schema type
                  detected, required properties present per schema.org spec. A JSON-LD preview is
                  included in the report.
                </li>
                <li>
                  <strong>Open Graph tags</strong> — <code>og:title</code>,{' '}
                  <code>og:description</code>, <code>og:image</code> present and non-empty. Image
                  URL is reachable (HTTP 200).
                </li>
                <li>
                  <strong>Twitter / X Card tags</strong> — <code>twitter:card</code>,{' '}
                  <code>twitter:title</code>, <code>twitter:image</code> present.
                </li>
                <li>
                  <strong>Hreflang</strong> — valid language codes, reciprocal links present where
                  declared.
                </li>
                <li>
                  <strong>Image alt text</strong> — non-decorative images missing <code>alt</code>{' '}
                  attributes.
                </li>
                <li>
                  <strong>Broken links</strong> — internal anchor <code>href</code> values returning
                  4xx/5xx within scope.
                </li>
                <li>
                  <strong>Redirect chains</strong> — 301/302 hops counted; chains longer than two
                  hops flagged.
                </li>
                <li>
                  <strong>Page speed signals</strong> — server response time, uncompressed transfer
                  size and HTTP/2 support as measurable proxies.
                </li>
                <li>
                  <strong>HTTPS enforcement</strong> — HTTP-to-HTTPS redirect present, no mixed
                  content in the HTML source.
                </li>
              </ul>
            </section>

            <section id="checks-ai-seo" className="legal-section">
              <span className="legal-section__label">02 / AI SEO / GEO</span>
              <h2>AI SEO / Generative Engine Optimisation</h2>
              <p>
                AI search systems (ChatGPT, Gemini, Perplexity, Claude, Bing Copilot, etc.) use
                public web content and their own proprietary indexes. FluxRadar checks the publicly
                observable signals that influence whether your site is understood and cited by these
                systems.
              </p>
              <ul>
                <li>
                  <strong>AI crawler access</strong> — <code>robots.txt</code> is parsed for known
                  AI crawler user-agent strings (GPTBot, Claude-Web, PerplexityBot, GoogleOther,
                  BingBot and others). The report shows which crawlers are allowed, disallowed or
                  missing an explicit rule.
                </li>
                <li>
                  <strong>LLMs.txt</strong> — checks for the emerging <code>/llms.txt</code>{' '}
                  convention, which signals AI-friendly content structure to language models.
                </li>
                <li>
                  <strong>Structured data for AI comprehension</strong> — JSON-LD types that help AI
                  systems build entity graphs (Organization, Product, FAQPage, HowTo, Article,
                  BreadcrumbList) are flagged when absent.
                </li>
                <li>
                  <strong>Content clarity signals</strong> — heading density, paragraph length
                  distribution and readability score (Flesch-Kincaid) measured from the extracted
                  main content.
                </li>
                <li>
                  <strong>Provider visibility (optional, consent-gated)</strong> — the AI SEO module
                  can query provider APIs to check whether your brand appears in AI-generated
                  answers. This step runs only when you explicitly enable it in the scan settings
                  and is never included in the free homepage check. Provider API calls are subject
                  to the providers' own terms.
                </li>
              </ul>
            </section>

            <section id="checks-security" className="legal-section">
              <span className="legal-section__label">03 / SECURITY</span>
              <h2>Security — OWASP ASVS public profile</h2>
              <p>
                FluxRadar checks the subset of{' '}
                <strong>OWASP Application Security Verification Standard (ASVS) v4</strong> signals
                that are observable in public HTTP responses. It does not attempt to exploit
                vulnerabilities, probe authenticated surfaces or run active attack techniques.
              </p>
              <ul>
                <li>
                  <strong>Transport security</strong> — TLS version (TLS 1.2+ required), HSTS header
                  present with <code>max-age ≥ 31536000</code> and <code>includeSubDomains</code>{' '}
                  flag. Maps to ASVS 9.1.
                </li>
                <li>
                  <strong>Security headers</strong> — <code>Content-Security-Policy</code>,{' '}
                  <code>X-Frame-Options</code> (or CSP <code>frame-ancestors</code>),{' '}
                  <code>X-Content-Type-Options: nosniff</code>, <code>Referrer-Policy</code>,{' '}
                  <code>Permissions-Policy</code>. Maps to ASVS 14.4.
                </li>
                <li>
                  <strong>Cookie flags</strong> — cookies set on the homepage response are checked
                  for <code>HttpOnly</code>, <code>Secure</code> and <code>SameSite</code>{' '}
                  attributes. Maps to ASVS 3.4.
                </li>
                <li>
                  <strong>Information disclosure</strong> — server version strings in{' '}
                  <code>Server</code> / <code>X-Powered-By</code> headers, verbose error messages in
                  HTML, directory listing indicators. Maps to ASVS 14.3.
                </li>
                <li>
                  <strong>Mixed content</strong> — HTTP resources (scripts, stylesheets, images)
                  embedded in an HTTPS page. Maps to ASVS 9.1.
                </li>
                <li>
                  <strong>Subresource Integrity</strong> — third-party <code>&lt;script&gt;</code>{' '}
                  and <code>&lt;link&gt;</code> tags checked for <code>integrity</code> attribute
                  presence. Maps to ASVS 14.2.
                </li>
              </ul>
              <p>
                Findings are classified as <em>signal present</em> or <em>signal absent</em> — not
                as confirmed vulnerabilities. A missing header is evidence that a defensive control
                is not deployed, not proof that the site is exploitable.
              </p>
            </section>

            <section id="checks-accessibility" className="legal-section">
              <span className="legal-section__label">04 / ACCESSIBILITY</span>
              <h2>Accessibility — WCAG 2.2 AA / EN 301 549 / Section 508</h2>
              <p>
                Automated DOM checks cover the machine-verifiable subset of{' '}
                <strong>WCAG 2.2 Level AA</strong>. WCAG 2.2 AA is a superset of the WCAG chapters
                referenced by <strong>EN 301 549</strong> (EU, chapter 9 references WCAG 2.1) and{' '}
                <strong>Section 508</strong> (US federal, incorporates WCAG 2.0 AA). Note that both
                standards include non-WCAG functional requirements that automated DOM scanning does
                not cover. Automated tools can verify approximately 30–40 % of WCAG criteria; the
                remaining criteria require human judgement or assistive-technology testing.
              </p>
              <ul>
                <li>
                  <strong>Perceivable (WCAG 2.2 Principle 1)</strong> — missing image alt text
                  (1.1.1), colour-contrast ratio ≥ 4.5:1 for normal text and ≥ 3:1 for large text
                  measured from computed CSS (1.4.3), absence of auto-playing media with audio
                  (1.4.2).
                </li>
                <li>
                  <strong>Operable (WCAG 2.2 Principle 2)</strong> — interactive elements reachable
                  by keyboard in source order (2.1.1), skip-navigation link present (2.4.1), page
                  <code>&lt;title&gt;</code> descriptive (2.4.2), link purpose from text (2.4.4).
                </li>
                <li>
                  <strong>Understandable (WCAG 2.2 Principle 3)</strong> —{' '}
                  <code>&lt;html lang&gt;</code> attribute present and valid (3.1.1), form{' '}
                  <code>&lt;label&gt;</code> elements properly associated (3.3.2), error
                  identification markup (3.3.1).
                </li>
                <li>
                  <strong>Robust (WCAG 2.2 Principle 4)</strong> — valid HTML (4.1.1), ARIA roles
                  and properties correctly applied (4.1.2), status messages using appropriate live
                  regions (4.1.3).
                </li>
              </ul>
              <p>
                Each accessibility finding includes the WCAG criterion reference, the failing
                element selector and the specific rule that was violated, so you can reproduce the
                finding without re-running the scan.
              </p>
              <p>
                <strong>What automated checks cannot assess:</strong> keyboard trap behaviour in
                dynamic widgets, screen-reader announcement quality, cognitive load, motion
                sensitivity in animations, or compliance with criteria that require understanding
                content meaning (e.g. 1.3.3 Sensory Characteristics).
              </p>
            </section>

            <section id="checks-reliability" className="legal-section">
              <span className="legal-section__label">05 / RELIABILITY & PERFORMANCE</span>
              <h2>Reliability and performance</h2>
              <p>
                Performance signals are measured from a single-origin, single-request perspective.
                They reflect what FluxRadar's scanner observed at the time of the scan, not a
                statistical average across geographies or time.
              </p>
              <ul>
                <li>
                  <strong>Server response time (TTFB)</strong> — time to first byte recorded for
                  each scanned URL. Flagged if consistently above 600 ms.
                </li>
                <li>
                  <strong>Transfer size</strong> — uncompressed HTML size and total page weight
                  (HTML + linked CSS/JS within scope). Flagged if HTML exceeds 100 KB.
                </li>
                <li>
                  <strong>Compression</strong> — <code>Content-Encoding: gzip</code> or{' '}
                  <code>br</code> present on text responses.
                </li>
                <li>
                  <strong>HTTP/2 or HTTP/3</strong> — protocol version recorded; HTTP/1.1-only sites
                  flagged.
                </li>
                <li>
                  <strong>Cache headers</strong> — <code>Cache-Control</code> and <code>ETag</code>{' '}
                  / <code>Last-Modified</code> presence on static assets.
                </li>
                <li>
                  <strong>Uptime signal</strong> — HTTP status recorded for every URL in scope. 5xx
                  responses and connection timeouts are flagged as reliability issues.
                </li>
                <li>
                  <strong>Redirect economy</strong> — total redirect hops from the canonical entry
                  URL; each hop adds latency for real users and crawlers.
                </li>
              </ul>
            </section>

            <section id="checks-privacy" className="legal-section">
              <span className="legal-section__label">06 / PRIVACY & CONSENT</span>
              <h2>Privacy and consent signals</h2>
              <p>
                FluxRadar reads publicly visible consent and tracking signals. It does not install
                tracking code, set cookies on behalf of the target site, or interact with
                third-party consent infrastructure beyond reading what is embedded in the page.
              </p>
              <ul>
                <li>
                  <strong>Cookie consent banner detection</strong> — common consent-management
                  platform (CMP) signatures detected in HTML and script sources (OneTrust,
                  Cookiebot, CookieYes, Osano and others). Absence flagged when cookies are set on
                  first load.
                </li>
                <li>
                  <strong>Third-party script audit</strong> — external script domains classified
                  against a known-tracker list (analytics, advertising, fingerprinting). Count and
                  domains listed in the report.
                </li>
                <li>
                  <strong>Privacy policy link</strong> — a link whose text or destination suggests a
                  privacy or cookie policy is present in the page or footer.
                </li>
                <li>
                  <strong>Do Not Track / GPC signal support</strong> — whether the site sets{' '}
                  <code>Sec-GPC</code> acknowledgement headers or publishes a GPC support statement.
                </li>
                <li>
                  <strong>Cookie first-load audit</strong> — cookies set before any user interaction
                  are recorded. Cookies with no <code>SameSite</code> attribute or marked as
                  cross-site are highlighted.
                </li>
              </ul>
            </section>

            <section id="checks-evidence" className="legal-section">
              <span className="legal-section__label">07 / EVIDENCE</span>
              <h2>How findings are evidenced</h2>
              <p>Every issue in the Issue Center includes:</p>
              <ul>
                <li>The URL on which the finding was observed.</li>
                <li>
                  The specific HTTP response field (header name, HTML selector or attribute) that
                  triggered the rule.
                </li>
                <li>
                  The actual value observed (truncated for display; the full value is in the JSON
                  export).
                </li>
                <li>The rule ID and the standard or guideline it maps to.</li>
                <li>A recommended remediation step.</li>
              </ul>
              <p>
                The JSON and CSV export (Complete plan) contains the full raw evidence for every
                finding so you can reproduce the check independently.
              </p>
            </section>

            <section id="checks-limits" className="legal-section">
              <span className="legal-section__label">08 / LIMITATIONS</span>
              <h2>What FluxRadar cannot certify</h2>
              <p>
                FluxRadar is a public-signal audit tool. There are important things it cannot do:
              </p>
              <ul>
                <li>
                  <strong>It cannot certify WCAG conformance.</strong> Automated checks cover
                  roughly one-third of WCAG criteria. A passing accessibility score does not mean
                  your site is fully accessible or legally compliant.
                </li>
                <li>
                  <strong>It cannot certify ASVS compliance.</strong> Security findings reflect the
                  observable public surface only. Authenticated pages, server-side logic, database
                  access, dependency vulnerabilities and infrastructure configuration are outside
                  scope.
                </li>
                <li>
                  <strong>It cannot certify GDPR, ePrivacy or CCPA compliance.</strong> Privacy
                  signals indicate whether common mechanisms are present; they do not constitute a
                  legal assessment of data processing lawfulness.
                </li>
                <li>
                  <strong>It does not run active security tests.</strong> No fuzzing, injection
                  attempts, brute-force probing or credential stuffing is performed.
                </li>
                <li>
                  <strong>Results are a point-in-time snapshot.</strong> A scan reflects what was
                  publicly visible when the scan ran. Dynamic content, A/B tests and CDN edge
                  variance may produce different results for a simultaneous browser visit.
                </li>
                <li>
                  <strong>It does not access authenticated or paywalled content.</strong> The audit
                  covers only URLs reachable by an unauthenticated HTTP client.
                </li>
                <li>
                  <strong>AI SEO provider visibility is optional and not guaranteed.</strong> AI
                  provider APIs change frequently; provider-visibility checks reflect API responses
                  at scan time and may not represent end-user query behaviour.
                </li>
              </ul>
              <p>
                Questions about coverage or evidence:{' '}
                <a href="mailto:pavlenkoandrey56@gmail.com">pavlenkoandrey56@gmail.com</a>
              </p>
            </section>
          </article>
        </div>

        <footer className="legal-footer">
          <span>FLUXRADAR / BY FLUXLAB</span>
          <span>
            <a href="/">Home</a> · <a href="/privacy">Privacy policy</a> ·{' '}
            <a href="/terms">Terms of service</a>
          </span>
        </footer>
      </main>
    </div>
  );
}

// ─── /integrations ────────────────────────────────────────────────────────────

function IntegrationsScreen(props: {
  profiles: readonly SiteProfile[];
  onClose: () => void;
  onError: (value: string) => void;
}) {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setIntegrations(await apiRequest<IntegrationStatus[]>('/integrations'));
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Integrations unavailable');
    } finally {
      setLoading(false);
    }
  }, [props.onError]);

  useEffect(() => {
    void load();
    const result = new URLSearchParams(window.location.search).get('result');
    const message = new URLSearchParams(window.location.search).get('message');
    if (result === 'connected')
      setNotice('Google is connected. Choose which properties this website reports on below.');
    if (result === 'error') setNotice(message ?? 'The integration could not be connected.');
  }, [load]);

  const connect = async (provider: IntegrationStatus) => {
    setBusyProvider(provider.provider);
    try {
      const result = await apiRequest<{ authorizationUrl: string }>(
        `/integrations/${provider.provider}/start`,
        { method: 'POST', body: '{}' },
      );
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Connection could not be started');
    } finally {
      setBusyProvider(null);
    }
  };

  const disconnect = async (provider: IntegrationStatus) => {
    setBusyProvider(provider.provider);
    try {
      await apiRequest<null>(`/integrations/${provider.provider}`, { method: 'DELETE' });
      await load();
    } catch (caught) {
      props.onError(
        caught instanceof Error ? caught.message : 'Integration could not be disconnected',
      );
    } finally {
      setBusyProvider(null);
    }
  };

  if (loading)
    return (
      <Window title="Integrations" onClose={props.onClose}>
        <LoadingState />
      </Window>
    );
  return (
    <div className="stack">
      <Window title="FluxRadar — Integrations" onClose={props.onClose}>
        <div className="split">
          <div>
            <h2 className="section-heading">Connected data sources</h2>
            <p className="muted">
              Optional connections are managed here. Public-site checks continue to work without
              them.
            </p>
          </div>
          <Button onClick={() => void load()}>Refresh</Button>
        </div>
        {notice ? (
          <div className="integration-notice" role="status">
            {notice}
          </div>
        ) : null}
        <div className="integration-list">
          {integrations.map((integration) => (
            <div className="integration-row" key={integration.provider}>
              <div className="integration-row__copy">
                <div className="split">
                  <strong>{integration.label}</strong>
                  <StatusChip
                    status={
                      integration.status === 'available'
                        ? 'Ready to connect'
                        : integration.status.replace('_', ' ')
                    }
                  />
                </div>
                <p>{integration.services.join(' · ')}</p>
                {integration.lastError ? (
                  <small className="integration-row__error">{integration.lastError}</small>
                ) : null}
              </div>
              <div className="integration-row__action">
                {integration.kind === 'user' ? (
                  integration.status === 'connected' ? (
                    <Button
                      variant="danger"
                      disabled={busyProvider === integration.provider}
                      onClick={() => void disconnect(integration)}
                    >
                      {busyProvider === integration.provider ? 'Disconnecting…' : 'Disconnect'}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      disabled={!integration.canConnect || busyProvider === integration.provider}
                      onClick={() => void connect(integration)}
                    >
                      {busyProvider === integration.provider ? 'Opening…' : 'Connect'}
                    </Button>
                  )
                ) : (
                  <span className="technical integration-row__server">
                    {integration.status === 'connected'
                      ? 'Server configured'
                      : integration.status === 'limited'
                        ? 'Limited mode'
                        : 'Needs server config'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        <GoogleProperties
          profiles={props.profiles}
          connected={integrations.some(
            (integration) =>
              integration.provider === 'google' && integration.status === 'connected',
          )}
          onError={props.onError}
        />
        <Panel title="Current policy">
          <p className="muted integration-policy">
            Google and Bing connections are read-only. FluxRadar requests no CMS credentials and
            never changes a client site. Public-site scans continue to work without either
            connection.
          </p>
        </Panel>
      </Window>
    </div>
  );
}

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
  const checkoutConfig = useCheckoutConfig(!props.internalFreeAccess);
  const paidAvailable = props.internalFreeAccess || checkoutConfig?.available === true;
  const [profileId, setProfileId] = useState(
    props.selectedProfile?.id ?? props.profiles[0]?.id ?? '',
  );
  const [plan, setPlan] = useState<'Free' | 'Basic' | 'Complete'>(
    paidAvailable ? 'Complete' : 'Free',
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
        <EmptyState title={t.newScan.emptyTitle} />
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
          {!paidAvailable ? (
            <p className="muted">{paidUnavailableCopy(t, checkoutConfig)}</p>
          ) : null}
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

function ScanScreen(props: {
  scan: Scan | null;
  onUpdate: (scan: Scan) => void;
  onDone: () => void;
  onError: (value: string) => void;
}) {
  const [cancelBusy, setCancelBusy] = useState(false);
  useEffect(() => {
    if (props.scan === null || isTerminalScan(props.scan)) return undefined;
    let cancelled = false;
    const scanId = props.scan.id;
    const poll = async () => {
      try {
        const scan = await apiRequest<Scan>(`/scans/${scanId}`);
        if (cancelled) return;
        props.onUpdate(scan);
        if (isTerminalScan(scan) && timer !== undefined) {
          window.clearInterval(timer);
        }
      } catch (caught) {
        if (!cancelled)
          props.onError(caught instanceof Error ? caught.message : 'Scan status unavailable');
      }
    };
    const timer = window.setInterval(() => void poll(), 1000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [props.scan?.id, props.onError, props.onUpdate]);
  if (props.scan === null)
    return (
      <Window title="Scan progress">
        <EmptyState title="No scan selected" />
      </Window>
    );
  const scan = props.scan;
  const progress =
    scan.progress.totalModules === 0
      ? 0
      : (scan.progress.completedModules / scan.progress.totalModules) * 100;
  const terminal = ['Completed', 'Partial', 'Failed', 'Cancelled'].includes(scan.status);
  const cancel = async () => {
    setCancelBusy(true);
    try {
      props.onUpdate(await apiRequest<Scan>(`/scans/${scan.id}/cancel`, { method: 'POST' }));
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Cancel failed');
    } finally {
      setCancelBusy(false);
    }
  };
  return (
    <Window title={`Scan progress · ${scan.plan}`}>
      <Panel title="Checking your website">
        <p className="muted">We’re reviewing {scan.domain} for you.</p>
        <ProgressBar value={progress} label="Audit progress" />
        {terminal ? (
          <div className="scan-complete" role="status" aria-live="polite">
            <StatusChip status={scan.status} />
            <div>
              <strong>
                {scan.status === 'Completed'
                  ? 'Your report is ready.'
                  : scanStatusLabel(scan.status)}
              </strong>
              <p className="muted">
                {scan.completedAt
                  ? `Finished ${new Date(scan.completedAt).toLocaleString()}.`
                  : 'The scan has finished processing.'}
              </p>
            </div>
          </div>
        ) : (
          <p className="muted">
            Checking your site — {scan.progress.completedModules} of {scan.progress.totalModules}{' '}
            audit sections done.
          </p>
        )}
      </Panel>
      <Panel title="What we’re checking">
        {scan.modules.length === 0 ? (
          <p className="muted">Getting your checks ready…</p>
        ) : (
          <div aria-label="Audit sections">
            {scan.modules.map((module) => (
              <FieldRow
                key={module.module}
                label={module.module}
                value={friendlySectionStatus(module.status)}
              />
            ))}
          </div>
        )}
      </Panel>
      <div className="button-row">
        {terminal ? (
          <Button onClick={props.onDone} variant="primary">
            Open report
          </Button>
        ) : (
          <Button onClick={() => void cancel()} variant="danger" disabled={cancelBusy}>
            {cancelBusy ? 'Cancelling…' : 'Cancel scan'}
          </Button>
        )}
      </div>
    </Window>
  );
}

// Maps internal per-module runtime statuses (Pending/Running/Completed/Partial/
// Unavailable) to plain language for the non-technical progress screen. Keeps the
// owner-facing UI free of queue/worker/state jargon while still saying, in human
// terms, what is happening to each audit section.
function friendlySectionStatus(status: string): string {
  if (/running/i.test(status)) return 'Checking…';
  if (/partial/i.test(status)) return 'Checked with limits';
  if (/completed|pass|ok|done/i.test(status)) return 'Checked';
  if (/unavailable|failed|error/i.test(status)) return 'Not available';
  return 'Waiting';
}

function scanStatusLabel(status: string): string {
  if (/partial/i.test(status)) return 'Your report is partially ready.';
  if (/failed/i.test(status)) return 'The scan could not finish.';
  if (/cancelled/i.test(status)) return 'The scan was cancelled.';
  return 'The scan has finished.';
}

function reportModuleStatus(module: ScanModule): string {
  if (/unavailable|failed|error/i.test(module.status)) return 'Unavailable';
  if (!module.usableOutput) return 'Insufficient data';
  if (/partial/i.test(module.status)) return 'Partial';
  if (/completed|pass|ok|done/i.test(module.status)) return 'Completed';
  return friendlySectionStatus(module.status);
}

function reportDomain(domain: string): string {
  try {
    return new URL(domain).hostname;
  } catch {
    return domain;
  }
}

function ResultsScreen(props: {
  scan: Scan | null;
  onScan: (scan: Scan) => void;
  onIssues: () => void;
  onError: (value: string) => void;
}) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!props.scan) {
      setLoading(false);
      return;
    }
    apiRequest<Dashboard>(`/scans/${props.scan.id}/dashboard`)
      .then((value) => {
        setDashboard(value);
        props.onScan(value.scan);
      })
      .catch((caught) =>
        props.onError(caught instanceof Error ? caught.message : 'Dashboard unavailable'),
      )
      .finally(() => setLoading(false));
  }, [props.scan?.id, props.onError, props.onScan]);
  if (loading)
    return (
      <Window title="Report dashboard">
        <LoadingState />
      </Window>
    );
  if (!dashboard)
    return (
      <Window title="Report dashboard">
        <EmptyState title="No completed report selected" />
      </Window>
    );
  const { scan, overall } = dashboard;
  // Present only when the scan actually stored a Google snapshot; a plan without
  // the Analytics module renders no Google section at all.
  const googleSnapshot = googleSnapshotOf(dashboard.modules);
  return (
    <div className="stack">
      <Window title={`Report dashboard · ${reportDomain(scan.domain)}`}>
        <div className="split">
          <div>
            <h2 className="section-heading">Unified website signal</h2>
            <div className="report-meta" aria-label="Report details">
              <span>
                <small>Website</small>
                <strong className="technical">{reportDomain(scan.domain)}</strong>
              </span>
              <span>
                <small>Plan</small>
                <strong>{scan.plan}</strong>
              </span>
              <span>
                <small>Report</small>
                <strong className="technical">{scan.id}</strong>
              </span>
            </div>
          </div>
          <ScoreDial
            score={overall.score}
            verdict={overall.verdict}
            coverage={overall.weightedCoverage}
          />
        </div>
        <section className="report-help" aria-label="How to read this report">
          <h3 className="section-heading">How to read this report</h3>
          <dl className="report-help__list">
            <div>
              <dt>Score</dt>
              <dd>
                A 0–100 rating for each area and for the site overall. Higher is better; a dash (—)
                means there was not enough public data to score it.
              </dd>
            </div>
            <div>
              <dt>Coverage</dt>
              <dd>How much of your site FluxRadar was able to check for that area.</dd>
            </div>
            <div>
              <dt>Findings</dt>
              <dd>
                Specific issues we detected, each with the evidence behind it. Open the findings
                list below to review them and see recommended fixes.
              </dd>
            </div>
          </dl>
        </section>
        <div className="module-grid">
          {dashboard.modules.map((module) => (
            <div className="module-card" key={module.module}>
              <div className="split">
                <strong>{module.module}</strong>
                <StatusChip status={reportModuleStatus(module)} />
              </div>
              <div
                className={
                  module.score === null
                    ? 'module-card__score module-card__score--null'
                    : 'module-card__score'
                }
              >
                {module.score === null ? 'No score' : module.score.toFixed(2)}
              </div>
              <ModuleMetadata module={module} />
              {module.usableOutput && module.coverage !== null ? (
                <ProgressBar value={module.coverage * 100} label={`${module.module} coverage`} />
              ) : (
                <div className="module-card__coverage-unavailable" role="status">
                  {reportModuleStatus(module)} · coverage unavailable
                </div>
              )}
            </div>
          ))}
        </div>
        {dashboard.modules.some((module) => module.module === 'Accessibility') ? (
          <aside className="accessibility-note" aria-label="Accessibility audit scope">
            <strong>Accessibility · WCAG 2.2 AA</strong>
            <p>
              Automated DOM/CSS checks are shown in this report. Keyboard flows, computed styles,
              focus visibility under overlays and runtime validation may require manual review.
            </p>
            <small>FluxRadar does not provide legal accessibility certification.</small>
          </aside>
        ) : null}
        {googleSnapshot === null ? null : <GoogleDataPanel snapshot={googleSnapshot} />}
        <p className="muted report-help__cta">
          The Issue Center lists every finding with its evidence and a recommended fix, so you can
          decide what to work on first.
        </p>
        <div className="button-row">
          <Button onClick={props.onIssues} variant="primary">
            Open Issue Center
          </Button>
          {scan.plan === 'Complete' ? (
            <ExportButtons scanId={scan.id} onError={props.onError} />
          ) : (
            <span className="muted">Export is reserved for Complete scans.</span>
          )}
        </div>
        <div className="breadcrumb">
          {scan.id} · {scan.rulesetVersion} · coverage {(overall.weightedCoverage * 100).toFixed(0)}
          %
        </div>
      </Window>
    </div>
  );
}

function ModuleMetadata({ module }: { module: ScanModule }) {
  if (module.module === 'Accessibility') {
    return <small className="module-card__meta">WCAG 2.2 AA · EN 301 549 · Section 508</small>;
  }
  if (module.module === 'Security') {
    return <small className="module-card__meta">OWASP ASVS · Public Security Profile</small>;
  }
  if (module.module === 'Privacy') {
    return <small className="module-card__meta">Public technical consent signals</small>;
  }
  if (module.module === 'SEO') {
    return <small className="module-card__meta">JSON-LD · Open Graph · Twitter Cards</small>;
  }
  if (module.module === 'Analytics') {
    return (
      <small className="module-card__meta">Google Search Console · Analytics 4 · read-only</small>
    );
  }
  if (module.module === 'AI SEO / GEO') {
    const pages = asRecord(module.metadata?.pages);
    const checked = numberValue(pages?.checked);
    const structured = numberValue(pages?.structuredData);
    return (
      <small className="module-card__meta">
        Public AI readiness
        {checked !== null && structured !== null
          ? ` · ${structured}/${checked} pages with structured data`
          : ''}
      </small>
    );
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function ExportButtons(props: { scanId: string; onError: (value: string) => void }) {
  const downloadJson = async () => {
    try {
      const value = await apiRequest<ExportPayload>(`/scans/${props.scanId}/export?format=json`);
      download(
        `fluxradar-${props.scanId}.json`,
        JSON.stringify(value.records, null, 2),
        'application/json',
      );
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'JSON export failed');
    }
  };
  const downloadCsv = async () => {
    try {
      const value = await apiRequest<string>(`/scans/${props.scanId}/export?format=csv`);
      download(`fluxradar-${props.scanId}.csv`, value, 'text/csv');
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'CSV export failed');
    }
  };
  return (
    <>
      <Button onClick={() => void downloadJson()}>JSON</Button>
      <Button onClick={() => void downloadCsv()}>CSV</Button>
    </>
  );
}

function IssuesScreen(props: { scan: Scan | null; onError: (value: string) => void }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [filter, setFilter] = useState('');
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!props.scan) {
      setLoading(false);
      return;
    }
    apiRequest<Issue[]>(`/scans/${props.scan.id}/issues?limit=100`)
      .then(setIssues)
      .catch((caught) =>
        props.onError(caught instanceof Error ? caught.message : 'Issues unavailable'),
      )
      .finally(() => setLoading(false));
  }, [props.scan?.id, props.onError]);
  const visible = useMemo(
    () =>
      filter === ''
        ? issues
        : issues.filter((issue) =>
            `${issue.ruleId} ${issue.module} ${issue.status} ${issue.targetUrl}`
              .toLowerCase()
              .includes(filter.toLowerCase()),
          ),
    [filter, issues],
  );
  const update = async (issue: Issue, status: string) => {
    try {
      const value = await apiRequest<Issue>(`/scans/${issue.scanId}/issues/${issue.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setIssues((current) =>
        current.map((candidate) => (candidate.id === value.id ? value : candidate)),
      );
      setSelectedIssue((current) => (current?.id === value.id ? value : current));
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Issue update failed');
    }
  };
  if (loading)
    return (
      <Window title="Issue Center">
        <SkeletonRows rows={3} />
      </Window>
    );
  return (
    <Window title={`Issue Center · ${props.scan?.id ?? 'no scan'}`}>
      <div className="split">
        <div>
          <h2 className="section-heading">Findings and evidence</h2>
          <p className="muted">
            Each finding is something FluxRadar detected on a public page. Use Details to see the
            evidence, the affected page and a recommended fix. The status you set is remembered on
            your next full scan.
          </p>
        </div>
        <Field label="Filter" value={filter} onChange={setFilter} placeholder="rule, module, URL" />
      </div>
      <p className="muted issue-severity-legend">
        <strong>Severity</strong> shows how urgent a finding is: Critical and High need attention
        first, then Medium, then Low.
      </p>
      {visible.length === 0 ? (
        <EmptyState title="No issues match this filter" />
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Rule</th>
              <th>Target</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((issue) => {
              const isExpanded = selectedIssue?.id === issue.id;
              const detailId = `issue-detail-${issue.id}`;
              return (
                <Fragment key={issue.id}>
                  <tr>
                    <td data-label="Severity">
                      <StatusChip status={issue.severity} />
                    </td>
                    <td data-label="Rule" className="technical">
                      {issue.ruleId}
                      <br />
                      <span className="muted">{issue.module}</span>
                    </td>
                    <td data-label="Target" className="technical">
                      {issue.targetUrl}
                    </td>
                    <td data-label="Status">
                      <StatusChip status={issue.status} />
                    </td>
                    <td data-label="Action">
                      <div className="button-row">
                        <Button
                          onClick={() => setSelectedIssue(isExpanded ? null : issue)}
                          aria-expanded={isExpanded}
                          aria-controls={detailId}
                        >
                          {isExpanded ? 'Hide details' : 'Details'}
                        </Button>
                        <select
                          className="control"
                          value={
                            ['New', 'Acknowledged', 'Ignored', 'False Positive'].includes(
                              issue.status,
                            )
                              ? issue.status
                              : 'New'
                          }
                          onChange={(event) => void update(issue, event.target.value)}
                        >
                          <option>New</option>
                          <option>Acknowledged</option>
                          <option>Ignored</option>
                          <option>False Positive</option>
                        </select>
                      </div>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr id={detailId} className="issue-detail-row">
                      <td colSpan={5} className="issue-detail-cell">
                        <div className="issue-detail">
                          <div className="split">
                            <strong>
                              {issue.ruleId} · {issue.module}
                            </strong>
                            <Button onClick={() => setSelectedIssue(null)}>Close details</Button>
                          </div>
                          <FieldRow
                            label="Severity"
                            value={<StatusChip status={issue.severity} />}
                          />
                          <FieldRow label="Status" value={<StatusChip status={issue.status} />} />
                          <FieldRow label="Target" value={issue.targetUrl} technical />
                          <FieldRow
                            label="Evidence"
                            value={issue.evidenceExcerpt ?? 'No excerpt available'}
                          />
                          <FieldRow label="Recommendation" value={issue.recommendation} />
                          <FieldRow
                            label="Impact"
                            value={`${issue.affectedTargets}/${issue.applicableTargets} targets · score ${issue.scoreDelta.toFixed(2)}`}
                          />
                          <FieldRow
                            label="Confidence"
                            value={`${(issue.confidence * 100).toFixed(0)}%`}
                          />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </DataTable>
      )}
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

function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
