// Builds the Bing section of a report.
//
// It is assembled from the same two reads the scan-time client makes and never
// from anything else: no value here is inferred from the Google section, and no
// value is produced by an AI provider. A field FluxRadar did not receive from
// Bing is null, and the state beside it says why.

import { fetchBingQueryStats, fetchBingTrafficStats } from './api.ts';
import {
  bingReportDateRange,
  daysWithin,
  isWithin,
  previousBingDateRange,
  totalsFor,
} from './date-range.ts';
import { detailFor, detailOf, stateOf } from './errors.ts';
import type { BingRequestOptions } from './http.ts';
import type { BingBinding } from './store.ts';
import type { BingAccess } from './tokens.ts';
import type {
  BingDataSnapshot,
  BingDataState,
  BingDateRange,
  BingQueryDetail,
  BingQueryRow,
  BingQueryTotal,
  BingScanData,
  BingSiteSummary,
} from './types.ts';

/** Query rows the report shows. The rest stay in the detail for the checks. */
const TOP_QUERY_LIMIT = 10;

/**
 * Queries kept at all, after the daily rows have been added up.
 *
 * The cap is on distinct queries, not on Bing's rows: capping the rows would cut
 * a query's own days in half and understate the query that happened to be last
 * in the payload. When it bites, `queriesComplete` says so.
 */
const QUERY_ROW_LIMIT = 1_000;

const MISSING_SCOPE_DETAIL =
  'The Bing authorization does not include read access. Reconnect Bing Webmaster Tools to grant it.';

/** One of the two reads answered and the other did not; the section says which. */
const PARTIAL_READ_DETAIL =
  'Bing answered part of this section. The missing half is named rather than shown as zero.';

function result<T>(state: BingDataState, detail: string, data: T | null) {
  return { state, detail, data } as const;
}

/** Snapshot for a state that applies to the whole connection, not one read. */
export function bingConnectionStateSnapshot(
  state: BingDataState,
  detail: string,
  now: Date,
): BingDataSnapshot {
  return {
    source: 'bing',
    readOnly: true,
    fetchedAt: now.toISOString(),
    dateRange: bingReportDateRange(now),
    webmaster: result<BingSiteSummary>(state, detail, null),
  };
}

function topQueries(queries: readonly BingQueryTotal[]): readonly BingQueryTotal[] {
  // Bing does not promise an order, so the report sorts by the number it is
  // about to show rather than trusting the payload's sequence.
  return [...queries].sort((left, right) => right.clicks - left.clicks).slice(0, TOP_QUERY_LIMIT);
}

/** Running sums for one query, before they are turned into its totals. */
interface QueryAccumulator {
  query: string;
  clicks: number;
  impressions: number;
  impressionPositionWeighted: number;
  /**
   * Impressions behind `impressionPositionWeighted`, which is NOT the query's
   * impressions: Bing reports a position as `null` for some rows, and a day with
   * no position has no place in an average of positions. Counting its
   * impressions in the denominator anyway would divide a real numerator by a
   * larger weight and report a better position than the site actually had.
   */
  impressionPositionWeight: number;
  clickPositionWeighted: number;
  /** Clicks behind `clickPositionWeighted`, for the same reason. */
  clickPositionWeight: number;
  days: number;
}

function weightedPosition(weighted: number, weight: number): number | null {
  return weight === 0 ? null : Number((weighted / weight).toFixed(2));
}

/**
 * The report period's queries, from the daily rows Bing returned.
 *
 * Three things happen here, and all three used to be missing: the rows are
 * restricted to the period the section is labelled with, the days of one query
 * are added up into one row, and what could not be placed in the period is
 * counted rather than quietly folded in. Without the first two, a "top queries"
 * table showed the same query several times, each with one day's clicks, next to
 * a totals figure covering twenty-eight — and the concentration check divided by
 * the sum of that.
 */
export function queriesWithin(
  rows: readonly BingQueryRow[],
  range: BingDateRange,
): BingQueryDetail {
  const totals = new Map<string, QueryAccumulator>();
  let rowsOutsidePeriod = 0;
  let rowsWithoutDate = 0;
  for (const row of rows) {
    if (row.date === null) {
      // A row Bing gave no readable day for belongs to no period. It is counted,
      // not dropped silently and not added to the period's numbers.
      rowsWithoutDate += 1;
      continue;
    }
    if (!isWithin(range, row.date)) {
      rowsOutsidePeriod += 1;
      continue;
    }
    const accumulated = totals.get(row.query) ?? {
      query: row.query,
      clicks: 0,
      impressions: 0,
      impressionPositionWeighted: 0,
      impressionPositionWeight: 0,
      clickPositionWeighted: 0,
      clickPositionWeight: 0,
      days: 0,
    };
    const impressionPosition = row.avgImpressionPosition;
    const clickPosition = row.avgClickPosition;
    totals.set(row.query, {
      query: accumulated.query,
      clicks: accumulated.clicks + row.clicks,
      impressions: accumulated.impressions + row.impressions,
      impressionPositionWeighted:
        accumulated.impressionPositionWeighted +
        (impressionPosition === null ? 0 : impressionPosition * row.impressions),
      impressionPositionWeight:
        accumulated.impressionPositionWeight + (impressionPosition === null ? 0 : row.impressions),
      clickPositionWeighted:
        accumulated.clickPositionWeighted +
        (clickPosition === null ? 0 : clickPosition * row.clicks),
      clickPositionWeight:
        accumulated.clickPositionWeight + (clickPosition === null ? 0 : row.clicks),
      days: accumulated.days + 1,
    });
  }
  const queries = [...totals.values()]
    .map((entry): BingQueryTotal => ({
      query: entry.query,
      clicks: entry.clicks,
      impressions: entry.impressions,
      ctr: entry.impressions === 0 ? 0 : entry.clicks / entry.impressions,
      avgImpressionPosition: weightedPosition(
        entry.impressionPositionWeighted,
        entry.impressionPositionWeight,
      ),
      avgClickPosition: weightedPosition(entry.clickPositionWeighted, entry.clickPositionWeight),
      days: entry.days,
    }))
    .sort((left, right) => right.clicks - left.clicks || left.query.localeCompare(right.query));
  return {
    queries: queries.slice(0, QUERY_ROW_LIMIT),
    // Complete means "these totals are the period's totals". A cap that bit, or
    // a row nobody could place in time, makes that claim false.
    queriesComplete: queries.length <= QUERY_ROW_LIMIT && rowsWithoutDate === 0,
    rowsOutsidePeriod,
    rowsWithoutDate,
  };
}

export interface BingSnapshotParams {
  readonly access: BingAccess;
  readonly binding: BingBinding;
  readonly now: Date;
  readonly requestOptions?: BingRequestOptions;
}

/**
 * The Bing section for one scan.
 *
 * The two reads are issued together and neither can hide the other: a failing
 * query-stats call still leaves the traffic totals, because both are surfaced
 * through one summary whose figures are whichever of them answered. What is NOT
 * done is inventing the missing half — an absent query list stays absent.
 */
export async function fetchBingScanData(params: BingSnapshotParams): Promise<BingScanData> {
  const range = bingReportDateRange(params.now);
  const options = params.requestOptions ?? {};
  const { siteUrl } = params.binding;
  if (siteUrl === null) {
    return {
      snapshot: bingConnectionStateSnapshot(
        'no_property_selected',
        detailFor('no_property_selected'),
        params.now,
      ),
      detail: null,
    };
  }
  if (!params.access.hasWebmasterScope) {
    return {
      snapshot: bingConnectionStateSnapshot('no_access', MISSING_SCOPE_DETAIL, params.now),
      detail: null,
    };
  }

  const [traffic, queries] = await Promise.allSettled([
    fetchBingTrafficStats(params.access.accessToken, siteUrl, options),
    fetchBingQueryStats(params.access.accessToken, siteUrl, options),
  ]);

  if (traffic.status === 'rejected' && queries.status === 'rejected') {
    // Both reads failed: the section has no data at all, and the traffic call's
    // state is the one reported because it is the one that decides the totals.
    return {
      snapshot: bingConnectionStateSnapshot(
        stateOf(traffic.reason),
        detailOf(traffic.reason),
        params.now,
      ),
      detail: null,
    };
  }

  const trafficDays = traffic.status === 'fulfilled' ? traffic.value : null;
  // Both reads return the site's whole retained history, so both are cut to the
  // period the section is labelled with — the queries by their own day, exactly
  // as the traffic days are.
  const queryDetail = queries.status === 'fulfilled' ? queriesWithin(queries.value, range) : null;
  const queryRows = queryDetail === null ? null : queryDetail.queries;
  const withinPeriod = trafficDays === null ? null : daysWithin(trafficDays, range);
  const previous =
    trafficDays === null ? [] : daysWithin(trafficDays, previousBingDateRange(range));

  // "No data" is a statement about the site, so it may only be made when both
  // reads actually answered. A failed read produces the summary below with that
  // half missing instead.
  if (withinPeriod?.length === 0 && queryRows?.length === 0) {
    return {
      snapshot: bingConnectionStateSnapshot('no_data', detailFor('no_data'), params.now),
      detail: null,
    };
  }

  const summary: BingSiteSummary = {
    siteUrl,
    totals: withinPeriod === null ? null : totalsFor(withinPeriod),
    previousTotals: previous.length === 0 ? null : totalsFor(previous),
    topQueries: queryRows === null ? null : topQueries(queryRows),
    dailyTraffic:
      withinPeriod === null
        ? []
        : [...withinPeriod].sort((left, right) => left.date.localeCompare(right.date)),
    unavailableReads: [
      ...(trafficDays === null ? (['traffic'] as const) : []),
      ...(queryRows === null ? (['queries'] as const) : []),
    ],
  };
  return {
    snapshot: {
      source: 'bing',
      readOnly: true,
      fetchedAt: params.now.toISOString(),
      dateRange: range,
      webmaster: result<BingSiteSummary>(
        'connected',
        summary.unavailableReads.length === 0 ? detailFor('connected') : PARTIAL_READ_DETAIL,
        summary,
      ),
    },
    detail: queryDetail,
  };
}

export function hasBingData(snapshot: BingDataSnapshot): boolean {
  return snapshot.webmaster.data !== null;
}
