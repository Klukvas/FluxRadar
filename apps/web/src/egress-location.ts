// Where a check leaves from, as the launch screen and the report see it.
//
// Which countries exist, and which of them are answering, is the server's
// answer (`GET /scans/launch-config`), not something built into this bundle:
// the same build serves a deployment with one proxy and one with five, and a
// country whose network went down five minutes ago must stop being offered
// without a release (D-228).

import { useEffect, useState } from 'react';

import { apiRequest, type EgressLaunchConfig, type EgressLocation, type LaunchConfig } from './api';
import type { Language } from './i18n';

export type LaunchConfigState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly egress: EgressLaunchConfig }
  | { readonly status: 'unavailable' };

export function useLaunchConfig(): LaunchConfigState {
  const [state, setState] = useState<LaunchConfigState>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    void apiRequest<unknown>('/scans/launch-config')
      .then((value) => {
        const egress = readEgressLaunchConfig(value);
        if (active)
          setState(egress === null ? { status: 'unavailable' } : { status: 'ready', egress });
        return value;
      })
      .catch((caught: unknown) => {
        // The launch still works without it — the server picks the default
        // location and checks it — so this is a missing list, not a failure.
        console.error('FluxRadar launch configuration unavailable', caught);
        if (active) setState({ status: 'unavailable' });
      });
    return () => {
      active = false;
    };
  }, []);
  return state;
}

/**
 * The egress half of a launch configuration, or null for anything that is not
 * one — an older API, a proxy's error page. A list that cannot be read is
 * treated as missing, never as "no country is available".
 */
export function readEgressLaunchConfig(value: unknown): EgressLaunchConfig | null {
  const egress = (value as Partial<LaunchConfig> | null)?.egress;
  if (typeof egress !== 'object' || egress === null) return null;
  const { mode, locations, defaultLocationId } = egress as Partial<EgressLaunchConfig>;
  if (mode !== 'direct' && mode !== 'proxy') return null;
  if (!Array.isArray(locations) || !locations.every(isEgressLocation)) return null;
  if (defaultLocationId !== null && typeof defaultLocationId !== 'string') return null;
  return { mode, locations, defaultLocationId };
}

function isEgressLocation(value: unknown): value is EgressLocation {
  const location = value as Partial<EgressLocation> | null;
  const label = location?.label;
  return (
    typeof location?.id === 'string' &&
    (label === null ||
      (typeof label === 'object' && typeof label?.en === 'string' && typeof label.uk === 'string'))
  );
}

/** "Україна, Київ" in the reader's language, or the bare code for an id the API no longer knows. */
export function egressLocationLabel(location: EgressLocation, language: Language): string {
  return location.label?.[language] ?? location.id.toUpperCase();
}

/**
 * The location a paid launch will ask for: the owner's choice while it is on
 * offer, else the default, else the first location that is answering.
 *
 * A saved choice that is not on offer right now (its network is down) is not
 * silently replaced on the server — the screen shows the location it will
 * actually send, so the substitution happens where the owner can see it.
 */
export function effectiveEgressLocation(
  chosen: string,
  config: EgressLaunchConfig | null,
): EgressLocation | null {
  if (config === null) return null;
  const offered = (id: string | null): EgressLocation | undefined =>
    config.locations.find((location) => location.id === id);
  return offered(chosen) ?? offered(config.defaultLocationId) ?? config.locations[0] ?? null;
}

/**
 * Where a Free check will leave from: always the default location, which it
 * does not choose — or null while that location is not answering.
 */
export function freeEgressLocation(config: EgressLaunchConfig | null): EgressLocation | null {
  if (config === null) return null;
  return config.locations.find((location) => location.id === config.defaultLocationId) ?? null;
}
