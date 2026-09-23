// Which egress locations are up right now.
//
// D-225 watched one proxy: at boot, every five minutes, and before a scan's
// first request. With a choice of locations (D-228) the same question is asked
// of each of them, and the answer decides two things beyond a log line: a
// location that is down is not offered on the launch screen, and a launch that
// names one is refused rather than accepted and failed later.
//
// The last answer per location is kept in memory. It is a cache of a probe, not
// a record of anything — a restarted process asks again before it answers.

import type { EgressProxy } from '@fluxradar/safe-fetch';

import type { ApiLogger } from '../http/logger.ts';
import { defaultEgressLocation, type ConfiguredEgressLocation } from './crawl-egress-config.ts';
import {
  isEgressUsable,
  logEgressHealth,
  probeEgressProxy,
  type EgressHealth,
  type EgressProbeOptions,
} from './crawl-egress-health.ts';

/**
 * How long an answer is trusted without asking again.
 *
 * Twice the periodic interval, so the timer normally refreshes an answer well
 * before it goes stale, and a process whose timer has not fired yet (a fresh
 * boot, a test) asks on demand instead of answering from nothing.
 */
export const EGRESS_HEALTH_MAX_AGE_MS = 10 * 60 * 1000;

export type EgressProbe = (
  proxy: EgressProxy | null,
  options: EgressProbeOptions,
) => Promise<EgressHealth>;

export interface EgressLocationStatus {
  readonly configured: ConfiguredEgressLocation;
  readonly health: EgressHealth;
}

export interface EgressLocationMonitor {
  /** Every location this deployment has a proxy for, in registry order. */
  readonly configured: readonly ConfiguredEgressLocation[];
  /** Where a scan goes when nobody chose (`defaultEgressLocation`). */
  readonly defaultLocation: ConfiguredEgressLocation | null;
  find(id: string): ConfiguredEgressLocation | null;
  /** Probes every location now, and records and logs each answer. */
  checkAll(): Promise<readonly EgressLocationStatus[]>;
  /** The latest answer for one location, asking first when it has none recent. */
  healthOf(configured: ConfiguredEgressLocation): Promise<EgressHealth>;
  /** The locations a launch may choose right now: configured and answering. */
  available(): Promise<readonly ConfiguredEgressLocation[]>;
}

export interface EgressLocationMonitorOptions {
  readonly locations: readonly ConfiguredEgressLocation[];
  readonly logger: ApiLogger;
  readonly now?: () => Date;
  /** Test seam; production uses `probeEgressProxy`. */
  readonly probe?: EgressProbe;
  readonly probeOptions?: Pick<EgressProbeOptions, 'probeUrl'>;
}

export function createEgressLocationMonitor(
  options: EgressLocationMonitorOptions,
): EgressLocationMonitor {
  const now = options.now ?? ((): Date => new Date());
  const probe = options.probe ?? probeEgressProxy;
  const { locations, logger } = options;
  // Replaced, never edited, so a reader holding the previous map keeps a
  // consistent view while a check is being recorded.
  let latest: ReadonlyMap<string, EgressHealth> = new Map();
  // One probe per location at a time: a launch that arrives while the timer's
  // check is in flight waits for that answer instead of sending a second one.
  let inFlight: ReadonlyMap<string, Promise<EgressHealth>> = new Map();

  const probeNow = (configured: ConfiguredEgressLocation): Promise<EgressHealth> => {
    const id = configured.location.id;
    const running = inFlight.get(id);
    if (running !== undefined) return running;
    const pending = probe(configured.proxy, {
      ...options.probeOptions,
      expectedIp: configured.expectedIp,
    })
      .then((health) => {
        latest = new Map([...latest, [id, health]]);
        logEgressHealth(logger, health, id);
        return health;
      })
      .finally(() => {
        inFlight = new Map([...inFlight].filter(([key]) => key !== id));
      });
    inFlight = new Map([...inFlight, [id, pending]]);
    return pending;
  };

  const healthOf = async (configured: ConfiguredEgressLocation): Promise<EgressHealth> => {
    const known = latest.get(configured.location.id);
    if (
      known !== undefined &&
      now().getTime() - known.checkedAt.getTime() <= EGRESS_HEALTH_MAX_AGE_MS
    ) {
      return known;
    }
    return probeNow(configured);
  };

  return {
    configured: locations,
    defaultLocation: defaultEgressLocation(locations),
    find: (id) => locations.find((configured) => configured.location.id === id) ?? null,
    checkAll: async () =>
      Promise.all(
        locations.map(async (configured) => ({ configured, health: await probeNow(configured) })),
      ),
    healthOf,
    available: async () => {
      const statuses = await Promise.all(
        locations.map(async (configured) => ({ configured, health: await healthOf(configured) })),
      );
      return statuses
        .filter((status) => isEgressUsable(status.health))
        .map((status) => status.configured);
    },
  };
}
