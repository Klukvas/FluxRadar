// Which egress location a new scan will leave from, decided at launch.
//
// The owner chooses a country on the launch screen (D-228), and the choice is
// checked here against this deployment rather than trusted: a location that is
// not configured, or whose proxy is not answering, refuses the launch with a
// reason. Accepting it would leave two bad outcomes — crawl from somewhere else
// and print the wrong country on the report (the silent substitution D-220
// forbids), or take the purchase and fail the scan on our own outage.
//
// Every scan path goes through here: the Free check, the FastSpring checkout,
// the internal and mock checkouts. What it returns is written into the scope,
// so the stored execution config records the location actually used.
//
// That is enforced by type rather than by each caller remembering it: the
// functions that create a scan or a checkout session take a `LaunchEgress`,
// and only `resolveLaunchEgressLocation` makes one. A new caller cannot hand
// them an id nobody checked.

import type { ScanScopeInput } from '@fluxradar/contracts';

import { ApiError } from '../http/errors.ts';
import type { ConfiguredEgressLocation } from '../integrations/crawl-egress-config.ts';
import { isEgressUsable } from '../integrations/crawl-egress-health.ts';
import type { EgressLocationView } from '../integrations/crawl-egress-locations.ts';
import type { EgressLocationMonitor } from '../integrations/crawl-egress-monitor.ts';

export const EGRESS_LOCATION_UNKNOWN = 'EGRESS_LOCATION_UNKNOWN';
export const EGRESS_LOCATION_UNAVAILABLE = 'EGRESS_LOCATION_UNAVAILABLE';

declare const checkedAtLaunch: unique symbol;

/**
 * Where a new scan leaves from, as checked at launch: a configured location
 * that answered, or null for a deployment that crawls directly. Branded, so
 * the only way to hold one is to have gone through `resolveLaunchEgressLocation`.
 */
export interface LaunchEgress {
  readonly location: ConfiguredEgressLocation | null;
  readonly [checkedAtLaunch]: true;
}

/**
 * The configured location a launch leaves from, or null for a deployment that
 * crawls directly. `requested` absent means "the default" — what a Free check
 * and an older client get; it never means "any location that happens to be up".
 */
export async function resolveLaunchEgressLocation(
  monitor: EgressLocationMonitor,
  requested: string | undefined,
): Promise<LaunchEgress> {
  if (requested === undefined && monitor.configured.length === 0) return checked(null);
  const chosen = requested === undefined ? monitor.defaultLocation : monitor.find(requested);
  if (chosen === null) {
    throw new ApiError(
      400,
      EGRESS_LOCATION_UNKNOWN,
      `Checks from "${requested ?? ''}" are not offered here. Choose one of the countries on the launch screen.`,
    );
  }
  const health = await monitor.healthOf(chosen);
  if (!isEgressUsable(health)) {
    throw new ApiError(
      503,
      EGRESS_LOCATION_UNAVAILABLE,
      `Checks from ${chosen.location.label.en} are unavailable right now: the network they leave from is not answering. Nothing was charged. Try again in a few minutes.`,
    );
  }
  return checked(chosen);
}

function checked(location: ConfiguredEgressLocation | null): LaunchEgress {
  return { location } as LaunchEgress;
}

/**
 * The scope as it will be stored: naming the location that was checked, and
 * nothing else. Whatever location the request carried is replaced — or
 * dropped, for a direct crawl — so a stored scope can only ever name a
 * location that answered at launch.
 */
export function scopeWithEgressLocation(
  scope: ScanScopeInput,
  egress: LaunchEgress,
): ScanScopeInput {
  return { ...scope, egressLocation: egress.location?.location.id };
}

/** What the launch screen is told about the locations it may offer. */
export interface EgressLaunchConfig {
  /**
   * `direct` when this deployment has no egress location at all — the crawl
   * leaves from the server itself and there is nothing to choose.
   */
  readonly mode: 'direct' | 'proxy';
  /** Configured and answering, in registry order. Only these are offered. */
  readonly locations: readonly EgressLocationView[];
  /** Where a scan goes when nobody chose; null for a direct deployment. */
  readonly defaultLocationId: string | null;
}

export async function egressLaunchConfig(
  monitor: EgressLocationMonitor,
): Promise<EgressLaunchConfig> {
  const available = await monitor.available();
  return {
    mode: monitor.configured.length === 0 ? 'direct' : 'proxy',
    locations: available.map(({ location }) => ({
      id: location.id,
      countryCode: location.countryCode,
      city: location.city,
      label: location.label,
    })),
    defaultLocationId: monitor.defaultLocation?.location.id ?? null,
  };
}
