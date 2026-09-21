// Which networks the crawler's requests can leave from.
//
// The API runs on a hosting network that some audited sites block outright,
// and a blocked crawl does not look like a blocked crawl in a report — it looks
// like a site with no robots.txt that never answers 200. Each egress location
// (crawl-egress-locations.ts) points the crawl at a proxy on a network those
// sites accept, and the owner chooses which one a scan leaves from (D-228).
//
// No location at all is a valid, supported state: the crawl goes out directly,
// exactly as it did before any proxy existed. A variable that is present but
// unusable is not: it would silently drop a country, or fall back to the
// blocked network, so it fails the boot by NAME. So does a proxy variable for a
// location nobody registered — the operator meant a country to appear, and it
// would not. Values are URLs with passwords in them and are never logged.

import { isIP } from 'node:net';

import { DEFAULT_EGRESS_LOCATION } from '@fluxradar/contracts';
import type { EgressProxy } from '@fluxradar/safe-fetch';
import { parseEgressProxyUrl, ProxyConfigError } from '@fluxradar/safe-fetch';

import {
  EGRESS_LOCATIONS,
  EGRESS_PROXY_ENV_PREFIX,
  type EgressLocationDefinition,
} from './crawl-egress-locations.ts';

/** One location this deployment can actually crawl from. */
export interface ConfiguredEgressLocation {
  readonly location: EgressLocationDefinition;
  readonly proxy: EgressProxy;
  /** The address the internet should see through this proxy, when stated. */
  readonly expectedIp: string | null;
}

export type CrawlEgressConfigResult =
  | { readonly state: 'configured'; readonly locations: readonly ConfiguredEgressLocation[] }
  | { readonly state: 'not_configured' }
  | { readonly state: 'invalid'; readonly missing: readonly string[]; readonly reason: string };

interface VariableFailure {
  readonly variable: string;
  readonly reason: string;
}

type LocationReading =
  | { readonly kind: 'absent' }
  | { readonly kind: 'configured'; readonly configured: ConfiguredEgressLocation }
  | { readonly kind: 'invalid'; readonly failure: VariableFailure };

export function readCrawlEgressConfig(
  env: NodeJS.ProcessEnv = process.env,
  registry: readonly EgressLocationDefinition[] = EGRESS_LOCATIONS,
): CrawlEgressConfigResult {
  const readings = registry.map((location) => readLocation(location, env));
  const failures = [
    ...readings.flatMap((reading) => (reading.kind === 'invalid' ? [reading.failure] : [])),
    ...unregisteredProxyVariables(env, registry),
  ];
  if (failures.length > 0) {
    return {
      state: 'invalid',
      missing: failures.map((failure) => failure.variable),
      reason: failures.map((failure) => failure.reason).join('; '),
    };
  }
  const locations = readings.flatMap((reading) =>
    reading.kind === 'configured' ? [reading.configured] : [],
  );
  return locations.length === 0 ? { state: 'not_configured' } : { state: 'configured', locations };
}

/**
 * The locations to crawl from, in registry order; empty for a direct crawl.
 *
 * A location whose variable is unusable is left out here rather than guessed
 * at — production never reaches this function with one, because
 * `validateRuntimeConfig` refuses to boot on it first.
 */
export function readCrawlEgressLocations(
  env: NodeJS.ProcessEnv = process.env,
  registry: readonly EgressLocationDefinition[] = EGRESS_LOCATIONS,
): readonly ConfiguredEgressLocation[] {
  return registry.flatMap((location) => {
    const reading = readLocation(location, env);
    return reading.kind === 'configured' ? [reading.configured] : [];
  });
}

/**
 * Where a scan goes when nobody chose — a Free check, an older client, a scan
 * that predates the choice: the default location when it is configured, else
 * the first one that is, else null for a deployment that crawls directly.
 */
export function defaultEgressLocation(
  configured: readonly ConfiguredEgressLocation[],
): ConfiguredEgressLocation | null {
  return (
    configured.find((entry) => entry.location.id === DEFAULT_EGRESS_LOCATION) ??
    configured[0] ??
    null
  );
}

function readLocation(location: EgressLocationDefinition, env: NodeJS.ProcessEnv): LocationReading {
  const raw = env[location.proxyEnvVar]?.trim() ?? '';
  if (raw === '') return { kind: 'absent' };
  let proxy: EgressProxy;
  try {
    proxy = parseEgressProxyUrl(raw);
  } catch (error) {
    const reason = error instanceof ProxyConfigError ? error.reason : 'unreadable value';
    return invalid(location.proxyEnvVar, `${location.proxyEnvVar} is set but unusable: ${reason}`);
  }
  const expectedIp = env[location.expectedIpEnvVar]?.trim() ?? '';
  if (expectedIp !== '' && isIP(expectedIp) === 0) {
    // A typo here would read as "wrong egress" on every probe and block every
    // scan from this location, so it is refused at boot instead.
    return invalid(
      location.expectedIpEnvVar,
      `${location.expectedIpEnvVar} is set but is not an IP address`,
    );
  }
  return {
    kind: 'configured',
    configured: { location, proxy, expectedIp: expectedIp === '' ? null : expectedIp },
  };
}

function invalid(variable: string, reason: string): LocationReading {
  return { kind: 'invalid', failure: { variable, reason } };
}

function unregisteredProxyVariables(
  env: NodeJS.ProcessEnv,
  registry: readonly EgressLocationDefinition[],
): readonly VariableFailure[] {
  const known = new Set(registry.map((location) => location.proxyEnvVar));
  return Object.entries(env)
    .filter(
      ([name, value]) =>
        name.startsWith(EGRESS_PROXY_ENV_PREFIX) &&
        !known.has(name) &&
        (value?.trim() ?? '') !== '',
    )
    .map(([name]) => ({
      variable: name,
      reason:
        `${name} is set but no egress location is registered for it ` +
        '(add it to apps/api/src/integrations/crawl-egress-locations.ts)',
    }));
}
