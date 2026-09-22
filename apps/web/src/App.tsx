import { useCallback, useState } from 'react';

import { AlertDialog, Notice, LoadingState, Window } from './components';
import { apiRequest, type Account } from './api';
import { AccountScreen } from './AccountScreen';
import { AdminStatsScreen } from './AdminStats';
import { useAppModel, type AppModelProps } from './app-model';
import { isPublicDocument } from './app-routes';
import { loadProfiles } from './app-session';
import { accountCopy } from './account-copy';
import { AuthScreen } from './AuthScreen';
import { CheckoutPending } from './Checkout';
import { CookieConsent } from './CookieConsent';
import { DesktopScreen } from './DesktopScreen';
import { NewScanScreen } from './NewScanScreen';
import { HomeScreen } from './HomeScreen';
import { copy, readInitialLanguage, storeLanguage, type Language } from './i18n';
import { OnboardingTour } from './OnboardingTour';
import { PublicDocument } from './PublicDocument';
import { PrintReport } from './PrintReport';
import { planLanguageFromSearch, planSearch } from './action-plan';
import { IntegrationsScreen } from './Integrations';
import { IssuesScreen } from './Issues';
import { ResultsScreen } from './Report';
import { ScanScreen } from './ScanProgress';
import { ReportsScreen } from './Reports';
import { Styleguide } from './Styleguide';
import { SupportWidget } from './SupportWidget';
import { AppFrame, VerifyBanner, WorkspaceFooter, WorkspaceHeader } from './WorkspaceChrome';
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

function AppContent(props: AppModelProps) {
  const app = useAppModel(props);
  const {
    language,
    changeLanguage,
    entryRoute,
    screen,
    emailAction,
    setEmailAction,
    authMode,
    setAuthMode,
    intent,
    setIntent,
    account,
    profiles,
    setProfiles,
    booting,
    tourOpen,
    setTourOpen,
    verifyBannerHidden,
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
    pendingCheckout,
    startCheckout,
    endCheckout,
    navigate,
    openScanById,
    followIntent,
    onAuthed,
    retryScan,
    signOutLocally,
    finishOnboarding,
    skipOnboarding,
    onScanCreated,
    openReport,
  } = app;

  if (screen === 'styleguide') {
    return (
      <Styleguide onNavigate={navigate} language={language} onLanguageChange={changeLanguage} />
    );
  }
  if (isPublicDocument(screen)) {
    return (
      <PublicDocument
        screen={screen}
        language={language}
        onLanguageChange={changeLanguage}
        signedIn={account !== null}
      />
    );
  }
  if (booting) {
    return (
      <AppFrame
        className="app-shell"
        active="desktop"
        onNavigate={navigate}
        signedIn={false}
        language={language}
        onLanguageChange={changeLanguage}
      >
        <Window title={copy[language].workspace.booting} terminal>
          <LoadingState />
        </Window>
      </AppFrame>
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
    <AppFrame
      className="app-shell workspace-shell"
      active={screen}
      onNavigate={navigate}
      signedIn
      language={language}
      onLanguageChange={changeLanguage}
    >
      <WorkspaceHeader app={app} account={account} />
      {account.emailVerified === false && !verifyBannerHidden && screen !== 'account' ? (
        <VerifyBanner app={app} account={account} />
      ) : null}
      {error ? (
        <AlertDialog message={error} language={language} floating onClose={() => setError(null)} />
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
          onDone={() => (selectedScan ? navigate('results', selectedScan.id) : navigate('reports'))}
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
      <WorkspaceFooter language={language} />
    </AppFrame>
  );
}
