// ANALYTICS-LINK-001: the pages that earn the most search impressions, next to
// the findings the rest of the report raised on them — which checks, by rule
// id, the same id the Issue Center shows and searches by. The findings already
// cost their own sections; this check only says which of them sit where the
// traffic is, so it is informational and adds no penalty (D-219).

import { SEVERITY_WEIGHTS, type Severity } from '@fluxradar/contracts';

import type { SearchConsoleDetail } from '../../integrations/google/types.ts';
import { pageKey } from './page-match.ts';
import { uniqueByPage } from './search-checks.ts';
import type { AnalyticsCheck, AnalyticsCheckInput, ReportIssue } from './types.ts';

const TOP_PAGE_LIMIT = 10;
/** Enough to say what to open in the Issue Center without turning into its list. */
const RULE_ID_LIMIT = 5;

export interface TopPageFindings {
  readonly url: string;
  readonly impressions: number;
  readonly clicks: number;
  readonly findings: number;
  /** The most severe of those findings; null when the page has none. */
  readonly highestSeverity: Severity | null;
  /** The checks that found them, most severe first, at most RULE_ID_LIMIT. */
  readonly ruleIds: readonly string[];
}

export function findingsOnTopPages(
  input: AnalyticsCheckInput,
  detail: SearchConsoleDetail,
): { readonly check: AnalyticsCheck; readonly pages: readonly TopPageFindings[] } {
  const issuesByPage = groupByPage(input.reportIssues);
  const pages = uniqueByPage(detail.pages)
    .filter((row) => row.impressions > 0)
    .toSorted((left, right) => right.impressions - left.impressions)
    .slice(0, TOP_PAGE_LIMIT)
    .map((row) => {
      const issues = issuesByPage.get(pageKey(row.key) ?? '') ?? [];
      return {
        url: row.key,
        impressions: row.impressions,
        clicks: row.clicks,
        findings: issues.length,
        highestSeverity: highestSeverity(issues),
        ruleIds: ruleIdsBySeverity(issues),
      };
    });
  return {
    pages,
    check: {
      ruleId: 'ANALYTICS-LINK-001',
      ran: true,
      applicableTargets: pages.length,
      affectedTargets: pages.filter((page) => page.findings > 0).length,
      findings: [],
    },
  };
}

function groupByPage(issues: readonly ReportIssue[]): ReadonlyMap<string, readonly ReportIssue[]> {
  const groups = new Map<string, readonly ReportIssue[]>();
  for (const issue of issues) {
    const key = pageKey(issue.normalizedUrl);
    if (key !== null) groups.set(key, [...(groups.get(key) ?? []), issue]);
  }
  return groups;
}

function ruleIdsBySeverity(issues: readonly ReportIssue[]): readonly string[] {
  const ordered = issues.toSorted(
    (left, right) => SEVERITY_WEIGHTS[right.severity] - SEVERITY_WEIGHTS[left.severity],
  );
  return [...new Set(ordered.map((issue) => issue.ruleId))].slice(0, RULE_ID_LIMIT);
}

function highestSeverity(issues: readonly ReportIssue[]): Severity | null {
  return issues.reduce<Severity | null>(
    (highest, issue) =>
      highest === null || SEVERITY_WEIGHTS[issue.severity] > SEVERITY_WEIGHTS[highest]
        ? issue.severity
        : highest,
    null,
  );
}
