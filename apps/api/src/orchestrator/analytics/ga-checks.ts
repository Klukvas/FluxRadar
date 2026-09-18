// The GA4 checks of the Analytics module (D-219). Both use only what the
// report already reads from GA4 — totals for the period — plus the crawl, so
// they add no call to the Google Analytics API.

import { findingMessage } from '@fluxradar/rules';

import type { Ga4Summary } from '../../integrations/google/types.ts';
import {
  nothingToJudge,
  siteCheck,
  type AnalyticsCheck,
  type AnalyticsCheckInput,
} from './types.ts';

/**
 * Any traffic at all and not one key event in 28 days: nothing is marked as a
 * key event, or the events behind them never fire. Only a property with no
 * sessions, or one that does not report the metric, gives nothing to judge.
 */
export function keyEventsRecorded(input: AnalyticsCheckInput, ga4: Ga4Summary): AnalyticsCheck {
  const ruleId = 'ANALYTICS-GA-001';
  if (ga4.keyEvents === null || ga4.sessions === 0) {
    return nothingToJudge(ruleId);
  }
  return siteCheck(
    ruleId,
    input,
    ga4.keyEvents > 0
      ? null
      : {
          evidence: findingMessage('analytics-ga-001.evidence', {
            property: ga4.propertyName ?? ga4.propertyId,
            sessions: ga4.sessions,
          }),
          recommendation: findingMessage('analytics-ga-001.recommendation', {}),
        },
  );
}

/**
 * Pages whose HTML lacks the Google tag the rest of the site carries.
 *
 * Judged only when at least one crawled page has the tag in its HTML: a site
 * whose GA4 has sessions but whose HTML carries no tag anywhere loads it from a
 * script bundle, and calling every page "untagged" would be wrong everywhere.
 */
export function googleTagCoverage(input: AnalyticsCheckInput): AnalyticsCheck {
  const ruleId = 'ANALYTICS-GA-002';
  const tagged = input.pages.filter((page) => page.hasGoogleTag).length;
  if (tagged === 0) return nothingToJudge(ruleId);
  const untagged = input.pages.filter((page) => !page.hasGoogleTag);
  return {
    ruleId,
    ran: true,
    applicableTargets: input.pages.length,
    affectedTargets: untagged.length,
    findings: untagged.map((page) => ({
      ruleId,
      targetKind: 'page',
      targetUrl: page.url,
      evidenceType: 'dom',
      evidence: findingMessage('analytics-ga-002.evidence', {
        tagged,
        checked: input.pages.length,
      }),
      recommendation: findingMessage('analytics-ga-002.recommendation', {}),
    })),
  };
}
