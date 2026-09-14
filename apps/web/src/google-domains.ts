// Which FluxRadar profile each Search Console domain feeds.
//
// The panel configured one selected profile at a time, and turning a domain
// into a profile was offered only to an account with no profile at all. An
// owner with several domains under one Google account and several profiles
// could neither see which domain went where nor link the next one. Each row
// here answers that for one domain.

import type { GoogleBinding, SiteProfile } from './api';
import {
  isDomainProperty,
  originFromSearchConsoleProperty,
  type SearchConsoleOriginProblem,
} from './search-console-origin';

export type GoogleDomainRow =
  /** At least one profile already reads this domain. */
  | {
      readonly kind: 'linked';
      readonly siteUrl: string;
      readonly profiles: readonly [SiteProfile, ...SiteProfile[]];
    }
  /** A profile at this address reads no Search Console domain yet, so it can take this one. */
  | { readonly kind: 'matching'; readonly siteUrl: string; readonly profile: SiteProfile }
  /**
   * The profile at this exact address already reads another domain. A new
   * profile would duplicate its address and a link would replace its choice, so
   * the row only opens that profile.
   */
  | { readonly kind: 'occupied'; readonly siteUrl: string; readonly profile: SiteProfile }
  /** The domain cannot become an address FluxRadar audits, such as an http:// property. */
  | {
      readonly kind: 'unsupported';
      readonly siteUrl: string;
      readonly reason: SearchConsoleOriginProblem;
    }
  /** No profile reads it or sits at its address. */
  | { readonly kind: 'unlinked'; readonly siteUrl: string };

/** How closely a property covers a profile's address; a higher rank is a closer match. */
const MATCH = { none: 0, subdomain: 1, sameAddress: 2 } as const;

type MatchRank = (typeof MATCH)[keyof typeof MATCH];

function httpsUrlOf(domain: string): URL | null {
  try {
    const url = new URL(domain);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** A URL-prefix property covers only its own origin; a domain property also its subdomains. */
function matchRank(siteUrl: string, profile: SiteProfile): MatchRank {
  const property = originFromSearchConsoleProperty(siteUrl);
  const profileUrl = httpsUrlOf(profile.domain);
  if (!property.ok || profileUrl === null) return MATCH.none;
  if (!isDomainProperty(siteUrl)) {
    return profileUrl.origin === property.origin ? MATCH.sameAddress : MATCH.none;
  }
  if (profileUrl.hostname === property.host) return MATCH.sameAddress;
  return profileUrl.hostname.endsWith(`.${property.host}`) ? MATCH.subdomain : MATCH.none;
}

/** One row per Search Console domain, in the order Google listed them. */
export function googleDomainRows(
  sites: readonly { readonly siteUrl: string }[],
  profiles: readonly SiteProfile[],
  bindings: readonly GoogleBinding[],
): readonly GoogleDomainRow[] {
  const boundSiteUrl: ReadonlyMap<string, string | null> = new Map(
    bindings.map((binding) => [binding.siteProfileId, binding.searchConsoleSiteUrl]),
  );
  return sites.map(({ siteUrl }) => rowFor(siteUrl, profiles, boundSiteUrl));
}

/**
 * Only a profile without a domain of its own is offered for linking: linking one
 * that already reads another property would silently replace that choice.
 */
function rowFor(
  siteUrl: string,
  profiles: readonly SiteProfile[],
  boundSiteUrl: ReadonlyMap<string, string | null>,
): GoogleDomainRow {
  const [first, ...rest] = profiles.filter((profile) => boundSiteUrl.get(profile.id) === siteUrl);
  if (first !== undefined) return { kind: 'linked', siteUrl, profiles: [first, ...rest] };
  const ranked = profiles
    .map((profile) => ({
      profile,
      rank: matchRank(siteUrl, profile),
      isFree: (boundSiteUrl.get(profile.id) ?? null) === null,
    }))
    .filter((entry) => entry.rank > MATCH.none)
    .toSorted((left, right) => right.rank - left.rank);
  const free = ranked.find((entry) => entry.isFree);
  if (free !== undefined) return { kind: 'matching', siteUrl, profile: free.profile };
  const atAddress = ranked.find((entry) => entry.rank === MATCH.sameAddress);
  if (atAddress !== undefined) return { kind: 'occupied', siteUrl, profile: atAddress.profile };
  const origin = originFromSearchConsoleProperty(siteUrl);
  return origin.ok
    ? { kind: 'unlinked', siteUrl }
    : { kind: 'unsupported', siteUrl, reason: origin.reason };
}
