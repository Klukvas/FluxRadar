// The configuration a Free check actually runs with.
//
// `Scan.scopeJson` is the record of what was asked for, and the report, the
// export and the next scan's form all read it. A Free scan used to store the
// same three-word stub whatever the request said, which made that record useless
// — and storing the request verbatim instead would be worse than useless, because
// Free does not honour most of it: `buildCrawlScope` (orchestrator/run-attempt.ts)
// forces the homepage and nothing else, whatever arrives here.
//
// So this is the one function that decides what a Free scan's scope IS, and it
// answers with the settings the crawler will genuinely apply. Anything a Free
// check cannot vary is written at its enforced value rather than at the value
// the caller sent, so nothing downstream can advertise a limit that was never in
// force. The enforcement itself stays where it was; this only makes the stored
// record agree with it.

import type { ScanScopeInput } from '@fluxradar/contracts';
import { scanScopeSchema } from '@fluxradar/contracts';

/**
 * The stored scope for a Free check, from whatever the caller requested.
 *
 * `userAgent` is the only setting Free honours — it is the crawler's request
 * header, which applies to a single page exactly as it applies to a thousand.
 * Everything else is the fixed homepage check: one page, no link following, no
 * subdomains, no patterns, robots.txt respected.
 *
 * The egress location is not the caller's either: a Free check does not choose
 * a country (D-228), so none is copied from the request. `createFreeScan` adds
 * the default location it checked at launch.
 */
export function freeScanScope(requested?: ScanScopeInput): ScanScopeInput {
  return scanScopeSchema.parse({
    includeSubdomains: false,
    maxPages: 1,
    maxDepth: 0,
    queryPolicy: 'ignore',
    respectRobots: true,
    robotsOverrideConfirmed: false,
    userAgent: requested?.userAgent ?? 'desktop',
  });
}
