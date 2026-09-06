import { describe, expect, it } from 'vitest';

import { analyticsModuleRow, ANALYTICS_APPLICABLE_CHECKS } from './module-row.ts';
import { connectionStateSnapshot } from './snapshot.ts';
import { detailFor } from './errors.ts';
import type { Ga4Summary, GoogleDataSnapshot, SearchConsoleSummary } from './types.ts';

const NOW = new Date('2026-09-06T12:00:00.000Z');

const SEARCH_CONSOLE: SearchConsoleSummary = {
  siteUrl: 'sc-domain:example.com',
  totals: { clicks: 10, impressions: 100, ctr: 0.1, position: 5 },
  topQueries: [],
  topPages: [],
};

const ANALYTICS: Ga4Summary = {
  propertyId: '1',
  propertyName: 'example',
  users: 5,
  sessions: 6,
  pageViews: 7,
  events: 8,
  keyEvents: null,
};

function snapshotWith(
  searchConsole: GoogleDataSnapshot['searchConsole'],
  analytics: GoogleDataSnapshot['analytics'],
): GoogleDataSnapshot {
  return {
    ...connectionStateSnapshot('no_data', detailFor('no_data'), NOW),
    searchConsole,
    analytics,
  };
}

describe('analyticsModuleRow', () => {
  it('is Completed with full coverage and no status reason when both services returned data', () => {
    const row = analyticsModuleRow(
      snapshotWith(
        { state: 'connected', detail: 'ok', data: SEARCH_CONSOLE },
        { state: 'connected', detail: 'ok', data: ANALYTICS },
      ),
    );

    expect(row).toMatchObject({
      runtimeStatus: 'Completed',
      statusReason: null,
      coverage: 1,
      applicableChecks: ANALYTICS_APPLICABLE_CHECKS,
      completedApplicableChecks: 2,
      usableOutput: true,
      score: null,
    });
  });

  it('is Partial when only one service returned data', () => {
    const row = analyticsModuleRow(
      snapshotWith(
        { state: 'connected', detail: 'ok', data: SEARCH_CONSOLE },
        { state: 'no_property_selected', detail: 'pick one', data: null },
      ),
    );

    expect(row.runtimeStatus).toBe('Partial');
    expect(row.coverage).toBe(0.5);
    expect(row.completedApplicableChecks).toBe(1);
    expect(row.statusReason).toBe('AnalyticsPropertyNotSelected');
    expect(row.usableOutput).toBe(true);
  });

  it('keeps a never-connected scan on the historical not-connected reason', () => {
    const row = analyticsModuleRow(
      connectionStateSnapshot('not_connected', detailFor('not_connected'), NOW),
    );

    expect(row).toMatchObject({
      runtimeStatus: 'Unavailable',
      statusReason: 'AnalyticsIntegrationNotConnected',
      coverage: 0,
      completedApplicableChecks: 0,
      usableOutput: false,
    });
  });

  it('prefers the state the user can act on over a transient provider failure', () => {
    const row = analyticsModuleRow(
      snapshotWith(
        { state: 'request_failed', detail: 'later', data: null },
        { state: 'needs_reconnect', detail: 'reconnect', data: null },
      ),
    );

    expect(row.statusReason).toBe('AnalyticsIntegrationNeedsReconnect');
  });

  it('stores the snapshot verbatim so the report can name its source and period', () => {
    const snapshot = snapshotWith(
      { state: 'connected', detail: 'ok', data: SEARCH_CONSOLE },
      { state: 'no_data', detail: 'none', data: null },
    );

    const parsed = JSON.parse(analyticsModuleRow(snapshot).metadataJson) as GoogleDataSnapshot;

    expect(parsed.source).toBe('google');
    expect(parsed.readOnly).toBe(true);
    expect(parsed.fetchedAt).toBe(NOW.toISOString());
    expect(parsed.searchConsole.data?.totals.clicks).toBe(10);
  });
});
