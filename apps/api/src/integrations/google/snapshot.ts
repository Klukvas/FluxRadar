// Builds the Google section of a report. Each service resolves independently:
// a GA4 outage must not hide Search Console data, and neither may ever be
// represented by a value FluxRadar did not receive from Google.

import { fetchGa4Summary } from './analytics.ts';
import { detailFor, detailOf, stateOf } from './errors.ts';
import type { GoogleRequestOptions } from './http.ts';
import { fetchSearchConsoleData } from './search-console.ts';
import type { GoogleAccess } from './tokens.ts';
import { reportDateRange } from './date-range.ts';
import type {
  DateRange,
  Ga4Summary,
  GoogleDataSnapshot,
  GoogleDataState,
  GoogleScanData,
  GoogleServiceResult,
  SearchConsoleDetail,
  SearchConsoleSummary,
} from './types.ts';

export interface GoogleBinding {
  readonly searchConsoleSiteUrl: string | null;
  readonly ga4PropertyId: string | null;
  readonly ga4PropertyName: string | null;
}

const MISSING_SCOPE_DETAIL =
  'The Google authorization does not include this service. Reconnect Google to grant read-only access.';

function result<T>(state: GoogleDataState, detail: string, data: T | null): GoogleServiceResult<T> {
  return { state, detail, data };
}

function unavailable<T>(state: GoogleDataState): GoogleServiceResult<T> {
  return result<T>(state, detailFor(state), null);
}

/** Snapshot for a state that applies to the whole connection, not one service. */
export function connectionStateSnapshot(
  state: GoogleDataState,
  detail: string,
  now: Date,
): GoogleDataSnapshot {
  return {
    source: 'google',
    readOnly: true,
    fetchedAt: now.toISOString(),
    dateRange: reportDateRange(now),
    searchConsole: result<SearchConsoleSummary>(state, detail, null),
    analytics: result<Ga4Summary>(state, detail, null),
  };
}

interface SearchConsoleSection {
  readonly result: GoogleServiceResult<SearchConsoleSummary>;
  readonly detail: SearchConsoleDetail | null;
}

function withoutDetail(result: GoogleServiceResult<SearchConsoleSummary>): SearchConsoleSection {
  return { result, detail: null };
}

async function searchConsoleSection(
  access: GoogleAccess,
  binding: GoogleBinding,
  range: DateRange,
  options: GoogleRequestOptions,
): Promise<SearchConsoleSection> {
  if (binding.searchConsoleSiteUrl === null) {
    return withoutDetail(unavailable<SearchConsoleSummary>('no_property_selected'));
  }
  if (!access.hasSearchConsoleScope) {
    return withoutDetail(result<SearchConsoleSummary>('no_access', MISSING_SCOPE_DETAIL, null));
  }
  try {
    const data = await fetchSearchConsoleData(
      access.accessToken,
      binding.searchConsoleSiteUrl,
      range,
      options,
    );
    return data === null
      ? withoutDetail(unavailable<SearchConsoleSummary>('no_data'))
      : {
          result: result<SearchConsoleSummary>('connected', detailFor('connected'), data.summary),
          detail: data.detail,
        };
  } catch (error) {
    return withoutDetail(result<SearchConsoleSummary>(stateOf(error), detailOf(error), null));
  }
}

async function analyticsSection(
  access: GoogleAccess,
  binding: GoogleBinding,
  range: DateRange,
  options: GoogleRequestOptions,
): Promise<GoogleServiceResult<Ga4Summary>> {
  if (binding.ga4PropertyId === null) return unavailable<Ga4Summary>('no_property_selected');
  if (!access.hasAnalyticsScope) {
    return result<Ga4Summary>('no_access', MISSING_SCOPE_DETAIL, null);
  }
  try {
    const summary = await fetchGa4Summary(
      access.accessToken,
      binding.ga4PropertyId,
      binding.ga4PropertyName,
      range,
      options,
    );
    return summary === null
      ? unavailable<Ga4Summary>('no_data')
      : result<Ga4Summary>('connected', detailFor('connected'), summary);
  } catch (error) {
    return result<Ga4Summary>(stateOf(error), detailOf(error), null);
  }
}

export interface SnapshotParams {
  readonly access: GoogleAccess;
  readonly binding: GoogleBinding;
  readonly now: Date;
  readonly requestOptions?: GoogleRequestOptions;
}

export async function fetchGoogleScanData(params: SnapshotParams): Promise<GoogleScanData> {
  const range = reportDateRange(params.now);
  const options = params.requestOptions ?? {};
  const [searchConsole, analytics] = await Promise.all([
    searchConsoleSection(params.access, params.binding, range, options),
    analyticsSection(params.access, params.binding, range, options),
  ]);
  return {
    snapshot: {
      source: 'google',
      readOnly: true,
      fetchedAt: params.now.toISOString(),
      dateRange: range,
      searchConsole: searchConsole.result,
      analytics,
    },
    searchConsoleDetail: searchConsole.detail,
  };
}

export function hasGoogleData(snapshot: GoogleDataSnapshot): boolean {
  return snapshot.searchConsole.data !== null || snapshot.analytics.data !== null;
}
