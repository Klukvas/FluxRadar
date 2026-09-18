import { describe, expect, it } from 'vitest';

import { detailFor } from '../../integrations/google/errors.ts';
import { connectionStateSnapshot } from '../../integrations/google/snapshot.ts';
import type { GoogleDataSnapshot } from '../../integrations/google/types.ts';
import {
  NOW,
  checkInput,
  detail,
  ga4Summary,
  page,
  row,
  searchConsoleSummary,
  snapshotWith,
} from '../../test-utils/analytics-fixtures.ts';
import { ANALYTICS_APPLICABLE_CHECKS, analyticsModuleRow } from './module-row.ts';
import { runAnalyticsChecks } from './run-checks.ts';
import { scoredAnalyticsIssues } from './scored-issues.ts';

function rowFor(snapshot: GoogleDataSnapshot, pages = [page('/')]) {
  const run = runAnalyticsChecks(
    checkInput({
      snapshot,
      searchConsoleDetail:
        snapshot.searchConsole.data === null
          ? null
          : detail({ pages: [row('https://example.com/')] }),
      pages,
    }),
  );
  const { score } = scoredAnalyticsIssues('scan-1', 'https://example.com', run.checks, NOW);
  return analyticsModuleRow(snapshot, run, score);
}

describe('analyticsModuleRow', () => {
  it('is Completed with a score when both services returned data', () => {
    const row = rowFor(snapshotWith(searchConsoleSummary(), ga4Summary()));

    expect(row).toMatchObject({
      runtimeStatus: 'Completed',
      statusReason: null,
      coverage: 1,
      applicableChecks: ANALYTICS_APPLICABLE_CHECKS,
      completedApplicableChecks: 8,
      usableOutput: true,
      score: 100,
    });
  });

  it('is Partial, still scored, when only one service returned data', () => {
    const row = rowFor(snapshotWith(searchConsoleSummary(), null));

    expect(row.runtimeStatus).toBe('Partial');
    expect(row.completedApplicableChecks).toBe(6);
    expect(row.coverage).toBe(6 / 8);
    expect(row.statusReason).toBe('AnalyticsPropertyNotSelected');
    expect(row.usableOutput).toBe(true);
    expect(row.score).toBe(100);
  });

  it('has no score when no check could run', () => {
    const row = rowFor(connectionStateSnapshot('not_connected', detailFor('not_connected'), NOW));

    expect(row).toMatchObject({
      runtimeStatus: 'Unavailable',
      statusReason: 'AnalyticsIntegrationNotConnected',
      coverage: 0,
      completedApplicableChecks: 0,
      usableOutput: false,
      score: null,
    });
  });

  it('prefers the state the user can act on over a transient provider failure', () => {
    const snapshot: GoogleDataSnapshot = {
      ...snapshotWith(null, null),
      searchConsole: { state: 'request_failed', detail: 'later', data: null },
      analytics: { state: 'needs_reconnect', detail: 'reconnect', data: null },
    };

    expect(rowFor(snapshot).statusReason).toBe('AnalyticsIntegrationNeedsReconnect');
  });

  it('stores the snapshot as before, with the checks that ran and the analysis beside it', () => {
    const snapshot = snapshotWith(searchConsoleSummary(), null);

    const metadata = JSON.parse(rowFor(snapshot).metadataJson) as GoogleDataSnapshot & {
      ruleChecks: readonly { ruleId: string; scoring: string }[];
      analysis: { trend: unknown };
    };

    expect(metadata.source).toBe('google');
    expect(metadata.readOnly).toBe(true);
    expect(metadata.fetchedAt).toBe(NOW.toISOString());
    expect(metadata.searchConsole.data?.totals.clicks).toBe(100);
    expect(metadata.ruleChecks.map((check) => check.ruleId)).toEqual([
      'ANALYTICS-SC-001',
      'ANALYTICS-SC-002',
      'ANALYTICS-SC-003',
      'ANALYTICS-SC-004',
      'ANALYTICS-SC-005',
      'ANALYTICS-LINK-001',
    ]);
    expect(metadata.ruleChecks[2]).toMatchObject({ scoring: 'informational' });
    expect(metadata.analysis.trend).toEqual({ metric: 'clicks', previous: 100, current: 100 });
  });
});

describe('the Analytics score', () => {
  it('adds up the scored checks with the §15 formula and leaves the lists free', () => {
    const run = runAnalyticsChecks(
      checkInput({
        snapshot: snapshotWith(
          searchConsoleSummary({
            totals: { clicks: 40, impressions: 5000, ctr: 0.01, position: 10 },
            previousTotals: { clicks: 100, impressions: 5000, ctr: 0.02, position: 10 },
          }),
          ga4Summary({ keyEvents: 0 }),
        ),
        searchConsoleDetail: detail({
          pages: [
            row('https://example.com/'),
            row('https://example.com/pricing', { clicks: 0, impressions: 80, position: 3 }),
          ],
          queries: [row('near miss', { impressions: 40, position: 12 })],
        }),
        pages: [
          page('/'),
          page('/pricing'),
          page('/about', { hasGoogleTag: false }),
          page('/team', { hasGoogleTag: false }),
        ],
      }),
    );

    const { score, issueRows } = scoredAnalyticsIssues(
      'scan-1',
      'https://example.com',
      run.checks,
      NOW,
    );

    // SC-001 High site-level 10; SC-002 Medium 3 × 1/2 = 1.5; SC-004 Low 1 × 2/4
    // = 0.5 (about, team); GA-001 Medium site-level 3; GA-002 Medium 3 × 2/4 = 1.5.
    expect(score).toBe(83.5);
    expect(Object.fromEntries(issueRows.map((issue) => [issue.ruleId, issue.rulePenalty]))).toEqual(
      {
        'ANALYTICS-SC-001': 10,
        'ANALYTICS-SC-002': 1.5,
        'ANALYTICS-SC-004': 0.5,
        'ANALYTICS-GA-001': 3,
        'ANALYTICS-GA-002': 1.5,
      },
    );
    expect(issueRows.some((issue) => issue.ruleId === 'ANALYTICS-SC-003')).toBe(false);
  });

  it('writes rows the Issue Center can show in every language', () => {
    const run = runAnalyticsChecks(
      checkInput({
        snapshot: snapshotWith(searchConsoleSummary(), ga4Summary({ keyEvents: 0 })),
      }),
    );

    const [issue] = scoredAnalyticsIssues(
      'scan-1',
      'https://example.com',
      run.checks,
      NOW,
    ).issueRows;

    expect(issue).toMatchObject({
      module: 'Analytics',
      ruleId: 'ANALYTICS-GA-001',
      severity: 'Medium',
      category: 'conversion-tracking',
      targetKind: 'site',
      // D-019: a site-level finding has no URL in its fingerprint.
      normalizedUrl: '',
      targetUrl: 'https://example.com',
      applicableTargets: 1,
      affectedTargets: 1,
      rulePenalty: 3,
      scoreDelta: -3,
      evidenceExcerpt:
        'GA4 property example.com recorded 500 sessions and no key events in the last 28 days.',
    });
    expect(JSON.parse(issue?.messagesJson ?? 'null')).toMatchObject({
      evidence: { code: 'analytics-ga-001.evidence' },
      recommendation: { code: 'analytics-ga-001.recommendation' },
    });
  });
});
