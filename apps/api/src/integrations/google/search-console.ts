// Google Search Console read-only client (Search Console API v3). Only the two
// endpoints the product needs are implemented: site listing for discovery and
// searchAnalytics.query for the report period and the one before it.

import { googleJson, type GoogleRequestOptions } from './http.ts';
import { previousDateRange } from './date-range.ts';
import type {
  DateRange,
  SearchConsoleDetail,
  SearchConsoleRow,
  SearchConsoleSite,
  SearchConsoleSummary,
  SearchConsoleTotals,
} from './types.ts';

const SITES_URL = 'https://www.googleapis.com/webmasters/v3/sites';
/** Rows the report shows per table. */
const TOP_ROW_LIMIT = 10;
/**
 * Rows the Analytics checks read (D-219). Search Console sorts by clicks, so the
 * top rows the report shows are the head of these lists and need no request of
 * their own. The page list is longer because the no-impressions check has to see
 * every page with impressions to call one missing.
 */
const QUERY_ROW_LIMIT = 1_000;
const PAGE_ROW_LIMIT = 5_000;

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
  rowLimit: number,
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
        rowLimit,
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

export interface SearchConsoleData {
  readonly summary: SearchConsoleSummary;
  readonly detail: SearchConsoleDetail;
}

/**
 * Period totals, the previous period's totals, and every query and page row.
 * Returns null when Search Console has no rows at all for the period — an
 * authorized property with no traffic is "no data", not a failure.
 */
export async function fetchSearchConsoleData(
  accessToken: string,
  siteUrl: string,
  range: DateRange,
  options: GoogleRequestOptions = {},
): Promise<SearchConsoleData | null> {
  const totals = toTotals(await query(accessToken, siteUrl, range, [], 1, options));
  if (totals === null) {
    return null;
  }
  const [previous, queriesResponse, pagesResponse] = await Promise.all([
    query(accessToken, siteUrl, previousDateRange(range), [], 1, options),
    query(accessToken, siteUrl, range, ['query'], QUERY_ROW_LIMIT, options),
    query(accessToken, siteUrl, range, ['page'], PAGE_ROW_LIMIT, options),
  ]);
  const queries = toRows(queriesResponse);
  const pages = toRows(pagesResponse);
  return {
    summary: {
      siteUrl,
      totals,
      previousTotals: toTotals(previous),
      topQueries: queries.slice(0, TOP_ROW_LIMIT),
      topPages: pages.slice(0, TOP_ROW_LIMIT),
    },
    detail: { queries, pages, pagesComplete: pages.length < PAGE_ROW_LIMIT },
  };
}
