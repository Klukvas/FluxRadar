import { AlertDialog } from './components';
import type { Account } from './api';
import { planLanguageFromSearch } from './plan-language';
import type { AppModel } from './app-model';
import { loadProfiles } from './app-session';
import { CheckoutPending, type PendingCheckout } from './Checkout';
import { NewScanScreen } from './NewScanScreen';
import { PrintReport } from './PrintReport';
import { IssuesScreen } from './Issues';
import { ResultsScreen } from './Report';
import { ScanScreen } from './ScanProgress';

/** The window that waits for the provider to confirm a payment made in another tab. */
export function CheckoutRoute({
  app,
  pendingCheckout,
}: {
  readonly app: AppModel;
  readonly pendingCheckout: PendingCheckout;
}) {
  const { endCheckout, language, onScanCreated, setError } = app;
  return (
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
  );
}

/** The scan form, opened on the site and the plan the owner picked. */
export function NewScanRoute({
  app,
  account,
}: {
  readonly app: AppModel;
  readonly account: Account;
}) {
  const { language, navigate, newScanPlan, onScanCreated, setError, startCheckout } = app;
  const { profiles, selectedProfile, setProfiles } = app;
  return (
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
  );
}

/** A running scan's progress window. */
export function ScanRoute({ app }: { readonly app: AppModel }) {
  const { language, navigate, selectedScan, setError, setSelectedScan } = app;
  return (
    <ScanScreen
      scan={selectedScan}
      language={language}
      onUpdate={setSelectedScan}
      onDone={() => (selectedScan ? navigate('results', selectedScan.id) : navigate('reports'))}
      onReports={() => navigate('reports')}
      onError={setError}
    />
  );
}

/** A finished scan's report. */
export function ResultsRoute({ app }: { readonly app: AppModel }) {
  const { language, navigate, profiles, retryScan, selectedScan, setError } = app;
  const { setIssueRuleFilter, setNewScanPlan, setSelectedProfile, updateSelectedScan } = app;
  return (
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
      targetLanguages={
        profiles.find((profile) => profile.id === selectedScan?.profileId)?.targetLanguages
      }
      onRetry={(scan) => retryScan(scan.id)}
      onReports={() => navigate('reports')}
      onError={setError}
    />
  );
}

/** The Issue Center for the open report, on the problem the owner came for. */
export function IssuesRoute({ app }: { readonly app: AppModel }) {
  const { issueRuleFilter, language, selectedScan, setError, setNotice } = app;
  return (
    <IssuesScreen
      scan={selectedScan}
      language={language}
      initialRuleId={issueRuleFilter}
      onError={setError}
      onNotice={setNotice}
    />
  );
}

/** The client report on its own page, with the alert over it when something fails. */
export function PrintRoute({
  app,
  printScanId,
}: {
  readonly app: AppModel;
  readonly printScanId: string;
}) {
  const { error, language, navigate, setError } = app;
  return (
    <>
      {error ? (
        <AlertDialog message={error} language={language} floating onClose={() => setError(null)} />
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
