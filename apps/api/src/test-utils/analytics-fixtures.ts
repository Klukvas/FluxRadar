// Builders for the Analytics check tests: a snapshot, the Search Console rows
// behind it, and crawl facts, each defaulting to "connected, nothing wrong".

import type { AnalyticsPageFact } from '@fluxradar/rules';

import { connectionStateSnapshot } from '../integrations/google/snapshot.ts';
import type {
  Ga4Summary,
  GoogleDataSnapshot,
  SearchConsoleDetail,
  SearchConsoleRow,
  SearchConsoleSummary,
} from '../integrations/google/types.ts';
import type { AnalyticsCheckInput } from '../orchestrator/analytics/types.ts';

export const NOW = new Date('2026-09-18T10:00:00.000Z');
export const ORIGIN = 'https://example.com';

export function row(key: string, overrides: Partial<SearchConsoleRow> = {}): SearchConsoleRow {
  return { key, clicks: 5, impressions: 100, ctr: 0.05, position: 4, ...overrides };
}

export function searchConsoleSummary(
  overrides: Partial<SearchConsoleSummary> = {},
): SearchConsoleSummary {
  return {
    siteUrl: 'sc-domain:example.com',
    totals: { clicks: 100, impressions: 5000, ctr: 0.02, position: 12 },
    previousTotals: { clicks: 100, impressions: 5000, ctr: 0.02, position: 12 },
    topQueries: [],
    topPages: [],
    ...overrides,
  };
}

export function ga4Summary(overrides: Partial<Ga4Summary> = {}): Ga4Summary {
  return {
    propertyId: '123',
    propertyName: 'example.com',
    users: 400,
    sessions: 500,
    pageViews: 1500,
    events: 4000,
    keyEvents: 12,
    ...overrides,
  };
}

export function snapshotWith(
  searchConsole: SearchConsoleSummary | null,
  analytics: Ga4Summary | null,
): GoogleDataSnapshot {
  const base = connectionStateSnapshot('no_property_selected', 'pick one', NOW);
  return {
    ...base,
    searchConsole:
      searchConsole === null
        ? base.searchConsole
        : { state: 'connected', detail: 'ok', data: searchConsole },
    analytics:
      analytics === null ? base.analytics : { state: 'connected', detail: 'ok', data: analytics },
  };
}

export function detail(overrides: Partial<SearchConsoleDetail> = {}): SearchConsoleDetail {
  return { queries: [], pages: [], pagesComplete: true, ...overrides };
}

export function page(path: string, overrides: Partial<AnalyticsPageFact> = {}): AnalyticsPageFact {
  const url = `${ORIGIN}${path}`;
  return { url, indexable: true, hasGoogleTag: true, ...overrides };
}

export function checkInput(overrides: Partial<AnalyticsCheckInput> = {}): AnalyticsCheckInput {
  return {
    origin: ORIGIN,
    snapshot: snapshotWith(searchConsoleSummary(), ga4Summary()),
    searchConsoleDetail: detail(),
    pages: [],
    reportIssues: [],
    ...overrides,
  };
}
