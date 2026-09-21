// The places a crawl can leave from.
//
// A site can answer a visitor from Kyiv differently from one in Frankfurt — the
// language it serves, where it redirects, which consent banner it shows, whether
// it lets them in at all — so where the crawl leaves from is part of what a
// report measured (D-228). This file is the list of places that exist. Which of
// them this deployment has a proxy for is read from the environment
// (crawl-egress-config.ts); which of those are up right now is the monitor's
// answer (crawl-egress-monitor.ts).
//
// Adding a country is one entry here plus its variable — nothing in the rules,
// the crawler or the orchestrator changes. An entry is never removed once a scan
// has recorded it: an old report reads its country and city from here, and an
// id that is gone reads as a bare code. A location that is retired simply loses
// its variable.

import { DEFAULT_EGRESS_LOCATION, egressLocationIdSchema } from '@fluxradar/contracts';

/** What a location is called, in both languages the product speaks. */
export interface EgressLocationLabel {
  readonly en: string;
  readonly uk: string;
}

export interface EgressLocationDefinition {
  /** The id a scan scope records, as `egressLocationIdSchema` reads it. */
  readonly id: string;
  /** ISO 3166-1 alpha-2, for operators and for the API response. */
  readonly countryCode: string;
  /** In English, for log lines. The interface reads `label`. */
  readonly city: string;
  /** Country and city, as the launch screen and the report print them. */
  readonly label: EgressLocationLabel;
  /** The variable holding `http://user:password@host:port` for this location. */
  readonly proxyEnvVar: string;
  /** The address the internet should see through it; absent skips that check. */
  readonly expectedIpEnvVar: string;
  /** The hosting plan's monthly traffic allowance, in bytes. */
  readonly monthlyTrafficBytes: number;
}

/** Every proxy variable that is not the legacy one starts with this. */
export const EGRESS_PROXY_ENV_PREFIX = 'CRAWL_EGRESS_PROXY_URL_';
const EGRESS_EXPECTED_IP_ENV_PREFIX = 'CRAWL_EGRESS_EXPECTED_IP_';

/** 1 TB: what the Kyiv VPS plan sells, and a sane default for the next one. */
export const DEFAULT_MONTHLY_TRAFFIC_BYTES = 1_000_000_000_000;

/** `de-fra` → `DE_FRA`, the suffix of that location's variables. */
export function envSuffixOf(id: string): string {
  return id.toUpperCase().replaceAll('-', '_');
}

/**
 * A registry entry whose variables follow the convention:
 * `CRAWL_EGRESS_PROXY_URL_<CODE>` and `CRAWL_EGRESS_EXPECTED_IP_<CODE>`.
 */
export function egressLocation(
  entry: Pick<EgressLocationDefinition, 'id' | 'countryCode' | 'city' | 'label'> &
    Partial<Pick<EgressLocationDefinition, 'monthlyTrafficBytes'>>,
): EgressLocationDefinition {
  const id = egressLocationIdSchema.parse(entry.id);
  return {
    monthlyTrafficBytes: DEFAULT_MONTHLY_TRAFFIC_BYTES,
    ...entry,
    id,
    proxyEnvVar: `${EGRESS_PROXY_ENV_PREFIX}${envSuffixOf(id)}`,
    expectedIpEnvVar: `${EGRESS_EXPECTED_IP_ENV_PREFIX}${envSuffixOf(id)}`,
  };
}

/**
 * Every location, in the order the launch screen lists them.
 *
 * Ukraine keeps the variable names it had before there was a choice, so a
 * deployment that sets only `CRAWL_EGRESS_PROXY_URL` goes on crawling from
 * exactly where it did (D-220).
 */
export const EGRESS_LOCATIONS: readonly EgressLocationDefinition[] = [
  {
    ...egressLocation({
      id: DEFAULT_EGRESS_LOCATION,
      countryCode: 'UA',
      city: 'Kyiv',
      label: { en: 'Ukraine, Kyiv', uk: 'Україна, Київ' },
    }),
    proxyEnvVar: 'CRAWL_EGRESS_PROXY_URL',
    expectedIpEnvVar: 'CRAWL_EGRESS_EXPECTED_IP',
  },
];

export function findEgressLocation(
  id: string,
  registry: readonly EgressLocationDefinition[] = EGRESS_LOCATIONS,
): EgressLocationDefinition | null {
  return registry.find((location) => location.id === id) ?? null;
}

/** A location as the API describes it to the browser: no variables, no proxy. */
export interface EgressLocationView {
  readonly id: string;
  /** Null for an id this registry no longer knows. */
  readonly countryCode: string | null;
  readonly city: string | null;
  readonly label: EgressLocationLabel | null;
}

/**
 * The view of a recorded location, or null when none was recorded.
 *
 * An id the registry does not know is still returned, as itself: a scan did
 * record it, and saying "not recorded" would be as untrue as inventing a city.
 */
export function egressLocationView(
  id: string | null | undefined,
  registry: readonly EgressLocationDefinition[] = EGRESS_LOCATIONS,
): EgressLocationView | null {
  if (id === null || id === undefined) return null;
  const location = findEgressLocation(id, registry);
  return {
    id,
    countryCode: location?.countryCode ?? null,
    city: location?.city ?? null,
    label: location?.label ?? null,
  };
}
