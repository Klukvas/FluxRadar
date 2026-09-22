import { useCallback, useEffect, useState } from 'react';

import {
  AlertDialog,
  Button,
  Notice,
  LoadingState,
  MenuBar,
  CreatedByFluxLab,
  Window,
} from './components';
import { apiRequest, type Account } from './api';
import { AccountScreen } from './AccountScreen';
import { AdminStatsScreen } from './AdminStats';
import { appActions } from './app-actions';
import { useBackAndForward, useNavigate, useOpenScanById } from './app-navigation';
import { loadProfiles, useConfirmEmailSignedIn, useSessionBoot } from './app-session';
import { useAppState } from './app-state';
import { accountCopy } from './account-copy';
import { AuthScreen } from './AuthScreen';
import { CheckoutPending } from './Checkout';
import { CookieConsent } from './CookieConsent';
import { DesktopScreen } from './DesktopScreen';
import { NewScanScreen } from './NewScanScreen';
import { HomeScreen } from './HomeScreen';
import { copy, readInitialLanguage, storeLanguage, type Language } from './i18n';
import { OnboardingTour } from './OnboardingTour';
import { usePageMetadata } from './page-metadata';
import { usePendingCheckout } from './pending-checkout';
import { FaqScreen } from './Faq';
import { AuditCoverageScreen } from './Checks';
import { BotScreen } from './Bot';
import { PrintReport } from './PrintReport';
import { planLanguageFromSearch, planSearch } from './action-plan';
import { IntegrationsScreen } from './Integrations';
import { IssuesScreen } from './Issues';
import { ResultsScreen } from './Report';
import { LegalDocumentScreen } from './LegalDocuments';
import { ScanScreen } from './ScanProgress';
import { ReportsScreen } from './Reports';
import { Styleguide } from './Styleguide';
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
  const state = useAppState();
  const {
    entryRoute,
    screen,
    setScreen,
    emailAction,
    setEmailAction,
    authMode,
    setAuthMode,
    intent,
    setIntent,
    account,
    setAccount,
    profiles,
    setProfiles,
    booting,
    setBooting,
    tourOpen,
    setTourOpen,
    verifyBannerHidden,
    setVerifyBannerHidden,
    selectedProfile,
    setSelectedProfile,
    reportsProfile,
    setReportsProfile,
    selectedScan,
    setSelectedScan,
    updateSelectedScan,
    issueRuleFilter,
    setIssueRuleFilter,
    newScanPlan,
    setNewScanPlan,
    error,
    setError,
    notice,
    setNotice,
    clearNotice,
  } = state;
  const confirmEmailSignedIn = useConfirmEmailSignedIn(language, {
    setAccount,
    setEmailAction,
    setError,
    setNotice,
    setScreen,
  });

  useEffect(() => {
    onAccountChange(account);
  }, [account, onAccountChange]);

  usePageMetadata(screen, language, selectedScan?.id ?? null);

  const openScanById = useOpenScanById({ setError, setScreen, setSelectedScan });

  useSessionBoot({
    entryRoute,
    setAccount,
    setBooting,
    setProfiles,
    setScreen,
    setSelectedScan,
    setTourOpen,
    openScanById,
    confirmEmailSignedIn,
  });

  const { pendingCheckout, startCheckout, endCheckout } = usePendingCheckout({
    account,
    setScreen,
  });

  const navigate = useNavigate({ setScreen, setTourOpen });

  useBackAndForward({ account, selectedScan, setScreen }, openScanById);

  const {
    followIntent,
    onAuthed,
    retryScan,
    signOutLocally,
    resendFromBanner,
    finishOnboarding,
    skipOnboarding,
    onScanCreated,
    openReport,
  } = appActions({ ...state, language, navigate, openScanById });

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
