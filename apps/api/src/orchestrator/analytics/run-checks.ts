// Runs the Analytics checks (D-219). Each reads one source: the Search Console
// checks and the top-pages list need Search Console data, the two GA4 checks
// need GA4 data. A check whose source gave nothing did not run, which is what
// the module's coverage counts.

import { rulesForModule } from '@fluxradar/contracts';

import { googleTagCoverage, keyEventsRecorded } from './ga-checks.ts';
import {
  crawledPagesWithoutImpressions,
  firstPageWithoutClicks,
  impressionsWithoutClicks,
  nearTopQueries,
  organicTrend,
  type QueryOpportunity,
  type TrendDetail,
} from './search-checks.ts';
import { findingsOnTopPages, type TopPageFindings } from './top-pages-check.ts';
import {
  ANALYTICS_MODULE,
  notRun,
  type AnalyticsCheck,
  type AnalyticsCheckInput,
} from './types.ts';

/** Every Analytics rule, in registry order — the order the report lists them in. */
export const ANALYTICS_RULE_IDS: readonly string[] = rulesForModule(ANALYTICS_MODULE).map(
  (rule) => rule.ruleId,
);

/** What the report shows beside the check list. */
export interface AnalyticsAnalysis {
  readonly trend: TrendDetail | null;
  readonly nearTop: readonly QueryOpportunity[];
  readonly topPages: readonly TopPageFindings[];
}

export interface AnalyticsRun {
  /** One entry per rule of ANALYTICS_RULE_IDS, in that order. */
  readonly checks: readonly AnalyticsCheck[];
  readonly analysis: AnalyticsAnalysis;
}

/** The Search Console half: its checks only, and all of the analysis. */
interface SearchConsoleRun {
  readonly checks: readonly AnalyticsCheck[];
  readonly analysis: AnalyticsAnalysis;
}

const NO_ANALYSIS: AnalyticsAnalysis = { trend: null, nearTop: [], topPages: [] };

export function runAnalyticsChecks(input: AnalyticsCheckInput): AnalyticsRun {
  const search = searchConsoleChecks(input);
  const ga4 = input.snapshot.analytics.data;
  const gaChecks = ga4 === null ? [] : [keyEventsRecorded(input, ga4), googleTagCoverage(input)];
  const byRule = new Map(
    [...search.checks, ...gaChecks].map((check) => [check.ruleId, check] as const),
  );
  return {
    checks: ANALYTICS_RULE_IDS.map((ruleId) => byRule.get(ruleId) ?? notRun(ruleId)),
    analysis: search.analysis,
  };
}

function searchConsoleChecks(input: AnalyticsCheckInput): SearchConsoleRun {
  const summary = input.snapshot.searchConsole.data;
  const detail = input.searchConsoleDetail;
  if (summary === null || detail === null) {
    return { checks: [], analysis: NO_ANALYSIS };
  }
  const trend = organicTrend(input, summary);
  const nearTop = nearTopQueries(detail);
  const topPages = findingsOnTopPages(input, detail);
  return {
    checks: [
      trend.check,
      firstPageWithoutClicks(detail),
      nearTop.check,
      crawledPagesWithoutImpressions(input, summary, detail),
      impressionsWithoutClicks(input, summary),
      topPages.check,
    ],
    analysis: { trend: trend.trend, nearTop: nearTop.queries, topPages: topPages.pages },
  };
}
