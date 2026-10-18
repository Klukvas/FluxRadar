// The main path as GA4 funnel steps: home → free check requested → sign-up →
// scan started → report viewed → upgrade clicked → paid plan chosen →
// checkout started → purchase.
//
// Every step goes through `trackEvent`, so nothing is sent before the visitor
// allows analytics or after they withdraw it. The parameters are a closed set
// on purpose: a plan name, a fixed enum or a boolean. Never the address the
// visitor typed, the audited domain, an email, a profile name or a scan id —
// scan ids are only held here, in memory, to report a step once per page load.
//
// | event                  | when                                              | params            |
// | ---------------------- | ------------------------------------------------- | ----------------- |
// | free_check_requested   | home hero form submitted with a valid address     | signed_in         |
// | scan_started           | the server created the scan (free, internal, paid) | plan              |
// | report_viewed          | a finished report screen loaded                   | plan, status      |
// | upgrade_clicked        | an upgrade button on a report or the dashboard    | plan, source      |
// | plan_selected          | a paid plan held on the new-scan form for 1 s     | plan              |
//
// Known limit: `scan_started` is guarded per page load only, so going Back to
// `/checkout/return` after a paid scan started can report that start again.

import { useEffect } from 'react';

import { trackEvent } from './analytics';
import { PLAN_ORDER, type PaidPlan, type Plan } from './plan-modules';
import { TERMINAL_SCAN_STATUSES } from './scan-status';

/** Where an upgrade button sits. */
export type UpgradeSource = 'free_report' | 'dashboard' | 'action_plan';

/**
 * How long the form has to hold a plan before it counts as chosen. The form
 * passes through intermediate plans on its own — the profile's saved plan for
 * one render before the plan picked on a pricing card replaces it — and those
 * are not choices anybody made.
 */
export const PLAN_SETTLE_MS = 1000;

type TerminalStatus = (typeof TERMINAL_SCAN_STATUSES)[number];

const startedScans = new Set<string>();
const viewedReports = new Set<string>();
const selectedPlans = new Set<Plan>();

/** A plan name the tariff table knows, or null for anything else the server might send. */
function knownPlan(value: string): Plan | null {
  return (PLAN_ORDER as readonly string[]).includes(value) ? (value as Plan) : null;
}

function terminalStatus(value: string): TerminalStatus | null {
  return (TERMINAL_SCAN_STATUSES as readonly string[]).includes(value)
    ? (value as TerminalStatus)
    : null;
}

export function trackFreeCheckRequested(signedIn: boolean): void {
  trackEvent('free_check_requested', { signed_in: signedIn });
}

/** Once per scan: a confirmation seen twice (a poll and a button) is still one start. */
export function trackScanStarted(scan: { readonly id: string; readonly plan: string }): void {
  const plan = knownPlan(scan.plan);
  if (plan === null || startedScans.has(scan.id)) return;
  if (trackEvent('scan_started', { plan })) startedScans.add(scan.id);
}

export function trackUpgradeClicked(plan: PaidPlan, source: UpgradeSource): void {
  trackEvent('upgrade_clicked', { plan, source });
}

/** Reports a finished report once per scan per page load, however often the screen renders. */
export function useReportViewed(
  scan: { readonly id: string; readonly plan: string; readonly status: string } | null,
): void {
  const id = scan?.id ?? null;
  const plan = scan === null ? null : knownPlan(scan.plan);
  const status = scan === null ? null : terminalStatus(scan.status);
  useEffect(() => {
    if (id === null || plan === null || status === null || viewedReports.has(id)) return;
    if (trackEvent('report_viewed', { plan, status })) viewedReports.add(id);
  }, [id, plan, status]);
}

/**
 * Reports the paid plan the new-scan form settles on: the preselected one, then
 * each different paid plan, once per plan per page load — closing and reopening
 * the form on the same plan is not a new choice. Free is not a selection here.
 */
export function usePlanSelected(plan: Plan, offered: boolean): void {
  useEffect(() => {
    if (plan === 'Free' || !offered || selectedPlans.has(plan)) return undefined;
    const timer = setTimeout(() => {
      if (!selectedPlans.has(plan) && trackEvent('plan_selected', { plan })) {
        selectedPlans.add(plan);
      }
    }, PLAN_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [plan, offered]);
}

/** Test seam: forgets which steps this page load already reported. */
export function resetFunnelAnalyticsForTests(): void {
  startedScans.clear();
  viewedReports.clear();
  selectedPlans.clear();
}
