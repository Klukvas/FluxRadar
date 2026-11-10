// Where a check leaves from, as the launch screen and the report see it.
//
// Which countries exist, and which of them are answering, is the server's
// answer (`GET /scans/launch-config`), not something built into this bundle:
// the same build serves a deployment with one proxy and one with five, and a
// country whose network went down five minutes ago must stop being offered
// without a release (D-228).

import { useEffect, useState } from 'react';

import { apiRequest, type EgressLaunchConfig, type EgressLocation, type LaunchConfig } from './api';
import { suggestEgressLocationId } from './egress-suggestion';
import type { Language } from './i18n';
import { reportLanguage } from './report-language';

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

/**
 * The Russian name of a place the API names in English and Ukrainian only.
 *
 * A country is a proper noun, and the label it sits in is chrome ("Страна
 * проверки"), so «Украина, Киев» is what a Russian reader should read there,
 * not «Україна, Київ». Keyed by the id a scan records, which is the stable
 * part; a location added to the API and not to this list keeps reading in
 * Ukrainian until it is named here, which is the honest fallback.
 */
const RUSSIAN_EGRESS_LABELS: Readonly<Record<string, string>> = {
  ua: 'Украина, Киев',
  us: 'США, Меса (Аризона)',
  gb: 'Великобритания, Лондон',
  ca: 'Канада, Монреаль',
};

/**
 * "Україна, Київ" in the reader's language, or the bare code for an id the API
 * no longer knows.
 *
 * Takes the interface language, not the report's: where the place is printed,
 * the words around it are the app's own. The printed report still reads
 * Ukrainian, because every caller inside it is handed a `ReportLanguage`.
 */
export function egressLocationLabel(location: EgressLocation, language: Language): string {
  if (language === 'ru') {
    const russian = RUSSIAN_EGRESS_LABELS[location.id];
    if (russian !== undefined) return russian;
  }
  return location.label?.[reportLanguage(language)] ?? location.id.toUpperCase();
}

/**
 * The location a launch will ask for: the owner's choice while it is on offer,
 * else the one suggested for the site (`suggestEgressLocationId`), else the
 * default, else the first location that is answering.
 *
 * A saved choice that is not on offer right now (its network is down) is not
 * silently replaced on the server — the screen shows the location it will
 * actually send, so the substitution happens where the owner can see it.
 */
export function effectiveEgressLocation(
  chosen: string,
  config: EgressLaunchConfig | null,
  suggestedId: string | null = null,
): EgressLocation | null {
  if (config === null) return null;
  const offered = (id: string | null): EgressLocation | undefined =>
    config.locations.find((location) => location.id === id);
  return (
    offered(chosen) ??
    offered(suggestedId) ??
    offered(config.defaultLocationId) ??
    config.locations[0] ??
    null
  );
}

/**
 * The country every profile saved before the choice existed carries without
 * anyone having chosen it: Kyiv was the only location, and new profiles were
 * written with it. Read as "not chosen" until the owner picks it here, so an
 * old UK or US site is offered its own country instead of staying on Kyiv.
 */
const AUTO_SAVED_EGRESS_LOCATION = 'ua';

/** The owner's choice of country, with the auto-saved Kyiv read as none. */
export function ownerEgressChoice(saved: string, pickedOnThisScreen: boolean): string {
  return !pickedOnThisScreen && saved === AUTO_SAVED_EGRESS_LOCATION ? '' : saved;
}

/**
 * The country a site with no saved choice is checked from: the one its domain
 * points to (.co.uk, .ca), else the browser's locale, else the United States —
 * among the locations answering now.
 */
export function suggestedEgressLocationId(
  site: string | undefined,
  config: EgressLaunchConfig | null,
  visitorLocales: readonly string[] = browserLocales(),
): string | null {
  if (config === null || site === undefined) return null;
  return suggestEgressLocationId(
    site,
    config.locations.map((location) => location.id),
    visitorLocales,
  );
}

function browserLocales(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages.length > 0 ? navigator.languages : [navigator.language];
}
