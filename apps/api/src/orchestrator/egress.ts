// Which network one crawl leaves from.
//
// Four inputs decide it, in this order:
//
//   1. an explicit override on the attempt (a test that states the network it
//      wants, including `null` for "no proxy");
//   2. the loopback test seam — a fixture site on 127.0.0.1 is unreachable from
//      an outside proxy, so a developer with the production value in .env must
//      not watch every local scan fail for a reason no report can explain;
//   3. the egress location the scan recorded at launch (D-228) — which must
//      still be configured, because crawling it from anywhere else would make
//      the report lie about where it was measured from;
//   4. for a scan that recorded none (it predates the choice), the default
//      location, which is where every such scan went before.
//
// The order matters: an explicit override used to lose to the loopback rule,
// which made the override unreachable in exactly the tests it exists for.

import type { EgressProxy } from '@fluxradar/safe-fetch';

import {
  defaultEgressLocation,
  type ConfiguredEgressLocation,
} from '../integrations/crawl-egress-config.ts';
import type { WorkerCrawlOptions } from './deps.ts';

export interface ScanEgress {
  readonly proxy: EgressProxy | null;
  /**
   * The configured location the crawl crosses, whose health is checked and
   * whose traffic is counted. Null for a direct crawl and for a test override,
   * neither of which is a location anyone chose.
   */
  readonly location: ConfiguredEgressLocation | null;
}

/** A scan's recorded location that this deployment can no longer crawl from. */
export class EgressLocationNotConfiguredError extends Error {
  readonly locationId: string;

  constructor(locationId: string) {
    super(`egress location "${locationId}" is not configured in this deployment`);
    this.name = 'EgressLocationNotConfiguredError';
    this.locationId = locationId;
  }
}

export function resolveScanEgress(
  crawl: WorkerCrawlOptions | undefined,
  recordedLocation: string | undefined,
  configured: readonly ConfiguredEgressLocation[],
): ScanEgress {
  if (crawl?.egressProxy !== undefined) return { proxy: crawl.egressProxy, location: null };
  if (crawl?.dangerouslyAllowLoopback === true) return { proxy: null, location: null };
  const location =
    recordedLocation === undefined
      ? defaultEgressLocation(configured)
      : (configured.find((entry) => entry.location.id === recordedLocation) ?? null);
  if (recordedLocation !== undefined && location === null) {
    // Not a direct crawl in its place: that is the silent substitution D-220
    // forbids. The attempt fails as ours, and the worker treats it that way.
    throw new EgressLocationNotConfiguredError(recordedLocation);
  }
  return { proxy: location?.proxy ?? null, location };
}
