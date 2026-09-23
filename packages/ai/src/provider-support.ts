// Shared plumbing for the raw-`fetch` provider adapters.
//
// Every adapter normalizes into the same §5 contract, so the parts that must
// behave identically across providers — how citations are de-duplicated and
// capped, which HTTP statuses mean "unavailable", how a transport failure is
// described — live here once instead of being re-derived four times.

import type { AiRequestCapsShape, UsageSource } from '@fluxradar/contracts';

import { AiRequestCancelledError, UnavailableError } from './errors.js';
import { CHARS_PER_TOKEN } from './prompt-builder.js';

/** Timeout for a request without provider web search. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
/** Search-enabled turns run several provider-side searches before answering. */
export const SEARCH_REQUEST_TIMEOUT_MS = 60_000;

/**
 * The signal an adapter gives `fetch`: this request's timeout, plus whatever the
 * caller may cancel the whole run with.
 */
export function requestSignal(timeoutMs: number, caller: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return caller === undefined ? timeout : AbortSignal.any([caller, timeout]);
}

/**
 * Stops the adapter when the caller has cancelled, and stops it by throwing
 * rather than by returning an unavailable provider.
 *
 * Called before the request goes out (a cancelled run must not start a paid
 * call) and again when the transport fails (a cancel and a timeout both surface
 * as `AbortError`, and only the timeout is a retryable provider outcome).
 */
export function throwIfCancelled(caller: AbortSignal | undefined): void {
  if (caller === undefined || !caller.aborted) return;
  const reason = cancellationReason(caller);
  throw reason instanceof Error ? reason : new AiRequestCancelledError();
}

/**
 * Why the caller cancelled, when it said so with an `Error`.
 *
 * `AbortController.abort()` with no argument fills the signal's reason with a
 * transport-level `AbortError`, which explains nothing; the layer that wraps a
 * cancellation keeps its own message in that case.
 */
export function cancellationReason(caller: AbortSignal | undefined): Error | undefined {
  if (caller === undefined || !caller.aborted) return undefined;
  const reason: unknown = caller.reason;
  if (!(reason instanceof Error) || reason.name === 'AbortError') return undefined;
  return reason;
}

/**
 * The response body, or null when it cannot be read as JSON.
 *
 * `fetch` resolves as soon as the HEADERS arrive, so the body is a second
 * transfer that the caller can still cancel — and that cancellation arrives
 * here as a rejected `json()`, several frames away from the `fetch` that the
 * adapters already guard. Swallowing it would report a cancelled run as
 * "the provider sent nothing readable": a provider outcome, which the module
 * above is entitled to retry and pay for a second time.
 *
 * A body that simply is not JSON stays a null, not a throw: that is a provider
 * fault, and each adapter says so in its own words.
 */
export async function readJsonBody(
  response: Response,
  caller: AbortSignal | undefined,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throwIfCancelled(caller);
    return null;
  }
}

export function transportFailureReason(provider: string, error: unknown): string {
  if (
    error instanceof DOMException &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return `${provider} request timed out`;
  }
  return `${provider} network request failed`;
}

/**
 * A non-2xx answer is always unavailable, never fail-open data. 408/429/5xx name
 * the status because they are the retryable ones an operator wants to see; any
 * other non-2xx — including a parameter the provider rejected — is reported as a
 * rejection rather than silently dropping the parameter and asking again.
 */
export function httpFailure(provider: string, status: number): UnavailableError {
  if (status === 408 || status === 429 || status >= 500) {
    return new UnavailableError(`${provider} HTTP ${status}`);
  }
  return new UnavailableError(`${provider} rejected the request`);
}

/**
 * Host suffixes that name a private network rather than a public source:
 * mDNS (`.local`), the reserved `.localhost`, the home network of RFC 8375
 * (`.home.arpa`), and the names operators give their own estates.
 */
const INTERNAL_HOST_SUFFIXES: readonly string[] = [
  '.local',
  '.localhost',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
];

/** The host as it is compared: lower case, without the root's trailing dot. */
function normalizedHost(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.endsWith('.') ? lower.slice(0, -1) : lower;
}

/**
 * Whether the host is a literal address rather than a name.
 *
 * The URL parser normalizes every IPv4 spelling to dotted quads (`127.1`,
 * `0x7f.0.0.1` and `2130706433` all become `127.0.0.1`) and every IPv6 literal
 * to a bracketed form, so the two shapes below cover them all — including the
 * IPv4-mapped ones that arrive as hex (`[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`)
 * and would slip past a list of dotted private ranges.
 */
function isAddressLiteral(hostname: string): boolean {
  return hostname.startsWith('[') || /^[0-9.]+$/.test(hostname);
}

/**
 * Whether a model-supplied string is safe to store and to put in front of a
 * reader as a source link.
 *
 * A citation is provider output, which means it is model-influenced text that
 * ends up in a report and in a PDF. Only absolute public http(s) URLs qualify:
 * `javascript:`/`data:` never become a link, embedded credentials never get
 * stored, and a URL naming an internal host is dropped rather than inviting
 * whoever opens the report to fetch it.
 *
 * A source the model cites is a published page, and a published page has a
 * DOMAIN NAME. So the rule is what a public source looks like rather than a
 * list of the ranges that are private: an address literal of either family is
 * refused outright, and so is a single-label host — `http://wiki/` is somebody's
 * intranet, never a citation. That is one rule instead of an enumeration nobody
 * can keep complete, and it is why cloud metadata (`169.254.169.254`) and a
 * mapped loopback (`[::ffff:127.0.0.1]`) are both already out.
 */
export function isSafeCitationUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username !== '' || url.password !== '') return false;
  const hostname = normalizedHost(url.hostname);
  if (hostname === '') return false;
  if (isAddressLiteral(hostname)) return false;
  if (!hostname.includes('.')) return false;
  return !INTERNAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

/**
 * Safe citations in order of first appearance, unique, at most the request's
 * cap. Anything that is not a public http(s) URL is dropped here, so no adapter
 * can pass one through by forgetting to check.
 *
 * The cap is checked BEFORE each citation is kept, so a request that allows
 * none keeps none: a cap of zero that returned everything would be the one
 * failure mode this function exists to prevent.
 */
export function boundedCitations(
  urls: readonly (string | undefined | null)[],
  caps: AiRequestCapsShape,
): readonly string[] {
  const kept: string[] = [];
  for (const url of urls) {
    if (kept.length >= caps.maxCitationUnits) break;
    if (typeof url !== 'string' || url === '') continue;
    if (kept.includes(url)) continue;
    if (!isSafeCitationUrl(url)) continue;
    kept.push(url);
  }
  return kept;
}

/**
 * A token count and where it came from.
 *
 * The distinction is the point: §5 lets an adapter fall back to the pinned
 * tokenizer when a provider omits a number, but the record must then say so.
 * A count is never clamped to the cap — spend is reported as the provider
 * billed it, and a provider that ignored the cap fails the response contract
 * instead of being quietly re-labelled as compliant.
 */
export interface TokenCount {
  readonly value: number;
  readonly source: UsageSource;
}

export function reportedOrEstimated(reported: unknown, estimate: number): TokenCount {
  const value = positiveCount(reported);
  return value === undefined
    ? { value: estimate, source: 'estimated' }
    : { value, source: 'provider' };
}

/** One estimated field makes the whole usage record estimated (§5). */
export function usageSourceOf(counts: readonly TokenCount[]): UsageSource {
  return counts.some((count) => count.source === 'estimated') ? 'estimated' : 'provider';
}

export interface CappedOutputText {
  readonly text: string;
  readonly truncated: boolean;
}

/** Output cap §5: cut on the approx tokenizer boundary, never mid-budget. */
export function capOutputText(rawText: string, caps: AiRequestCapsShape): CappedOutputText {
  const capChars = caps.maxOutputTokens * CHARS_PER_TOKEN;
  return rawText.length > capChars
    ? { text: rawText.slice(0, capChars), truncated: true }
    : { text: rawText, truncated: false };
}

export function positiveCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
