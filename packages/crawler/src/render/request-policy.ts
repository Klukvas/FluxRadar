// What a rendered page is allowed to ask the network for, decided without a
// browser so it can be read and tested on its own.
//
// The rule is narrow on purpose: a render exists to see the DOM a visitor
// would see, so it may load the things that build a DOM and nothing else. Every
// refusal is named, because a page rendered with half its scripts blocked is a
// different page and the report has to be able to say so.

import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';

import { validatePublicUrl } from '@fluxradar/safe-fetch';

import type { BlockedRequestReason } from './types.js';

/** Resource kinds that can change what the DOM contains. */
const RENDERABLE_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  'document',
  'script',
  'stylesheet',
  'fetch',
  'xhr',
]);

/** A render observes; it never changes state on the site being audited. */
const ALLOWED_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/**
 * Response headers that must not reach the browser.
 *
 * `set-cookie` would give the render a state it is not allowed to carry; the
 * transfer headers describe a connection that no longer exists, because the
 * body was read by safe-fetch and is handed over decoded.
 */
const STRIPPED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  'set-cookie',
  'set-cookie2',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'proxy-authenticate',
  'www-authenticate',
]);

export interface RenderBudget {
  readonly remainingRequests: number;
  readonly remainingBytes: number;
}

export interface SubresourceRequest {
  readonly url: string;
  readonly method: string;
  readonly resourceType: string;
}

/** A granted allocation: one request slot and the bytes it may read. */
export interface RenderReservation {
  readonly allowanceBytes: number;
}

/**
 * The subresource budget of one page render.
 *
 * Requests are concurrent, so a budget read *before* an await and spent after
 * it is not a budget at all: twenty scripts requested at once would each see
 * the full allowance and the page would fetch twenty times the cap. Everything
 * is therefore taken *before* the request goes out and reconciled when the
 * response arrives.
 *
 * Two allocations behave differently on exhaustion, because the two limits mean
 * different things. A request slot is gone for good — that is the hard cap on
 * how many times a page may reach the network. Bytes are only *held* by a
 * request in flight, so a caller that finds them all reserved waits for one to
 * finish instead of being refused: refusing there would starve a page of thirty
 * small scripts for no reason, while waiting keeps the aggregate exact.
 *
 * A byte reservation is granted whole or not at all. Handing out whatever was
 * left would cap the response below the size the caller asked for, and a
 * response cut at the cap is a script the browser parses to its middle — the
 * DOM would then be wrong with nothing recorded. There are two outcomes here
 * and only two: the full allowance, or a refusal the caller reports.
 */
export class RenderBudgetLedger {
  private readonly maxRequests: number;
  private readonly maxBytes: number;
  private requests = 0;
  private reservedBytes = 0;
  private spentBytes = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(maxRequests: number, maxBytes: number) {
    this.maxRequests = maxRequests;
    this.maxBytes = maxBytes;
  }

  snapshot(): RenderBudget {
    return {
      remainingRequests: this.maxRequests - this.requests,
      remainingBytes: this.maxBytes - this.spentBytes,
    };
  }

  /**
   * Takes one request slot synchronously, or returns null when the page has
   * used them all. Doing this before any await is what makes the request cap
   * hold under concurrency.
   */
  reserveRequest(): boolean {
    if (this.requests >= this.maxRequests) return false;
    this.requests += 1;
    return true;
  }

  /**
   * Gives a slot back when the request it was taken for never went out.
   *
   * Only for the window between taking the slot and finding the byte budget
   * spent: a slot that has already been spent on the wire is gone for good,
   * because the point of the cap is how many times the page reached the site.
   */
  releaseRequest(): void {
    if (this.requests > 0) this.requests -= 1;
  }

  /**
   * The bytes one response may read, in full, once they are free.
   *
   * Returns null when what remains can never cover a whole response — the
   * budget is spent rather than merely held — and when `waitFor` elapses: a
   * caller must not wait on a page that has stopped settling its own requests.
   */
  async reserveBytes(
    maxResponseBytes: number,
    waitForMs: number,
  ): Promise<RenderReservation | null> {
    // A single response may not ask for more than the page has in total; past
    // that the wait below could never end.
    const allowanceBytes = Math.min(maxResponseBytes, this.maxBytes);
    const deadline = Date.now() + waitForMs;
    for (;;) {
      const free = this.maxBytes - this.reservedBytes - this.spentBytes;
      if (free >= allowanceBytes) {
        this.reservedBytes += allowanceBytes;
        return { allowanceBytes };
      }
      // Only the bytes still *held* can come back; the spent ones cannot. When
      // even every in-flight request returning would not free enough, waiting
      // is pointless and the refusal is the honest answer.
      if (this.maxBytes - this.spentBytes < allowanceBytes) return null;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const released = await this.waitForRelease(remaining);
      if (!released) return null;
    }
  }

  /** Books what the response actually cost and frees the rest for waiters. */
  settle(reservation: RenderReservation, actualBytes: number): void {
    this.reservedBytes -= reservation.allowanceBytes;
    this.spentBytes += Math.min(actualBytes, reservation.allowanceBytes);
    this.wakeWaiters();
  }

  get servedRequests(): number {
    return this.requests;
  }

  get servedBytes(): number {
    return this.spentBytes;
  }

  private waitForRelease(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(wake);
        if (index >= 0) this.waiting.splice(index, 1);
        resolve(false);
      }, timeoutMs);
      const wake = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      this.waiting.push(wake);
    });
  }

  private wakeWaiters(): void {
    const woken = this.waiting.splice(0, this.waiting.length);
    for (const wake of woken) wake();
  }
}

export type PolicyVerdict =
  | { readonly allowed: true; readonly url: URL }
  | { readonly allowed: false; readonly reason: BlockedRequestReason };

/**
 * The verdict for one browser request, before any host lookup.
 *
 * Host-level checks (SSRF, robots, scan scope) are deliberately not here: they
 * need I/O, and keeping them out leaves this decision a pure function of the
 * request itself.
 */
export function subresourceVerdict(
  request: SubresourceRequest,
  budget: RenderBudget,
): PolicyVerdict {
  if (!ALLOWED_METHODS.has(request.method.toUpperCase())) {
    return { allowed: false, reason: 'method-not-allowed' };
  }
  if (!RENDERABLE_RESOURCE_TYPES.has(request.resourceType)) {
    return { allowed: false, reason: 'resource-kind' };
  }
  if (budget.remainingRequests <= 0 || budget.remainingBytes <= 0) {
    return { allowed: false, reason: 'budget' };
  }
  let url: URL;
  try {
    url = validatePublicUrl(request.url);
  } catch {
    return { allowed: false, reason: 'url-not-allowed' };
  }
  return { allowed: true, url };
}

/** The upstream headers a fulfilled response may carry into the browser. */
export function sanitizeResponseHeaders(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())),
  );
}

/** Decoders for the `content-encoding` values a server may answer with. */
const DECODERS: ReadonlyMap<string, (input: Buffer, maxOutputLength: number) => Buffer> = new Map([
  ['gzip', (input, maxOutputLength): Buffer => gunzipSync(input, { maxOutputLength })],
  ['x-gzip', (input, maxOutputLength): Buffer => gunzipSync(input, { maxOutputLength })],
  ['deflate', (input, maxOutputLength): Buffer => inflateOrRaw(input, maxOutputLength)],
  ['br', (input, maxOutputLength): Buffer => brotliDecompressSync(input, { maxOutputLength })],
]);

export type DecodedBody =
  | { readonly kind: 'decoded'; readonly bytes: Buffer }
  /** The body cannot be handed to the browser as anything it could read. */
  | { readonly kind: 'undecodable'; readonly encoding: string };

/**
 * The bytes a fulfilled response may hand the browser.
 *
 * safe-fetch asks for `identity` and does not decode, and `content-encoding` is
 * stripped before the response reaches the browser — so a server that ignores
 * the request header and compresses anyway would otherwise deliver compressed
 * bytes labelled as plain ones. A script that then fails to parse produces a
 * *wrong* rendered DOM with nothing recorded, which is worse than no render at
 * all. So the body is decoded here, under a hard output cap, or refused by name.
 *
 * `maxDecodedBytes` bounds the decompressed size as well as the wire size: a
 * small archive that expands to a gigabyte is exactly the shape a byte budget
 * exists to stop.
 */
export function decodeSubresourceBody(
  headers: Readonly<Record<string, string>>,
  bytes: Buffer,
  maxDecodedBytes: number,
): DecodedBody {
  const header = headerValue(headers, 'content-encoding');
  if (header === undefined) return { kind: 'decoded', bytes };
  // Chained encodings are applied outermost-last, so they are undone in reverse.
  const encodings = header
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value !== '' && value !== 'identity')
    .reverse();
  let decoded = bytes;
  for (const encoding of encodings) {
    const decode = DECODERS.get(encoding);
    if (decode === undefined) return { kind: 'undecodable', encoding };
    try {
      decoded = decode(decoded, maxDecodedBytes);
    } catch {
      // Truncated by the byte cap, corrupt, or larger than the budget allows.
      return { kind: 'undecodable', encoding };
    }
  }
  return { kind: 'decoded', bytes: decoded };
}

/** `deflate` is served both zlib-wrapped and raw; a reader has to accept both. */
function inflateOrRaw(input: Buffer, maxOutputLength: number): Buffer {
  try {
    return inflateSync(input, { maxOutputLength });
  } catch {
    return inflateRawSync(input, { maxOutputLength });
  }
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

/**
 * The request headers a render may send. Built from nothing: the browser's own
 * headers are discarded so no cookie, authorization or client hint can be
 * forwarded even if a page managed to set one.
 */
export function renderRequestHeaders(userAgent: string): Record<string, string> {
  return {
    'user-agent': userAgent,
    accept: '*/*',
    'accept-language': 'en',
  };
}
