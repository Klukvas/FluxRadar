// Rules whose findings live in the GEO summary, not in the Issue Center.
//
// GEO rules are informational (D-109) and never become Issue rows, so a link
// from the Action Plan to "the problem" of one of them must open the AI SEO /
// GEO section, where the summary shows it, rather than an empty Issue Center.

import { moduleChecksId } from './ModuleChecks';

export const GEO_SUMMARY_MODULE = 'AI SEO / GEO';

const GEO_SUMMARY_RULE_IDS: readonly string[] = ['GEO-VIS-007', 'GEO-VIS-009'];

export function opensGeoSummary(ruleId: string): boolean {
  return GEO_SUMMARY_RULE_IDS.includes(ruleId);
}

/** The section the report opens under its card, by scan. */
interface OpenSection {
  readonly scanId: string;
  readonly module: string;
}

/**
 * What "open this problem" does on a report: a GEO summary rule opens the AI
 * SEO / GEO section and scrolls to it; every other rule goes where the report
 * was told to send it (the Issue Center, filtered to the rule).
 */
export function geoAwareProblemOpener(
  report: { readonly onOpenProblem?: (ruleId: string) => void; readonly onIssues: () => void },
  scanId: string,
  openSection: (section: OpenSection) => void,
): (ruleId: string) => void {
  return (ruleId) => {
    if (!opensGeoSummary(ruleId)) {
      (report.onOpenProblem ?? (() => report.onIssues()))(ruleId);
      return;
    }
    openSection({ scanId, module: GEO_SUMMARY_MODULE });
    window.requestAnimationFrame(() => {
      document.getElementById(moduleChecksId(GEO_SUMMARY_MODULE))?.scrollIntoView?.();
    });
  };
}
