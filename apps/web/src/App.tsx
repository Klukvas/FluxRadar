import { useCallback, useState, type ReactNode } from 'react';

// Several of these modules bring their own stylesheet, and stylesheets cascade in
// the order they are first imported, all of them ahead of base.css below. Moving
// an import can reorder the cascade.
import { AlertDialog, Notice, LoadingState, Window } from './components';
import type { Account } from './api';
import { AccountRoute, PasswordResetRoute } from './AccountRoutes';
import { AdminStatsScreen } from './AdminStats';
import { useAppModel, type AppModel, type AppModelProps } from './app-model';
import { isPublicDocument } from './app-routes';
import { accountCopy } from './account-copy';
import { CookieConsent } from './CookieConsent';
import { DesktopRoute, IntegrationsRoute, ReportsRoute } from './SiteRoutes';
import { HomeRoute } from './HomeRoute';
import { copy, readInitialLanguage, storeLanguage, type Language } from './i18n';
import { OnboardingTour } from './OnboardingTour';
import { PublicDocument } from './PublicDocument';
import {
  CheckoutRoute,
  IssuesRoute,
  NewScanRoute,
  PrintRoute,
  ResultsRoute,
  ScanRoute,
} from './ScanRoutes';
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
  const { account, changeLanguage, language, navigate, screen } = app;
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
  return <SessionScreen app={app} />;
}

/**
 * The screens that wait for the session: the boot window, then the home page,
 * the print view or the workspace.
 */
function SessionScreen({ app }: { readonly app: AppModel }) {
  const { account, booting, clearNotice, entryRoute, language, notice, screen, selectedScan } = app;
  if (booting) {
    return (
      <AppFrame app={app} className="app-shell" active="desktop" signedIn={false}>
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
        <HomeRoute app={app} />
      </>
    );
  }

  if (screen === 'home') return <HomeRoute app={app} />;

  // The client report is a document, not a workspace window: it is drawn on its
  // own so what prints is the report and nothing around it.
  if (screen === 'print') {
    const printScanId = selectedScan?.id ?? entryRoute.scanId;
    if (printScanId !== null) return <PrintRoute app={app} printScanId={printScanId} />;
  }

  return (
    // `workspace-shell` makes the shell a column the desktop stretches to fill,
    // which is what gives the footer below a floor to sink to on a report short
    // enough not to fill the viewport.
    <AppFrame app={app} className="app-shell workspace-shell" active={screen} signedIn>
      <Workspace app={app} account={account} noticeElement={noticeElement} />
    </AppFrame>
  );
}

interface WorkspaceProps {
  readonly app: AppModel;
  readonly account: Account;
  readonly noticeElement: ReactNode;
}

/**
 * The workspace, one slot per surface in the order they are drawn. Each screen
 * keeps its own slot, so switching screens unmounts one and mounts the other.
 */
function Workspace({ app, account, noticeElement }: WorkspaceProps) {
  const { emailAction, error, issueRuleFilter, language, pendingCheckout, screen, tourOpen } = app;
  const { finishOnboarding, selectedScan, setError, skipOnboarding, verifyBannerHidden } = app;
  return (
    <>
      <WorkspaceHeader app={app} account={account} />
      {account.emailVerified === false && !verifyBannerHidden && screen !== 'account' ? (
        <VerifyBanner app={app} account={account} />
      ) : null}
      {error ? (
        <AlertDialog message={error} language={language} floating onClose={() => setError(null)} />
      ) : null}
      {noticeElement}
      {screen === 'auth' && emailAction?.kind === 'reset' ? <PasswordResetRoute app={app} /> : null}
      {screen === 'account' ? <AccountRoute app={app} account={account} /> : null}
      {screen === 'admin-stats' ? <AdminStatsScreen /> : null}
      {screen === 'desktop' ? <DesktopRoute app={app} /> : null}
      {screen === 'reports' ? <ReportsRoute app={app} /> : null}
      {pendingCheckout !== null ? (
        <CheckoutRoute app={app} pendingCheckout={pendingCheckout} />
      ) : null}
      {screen === 'new-scan' && pendingCheckout === null ? (
        <NewScanRoute app={app} account={account} />
      ) : null}
      {screen === 'scan' ? <ScanRoute app={app} /> : null}
      {screen === 'results' ? <ResultsRoute app={app} /> : null}
      {screen === 'issues' ? (
        <IssuesRoute
          // Remounted per report and per problem, so a filter from one never
          // leaks into another.
          key={`${selectedScan?.id ?? 'none'}:${issueRuleFilter ?? ''}`}
          app={app}
        />
      ) : null}
      {screen === 'integrations' ? <IntegrationsRoute app={app} /> : null}
      {tourOpen && screen === 'desktop' ? (
        <OnboardingTour language={language} onFinish={finishOnboarding} onSkip={skipOnboarding} />
      ) : null}
      <WorkspaceFooter language={language} />
    </>
  );
}
