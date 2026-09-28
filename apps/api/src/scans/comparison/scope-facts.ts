// What each of the two crawls was pointed at, and whether that is the same
// thing twice.
//
// The crawl filters already have a fingerprint: `crawlScopeKey`, which the
// Resolved policy compares runs by. It deliberately leaves out `maxPages` and
// `respectRobots`, because a URL dropped by either is still RECORDED by the
// crawl — over-limit and robots-blocked addresses stay in a rule's demand, so
// their loss reads as "no data" rather than as a fix.
//
// A page diff cannot borrow that leniency. A crawl with a lower page ceiling
// simply never read the rest of the site, and every address it did not reach
// would show up as a page the owner removed. Robots is the same story from the
// other side: turning the rule off adds addresses that would read as pages the
// owner published. Same for where the crawl STARTS: a different entry URL or a
// different seed list is a different walk of the site, whatever the filters say.
// And the device, which the fingerprint leaves out because the Resolved policy
// compares it separately — a site with its own mobile layout answers the same
// address with different markup.
//
// So the scope facts carry the fingerprint plus exactly those, and equality is
// asked over all of them.

import type { CrawlScopeFacts, ScanScopeInput } from '@fluxradar/contracts';
import type { Scan } from '@prisma/client';

import { egressLocationView } from '../../integrations/crawl-egress-locations.ts';
import { crawlScopeKey, scanScopeOf } from '../../orchestrator/run-context.ts';

/** The scan's effective scope, as stored on the scan itself. */
export function crawlScopeFactsOf(
  scan: Pick<Scan, 'domain' | 'executionConfigJson' | 'scopeJson'>,
): CrawlScopeFacts {
  const scope: ScanScopeInput = scanScopeOf(scan);
  return {
    entryUrl: scan.domain,
    maxPages: scope.maxPages ?? null,
    maxDepth: scope.maxDepth ?? null,
    includeSubdomains: scope.includeSubdomains,
    queryPolicy: scope.queryPolicy,
    urlPatterns: [...(scope.urlPatterns ?? [])],
    excludePatterns: [...(scope.excludePatterns ?? [])],
    seedUrls: [...(scope.seedUrls ?? [])],
    renderJs: scope.renderJs,
    respectRobots: scope.respectRobots,
    userAgent: scope.userAgent,
    egressLocation: scope.egressLocation ?? null,
    // The id is what equality is asked over; this is the same id as the reader
    // is shown it. The registry lives here and not in the browser, so a scope
    // row that carried only the id could print "UA" beside a report header
    // reading "Ukraine, Kyiv" (D-228).
    egressLocationView: egressLocationView(scope.egressLocation),
    scopeKey: crawlScopeKey(scope),
  };
}

/** Order and duplicates do not change where a crawl starts; the set does. */
function sameUrlSet(left: readonly string[], right: readonly string[]): boolean {
  const normalize = (urls: readonly string[]): string => [...new Set(urls)].toSorted().join('\n');
  return normalize(left) === normalize(right);
}

/**
 * Whether the two crawls were asked for the same pages.
 *
 * False is the honest answer whenever anything above moved: the endpoint then
 * reports `scope-changed` instead of a difference it cannot attribute to the
 * site.
 */
export function sameCrawlScope(current: CrawlScopeFacts, previous: CrawlScopeFacts): boolean {
  return (
    current.scopeKey === previous.scopeKey &&
    current.entryUrl === previous.entryUrl &&
    current.maxPages === previous.maxPages &&
    current.respectRobots === previous.respectRobots &&
    // The fingerprint leaves the device out because it belongs to the request
    // context the Resolved policy compares separately (`sameRequestContext`). It
    // belongs here for the same reason it belongs there: a site with its own
    // mobile layout answers the same address with different markup, so a desktop
    // run and a mobile one are two measurements rather than a trend.
    current.userAgent === previous.userAgent &&
    sameUrlSet(current.seedUrls, previous.seedUrls)
  );
}
