// Turns one finished crawl into the record the report reads (§15 coverage).
//
// The crawler answers "what did I fetch"; the tariff and the owner's settings
// answer "what was I allowed to fetch". Only together do they say whether a
// gap in the audit is the site's, the plan's, or the owner's own — and a report
// that cannot tell those apart ends up blaming the site for a limit we set.

import type { CrawlSummary, Plan, ScanScopeInput } from '@fluxradar/contracts';
import { TARIFFS } from '@fluxradar/contracts';
import type { CrawlResult } from '@fluxradar/crawler';
import { assessSiteReach, crawlCoverage } from '@fluxradar/crawler';

/** At most this many header signals are kept as evidence (contract bound). */
const MAX_ACCESS_CONTROL_SIGNALS = 10;

export function buildCrawlSummary(
  crawlResult: CrawlResult,
  origin: string,
  scope: ScanScopeInput,
  plan: Plan,
  maxPages: number,
): CrawlSummary {
  const coverage = crawlCoverage(crawlResult);
  const reach = assessSiteReach(crawlResult, origin);
  return {
    reach: reach.kind,
    startStatus: reach.startStatus,
    accessControlSignals: reach.accessControlSignals.slice(0, MAX_ACCESS_CONTROL_SIGNALS),
    pagesRead: coverage.pagesRead,
    pagesFetched: coverage.pagesFetched,
    urlsDiscovered: coverage.urlsDiscovered,
    urlsOverLimit: coverage.urlsOverLimit,
    urlsBlockedByRobots: coverage.urlsBlockedByRobots,
    limitedBy: limitedBy(coverage.urlsOverLimit, scope, plan),
    maxPages,
  };
}

/**
 * Who stopped the crawl, when addresses were left unread.
 *
 * Only asked when something actually was left over: a crawl that read
 * everything it found was limited by nothing, whatever ceilings existed above
 * it. When something was left over, the owner's own setting wins the attribution
 * — it is the one they can change, and calling their 15-page choice a plan
 * limit would send them to the pricing page for a problem they created.
 */
function limitedBy(
  urlsOverLimit: number,
  scope: ScanScopeInput,
  plan: Plan,
): CrawlSummary['limitedBy'] {
  if (urlsOverLimit === 0) return null;
  const { urlLimit } = TARIFFS[plan];
  return scope.maxPages !== undefined && scope.maxPages < urlLimit ? 'owner' : 'plan';
}
