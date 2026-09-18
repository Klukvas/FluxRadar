// Translates what the Analytics module collected into its ScanModule row.
//
// The row must satisfy the export coverage contract (§15): coverage equals
// completed/applicable exactly, Unavailable keeps completed = 0, Partial keeps
// 0 < completed < applicable, and Completed carries a null status_reason. The
// applicable checks are the seven Analytics rules (D-219); a rule completes
// when the source it reads — Search Console or GA4 — returned data.

import type { GoogleDataSnapshot, GoogleDataState } from '../../integrations/google/types.ts';
import { ruleCheckSummary } from '../rule-checks.ts';
import { ANALYTICS_RULE_IDS, type AnalyticsRun } from './run-checks.ts';

export const ANALYTICS_APPLICABLE_CHECKS = ANALYTICS_RULE_IDS.length;

/** Machine-readable reasons; the human sentence lives in the snapshot metadata. */
const STATUS_REASONS: Readonly<Record<GoogleDataState, string>> = {
  connected: 'AnalyticsDataAvailable',
  not_connected: 'AnalyticsIntegrationNotConnected',
  no_property_selected: 'AnalyticsPropertyNotSelected',
  needs_reconnect: 'AnalyticsIntegrationNeedsReconnect',
  no_access: 'AnalyticsPropertyAccessDenied',
  no_data: 'AnalyticsNoDataForPeriod',
  request_failed: 'AnalyticsProviderUnavailable',
};

export interface AnalyticsModuleRow {
  readonly runtimeStatus: 'Completed' | 'Partial' | 'Unavailable';
  readonly statusReason: string | null;
  readonly coverage: number;
  readonly score: number | null;
  readonly applicableChecks: number;
  readonly completedApplicableChecks: number;
  readonly usableOutput: boolean;
  readonly metadataJson: string;
}

export function statusReasonFor(state: GoogleDataState): string {
  return STATUS_REASONS[state];
}

/**
 * Picks the reason shown for a partial or unavailable Analytics module. A state
 * the user can act on outranks a transient provider problem, so reconnecting or
 * selecting a property is never hidden behind "temporarily unavailable".
 */
function dominantState(snapshot: GoogleDataSnapshot): GoogleDataState {
  const priority: readonly GoogleDataState[] = [
    'needs_reconnect',
    'not_connected',
    'no_property_selected',
    'no_access',
    'request_failed',
    'no_data',
  ];
  const states = [snapshot.searchConsole.state, snapshot.analytics.state];
  return priority.find((state) => states.includes(state)) ?? 'no_data';
}

/**
 * The row for one scan. `score` is what the scored findings add up to; it is
 * kept only when at least one check ran, because a section that looked at
 * nothing has no score to report (§15).
 */
export function analyticsModuleRow(
  snapshot: GoogleDataSnapshot,
  run: AnalyticsRun,
  score: number,
): AnalyticsModuleRow {
  const ran = run.checks.filter((check) => check.ran);
  const completed = ran.length;
  const runtimeStatus =
    completed === ANALYTICS_APPLICABLE_CHECKS
      ? 'Completed'
      : completed === 0
        ? 'Unavailable'
        : 'Partial';
  return {
    runtimeStatus,
    statusReason: runtimeStatus === 'Completed' ? null : statusReasonFor(dominantState(snapshot)),
    coverage: completed / ANALYTICS_APPLICABLE_CHECKS,
    score: runtimeStatus === 'Unavailable' ? null : score,
    applicableChecks: ANALYTICS_APPLICABLE_CHECKS,
    completedApplicableChecks: completed,
    usableOutput: completed > 0,
    // The snapshot stays at the top level, as every report before D-219 stored
    // it; the check list and the analysis sit beside it.
    metadataJson: JSON.stringify({
      ...snapshot,
      ruleChecks: ran.map((check) => ruleCheckSummary(check)),
      analysis: run.analysis,
    }),
  };
}
