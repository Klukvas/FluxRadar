// The Search Console checks of the Analytics module (D-219). Thresholds keep a
// check quiet only where the data cannot carry a verdict at all — a handful of
// impressions has no trend and no click-through rate — and are set low enough
// that a small site's real problem still shows.

import { normalizeUrl } from '@fluxradar/fingerprint';
import { findingMessage } from '@fluxradar/rules';

import type {
  SearchConsoleDetail,
  SearchConsoleRow,
  SearchConsoleSummary,
  SearchConsoleTotals,
} from '../../integrations/google/types.ts';
import { isInPropertyScope, pageKey } from './page-match.ts';
import {
  nothingToJudge,
  siteCheck,
  type AnalyticsCheck,
  type AnalyticsCheckInput,
} from './types.ts';

/** A fall this large over 28 days is a signal, not day-to-day noise. */
const TREND_DROP_SHARE = 0.3;
/** Clicks are the measure when there are enough of them; impressions otherwise. */
const TREND_MIN_PREVIOUS_CLICKS = 10;
/** Below this many impressions a site's search numbers are too thin to judge. */
const MIN_SITE_IMPRESSIONS = 100;
/** A first-page result shown this often with no click is a snippet problem. */
const FIRST_PAGE_POSITION = 10;
const NO_CLICK_MIN_IMPRESSIONS = 50;
/** The bottom of the first page and the second: close enough to climb. */
const NEAR_TOP_MIN_POSITION = 8;
const NEAR_TOP_MAX_POSITION = 20;
const NEAR_TOP_MIN_IMPRESSIONS = 10;
const NEAR_TOP_LIST_LIMIT = 10;

export interface TrendDetail {
  readonly metric: 'clicks' | 'impressions';
  readonly previous: number;
  readonly current: number;
}

export interface QueryOpportunity {
  readonly query: string;
  readonly impressions: number;
  readonly position: number;
}

export function organicTrend(
  input: AnalyticsCheckInput,
  summary: SearchConsoleSummary,
): { readonly check: AnalyticsCheck; readonly trend: TrendDetail | null } {
  const ruleId = 'ANALYTICS-SC-001';
  const trend = trendOf(summary.totals, summary.previousTotals ?? null);
  if (trend === null) {
    return { check: nothingToJudge(ruleId), trend: null };
  }
  const drop = (trend.previous - trend.current) / trend.previous;
  const params = { previous: trend.previous, current: trend.current, drop: Math.round(drop * 100) };
  return {
    trend,
    check: siteCheck(
      ruleId,
      input,
      drop < TREND_DROP_SHARE
        ? null
        : {
            evidence:
              trend.metric === 'clicks'
                ? findingMessage('analytics-sc-001.evidence.clicks', params)
                : findingMessage('analytics-sc-001.evidence.impressions', params),
            recommendation: findingMessage('analytics-sc-001.recommendation', {}),
          },
    ),
  };
}

function trendOf(
  current: SearchConsoleTotals,
  previous: SearchConsoleTotals | null,
): TrendDetail | null {
  if (previous === null) return null;
  if (previous.clicks >= TREND_MIN_PREVIOUS_CLICKS) {
    return { metric: 'clicks', previous: previous.clicks, current: current.clicks };
  }
  if (previous.impressions >= MIN_SITE_IMPRESSIONS) {
    return { metric: 'impressions', previous: previous.impressions, current: current.impressions };
  }
  return null;
}

export function firstPageWithoutClicks(detail: SearchConsoleDetail): AnalyticsCheck {
  const ruleId = 'ANALYTICS-SC-002';
  const candidates = uniqueByPage(detail.pages).filter(
    (row) => row.impressions >= NO_CLICK_MIN_IMPRESSIONS && row.position <= FIRST_PAGE_POSITION,
  );
  const unclicked = candidates.filter((row) => row.clicks === 0);
  return {
    ruleId,
    ran: true,
    applicableTargets: candidates.length,
    affectedTargets: unclicked.length,
    checkedTargets: candidates.map((row) => normalizeUrl(row.key)),
    findings: unclicked.map((row) => ({
      ruleId,
      targetKind: 'page',
      targetUrl: row.key,
      evidenceType: 'mixed',
      evidence: findingMessage('analytics-sc-002.evidence', {
        impressions: row.impressions,
        position: row.position.toFixed(1),
      }),
      recommendation: findingMessage('analytics-sc-002.recommendation', {}),
    })),
  };
}

/**
 * The whole site is shown in search and nobody clicks through. Usually the
 * impressions come from positions past the first page, where nobody looks — a
 * ranking problem rather than a snippet one, which is why it is a site finding
 * of its own and not one per page.
 */
export function impressionsWithoutClicks(
  input: AnalyticsCheckInput,
  summary: SearchConsoleSummary,
): AnalyticsCheck {
  const ruleId = 'ANALYTICS-SC-005';
  const { totals } = summary;
  if (totals.impressions < MIN_SITE_IMPRESSIONS) return nothingToJudge(ruleId);
  return siteCheck(
    ruleId,
    input,
    totals.clicks > 0
      ? null
      : {
          evidence: findingMessage('analytics-sc-005.evidence', {
            impressions: totals.impressions,
            position: totals.position.toFixed(1),
          }),
          recommendation: findingMessage('analytics-sc-005.recommendation', {}),
        },
  );
}

export function nearTopQueries(detail: SearchConsoleDetail): {
  readonly check: AnalyticsCheck;
  readonly queries: readonly QueryOpportunity[];
} {
  const queries = detail.queries
    .filter(
      (row) =>
        row.impressions >= NEAR_TOP_MIN_IMPRESSIONS &&
        row.position >= NEAR_TOP_MIN_POSITION &&
        row.position <= NEAR_TOP_MAX_POSITION,
    )
    .toSorted((left, right) => right.impressions - left.impressions)
    .slice(0, NEAR_TOP_LIST_LIMIT)
    .map((row) => ({ query: row.key, impressions: row.impressions, position: row.position }));
  return {
    queries,
    // A list of opportunities, not a verdict: the rule is informational.
    check: {
      ruleId: 'ANALYTICS-SC-003',
      ran: true,
      applicableTargets: 1,
      affectedTargets: queries.length > 0 ? 1 : 0,
      findings: [],
    },
  };
}

export function crawledPagesWithoutImpressions(
  input: AnalyticsCheckInput,
  summary: SearchConsoleSummary,
  detail: SearchConsoleDetail,
): AnalyticsCheck {
  const ruleId = 'ANALYTICS-SC-004';
  // A cut-off page list cannot prove a page is missing from it.
  if (!detail.pagesComplete) return nothingToJudge(ruleId);
  const shown = new Set(
    detail.pages.filter((row) => row.impressions > 0).flatMap((row) => keyOf(row)),
  );
  const applicable = input.pages.filter(
    (page) => page.indexable && isInPropertyScope(summary.siteUrl, page.url),
  );
  const unseen = applicable.filter((page) => !shown.has(pageKey(page.url) ?? page.url));
  return {
    ruleId,
    ran: true,
    applicableTargets: applicable.length,
    affectedTargets: unseen.length,
    checkedTargets: applicable.map((page) => normalizeUrl(page.url)),
    findings: unseen.map((page) => ({
      ruleId,
      targetKind: 'page',
      targetUrl: page.url,
      evidenceType: 'mixed',
      evidence: findingMessage('analytics-sc-004.evidence', {}),
      recommendation: findingMessage('analytics-sc-004.recommendation', {}),
    })),
  };
}

function keyOf(row: SearchConsoleRow): readonly string[] {
  const key = pageKey(row.key);
  return key === null ? [] : [key];
}

/**
 * One row per page. Search Console can list one page under two spellings (a
 * scheme or a trailing slash apart); the busier spelling speaks for it, and a
 * key that is not a URL is dropped rather than reported as a page.
 */
export function uniqueByPage(rows: readonly SearchConsoleRow[]): readonly SearchConsoleRow[] {
  const byKey = new Map<string, SearchConsoleRow>();
  for (const row of rows) {
    const key = pageKey(row.key);
    const seen = key === null ? undefined : byKey.get(key);
    if (key !== null && (seen === undefined || row.impressions > seen.impressions)) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}
