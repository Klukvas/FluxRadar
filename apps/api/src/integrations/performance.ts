import { readIntegrationConfig } from './config.ts';

export interface PerformanceSnapshot {
  readonly source: 'pagespeed' | 'crux' | 'pagespeed+crux';
  readonly origin: string;
  readonly strategy: 'desktop' | 'mobile';
  readonly performanceScore: number | null;
  readonly metrics: Readonly<Record<string, number | string | null>>;
  readonly fetchedAt: string;
}

export interface PerformanceRunnerOptions {
  readonly pageSpeedApiKey?: string | null;
  readonly cruxApiKey?: string | null;
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
}

interface PageSpeedResponse {
  readonly lighthouseResult?: {
    readonly categories?: { readonly performance?: { readonly score?: unknown } };
    readonly audits?: Readonly<
      Record<string, { readonly numericValue?: unknown; readonly score?: unknown }>
    >;
  };
}

interface CruxResponse {
  readonly record?: {
    readonly metrics?: Readonly<
      Record<string, { readonly percentiles?: { readonly p75?: unknown } }>
    >;
  };
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metricValue(
  audits: Readonly<Record<string, { readonly numericValue?: unknown }>> | undefined,
  key: string,
): number | null {
  return numeric(audits?.[key]?.numericValue);
}

async function jsonRequest<T>(url: URL, init: RequestInit, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || payload === null) throw new Error('performance provider request failed');
  return payload;
}

async function pageSpeed(
  origin: string,
  strategy: 'desktop' | 'mobile',
  apiKey: string | null,
  fetcher: typeof fetch,
): Promise<{
  readonly score: number | null;
  readonly metrics: Readonly<Record<string, number | null>>;
}> {
  const url = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  url.searchParams.set('url', origin);
  url.searchParams.set('strategy', strategy.toUpperCase());
  url.searchParams.append('category', 'performance');
  if (apiKey !== null) url.searchParams.set('key', apiKey);
  const response = await jsonRequest<PageSpeedResponse>(url, {}, fetcher);
  const lighthouse = response.lighthouseResult;
  const score = numeric(lighthouse?.categories?.performance?.score);
  const audits = lighthouse?.audits;
  return {
    score: score === null ? null : Math.round(score * 10000) / 100,
    metrics: {
      ttfbMs: metricValue(audits, 'server-response-time'),
      lcpMs: metricValue(audits, 'largest-contentful-paint'),
      inpMs: metricValue(audits, 'interaction-to-next-paint'),
      cls: metricValue(audits, 'cumulative-layout-shift'),
      htmlBytes: metricValue(audits, 'total-byte-weight'),
    },
  };
}

async function crux(
  origin: string,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<Readonly<Record<string, number | null>>> {
  const url = new URL('https://chromeuxreport.googleapis.com/v1/records:queryRecord');
  url.searchParams.set('key', apiKey);
  const response = await jsonRequest<CruxResponse>(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin }),
    },
    fetcher,
  );
  const metrics = response.record?.metrics;
  return {
    lcpP75Ms: numeric(metrics?.largest_contentful_paint?.percentiles?.p75),
    inpP75Ms: numeric(metrics?.interaction_to_next_paint?.percentiles?.p75),
    clsP75: numeric(metrics?.cumulative_layout_shift?.percentiles?.p75),
  };
}

export function createDefaultPerformanceRunner():
  ((origin: string, strategy: 'desktop' | 'mobile') => Promise<PerformanceSnapshot>) | undefined {
  const config = readIntegrationConfig();
  if (config.pageSpeedApiKey === null && config.cruxApiKey === null) return undefined;
  return createPerformanceRunner({
    ...(config.pageSpeedApiKey === null ? {} : { pageSpeedApiKey: config.pageSpeedApiKey }),
    ...(config.cruxApiKey === null ? {} : { cruxApiKey: config.cruxApiKey }),
  });
}

export function createPerformanceRunner(
  options: PerformanceRunnerOptions,
): (origin: string, strategy: 'desktop' | 'mobile') => Promise<PerformanceSnapshot> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  return async (origin, strategy) => {
    const pageSpeedResult =
      options.pageSpeedApiKey === undefined
        ? null
        : await pageSpeed(origin, strategy, options.pageSpeedApiKey, fetcher);
    const cruxResult = options.cruxApiKey ? await crux(origin, options.cruxApiKey, fetcher) : null;
    if (pageSpeedResult === null && cruxResult === null)
      throw new Error('performance provider is not configured');
    return {
      source:
        pageSpeedResult !== null && cruxResult !== null
          ? 'pagespeed+crux'
          : pageSpeedResult !== null
            ? 'pagespeed'
            : 'crux',
      origin,
      strategy,
      performanceScore: pageSpeedResult?.score ?? null,
      metrics: { ...(pageSpeedResult?.metrics ?? {}), ...(cruxResult ?? {}) },
      fetchedAt: now().toISOString(),
    };
  };
}
