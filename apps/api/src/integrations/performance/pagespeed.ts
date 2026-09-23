// PageSpeed Insights (Lighthouse) lab client.
//
// One call is one Lighthouse run of one URL on one emulated device. Nothing in
// here retries: a PSI call is slow and rate-limited, the audit's repeat count is
// already its sampling strategy, and a silent retry would spend the request
// budget without the caller knowing.
//
// The audits read below are all real Lighthouse audit ids. Where an audit is an
// "opportunity", Lighthouse states the saving twice — `numericValue` in the
// audit's own unit and `details.overallSavingsBytes`/`overallSavingsMs` — so the
// byte savings are read from `details` and the millisecond ones from
// `numericValue`, rather than assuming one unit for all of them.
//
// `interaction-to-next-paint` is NOT read here and never was measurable here:
// Lighthouse cannot produce INP from a cold page load. See types.ts.

import type { DeviceStrategy, LabMetrics, LabSample } from './types.ts';

const PAGESPEED_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/** A Lighthouse run is slow; this is the point past which it is not worth waiting. */
export const PAGESPEED_TIMEOUT_MS = 60_000;

export interface PageSpeedOptions {
  readonly apiKey?: string | null;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

interface AuditEntry {
  readonly numericValue?: unknown;
  readonly details?: {
    readonly overallSavingsBytes?: unknown;
    readonly overallSavingsMs?: unknown;
    readonly items?: readonly Readonly<Record<string, unknown>>[];
  };
}

interface PageSpeedResponse {
  readonly lighthouseResult?: {
    readonly lighthouseVersion?: unknown;
    readonly analysisUTCTimestamp?: unknown;
    readonly categories?: { readonly performance?: { readonly score?: unknown } };
    readonly audits?: Readonly<Record<string, AuditEntry>>;
  };
}

export class PageSpeedError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PageSpeedError';
    this.status = status;
  }
}

type Audits = Readonly<Record<string, AuditEntry>> | undefined;

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numericValue(audits: Audits, id: string): number | null {
  return finite(audits?.[id]?.numericValue);
}

/** Byte savings, preferring the figure Lighthouse states in bytes explicitly. */
function savedBytes(audits: Audits, id: string): number | null {
  const audit = audits?.[id];
  if (audit === undefined) return null;
  return finite(audit.details?.overallSavingsBytes) ?? finite(audit.numericValue);
}

/** Millisecond savings, preferring the figure Lighthouse states in milliseconds. */
function savedMilliseconds(audits: Audits, id: string): number | null {
  const audit = audits?.[id];
  if (audit === undefined) return null;
  return finite(audit.details?.overallSavingsMs) ?? finite(audit.numericValue);
}

/**
 * Total requests for the page load, from the `resource-summary` audit's `total`
 * row. Lighthouse reports it per resource type plus one total; summing the types
 * would double-count, so the total row is the one read.
 */
function requestCount(audits: Audits): number | null {
  const items = audits?.['resource-summary']?.details?.items;
  if (!Array.isArray(items)) return null;
  const total = items.find((item) => item.resourceType === 'total');
  return finite(total?.requestCount);
}

function metricsFrom(audits: Audits, score: number | null): LabMetrics {
  return {
    performanceScore: score,
    ttfbMs: numericValue(audits, 'server-response-time'),
    fcpMs: numericValue(audits, 'first-contentful-paint'),
    lcpMs: numericValue(audits, 'largest-contentful-paint'),
    clsScore: numericValue(audits, 'cumulative-layout-shift'),
    tbtMs: numericValue(audits, 'total-blocking-time'),
    speedIndexMs: numericValue(audits, 'speed-index'),
    totalBytes: numericValue(audits, 'total-byte-weight'),
    requestCount: requestCount(audits),
    unusedJavaScriptBytes: savedBytes(audits, 'unused-javascript'),
    unusedCssBytes: savedBytes(audits, 'unused-css-rules'),
    renderBlockingMs: savedMilliseconds(audits, 'render-blocking-resources'),
    uncachedBytes: savedBytes(audits, 'uses-long-cache-ttl'),
    uncompressedBytes: savedBytes(audits, 'uses-text-compression'),
    unoptimisedImageBytes: savedBytes(audits, 'modern-image-formats'),
  };
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function requestUrl(target: string, strategy: DeviceStrategy, apiKey: string | null): URL {
  const url = new URL(PAGESPEED_URL);
  url.searchParams.set('url', target);
  url.searchParams.set('strategy', strategy.toUpperCase());
  url.searchParams.append('category', 'performance');
  if (apiKey !== null && apiKey !== '') url.searchParams.set('key', apiKey);
  return url;
}

/**
 * One Lighthouse run. Throws PageSpeedError; the caller decides whether a failed
 * sample is fatal for the URL, the device, or nothing at all.
 */
export async function runPageSpeed(
  target: string,
  strategy: DeviceStrategy,
  options: PageSpeedOptions = {},
): Promise<LabSample> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? ((): Date => new Date());
  let response: Response;
  try {
    response = await fetcher(requestUrl(target, strategy, options.apiKey ?? null), {
      method: 'GET',
      signal: AbortSignal.timeout(options.timeoutMs ?? PAGESPEED_TIMEOUT_MS),
    });
  } catch (error) {
    throw new PageSpeedError(0, `PageSpeed Insights could not be reached: ${describe(error)}`);
  }
  if (!response.ok) {
    throw new PageSpeedError(
      response.status,
      `PageSpeed Insights answered HTTP ${response.status}`,
    );
  }
  const payload = (await response.json().catch(() => null)) as PageSpeedResponse | null;
  const lighthouse = payload?.lighthouseResult;
  if (lighthouse === undefined || lighthouse === null) {
    throw new PageSpeedError(502, 'PageSpeed Insights returned no Lighthouse result');
  }
  const rawScore = finite(lighthouse.categories?.performance?.score);
  return {
    url: target,
    strategy,
    collectedAt: now().toISOString(),
    lighthouseVersion:
      typeof lighthouse.lighthouseVersion === 'string' ? lighthouse.lighthouseVersion : null,
    analysedAt: isoOrNull(lighthouse.analysisUTCTimestamp),
    // Lighthouse states the category score as 0..1; the product speaks 0..100.
    metrics: metricsFrom(lighthouse.audits, rawScore === null ? null : Math.round(rawScore * 100)),
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
