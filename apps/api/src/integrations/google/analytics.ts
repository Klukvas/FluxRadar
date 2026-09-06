// Google Analytics 4 read-only client. Discovery uses the Admin API account
// summaries (one call returns every property the user can read); the report
// period uses the Data API runReport.

import { GoogleApiError } from './errors.ts';
import { googleJson, type GoogleRequestOptions } from './http.ts';
import type { DateRange, Ga4Property, Ga4Summary } from './types.ts';

const ACCOUNT_SUMMARIES_URL =
  'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200';
const DATA_API_BASE = 'https://analyticsdata.googleapis.com/v1beta/properties';

/** Metrics every GA4 property exposes. */
const CORE_METRICS = ['totalUsers', 'sessions', 'screenPageViews', 'eventCount'] as const;
/**
 * GA4 replaced `conversions` with `keyEvents`. Properties that predate the
 * rename reject it outright, so it is requested separately and degrades to null
 * instead of failing the whole Analytics section.
 */
const KEY_EVENTS_METRIC = 'keyEvents';

interface AccountSummariesResponse {
  readonly accountSummaries?: readonly {
    readonly displayName?: unknown;
    readonly propertySummaries?: readonly {
      readonly property?: unknown;
      readonly displayName?: unknown;
    }[];
  }[];
}

interface RunReportResponse {
  readonly rows?: readonly { readonly metricValues?: readonly { readonly value?: unknown }[] }[];
  readonly metricHeaders?: readonly { readonly name?: unknown }[];
}

function propertyIdFrom(resourceName: unknown): string | null {
  if (typeof resourceName !== 'string') return null;
  const id = resourceName.startsWith('properties/') ? resourceName.slice('properties/'.length) : '';
  return /^\d+$/.test(id) ? id : null;
}

export async function listGa4Properties(
  accessToken: string,
  options: GoogleRequestOptions = {},
): Promise<readonly Ga4Property[]> {
  const response = await googleJson<AccountSummariesResponse>(
    { url: ACCOUNT_SUMMARIES_URL, accessToken },
    options,
  );
  return (response.accountSummaries ?? []).flatMap((account) => {
    const accountName = typeof account.displayName === 'string' ? account.displayName : '';
    return (account.propertySummaries ?? []).flatMap((summary) => {
      const propertyId = propertyIdFrom(summary.property);
      if (propertyId === null) return [];
      return [
        {
          propertyId,
          displayName: typeof summary.displayName === 'string' ? summary.displayName : propertyId,
          accountName,
        },
      ];
    });
  });
}

function metricValues(response: RunReportResponse): readonly number[] | null {
  const row = response.rows?.[0];
  if (row === undefined) return null;
  return (row.metricValues ?? []).map((metric) => {
    const parsed = Number(metric.value);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

async function runReport(
  accessToken: string,
  propertyId: string,
  range: DateRange,
  metrics: readonly string[],
  options: GoogleRequestOptions,
): Promise<RunReportResponse> {
  return googleJson<RunReportResponse>(
    {
      url: `${DATA_API_BASE}/${encodeURIComponent(propertyId)}:runReport`,
      accessToken,
      body: {
        dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
        metrics: metrics.map((name) => ({ name })),
        limit: 1,
      },
    },
    options,
  );
}

async function optionalKeyEvents(
  accessToken: string,
  propertyId: string,
  range: DateRange,
  options: GoogleRequestOptions,
): Promise<number | null> {
  try {
    const response = await runReport(accessToken, propertyId, range, [KEY_EVENTS_METRIC], options);
    return metricValues(response)?.[0] ?? null;
  } catch (error) {
    // A revoked grant still has to surface; only a rejected metric is ignored.
    if (error instanceof GoogleApiError && error.state === 'needs_reconnect') throw error;
    return null;
  }
}

/**
 * Period totals for one GA4 property. Returns null when the property reports no
 * rows for the period, which GA4 does for a property with no traffic.
 */
export async function fetchGa4Summary(
  accessToken: string,
  propertyId: string,
  propertyName: string | null,
  range: DateRange,
  options: GoogleRequestOptions = {},
): Promise<Ga4Summary | null> {
  const response = await runReport(accessToken, propertyId, range, CORE_METRICS, options);
  const values = metricValues(response);
  if (values === null) {
    return null;
  }
  const [users = 0, sessions = 0, pageViews = 0, events = 0] = values;
  return {
    propertyId,
    propertyName,
    users,
    sessions,
    pageViews,
    events,
    keyEvents: await optionalKeyEvents(accessToken, propertyId, range, options),
  };
}
