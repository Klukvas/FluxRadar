// Bing API failures are translated here once, so no caller interprets a status
// code and no user ever sees one.
//
// Bing's JSON protocol answers HTTP 400 with `{"ErrorCode":n,"Message":"..."}`
// for application-level faults — including authentication ones — rather than the
// 401/403 an HTTP client would expect (learn.microsoft.com/en-us/bingwebmaster/
// getting-started, "JSON error response sample"). A 400 is therefore not simply
// "our request was malformed": the fault code is what says whether the owner has
// to reconnect, whether the site is not theirs, or whether we sent nonsense.
// Bing's own `Message` is never propagated to a user — it is free text that can
// echo request content — but it is what the code below is read from.

import type { BingDataState } from './types.ts';

export class BingApiError extends Error {
  readonly state: BingDataState;
  readonly detail: string;

  constructor(state: BingDataState, detail: string, cause?: unknown) {
    super(detail, cause === undefined ? undefined : { cause });
    this.name = 'BingApiError';
    this.state = state;
    this.detail = detail;
  }
}

const DETAILS: Readonly<Record<BingDataState, string>> = {
  connected: 'Bing returned data for this period.',
  not_connected: 'Bing Webmaster Tools is not connected for this workspace.',
  no_property_selected: 'No Bing site is linked to this profile yet.',
  needs_reconnect:
    'Bing access has expired or was revoked. Reconnect Bing Webmaster Tools to continue.',
  no_access: 'This Bing account cannot read the selected site.',
  no_data: 'Bing has no data for this site in the selected period.',
  not_verified: 'Bing has not verified ownership of this site yet.',
  request_failed: 'Bing did not respond in time. The rest of the report is unaffected.',
};

export function detailFor(state: BingDataState): string {
  return DETAILS[state];
}

/**
 * What the report says when Bing answered with something that is not the payload
 * its own reference documents.
 *
 * It is a `request_failed` like a timeout, and deliberately not "no data": the
 * difference between "Bing sent nothing" and "Bing sent something unreadable"
 * does not matter to the reader, but reporting either of them as zero clicks
 * would be a number the owner acts on that nobody measured.
 */
export const MALFORMED_PAYLOAD_DETAIL =
  'Bing returned data FluxRadar could not read. The rest of the report is unaffected.';

/**
 * Bing fault messages that mean the grant, not the request, is the problem.
 * Matched case-insensitively on the whole message because Bing states them as
 * bare tokens (`InvalidApiKey`, `UserNotAuthenticated`).
 */
const AUTHENTICATION_FAULTS = ['invalidapikey', 'usernotauthenticated', 'invalidtoken'];
const PERMISSION_FAULTS = ['useraccessdenied', 'notauthorized', 'accessdenied'];
const UNKNOWN_SITE_FAULTS = ['invalidurl', 'sitenotfound', 'nosuchsite'];

function normalised(message: string | null): string {
  return (message ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/[\s_-]/g, '');
}

/**
 * The state for one Bing answer.
 *
 * 401 is included even though the JSON protocol documents faults on 400,
 * because the OAuth layer in front of it answers 401 for a dead bearer token and
 * that is the most common way this call fails in practice.
 */
export function stateFromResponse(status: number, faultMessage: string | null): BingDataState {
  if (status === 401) return 'needs_reconnect';
  if (status === 403) return 'no_access';
  if (status === 400) {
    const fault = normalised(faultMessage);
    if (AUTHENTICATION_FAULTS.includes(fault)) return 'needs_reconnect';
    if (PERMISSION_FAULTS.includes(fault)) return 'no_access';
    if (UNKNOWN_SITE_FAULTS.includes(fault)) return 'no_access';
    // An unrecognised 400 is our request, not the owner's grant. It is reported
    // as a provider failure rather than as "reconnect", because telling an owner
    // to reauthorize for a bug in our query wastes their time.
    return 'request_failed';
  }
  if (status === 404) return 'no_access';
  return 'request_failed';
}

export function bingErrorFor(
  status: number,
  faultMessage: string | null = null,
  cause?: unknown,
): BingApiError {
  const state = stateFromResponse(status, faultMessage);
  return new BingApiError(state, detailFor(state), cause);
}

/** Converts any thrown value into a service state without leaking it. */
export function stateOf(error: unknown): BingDataState {
  return error instanceof BingApiError ? error.state : 'request_failed';
}

export function detailOf(error: unknown): string {
  return error instanceof BingApiError ? error.detail : detailFor('request_failed');
}
