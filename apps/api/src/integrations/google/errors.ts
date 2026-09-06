// Google API failures are translated here once, so no caller has to interpret a
// status code and no user ever sees one. Google's own error bodies routinely
// carry project ids and quota metadata, so the body is never propagated.

import type { GoogleDataState } from './types.ts';

export class GoogleApiError extends Error {
  readonly state: GoogleDataState;
  readonly detail: string;

  constructor(state: GoogleDataState, detail: string, cause?: unknown) {
    super(detail, cause === undefined ? undefined : { cause });
    this.name = 'GoogleApiError';
    this.state = state;
    this.detail = detail;
  }
}

const DETAILS: Readonly<Record<GoogleDataState, string>> = {
  connected: 'Google returned data for this period.',
  not_connected: 'Google is not connected for this workspace.',
  no_property_selected: 'No Google property is linked to this website yet.',
  needs_reconnect: 'Google access has expired or was revoked. Reconnect Google to continue.',
  no_access: 'This Google account cannot read the selected property.',
  no_data: 'Google has no data for this website in the selected period.',
  request_failed: 'Google did not respond in time. The rest of the report is unaffected.',
};

export function detailFor(state: GoogleDataState): string {
  return DETAILS[state];
}

/**
 * 401 means the token is dead (expired past refresh, revoked). 403 means the
 * token is alive but the grant or the property permission is not there — which
 * is a different user action, so the two must not be merged. 404 on a property
 * read is also a permission answer in practice: Google hides resources the
 * caller cannot see.
 */
export function stateFromStatus(status: number): GoogleDataState {
  if (status === 401) return 'needs_reconnect';
  if (status === 403 || status === 404) return 'no_access';
  return 'request_failed';
}

export function googleErrorFor(status: number, cause?: unknown): GoogleApiError {
  const state = stateFromStatus(status);
  return new GoogleApiError(state, detailFor(state), cause);
}

/** Converts any thrown value into a service result state without leaking it. */
export function stateOf(error: unknown): GoogleDataState {
  return error instanceof GoogleApiError ? error.state : 'request_failed';
}

export function detailOf(error: unknown): string {
  return error instanceof GoogleApiError ? error.detail : detailFor('request_failed');
}
