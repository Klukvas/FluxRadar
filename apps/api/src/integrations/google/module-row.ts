// Translates a Google snapshot into the Analytics ScanModule row.
//
// The row must satisfy the export coverage contract (§15): coverage equals
// completed/applicable exactly, Unavailable keeps completed = 0, Partial keeps
// 0 < completed < applicable, and Completed carries a null status_reason. The
// two applicable checks are Search Console and GA4.

import type { GoogleDataSnapshot, GoogleDataState } from './types.ts';

export const ANALYTICS_APPLICABLE_CHECKS = 2;

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
  readonly score: null;
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

export function analyticsModuleRow(snapshot: GoogleDataSnapshot): AnalyticsModuleRow {
  const completed = [snapshot.searchConsole, snapshot.analytics].filter(
    (section) => section.data !== null,
  ).length;
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
    score: null,
    applicableChecks: ANALYTICS_APPLICABLE_CHECKS,
    completedApplicableChecks: completed,
    usableOutput: completed > 0,
    metadataJson: JSON.stringify(snapshot),
  };
}
