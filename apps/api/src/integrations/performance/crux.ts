// Chrome UX Report (CrUX) field client.
//
// This is the only source of INP in the product. CrUX aggregates what real
// Chrome visitors experienced over a rolling 28-day window, so a site with too
// little traffic has no record at all — which is a distinct answer from "the
// request failed" and from "the site is fast", and is reported as its own state.
//
// The origin is queried rather than the URL: a per-URL record needs far more
// traffic to exist, so asking for one turns most sites into `no_data` when the
// origin would have answered. The scope travels with the result so nothing reads
// an origin figure as a page figure.

import type { FieldMetrics, FieldResult } from './types.ts';

const CRUX_URL = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';

export const CRUX_TIMEOUT_MS = 20_000;

export interface CruxOptions {
  readonly apiKey?: string | null;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

interface CruxMetric {
  readonly percentiles?: { readonly p75?: unknown };
}

interface CruxDate {
  readonly year?: unknown;
  readonly month?: unknown;
  readonly day?: unknown;
}

interface CruxResponse {
  readonly record?: {
    readonly metrics?: Readonly<Record<string, CruxMetric>>;
    readonly collectionPeriod?: {
      readonly firstDate?: CruxDate;
      readonly lastDate?: CruxDate;
    };
  };
}

const NOT_CONFIGURED_DETAIL =
  'Real-visitor data was not requested: no Chrome UX Report API key is configured.';
const NO_DATA_DETAIL =
  'The Chrome UX Report has no record for this origin, which means too few Chrome visitors to ' +
  'report on. Interaction to Next Paint cannot be measured without it — a lab run never produces it.';
const REQUEST_FAILED_DETAIL =
  'The Chrome UX Report did not answer. Lab measurements below are unaffected.';
const AVAILABLE_DETAIL =
  'Real-visitor 75th percentiles from the Chrome UX Report, aggregated over its rolling window.';

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** CrUX states CLS percentiles as decimal strings ("0.05"), unlike its millisecond metrics. */
function numberOrDecimalString(value: unknown): number | null {
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) return Number(value);
  return finite(value);
}

function isoDate(date: CruxDate | undefined): string | null {
  const year = finite(date?.year);
  const month = finite(date?.month);
  const day = finite(date?.day);
  if (year === null || month === null || day === null) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function metricsFrom(response: CruxResponse): FieldMetrics | null {
  const metrics = response.record?.metrics;
  if (metrics === undefined) return null;
  const period = response.record?.collectionPeriod;
  const field: FieldMetrics = {
    lcpP75Ms: finite(metrics.largest_contentful_paint?.percentiles?.p75),
    inpP75Ms: finite(metrics.interaction_to_next_paint?.percentiles?.p75),
    clsP75: numberOrDecimalString(metrics.cumulative_layout_shift?.percentiles?.p75),
    ttfbP75Ms: finite(metrics.experimental_time_to_first_byte?.percentiles?.p75),
    periodStart: isoDate(period?.firstDate),
    periodEnd: isoDate(period?.lastDate),
  };
  const anyMeasured =
    field.lcpP75Ms !== null ||
    field.inpP75Ms !== null ||
    field.clsP75 !== null ||
    field.ttfbP75Ms !== null;
  return anyMeasured ? field : null;
}

/**
 * The field section for one origin. Never throws: field data is an enrichment,
 * and a CrUX outage must leave the lab measurements intact.
 */
export async function fetchFieldMetrics(
  origin: string,
  options: CruxOptions = {},
): Promise<FieldResult> {
  const apiKey = options.apiKey ?? null;
  if (apiKey === null || apiKey === '') {
    return {
      state: 'not_configured',
      scope: 'origin',
      detail: NOT_CONFIGURED_DETAIL,
      metrics: null,
    };
  }
  const fetcher = options.fetcher ?? fetch;
  const url = new URL(CRUX_URL);
  url.searchParams.set('key', apiKey);
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin }),
      signal: AbortSignal.timeout(options.timeoutMs ?? CRUX_TIMEOUT_MS),
    });
    if (response.status === 404) {
      // CrUX's documented answer for an origin it has no record for.
      return { state: 'no_data', scope: 'origin', detail: NO_DATA_DETAIL, metrics: null };
    }
    if (!response.ok) {
      return {
        state: 'request_failed',
        scope: 'origin',
        detail: REQUEST_FAILED_DETAIL,
        metrics: null,
      };
    }
    const payload = (await response.json().catch(() => null)) as CruxResponse | null;
    const metrics = payload === null ? null : metricsFrom(payload);
    return metrics === null
      ? { state: 'no_data', scope: 'origin', detail: NO_DATA_DETAIL, metrics: null }
      : { state: 'available', scope: 'origin', detail: AVAILABLE_DETAIL, metrics };
  } catch {
    return {
      state: 'request_failed',
      scope: 'origin',
      detail: REQUEST_FAILED_DETAIL,
      metrics: null,
    };
  }
}
