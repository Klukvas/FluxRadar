// One place where Google HTTP calls get their timeout, their bounded retry and
// their error translation. Discovery and scan-time reads share it so a slow
// provider can never hold a scan open indefinitely.

import { googleErrorFor, GoogleApiError } from './errors.ts';

export const GOOGLE_REQUEST_TIMEOUT_MS = 15_000;

/** Only idempotent reads are retried, and only for states Google itself calls transient. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;

export type Fetcher = typeof fetch;

export interface GoogleRequest {
  readonly url: string;
  readonly accessToken: string;
  /** Absent for GET; JSON-encoded for the POST-based query endpoints. */
  readonly body?: unknown;
}

export interface GoogleRequestOptions {
  readonly fetcher?: Fetcher;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxAttempts?: number;
}

/**
 * Carries a GoogleApiError past the retry loop's catch. Without a distinct
 * wrapper the loop cannot tell "Google said no" from "the socket died", because
 * both arrive as a thrown value and both can carry the `request_failed` state.
 */
class NonRetryable {
  readonly error: GoogleApiError;

  // Node runs this source with strip-only type stripping, so a constructor
  // parameter property would not survive to runtime.
  constructor(error: GoogleApiError) {
    this.error = error;
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

/**
 * Performs one authorized Google JSON read. Throws GoogleApiError only: callers
 * turn that into a service state and never inspect the transport.
 */
export async function googleJson<T>(
  request: GoogleRequest,
  options: GoogleRequestOptions = {},
): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  let lastError: GoogleApiError = googleErrorFor(503);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetcher(request.url, {
        method: request.body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${request.accessToken}`,
          ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal: AbortSignal.timeout(options.timeoutMs ?? GOOGLE_REQUEST_TIMEOUT_MS),
      });
      if (response.ok) {
        return (await response.json()) as T;
      }
      lastError = googleErrorFor(response.status);
      if (!RETRYABLE_STATUSES.has(response.status)) {
        // Rejected by Google on the merits (400 bad metric, 403, 404, 410…).
        // Repeating an identical request cannot change the answer.
        throw new NonRetryable(lastError);
      }
    } catch (error) {
      if (error instanceof NonRetryable) throw error.error;
      if (error instanceof GoogleApiError && error.state !== 'request_failed') {
        throw error;
      }
      // A timeout, a socket error or an unparseable body is retried like a 503.
      lastError = error instanceof GoogleApiError ? error : googleErrorFor(503, error);
    }
    if (attempt < maxAttempts) {
      await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }
  throw lastError;
}
