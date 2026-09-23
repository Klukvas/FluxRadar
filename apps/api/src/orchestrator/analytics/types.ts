// Shared shapes of the Analytics checks (D-219). Each check reads one source —
// Search Console or GA4 — next to the crawl, and reports what it looked at the
// same way a rule of the engine does, so the module scores with the same §15
// formula and the report lists it like any other section.

import type { Severity } from '@fluxradar/contracts';
import type { AnalyticsPageFact, FindingMessageRef } from '@fluxradar/rules';

import type { GoogleDataSnapshot, SearchConsoleDetail } from '../../integrations/google/types.ts';

export const ANALYTICS_MODULE = 'Analytics';

export interface AnalyticsFinding {
  readonly ruleId: string;
  readonly targetKind: 'site' | 'page';
  /** The page for a page-level finding; the site origin for a site-level one. */
  readonly targetUrl: string;
  readonly evidenceType: 'dom' | 'mixed';
  readonly evidence: FindingMessageRef;
  readonly recommendation: FindingMessageRef;
}

export interface AnalyticsCheck {
  readonly ruleId: string;
  /** False when the source the check reads gave no data: it never looked. */
  readonly ran: boolean;
  readonly applicableTargets: number;
  readonly affectedTargets: number;
  readonly findings: readonly AnalyticsFinding[];
  /**
   * What the check actually judged, in the normalization its findings use: page
   * URLs for a page-level check, the site origin for a site-level one.
   *
   * This is the proof the next scan needs before it may call one of these
   * findings fixed (§14, run-coverage.ts). A disconnected integration, a
   * property with no data, or a crawl that never reached the page all make a
   * finding disappear without anything being fixed, and an empty list says so.
   */
  readonly checkedTargets?: readonly string[];
}

/** A finding of another section, reduced to what the top-pages check matches on. */
export interface ReportIssue {
  readonly ruleId: string;
  readonly normalizedUrl: string;
  readonly severity: Severity;
}

export interface AnalyticsCheckInput {
  /** The scan's normalized origin — the domain every fingerprint is built on. */
  readonly origin: string;
  readonly snapshot: GoogleDataSnapshot;
  readonly searchConsoleDetail: SearchConsoleDetail | null;
  /** What the crawl saw; empty when the scan could not hand it over. */
  readonly pages: readonly AnalyticsPageFact[];
  /** Page-level findings of the other sections of the same report. */
  readonly reportIssues: readonly ReportIssue[];
}

/** A check whose source gave no data. */
export function notRun(ruleId: string): AnalyticsCheck {
  return { ruleId, ran: false, applicableTargets: 0, affectedTargets: 0, findings: [] };
}

/** A check that ran but found nothing it could judge: "not applicable". */
export function nothingToJudge(ruleId: string): AnalyticsCheck {
  return { ruleId, ran: true, applicableTargets: 0, affectedTargets: 0, findings: [] };
}

/**
 * A site-level check that judged the site: it passed, or it found one thing
 * about the whole site, reported against the site origin.
 */
export function siteCheck(
  ruleId: string,
  input: AnalyticsCheckInput,
  found: Pick<AnalyticsFinding, 'evidence' | 'recommendation'> | null,
): AnalyticsCheck {
  return {
    ruleId,
    ran: true,
    applicableTargets: 1,
    affectedTargets: found === null ? 0 : 1,
    // The judged target is the site itself: the check had its source's data.
    checkedTargets: [input.origin],
    findings:
      found === null
        ? []
        : [
            {
              ruleId,
              targetKind: 'site',
              targetUrl: input.origin,
              evidenceType: 'mixed',
              ...found,
            },
          ],
  };
}
