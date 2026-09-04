import { useCallback, useEffect, useMemo, useState } from 'react';
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
  type Dashboard,
  type ExportPayload,
  type IntegrationStatus,
  type Issue,
  type Scan,
  type ScanModule,
  type SiteProfile,
} from './api';
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
  | 'privacy'
  | 'terms'
  | 'styleguide';

interface InitialRoute {
  readonly screen: Screen;
  readonly scanId: string | null;
}

function readInitialRoute(): InitialRoute {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/privacy') return { screen: 'privacy', scanId: null };
  if (path === '/terms') return { screen: 'terms', scanId: null };
  const scanMatch = /^\/scans\/([^/]+)$/.exec(path);
  if (scanMatch?.[1] !== undefined) {
    try {
      const scanId = decodeURIComponent(scanMatch[1]);
      if (scanId.length > 0) return { screen: 'scan', scanId };
    } catch {
      // Treat malformed deep links like any other unknown public route.
    }
  }
  const route = window.location.hash.slice(1);
  return {
    screen:
      route === 'styleguide' ? 'styleguide' : route === 'integrations' ? 'integrations' : 'home',
    scanId: null,
  };
}

function isTerminalScan(scan: Scan): boolean {
  return ['Completed', 'Partial', 'Failed', 'Cancelled'].includes(scan.status);
}

export function App() {
  const [entryRoute] = useState<InitialRoute>(readInitialRoute);
  const [screen, setScreen] = useState<Screen>(entryRoute.screen);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [account, setAccount] = useState<Account | null>(null);
  const [profiles, setProfiles] = useState<SiteProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<SiteProfile | null>(null);
  const [selectedScan, setSelectedScan] = useState<Scan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const updateSelectedScan = useCallback((scan: Scan) => setSelectedScan(scan), []);

  useEffect(() => {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/privacy' || path === '/terms') {
      setBooting(false);
      return;
    }
    apiRequest<Account>('/auth/me')
      .then(async (value) => {
        setAccount(value);
        try {
          await loadProfiles(setProfiles);
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
    const valid: Screen = [
      'home',
      'auth',
      'desktop',
      'new-scan',
      'scan',
      'results',
      'issues',
      'integrations',
    ].includes(next)
      ? (next as Screen)
      : 'desktop';
    const scanPath =
      scanId !== undefined && ['scan', 'results', 'issues'].includes(valid)
        ? `/scans/${encodeURIComponent(scanId)}`
        : '/';
    window.history.replaceState(null, '', scanPath);
    setScreen(valid);
  };

  const onAuthed = async (value: Account) => {
    setAccount(value);
    setError(null);
    await loadProfiles(setProfiles);
    if (entryRoute.scanId !== null) {
      await restoreScan(entryRoute.scanId);
    } else {
      navigate('desktop');
    }
  };

  const onScanCreated = (scan: Scan) => {
    setSelectedScan(scan);
    navigate('scan', scan.id);
  };

  if (screen === 'styleguide') {
    return <Styleguide onNavigate={navigate} />;
  }
  if (screen === 'privacy' || screen === 'terms') {
    return <LegalDocumentScreen kind={screen} />;
  }
  if (booting) {
    return (
      <div className="app-shell">
        <MenuBar active="desktop" onNavigate={navigate} signedIn={false} />
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
          setError(null);
          setAuthMode('login');
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
        authOpen={screen === 'auth'}
        authMode={authMode}
        authError={error}
        onAuthError={setError}
        onAuthed={onAuthed}
        onCloseAuth={() => {
          setError(null);
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
        authOpen={false}
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
      <MenuBar active={screen} onNavigate={navigate} signedIn />
      <div className="desktop">
        <header className="desktop__intro">
          <div>
            <h1>FluxRadar</h1>
            <p>Unified public website audit station.</p>
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
            onRefresh={() => loadProfiles(setProfiles)}
            onSelectProfile={setSelectedProfile}
            onNewScan={(profile) => {
              setSelectedProfile(profile);
              navigate('new-scan');
            }}
            onError={setError}
          />
        ) : null}
        {screen === 'new-scan' ? (
          <NewScanScreen
            profiles={profiles}
            selectedProfile={selectedProfile}
            internalFreeAccess={account.internalFreeAccess === true}
            onCreated={onScanCreated}
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
          <IntegrationsScreen onClose={() => navigate('desktop')} onError={setError} />
        ) : null}
      </div>
    </div>
  );
}

type LegalDocumentKind = 'privacy' | 'terms';

function LegalDocumentScreen(props: { kind: LegalDocumentKind }) {
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
            <strong>Purchase data:</strong> payment and transaction metadata supplied by Paddle,
            such as transaction ID, plan, amount, currency and payment status. FluxRadar does not
            store your payment-card number.
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
          and Bing tokens are encrypted before they are stored. Paddle, Google, Bing and Anthropic
          process information under their own terms and privacy documentation when you use the
          corresponding integration.
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
          Paddle; payment-card data is handled by Paddle rather than stored by FluxRadar.
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

function IntegrationsScreen(props: { onClose: () => void; onError: (value: string) => void }) {
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
    if (result === 'connected') setNotice('Integration connected. The next scan can use its data.');
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
        <Panel title="Current policy">
          <p className="muted integration-policy">
            Google and Bing connections are read-only. FluxRadar requests no CMS credentials and
            never changes a client site. Anthropic and Hetzner S3 are platform services configured
            by FluxLab.
          </p>
        </Panel>
      </Window>
      <Window title="Deferred integrations">
        <div className="integration-deferred">
          <span>ROADMAP / LATER</span>
          <strong>Cloudflare</strong>
          <strong>WordPress</strong>
          <p>
            Kept outside the current release scope. They will be added as separate read-only
            connections.
          </p>
        </div>
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
}) {
  const [mode, setMode] = useState<'login' | 'register'>(props.initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    props.onError(null);
    try {
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
      title={mode === 'login' ? 'FluxRadar — Sign in' : 'FluxRadar — Create account'}
      className="window--dialog"
      onClose={props.onBack}
    >
      <form className="stack" onSubmit={submit}>
        <div>
          <h1 id="auth-title" className="section-heading">
            Public web audit station
          </h1>
          <p className="muted">Sign in to keep scan results and issue history in one workspace.</p>
        </div>
        <Field
          label="Email"
          value={email}
          onChange={setEmail}
          type="email"
          placeholder="operator@example.com"
        />
        <Field
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
          placeholder="8+ characters"
        />
        <div className="button-row">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Signing in…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </Button>
          <Button onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Create account' : 'Back to sign in'}
          </Button>
          <Button onClick={props.onBack}>Back to home</Button>
        </div>
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
  authOpen: boolean;
  authMode: 'login' | 'register';
  authError: string | null;
  onAuthError: (value: string | null) => void;
  onAuthed: (account: Account) => Promise<void>;
  onCloseAuth: () => void;
}) {
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start' });
  useEffect(() => {
    if (!props.authOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onCloseAuth();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
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
      />
      <main className="home" id="top">
        <div className="home__account-bar">
          <span className="home__account-label">FLUXRADAR / PUBLIC WEB AUDIT STATION</span>
          {props.signedIn ? (
            <div className="home__account-actions">
              <span className="home__account-email technical">{props.accountEmail}</span>
              <Button variant="primary" onClick={props.onOpenWorkspace}>
                Open workspace
              </Button>
            </div>
          ) : (
            <div className="home__account-actions">
              <Button onClick={props.onLogin}>Sign in</Button>
              <Button variant="primary" onClick={props.onRegister}>
                Create account
              </Button>
            </div>
          )}
        </div>
        <section className="home__hero" aria-labelledby="home-title">
          <div className="home__hero-copy">
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">01</span> FLUXLAB / PUBLIC WEB AUDIT STATION
            </div>
            <h1 id="home-title">
              One URL.
              <br />
              <em>Every signal.</em>
            </h1>
            <p className="home__lede">
              FluxRadar turns a public website into one clear operating picture: search visibility,
              AI discoverability, technical integrity and the issues worth fixing first.
            </p>
            <div className="home__actions">
              <Button variant="primary" onClick={props.onStart}>
                Run a free homepage check
              </Button>
              <button
                className="home__text-action"
                type="button"
                onClick={() => scrollTo('pricing')}
              >
                Compare plans <span aria-hidden="true">↓</span>
              </button>
            </div>
            <div className="home__proof" aria-label="Product highlights">
              <span>
                <strong>01</strong> homepage check
              </span>
              <span>
                <strong>06</strong> audit signals
              </span>
              <span>
                <strong>02</strong> paid report tiers
              </span>
            </div>
          </div>
          <div className="home__instrument" aria-label="FluxRadar audit preview">
            <div className="home__instrument-bar">
              <span className="home__live-dot" /> LIVE AUDIT PREVIEW{' '}
              <span className="home__instrument-mode">READ ONLY</span>
            </div>
            <div className="home__instrument-body">
              <div className="home__origin">
                <span className="home__label">PUBLIC ORIGIN</span>
                <strong className="technical">https://your-site.com</strong>
                <StatusChip status="Running" />
              </div>
              <div className="home__readout">
                <div className="home__readout-cell">
                  <span className="home__label">SIGNAL SCORE</span>
                  <strong>
                    87<span>/100</span>
                  </strong>
                  <small>score-v1</small>
                </div>
                <div className="home__readout-cell">
                  <span className="home__label">COVERAGE</span>
                  <strong>
                    92<span>%</span>
                  </strong>
                  <small>public pages read</small>
                </div>
                <div className="home__readout-cell">
                  <span className="home__label">FINDINGS</span>
                  <strong>14</strong>
                  <small>prioritized issues</small>
                </div>
              </div>
              <Terminal
                lines={[
                  'scope homepage + public links',
                  'seo       16 checks · complete',
                  'ai seo    public readiness · ready',
                  'security  ASVS public profile · queued',
                ]}
                active
              />
              <div className="home__module-list" aria-label="Audit modules">
                <span>
                  <i className="home__module-mark home__module-mark--green" /> SEO
                </span>
                <span>
                  <i className="home__module-mark home__module-mark--cyan" /> AI SEO / GEO
                </span>
                <span>
                  <i className="home__module-mark home__module-mark--amber" /> Security
                </span>
                <span>
                  <i className="home__module-mark home__module-mark--dim" /> 03 more signals
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="home__ticker" aria-label="FluxRadar audit coverage">
          <span>SEO</span>
          <span>AI SEO / GEO</span>
          <span>SECURITY</span>
          <span>ACCESSIBILITY</span>
          <span>RELIABILITY</span>
          <span>PRIVACY</span>
        </div>

        <section className="home__section" id="capabilities" aria-labelledby="capabilities-title">
          <div className="home__section-head">
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">02</span> WHAT FLUXRADAR READS
            </div>
            <h2 id="capabilities-title">A website is more than a ranking.</h2>
            <p>
              Get one report for the signals that shape how people, crawlers and AI systems
              experience your site.
            </p>
          </div>
          <div className="home__capability-grid">
            <article className="home__capability home__capability--green">
              <span className="home__card-index">A / SEARCH</span>
              <h3>SEO visibility</h3>
              <p>
                Titles, descriptions, headings, canonicals, indexing and the technical details that
                help search engines understand your pages.
              </p>
              <span className="home__card-foot">16 deterministic checks · JSON-LD preview</span>
            </article>
            <article className="home__capability home__capability--cyan">
              <span className="home__card-index">B / AI SYSTEMS</span>
              <h3>AI SEO / GEO</h3>
              <p>
                See whether your brand and site are discoverable by AI systems, with public crawler
                readiness plus consent-aware provider checks.
              </p>
              <span className="home__card-foot">
                Public readiness · provider visibility optional
              </span>
            </article>
            <article className="home__capability home__capability--amber">
              <span className="home__card-index">C / INTEGRITY</span>
              <h3>Site health</h3>
              <p>
                OWASP ASVS public signals, WCAG mappings, reliability, content quality and privacy —
                scored with honest coverage states.
              </p>
              <span className="home__card-foot">No false certainty</span>
            </article>
          </div>
        </section>

        <section className="home__workflow" aria-labelledby="workflow-title">
          <div className="home__workflow-copy">
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">03</span> THE OPERATING LOOP
            </div>
            <h2 id="workflow-title">From public URL to prioritized work.</h2>
            <p>
              No access to your CMS, analytics or source code required. Start with what anyone on
              the web can see.
            </p>
            <Button onClick={props.onStart}>Start with a public site</Button>
          </div>
          <div className="home__steps">
            <div className="home__step">
              <strong>01</strong>
              <div>
                <h3>Choose an origin</h3>
                <p>Enter one HTTPS website and define how deep the crawl should go.</p>
              </div>
            </div>
            <div className="home__step">
              <strong>02</strong>
              <div>
                <h3>Run the station</h3>
                <p>FluxRadar crawls public pages and records evidence behind every finding.</p>
              </div>
            </div>
            <div className="home__step">
              <strong>03</strong>
              <div>
                <h3>Fix what matters</h3>
                <p>Open the Issue Center, assign a status and export the Complete report.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="home__pricing" id="pricing" aria-labelledby="pricing-title">
          <div className="home__section-head">
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">04</span> PAY PER SCAN
            </div>
            <h2 id="pricing-title">Buy the answer you need.</h2>
            <p>One scan, one clear result. No monthly quota and no recurring subscription.</p>
          </div>
          <div className="home__pricing-grid">
            <article className="home__plan home__plan--free">
              <span className="home__card-index">FREE / FIRST LOOK</span>
              <h3>Homepage check</h3>
              <div className="home__price">$0</div>
              <p>
                One limited check for title, headings, description and indexing on your homepage.
              </p>
              <Button onClick={props.onStart}>Try free</Button>
            </article>
            <article className="home__plan home__plan--basic">
              <span className="home__card-index">BASIC / FOCUSED</span>
              <h3>SEO + AI SEO / GEO</h3>
              <div className="home__price">$55</div>
              <p>Public-site SEO analysis plus AI visibility checks with one actionable report.</p>
              <Button variant="primary" onClick={props.onStart}>
                Choose Basic
              </Button>
            </article>
            <article className="home__plan home__plan--complete">
              <span className="home__card-index">COMPLETE / FULL SIGNAL</span>
              <h3>Unified audit</h3>
              <div className="home__price">$120</div>
              <p>All available audit modules, Issue Center, history and JSON/CSV export.</p>
              <Button onClick={props.onStart}>Choose Complete</Button>
            </article>
          </div>
        </section>

        <section className="home__last-call" aria-labelledby="last-call-title">
          <div>
            <div className="home__eyebrow">
              <span className="home__eyebrow-index">05</span> READY WHEN YOU ARE
            </div>
            <h2 id="last-call-title">
              Start with the site
              <br />
              <em>you already have.</em>
            </h2>
          </div>
          <Button variant="primary" onClick={props.onStart}>
            Run a free check <span aria-hidden="true">→</span>
          </Button>
        </section>
        <footer className="home__footer">
          <span>FLUXRADAR / BY FLUXLAB</span>
          <span className="home__footer-links">
            <a href="/privacy">Privacy policy</a>
            <a href="/terms">Terms of service</a>
            <span>PUBLIC WEB AUDIT STATION · v0.1</span>
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
          <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <AuthScreen
              onAuthed={props.onAuthed}
              error={props.authError}
              onError={props.onAuthError}
              onBack={props.onCloseAuth}
              initialMode={props.authMode}
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
}) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('https://');
  const [busy, setBusy] = useState(false);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest<SiteProfile>('/profiles', {
        method: 'POST',
        body: JSON.stringify({ name, domain }),
      });
      setName('');
      setDomain('https://');
      await props.onRefresh();
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Profile creation failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="desktop__grid">
      <Window title="Site Profiles">
        <Panel title="Registered public origins">
          <div>
            {props.profiles.length === 0 ? (
              <EmptyState
                title="No public sites yet"
                action={
                  <Button
                    variant="primary"
                    onClick={() =>
                      document
                        .querySelector<HTMLInputElement>('input[placeholder="Product website"]')
                        ?.focus()
                    }
                  >
                    Add site
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
                      New scan
                    </Button>
                    <Button onClick={() => props.onSelectProfile(profile)}>Inspect</Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
        <Panel title="Add site">
          <form className="stack" onSubmit={create}>
            <Field
              label="Display name"
              value={name}
              onChange={setName}
              placeholder="Product website"
            />
            <Field
              label="HTTPS origin"
              value={domain}
              onChange={setDomain}
              placeholder="https://example.com"
            />
            <Button type="submit" variant="primary" disabled={busy || name.trim() === ''}>
              {busy ? 'Saving…' : 'Save profile'}
            </Button>
          </form>
        </Panel>
      </Window>
      <Window title="Operator notes" terminal>
        <Terminal
          lines={[
            'ready: public-origin mode',
            'free: one homepage check',
            'basic: seo + ai seo / geo',
            'complete: all available modules + export',
          ]}
        />
        <Panel title="Subscription model">
          <FieldRow label="Billing" value="Pay-per-scan" />
          <FieldRow label="Basic" value="$55 · SEO + AI SEO / GEO" />
          <FieldRow label="Complete" value="$120 · full report" />
        </Panel>
      </Window>
    </div>
  );
}

function NewScanScreen(props: {
  profiles: readonly SiteProfile[];
  selectedProfile: SiteProfile | null;
  internalFreeAccess: boolean;
  onCreated: (scan: Scan) => void;
  onError: (value: string) => void;
}) {
  const [profileId, setProfileId] = useState(
    props.selectedProfile?.id ?? props.profiles[0]?.id ?? '',
  );
  const [plan, setPlan] = useState<'Free' | 'Basic' | 'Complete'>('Complete');
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
      if (plan === 'Free') {
        scan = await apiRequest<Scan>(`/profiles/${profileId}/free-check`, {
          method: 'POST',
          body: JSON.stringify({ scope }),
        });
      } else {
        scan = await apiRequest<{ scanId: string } & Record<string, unknown>>(
          '/billing/dev-checkout',
          {
            method: 'POST',
            body: JSON.stringify({
              siteProfileId: profileId,
              plan,
              scope,
              ...(consent ? { aiConsent: { providers: ['anthropic'], noticeVersion: 'v1' } } : {}),
            }),
          },
        ).then((value) => apiRequest<Scan>(`/scans/${value.scanId}`));
      }
      props.onCreated(scan);
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Scan could not be created');
    } finally {
      setBusy(false);
    }
  };
  if (props.profiles.length === 0)
    return (
      <Window title="New scan">
        <EmptyState title="Create a site profile first" />
      </Window>
    );
  return (
    <Window title="New scan — scope and tariff" className="window--dialog">
      <form className="stack" onSubmit={submit}>
        <Panel title="Target">
          <SelectField
            label="Public origin"
            value={profileId}
            onChange={setProfileId}
            options={props.profiles.map((profile) => ({
              value: profile.id,
              label: `${profile.name} · ${profile.domain}`,
            }))}
          />
          <Checkbox
            label="Include subdomains (where allowed)"
            checked={includeSubdomains}
            onChange={setIncludeSubdomains}
          />
          <SelectField
            label="User agent"
            value={userAgent}
            onChange={(value) => setUserAgent(value as typeof userAgent)}
            options={[
              { value: 'desktop', label: 'Desktop' },
              { value: 'mobile', label: 'Mobile' },
            ]}
          />
        </Panel>
        <Panel title="Audit depth">
          <SelectField
            label="Scan plan"
            value={plan}
            onChange={(value) => setPlan(value as typeof plan)}
            options={[
              { value: 'Free', label: 'Free · homepage only' },
              {
                value: 'Basic',
                label: props.internalFreeAccess ? 'Basic · internal free' : 'Basic · $55',
              },
              {
                value: 'Complete',
                label: props.internalFreeAccess ? 'Complete · internal free' : 'Complete · $120',
              },
            ]}
          />
          {plan !== 'Free' ? (
            <>
              <Field label="Maximum pages" value={maxPages} onChange={setMaxPages} type="number" />
              <Field
                label="Maximum crawl depth"
                value={maxDepth}
                onChange={setMaxDepth}
                type="number"
              />
              <Field
                label="Include path patterns (comma separated)"
                value={includePatterns}
                onChange={setIncludePatterns}
                placeholder="/docs/*, /blog/*"
              />
              <Field
                label="Exclude path patterns (comma separated)"
                value={excludePatterns}
                onChange={setExcludePatterns}
                placeholder="/admin/*, /private/*"
              />
              <SelectField
                label="URL query parameters"
                value={queryPolicy}
                onChange={(value) => setQueryPolicy(value as typeof queryPolicy)}
                options={[
                  { value: 'ignore', label: 'Ignore parameters' },
                  { value: 'include', label: 'Include parameters' },
                ]}
              />
            </>
          ) : null}
          <Checkbox
            label="Respect robots.txt"
            checked={respectRobots}
            onChange={setRespectRobots}
          />
          {!respectRobots ? (
            <Checkbox
              label="I confirm the robots.txt override"
              checked={robotsOverrideConfirmed}
              onChange={setRobotsOverrideConfirmed}
            />
          ) : null}
          {plan !== 'Free' ? (
            <Checkbox
              label="Allow AI SEO / GEO provider requests"
              checked={consent}
              onChange={setConsent}
            />
          ) : null}
        </Panel>
        <div className="split">
          <span className="muted">{selected?.domain ?? 'Select a profile'} · public site only</span>
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
              ? 'Creating…'
              : plan === 'Free'
                ? 'Run free check'
                : props.internalFreeAccess
                  ? 'Run internal scan'
                  : 'Pay and run scan'}
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
  const lines =
    scan.modules.length === 0
      ? ['queued: waiting for worker']
      : scan.modules.map((module) => `${module.status.padEnd(16, ' ')} ${module.module}`);
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
    <Window title={`Scan progress · ${scan.plan}`} terminal>
      <Terminal
        lines={[`target ${scan.domain}`, `scan ${scan.id}`, `state ${scan.status}`, ...lines]}
        active={!terminal}
      />
      <div className="window__content">
        <Panel title="Module progress">
          <ProgressBar value={progress} label="Module progress" />
          <p className="muted">
            {scan.progress.completedModules}/{scan.progress.totalModules} modules settled ·{' '}
            <span className="technical">{scan.rulesetVersion}</span>
          </p>
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
          <StatusChip status={scan.status} />
        </div>
      </div>
    </Window>
  );
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
  return (
    <div className="stack">
      <Window title={`Report dashboard · ${scan.domain}`}>
        <div className="split">
          <div>
            <h2 className="section-heading">Unified website signal</h2>
            <p className="muted">
              {scan.plan} · <span className="technical">{scan.id}</span>
            </p>
          </div>
          <ScoreDial
            score={overall.score}
            verdict={overall.verdict}
            coverage={overall.weightedCoverage}
          />
        </div>
        <div className="module-grid">
          {dashboard.modules.map((module) => (
            <div className="module-card" key={module.module}>
              <div className="split">
                <strong>{module.module}</strong>
                <StatusChip status={module.status} />
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
              <ProgressBar
                value={(module.coverage ?? 0) * 100}
                label={`${module.module} coverage`}
              />
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
          <p className="muted">Statuses are preserved by fingerprint on the next Complete scan.</p>
        </div>
        <Field label="Filter" value={filter} onChange={setFilter} placeholder="rule, module, URL" />
      </div>
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
            {visible.map((issue) => (
              <tr key={issue.id}>
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
                    <Button onClick={() => setSelectedIssue(issue)}>Details</Button>
                    <select
                      className="control"
                      value={
                        ['New', 'Acknowledged', 'Ignored', 'False Positive'].includes(issue.status)
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
            ))}
          </tbody>
        </DataTable>
      )}
      {selectedIssue ? (
        <div className="issue-detail">
          <div className="split">
            <strong>
              {selectedIssue.ruleId} · {selectedIssue.module}
            </strong>
            <Button onClick={() => setSelectedIssue(null)}>Close details</Button>
          </div>
          <FieldRow label="Severity" value={<StatusChip status={selectedIssue.severity} />} />
          <FieldRow label="Status" value={<StatusChip status={selectedIssue.status} />} />
          <FieldRow label="Target" value={selectedIssue.targetUrl} technical />
          <FieldRow
            label="Evidence"
            value={selectedIssue.evidenceExcerpt ?? 'No excerpt available'}
          />
          <FieldRow label="Recommendation" value={selectedIssue.recommendation} />
          <FieldRow
            label="Impact"
            value={`${selectedIssue.affectedTargets}/${selectedIssue.applicableTargets} targets · score ${selectedIssue.scoreDelta.toFixed(2)}`}
          />
          <FieldRow label="Confidence" value={`${(selectedIssue.confidence * 100).toFixed(0)}%`} />
        </div>
      ) : null}
    </Window>
  );
}

function Styleguide(props: { onNavigate: (screen: string) => void }) {
  const lines = [
    'loading… ▮',
    'GET https://example.com/ → 200 (312 ms)',
    'warning: missing CSP',
    'completed: 34 findings',
  ];
  return (
    <div className="app-shell">
      <MenuBar active="styleguide" onNavigate={props.onNavigate} signedIn={false} />
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

async function loadProfiles(setter: (profiles: SiteProfile[]) => void): Promise<void> {
  const profiles = await apiRequest<SiteProfile[]>('/profiles');
  setter(profiles);
}

function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
