// The state the app shell keeps across screens, in the groups it falls into.
//
// These were declared one after another at the top of the shell component. They
// keep their initial values; only their order relative to one another changed,
// which React does not observe: a state hook is matched to its call position,
// and that position is the same on every render.

import { useCallback, useState } from 'react';

import type { Account, Scan, SiteProfile } from './api';
import { readInitialRoute, type InitialRoute, type Screen } from './app-routes';
import type { ChosenPlan } from './Pricing';

/** What a visitor asked for before they had an account. */
export interface VisitorIntent {
  readonly site: string | null;
  readonly plan: ChosenPlan | null;
}

/** Where the app is, and the sign-in dialog a visitor may have open over it. */
function useRouteState() {
  const [entryRoute] = useState<InitialRoute>(readInitialRoute);
  const [screen, setScreen] = useState<Screen>(entryRoute.screen);
  const [emailAction, setEmailAction] = useState(entryRoute.emailAction);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  // What a visitor asked for before they had an account — the site typed on the
  // home page, or a plan picked on its pricing cards. Kept in memory only:
  // registration happens in a dialog over the same page, so nothing is stored.
  const [intent, setIntent] = useState<VisitorIntent | null>(null);
  return {
    entryRoute,
    screen,
    setScreen,
    emailAction,
    setEmailAction,
    authMode,
    setAuthMode,
    intent,
    setIntent,
  };
}

/** Who is signed in, the sites they saved, and what the workspace shows them first. */
function useSessionState() {
  const [account, setAccount] = useState<Account | null>(null);
  const [profiles, setProfiles] = useState<SiteProfile[]>([]);
  const [booting, setBooting] = useState(true);
  const [tourOpen, setTourOpen] = useState(false);
  const [verifyBannerHidden, setVerifyBannerHidden] = useState(false);
  return {
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
  };
}

/** The site, scan, problem and plan the owner is working with. */
function useSelectionState() {
  const [selectedProfile, setSelectedProfile] = useState<SiteProfile | null>(null);
  // Which profile the reports list is scoped to; null lists the whole account.
  const [reportsProfile, setReportsProfile] = useState<SiteProfile | null>(null);
  const [selectedScan, setSelectedScan] = useState<Scan | null>(null);
  const updateSelectedScan = useCallback((scan: Scan) => setSelectedScan(scan), []);
  // The problem the Issue Center opens on, when "Fix these first" sent the owner there.
  const [issueRuleFilter, setIssueRuleFilter] = useState<string | null>(null);
  // The plan the scan form opens on: chosen on the pricing cards, or from a Free
  // report's "Run Complete for this site".
  const [newScanPlan, setNewScanPlan] = useState<'Free' | 'Basic' | 'Complete' | null>(null);
  return {
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
  };
}

/** The alert for what failed, and its counterpart for what just worked. */
function useFeedbackState() {
  const [error, setError] = useState<string | null>(null);
  // A confirmation for what just worked — "Password changed", "Status saved" —
  // pinned where the owner is looking, like the error alert.
  const [notice, setNotice] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  return { error, setError, notice, setNotice, clearNotice };
}

export function useAppState() {
  const route = useRouteState();
  const session = useSessionState();
  const selection = useSelectionState();
  const feedback = useFeedbackState();
  return { ...route, ...session, ...selection, ...feedback };
}

export type AppState = Readonly<ReturnType<typeof useAppState>>;
