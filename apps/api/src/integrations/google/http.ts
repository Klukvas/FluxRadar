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

/** The one method the Google client logs through; the API's `ApiLogger` satisfies it. */
export interface GoogleRequestLogger {
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
}

export interface GoogleRequestOptions {
  readonly fetcher?: Fetcher;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxAttempts?: number;
  /** Receives Google's reason for a refused request; see `rejectionContext`. */
  readonly logger?: GoogleRequestLogger;
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
        options.logger?.warn(
          'google request rejected',
          await rejectionContext(request.url, response),
        );
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

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The string each entry of a JSON array yields; anything else is skipped. */
function stringsFrom(
  entries: unknown,
  read: (entry: Readonly<Record<string, unknown>>) => unknown,
): readonly string[] {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry: unknown) => {
    const value = read(asRecord(entry) ?? {});
    return typeof value === 'string' ? [value] : [];
  });
}

/**
 * Google's own reason for refusing a request, for the server log only.
 *
 * A 403 by itself cannot tell an API switched off in the OAuth client's Google
 * Cloud project (`SERVICE_DISABLED`) from a grant without the scope or a
 * property the account cannot see — three problems fixed in three different
 * places. The reason codes and the service name say which. Google's message is
 * left out: it carries project numbers and quota details, and the reason
 * already says what it would. The URL is logged without its query string.
 * Never throws: a body that is not JSON only leaves the reasons empty.
 */
async function rejectionContext(
  url: string,
  response: Response,
): Promise<Readonly<Record<string, unknown>>> {
  const body: unknown = await response.json().catch(() => null);
  const error = asRecord(asRecord(body)?.error);
  return {
    endpoint: endpointOf(url),
    status: response.status,
    googleStatus: typeof error?.status === 'string' ? error.status : null,
    reasons: [
      ...stringsFrom(error?.details, (detail) => detail.reason),
      // Search Console's v3 API still answers in the older `errors` shape.
      ...stringsFrom(error?.errors, (entry) => entry.reason),
    ],
    services: stringsFrom(error?.details, (detail) => asRecord(detail.metadata)?.service),
  };
}

function endpointOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return 'unparseable-url';
  }
}
