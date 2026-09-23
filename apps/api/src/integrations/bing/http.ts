// One place where Bing Webmaster HTTP calls get their timeout, their bounded
// retry and their error translation.
//
// Transport facts, all from Microsoft's own reference:
//   * the JSON protocol lives at https://www.bing.com/webmaster/api.svc/json/
//     and each method is one path segment — `.../json/GetUserSites`
//     (learn.microsoft.com/en-us/bingwebmaster/oauth2, step 6);
//   * an OAuth caller authenticates with `Authorization: Bearer <token>`, not
//     with the `apikey` query parameter the API-key samples use (same page);
//   * successful responses wrap their payload in `{"d": …}`
//     (learn.microsoft.com/.../iwebmasterapi.getusersites, "JSON response sample");
//   * faults come back as HTTP 400 with `{"ErrorCode":n,"Message":"…"}`
//     (learn.microsoft.com/en-us/bingwebmaster/getting-started).
//
// Only reads are issued from here, and only ever as GET. Nothing in this module
// can write to a Bing property.

import { bingErrorFor, BingApiError } from './errors.ts';

export const BING_API_BASE_URL = 'https://www.bing.com/webmaster/api.svc/json';
export const BING_REQUEST_TIMEOUT_MS = 15_000;

/** Only idempotent reads are retried, and only for states Bing calls transient. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;

export type Fetcher = typeof fetch;

/** The one method the Bing client logs through; the API's `ApiLogger` satisfies it. */
export interface BingRequestLogger {
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
}

export interface BingRequestOptions {
  readonly fetcher?: Fetcher;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxAttempts?: number;
  /** Receives Bing's own fault code for a refused request; never the payload. */
  readonly logger?: BingRequestLogger;
}

/**
 * Carries a BingApiError past the retry loop's catch, so "Bing said no" is not
 * confused with "the socket died" — both arrive as a thrown value.
 */
class NonRetryable {
  readonly error: BingApiError;

  // Node runs this source with strip-only type stripping, so a constructor
  // parameter property would not survive to runtime.
  constructor(error: BingApiError) {
    this.error = error;
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

/** The URL for one documented method with its query parameters. */
export function bingMethodUrl(
  method: string,
  parameters: Readonly<Record<string, string>> = {},
): string {
  const url = new URL(`${BING_API_BASE_URL}/${method}`);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

interface BingEnvelope<T> {
  readonly d?: T;
}

interface BingFault {
  readonly ErrorCode?: unknown;
  readonly Message?: unknown;
}

function faultMessageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const message = (body as BingFault).Message;
  return typeof message === 'string' ? message : null;
}

function faultCodeOf(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const code = (body as BingFault).ErrorCode;
  return typeof code === 'number' ? code : null;
}

export interface BingReadRequest {
  readonly method: string;
  readonly accessToken: string;
  readonly parameters?: Readonly<Record<string, string>>;
}

/**
 * Performs one authorized Bing JSON read and unwraps the `d` envelope. Throws
 * BingApiError only: callers turn that into a service state and never inspect
 * the transport.
 */
export async function bingJson<T>(
  request: BingReadRequest,
  options: BingRequestOptions = {},
): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const url = bingMethodUrl(request.method, request.parameters);
  let lastError: BingApiError = bingErrorFor(503);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetcher(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${request.accessToken}`,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(options.timeoutMs ?? BING_REQUEST_TIMEOUT_MS),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const envelope = body as BingEnvelope<T> | null;
        if (envelope === null || envelope.d === undefined) {
          // A 200 without the documented envelope is not data we may report as
          // Bing's. Treated as a provider failure rather than as an empty result.
          throw new NonRetryable(bingErrorFor(502));
        }
        return envelope.d;
      }
      const faultMessage = faultMessageOf(body);
      lastError = bingErrorFor(response.status, faultMessage);
      if (!RETRYABLE_STATUSES.has(response.status)) {
        options.logger?.warn('bing request rejected', {
          method: request.method,
          status: response.status,
          // The fault token, not Bing's sentence: the token is the closed set an
          // operator acts on, and the sentence can echo the request — including
          // the siteUrl, which is a customer's property and has no business in
          // an operational log line.
          bingErrorCode: faultCodeOf(body),
          state: lastError.state,
        });
        throw new NonRetryable(lastError);
      }
    } catch (error) {
      if (error instanceof NonRetryable) throw error.error;
      if (error instanceof BingApiError && error.state !== 'request_failed') throw error;
      // A timeout, a socket error or an unparseable body is retried like a 503.
      lastError = error instanceof BingApiError ? error : bingErrorFor(503, null, error);
    }
    if (attempt < maxAttempts) {
      await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }
  throw lastError;
}
