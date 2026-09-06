// Google Search Console read-only client (Search Console API v3). Only the two
// endpoints the product needs are implemented: site listing for discovery and
// searchAnalytics.query for the report period.

import { googleJson, type GoogleRequestOptions } from './http.ts';
import type {
  DateRange,
  SearchConsoleRow,
  SearchConsoleSite,
  SearchConsoleSummary,
  SearchConsoleTotals,
} from './types.ts';

const SITES_URL = 'https://www.googleapis.com/webmasters/v3/sites';
const TOP_ROW_LIMIT = 10;

/** Verified-but-unreadable entries would only produce 403s later. */
const READABLE_PERMISSIONS = new Set(['siteOwner', 'siteFullUser', 'siteRestrictedUser']);

interface SitesResponse {
  readonly siteEntry?: readonly {
    readonly siteUrl?: unknown;
    readonly permissionLevel?: unknown;
  }[];
}

interface QueryResponse {
  readonly rows?: readonly {
    readonly keys?: readonly unknown[];
    readonly clicks?: unknown;
    readonly impressions?: unknown;
    readonly ctr?: unknown;
    readonly position?: unknown;
  }[];
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function listSearchConsoleSites(
  accessToken: string,
  options: GoogleRequestOptions = {},
): Promise<readonly SearchConsoleSite[]> {
  const response = await googleJson<SitesResponse>({ url: SITES_URL, accessToken }, options);
  return (response.siteEntry ?? []).flatMap((entry) => {
    const siteUrl = entry.siteUrl;
    const permissionLevel = entry.permissionLevel;
    if (typeof siteUrl !== 'string' || typeof permissionLevel !== 'string') return [];
    if (!READABLE_PERMISSIONS.has(permissionLevel)) return [];
    return [{ siteUrl, permissionLevel }];
  });
}

function queryUrl(siteUrl: string): string {
  return `${SITES_URL}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
}

async function query(
  accessToken: string,
  siteUrl: string,
  range: DateRange,
  dimensions: readonly string[],
  options: GoogleRequestOptions,
): Promise<QueryResponse> {
  return googleJson<QueryResponse>(
    {
      url: queryUrl(siteUrl),
      accessToken,
      body: {
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions,
        rowLimit: dimensions.length === 0 ? 1 : TOP_ROW_LIMIT,
      },
    },
    options,
  );
}

function toRows(response: QueryResponse): readonly SearchConsoleRow[] {
  return (response.rows ?? []).flatMap((row) => {
    const key = row.keys?.[0];
    if (typeof key !== 'string') return [];
    return [
      {
        key,
        clicks: numberOrZero(row.clicks),
        impressions: numberOrZero(row.impressions),
        ctr: numberOrZero(row.ctr),
        position: numberOrZero(row.position),
      },
    ];
  });
}

function toTotals(response: QueryResponse): SearchConsoleTotals | null {
  const row = response.rows?.[0];
  if (row === undefined) return null;
  return {
    clicks: numberOrZero(row.clicks),
    impressions: numberOrZero(row.impressions),
    ctr: numberOrZero(row.ctr),
    position: numberOrZero(row.position),
  };
}

/**
 * Period totals plus the top queries and pages. Returns null when Search
 * Console has no rows at all for the period — an authorized property with no
 * traffic is "no data", not a failure.
 */
export async function fetchSearchConsoleSummary(
  accessToken: string,
  siteUrl: string,
  range: DateRange,
  options: GoogleRequestOptions = {},
): Promise<SearchConsoleSummary | null> {
  const totalsResponse = await query(accessToken, siteUrl, range, [], options);
  const totals = toTotals(totalsResponse);
  if (totals === null) {
    return null;
  }
  const [queries, pages] = await Promise.all([
    query(accessToken, siteUrl, range, ['query'], options),
    query(accessToken, siteUrl, range, ['page'], options),
  ]);
  return {
    siteUrl,
    totals,
    topQueries: toRows(queries),
    topPages: toRows(pages),
  };
}
