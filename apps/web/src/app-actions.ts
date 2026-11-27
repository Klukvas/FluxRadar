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
import {
  SCAN_PROFILE_PARAM,
  isTerminalScan,
  isWorkspaceScreen,
  newScanPath,
  scanRoutePreference,
} from './app-routes';
import { loadProfiles } from './app-session';
import type { AppState, VisitorIntent } from './app-state';
import { startFreeCheckForSite } from './auto-free-check';
import type { Language } from './i18n';

/** What the actions act on: the shell's state, its language, and the two ways it moves. */
export type ActionContext = AppState & {
  readonly language: Language;
  readonly navigate: Navigate;
  readonly openScanById: OpenScanById;
};

/**
 * Keeping the new-scan screen's own address honest.
 *
 * The form reports the site it is set up for; this writes it into the address,
 * so a reload reopens on that site instead of on whichever profile came first.
 * The address is the only thing written: the form owns which site is selected
 * while it is open, and pushing that back into the shell's `selectedProfile`
 * made the two owners of one fact fight over it — the dropdown snapped back to
 * the first site on the next render.
 *
 * Replaced rather than pushed: changing the site in the dropdown is not a new
 * place in the history, and Back has to leave the form rather than walk back
 * through every site the owner looked at.
 *
 * Only the site is written: the rest of the query string is carried over. It
 * used to be rebuilt from `newScanPath` alone, which dropped every other
 * parameter — and when the visitor has declined preferences storage, `?lang=uk`
 * is the only thing carrying their language (`readInitialLanguage`;
 * `storeLanguage` writes nothing without consent). Choosing a site in the
 * dropdown then meant a reload came back in English.
 */
function scanProfileAddress() {
  return (profileId: string): void => {
    // Only while the new-scan screen is the one on screen: rewriting an
    // unrelated address is a loop waiting to happen.
    const base = newScanPath(null);
    if (window.location.pathname !== base) return;
    const query = new URLSearchParams(window.location.search);
    if (query.get(SCAN_PROFILE_PARAM) === profileId) return;
    query.set(SCAN_PROFILE_PARAM, profileId);
    window.history.replaceState(null, '', `${base}?${query.toString()}`);
  };
}

/** Opening a scan the owner created or picked, and retrying one that came back Partial. */
function scanActions({
  navigate,
  openScanById,
  setAccount,
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
    // The free check is once per account: the new-scan screen marks it spent
    // from here on without waiting for the next session read.
    if (scan.plan === 'Free') {
      setAccount((current) => (current === null ? null : { ...current, freeCheckUsed: true }));
    }
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
/** How long the account re-read before an automatic start may take before the shell's copy is used. */
const ACCOUNT_REREAD_TIMEOUT_MS = 10_000;

function followIntentFor(context: ActionContext, onScanCreated: (scan: Scan) => void) {
  const { freeCheckStarting, language, navigate, setError, setFreeAiAskScanId } = context;
  const { setAccount, setNewScanPlan, setProfiles, setSelectedProfile } = context;
  const { setStartingCheckFor } = context;
  /** The add-a-site form with the address already in it: nothing was created. */
  const openAddSite = (site: string): void => {
    navigate('desktop', undefined, `?add=${encodeURIComponent(site)}`);
  };
  /** The scan form for a site just saved, with the reason it did not start on top. */
  const openScanForm = (profile: SiteProfile, message: string): void => {
    setError(message);
    setNewScanPlan(null);
    // The site goes in the address too, so a reload reopens the form on it.
    navigate('new-scan', undefined, `?${SCAN_PROFILE_PARAM}=${encodeURIComponent(profile.id)}`);
  };
  const startFreeCheck = async (site: string, account: Account): Promise<void> => {
    // The account as the server has it now: the free check may have been used
    // in another tab since this one last asked, and starting on a stale "unused"
    // would save the site only to be refused.
    const current = await apiRequest<Account>('/auth/me', {
      signal: AbortSignal.timeout(ACCOUNT_REREAD_TIMEOUT_MS),
    }).catch((caught: unknown) => {
      console.error('FluxRadar could not re-read the account before a free check', caught);
      return account;
    });
    // What it learned is kept: a spent check must read as spent on the scan
    // form this may lead to, not be offered again only to be refused.
    if (current.freeCheckUsed === true) {
      setAccount((shell) => (shell === null ? null : { ...shell, freeCheckUsed: true }));
    }
    const outcome = await startFreeCheckForSite(site, language, current);
    if (outcome.kind === 'free-check-used') {
      openAddSite(site);
      return;
    }
    if (outcome.kind === 'profile-failed') {
      setError(outcome.message);
      openAddSite(site);
      return;
    }
    setSelectedProfile(outcome.profile);
    // The workspace lists the new site whether or not its check started; a
    // failed re-read leaves the list as it was and the next screen still opens.
    await loadProfiles(setProfiles).catch((caught: unknown) => {
      console.error('FluxRadar sites could not be re-read after a site was saved', caught);
    });
    if (outcome.kind !== 'started') {
      openScanForm(outcome.profile, outcome.message);
      return;
    }
    setFreeAiAskScanId(outcome.scan.id);
    onScanCreated(outcome.scan);
  };
  /**
   * `account` is the one just signed in, or the owner already in the
   * workspace: the shell's own copy may not have caught up with a sign-in yet.
   */
  return async (pending: VisitorIntent, account: Account): Promise<boolean> => {
    if (pending.site === null) {
      if (pending.plan === null) return false;
      setNewScanPlan(pending.plan);
      navigate('new-scan');
      return true;
    }
    if (pending.plan !== null) {
      // A paid plan was picked: what is checked and how is still the buyer's
      // to set, so the site goes to its form and the plan is kept for it.
      setNewScanPlan(pending.plan);
      openAddSite(pending.site);
      return true;
    }
    if (freeCheckStarting.current) return true;
    freeCheckStarting.current = true;
    setStartingCheckFor(pending.site);
    try {
      await startFreeCheck(pending.site, account);
    } finally {
      freeCheckStarting.current = false;
      setStartingCheckFor(null);
    }
    return true;
  };
}

/**
 * The way from an empty new-scan screen to making the first site.
 *
 * It used to be a plain `<a href="/profiles">`, which reloads the whole app —
 * and the plan picked on a pricing card lives in memory, so somebody who chose
 * Basic, made their profile and came back found the form on Free, with nothing
 * on screen saying their choice had been dropped. This moves inside the app
 * instead, so the chosen plan survives — and `newScanPlan` is deliberately not
 * cleared on the way, which is the whole point.
 *
 * It needs no "open the form" hint: the Profiles screen opens its own add-a-site
 * form whenever the account has no sites, which is the only state the link that
 * calls this is shown in.
 */
function profileCreationNavigation({ navigate }: ActionContext) {
  return (): void => {
    navigate('desktop');
  };
}

/**
 * Where the sign-in dialog leads: the scan a link named, what the visitor asked
 * for, or the workspace.
 */
function onAuthedFor(
  context: ActionContext,
  followIntent: (pending: VisitorIntent, account: Account) => Promise<boolean>,
) {
  const { entryRoute, intent, navigate, openScanById, setTourOpen } = context;
  const { setAccount, setEmailAction, setError, setIntent, setProfiles } = context;
  const { setSelectedProfile } = context;
  return async (value: Account) => {
    setEmailAction(null);
    setAccount(value);
    setError(null);
    const profiles = await loadProfiles(setProfiles);
    if (entryRoute.scanId !== null) {
      await openScanById(entryRoute.scanId, scanRoutePreference(entryRoute.screen));
      return;
    }
    // The site a `/scan?profile=…` address named, carried through the sign-in
    // dialog. A session that was already signed in gets this
    // (`restoreSignedInSession`); a signed-out owner who followed the same link
    // did not, so they signed in and landed on the form for whichever site came
    // first. The id is untrusted — anyone can type an address — so it is only
    // ever matched against this account's own profiles, never requested or
    // shown, and one that names nothing selects nothing.
    if (entryRoute.profileId !== null) {
      const named = profiles.find((profile) => profile.id === entryRoute.profileId);
      if (named !== undefined) setSelectedProfile(named);
    }
    const pending = intent;
    setIntent(null);
    // The owner is in the middle of something they asked for; the tour waits
    // for their next visit (the account stays "pending" until it is seen).
    if (pending !== null && (await followIntent(pending, value))) return;
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
    rememberScanProfile: scanProfileAddress(),
    openProfileCreation: profileCreationNavigation(context),
    followIntent,
    onAuthed: onAuthedFor(context, followIntent),
    ...sessionActions(context),
    ...onboardingActions(context),
  };
}

export type AppActions = ReturnType<typeof appActions>;
