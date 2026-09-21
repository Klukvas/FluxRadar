// Which network one crawl leaves from.
//
// Three inputs decide it, in this order:
//
//   1. an explicit override on the attempt (a test that states the network it
//      wants, including `null` for "no proxy");
//   2. the loopback test seam — a fixture site on 127.0.0.1 is unreachable from
//      an outside proxy, so a developer with the production value in .env must
//      not watch every local scan fail for a reason no report can explain;
//   3. what the environment configures (integrations/crawl-egress-config.ts).
//
// The order matters: an explicit override used to lose to the loopback rule,
// which made the override unreachable in exactly the tests it exists for.

import type { EgressProxy } from '@fluxradar/safe-fetch';

import type { WorkerCrawlOptions } from './deps.ts';

export function resolveEgressProxy(
  crawl: WorkerCrawlOptions | undefined,
  configured: EgressProxy | null,
): EgressProxy | null {
  if (crawl?.egressProxy !== undefined) return crawl.egressProxy;
  if (crawl?.dangerouslyAllowLoopback === true) return null;
  return configured;
}
