// What the shell does when an owner or a visitor acts: open and retry scans,
// carry a visitor into an account and out of it again, and close the setup
// tour.
//
// The actions are built again on every render from that render's state, as they
// were when they were declared inside the component, so none of them acts on
// state older than the screen it was called from.

import { apiRequest, type Account, type Scan, type SiteProfile } from './api';
import { resendVerification } from './AccountScreen';
import { accountCopy } from './account-copy';
import type { Navigate, OpenScanById } from './app-navigation';
import { isTerminalScan, isWorkspaceScreen, scanRoutePreference } from './app-routes';
import { loadProfiles } from './app-session';
import type { AppState, VisitorIntent } from './app-state';
import type { Language } from './i18n';

/** What the actions act on: the shell's state, its language, and the two ways it moves. */
export type ActionContext = AppState & {
  readonly language: Language;
  readonly navigate: Navigate;
  readonly openScanById: OpenScanById;
};

/** Opening a scan the owner created or picked, and retrying one that came back Partial. */
function scanActions({
  navigate,
  openScanById,
  setError,
  setNewScanPlan,
  setSelectedScan,
}: ActionContext) {
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

  return { retryScan, onScanCreated, openReport };
}

/**
 * Carries out what the visitor asked for before they had an account.
 *
 * A typed site becomes a profile and, unless a paid plan was picked, its free
 * homepage check starts at once — that is the promise the home page's form
 * made. A picked plan opens the scan form on that plan. Returns false when
 * there was nothing to carry out.
 */
function followIntentFor(
  { navigate, setError, setNewScanPlan, setProfiles, setSelectedProfile }: ActionContext,
  onScanCreated: (scan: Scan) => void,
) {
  return async (pending: VisitorIntent): Promise<boolean> => {
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
}

/**
 * Where the sign-in dialog leads: the scan a link named, what the visitor asked
 * for, or the workspace.
 */
function onAuthedFor(
  context: ActionContext,
  followIntent: (pending: VisitorIntent) => Promise<boolean>,
) {
  const { entryRoute, intent, navigate, openScanById, setTourOpen } = context;
  const { setAccount, setEmailAction, setError, setIntent, setProfiles } = context;
  return async (value: Account) => {
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
}

/** Ending the session in this tab, and the banner that asks for the address to be confirmed. */
function sessionActions(context: ActionContext) {
  const { account, language, navigate, setAccount, setError, setNotice, setProfiles } = context;
  const { setReportsProfile, setSelectedProfile, setSelectedScan, setVerifyBannerHidden } = context;
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

  return { signOutLocally, resendFromBanner };
}

/** Closing the setup tour. The API keeps either answer, so the tour does not open again. */
function onboardingActions({ navigate, setAccount, setError, setTourOpen }: ActionContext) {
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

  return { finishOnboarding, skipOnboarding };
}

/** Every action the screens call, built from this render's state. */
export function appActions(context: ActionContext) {
  const scans = scanActions(context);
  const followIntent = followIntentFor(context, scans.onScanCreated);
  return {
    ...scans,
    followIntent,
    onAuthed: onAuthedFor(context, followIntent),
    ...sessionActions(context),
    ...onboardingActions(context),
  };
}

export type AppActions = ReturnType<typeof appActions>;
