// Ask the site whether it will let us read it, before we read it.
//
// The profile form fills itself from the public homepage as soon as an address
// is typed, so the read is no longer a button somebody pressed on purpose — it
// is a request this product sends to a stranger's server on a keystroke. Two
// things follow from that, and both are enforced here rather than in the
// browser:
//
//   1. robots.txt is honoured *before* the page is fetched. Autofill used to
//      read a homepage a site had told FluxRadarBot to stay out of.
//   2. A site that refuses our crawler is named as such. "Could not read public
//      details" tells the owner nothing; "a WAF refused our crawler, allow
//      FluxRadarBot" is the one sentence that fixes both the autofill and the
//      audit they are about to buy.
//
// It is deliberately the same probe the paid crawl and the pre-purchase gate
// use (`integrations/site-reachability.ts`), so the three cannot drift into
// three different opinions about one site. It differs from the pre-purchase
// probe in one way: that one leaves from the egress location the buyer picked
// and is stored as evidence for the checkout, while this one answers a question
// about a profile that does not exist yet, from the API's own network — the same
// network the extraction fetch below it takes. Nothing here authorises a
// purchase; `reachability-routes.ts` remains the only probe that does.

import type { SiteReachKind } from '@fluxradar/crawler';

import { ApiError } from '../http/errors.ts';
import {
  probeSiteReachability,
  type SiteReachabilityOptions,
  type SiteReachabilityProbeResult,
} from '../integrations/site-reachability.ts';

/**
 * Why a site cannot be read, as a machine-readable code and one plain sentence.
 *
 * The codes are the contract the form reads to pick its own localized advice
 * (`apps/web/src/profile-autofill.ts`); the messages are the fallback for any
 * other client. Neither says anything the owner of the site could not learn by
 * fetching their own homepage, so this is not an oracle about our network.
 */
const REFUSALS = {
  'access-denied': {
    code: 'SITE_ACCESS_DENIED',
    message: 'this site refused our crawler, so its public details could not be read',
  },
  'blocked-by-robots': {
    code: 'SITE_BLOCKED_BY_ROBOTS',
    message: 'this site’s robots.txt disallows our crawler, so its homepage was not read',
  },
  unreachable: {
    code: 'SITE_UNREACHABLE',
    message: 'this site did not answer, so its public details could not be read',
  },
  'bad-response': {
    code: 'SITE_BAD_RESPONSE',
    message: 'this site answered without a readable page, so its public details could not be read',
  },
} as const satisfies Record<
  Exclude<SiteReachKind, 'reachable'>,
  { readonly code: string; readonly message: string }
>;

/**
 * 409, not 400: the request is well formed and the address is valid — the site
 * it names is not in a state we may read. It is the status this API already
 * gives a site that is not ready to be audited (`SitePreconditionError`).
 */
function refusalFor(state: Exclude<SiteReachKind, 'reachable'>): ApiError {
  const refusal = REFUSALS[state];
  return new ApiError(409, refusal.code, refusal.message);
}

/**
 * Probes `origin` and throws the matching refusal unless the site let us in.
 *
 * Returns the verdict so the caller can log what the site answered. The probe
 * carries no abort signal on purpose: it has its own timeout, and the one thing
 * a disconnecting client must not do is leave a half-read robots.txt deciding
 * whether the site is readable. The caller re-checks its signal afterwards and
 * skips the extraction instead.
 */
export async function assertSiteReadable(
  origin: string,
  options: SiteReachabilityOptions = {},
): Promise<SiteReachabilityProbeResult> {
  const result = await probeSiteReachability(origin, options);
  if (result.state !== 'reachable') throw refusalFor(result.state);
  return result;
}
