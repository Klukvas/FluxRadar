import type { AppModel } from './app-model';
import { loadProfiles } from './app-session';
import { DesktopScreen } from './DesktopScreen';
import { IntegrationsScreen } from './Integrations';
import { ReportsScreen } from './Reports';

/** The owner's saved sites: where they add one, and start a scan or a report from it. */
export function DesktopRoute({ app }: { readonly app: AppModel }) {
  const { language, navigate, openScanById, retryScan, setError, setNotice } = app;
  const { profiles, setProfiles, setNewScanPlan, setReportsProfile, setSelectedProfile } = app;
  const { tourOpen, setTourOpen } = app;
  return (
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
  );
}

/** The reports list, for one site or for the whole account. */
export function ReportsRoute({ app }: { readonly app: AppModel }) {
  const { language, navigate, openReport, reportsProfile, setNewScanPlan, setReportsProfile } = app;
  return (
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
  );
}

/** The connections to Google data for each saved site. */
export function IntegrationsRoute({ app }: { readonly app: AppModel }) {
  const { language, navigate, profiles, setError, setProfiles } = app;
  return (
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
  );
}
