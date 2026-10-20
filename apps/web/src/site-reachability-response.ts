import type { SiteReachability } from './api';

/**
 * The reachability answer, or null when the response is not one.
 *
 * The panel reads this endpoint on its own, on screens whose test doubles answer
 * any path they do not know with unrelated data. A scan object read as an
 * answer would unlock nothing, but its missing `state` would look like "never
 * checked" and start a probe. Only the two fields the panel decides on are
 * required; the rest are optional in the API's own type. An unknown state
 * string is kept: the panel has a neutral sentence for it, and a newer API
 * naming a new verdict is still an answer.
 */
export function readSiteReachability(value: unknown): SiteReachability | null {
  if (typeof value !== 'object' || value === null) return null;
  const { state, canPurchase, searchEnginesBlocked, blockedSearchEngines } = value as Record<
    string,
    unknown
  >;
  if (typeof canPurchase !== 'boolean') return null;
  if (searchEnginesBlocked !== undefined && typeof searchEnginesBlocked !== 'boolean') return null;
  if (state !== null && (typeof state !== 'string' || state.length === 0)) return null;
  if (
    blockedSearchEngines !== undefined &&
    (!Array.isArray(blockedSearchEngines) ||
      !blockedSearchEngines.every((name) => name === 'Google' || name === 'Bing'))
  )
    return null;
  return value as SiteReachability;
}
