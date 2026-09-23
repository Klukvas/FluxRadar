// Shared vocabulary for the Bing Webmaster Tools data flow.
//
// It deliberately mirrors the Google one (integrations/google/types.ts) state
// for state, because the report renders both with the same component and a user
// reading "no property selected" must mean the same thing on either side. What
// it does NOT do is share a snapshot: Bing data and Google data are separate
// grants over separate search engines, they are stored under separate module
// metadata keys, and neither is ever merged into the other or used as a
// stand-in for it. No value here is produced by, or passed to, an AI provider.

/**
 * Why a Bing service has (or has not) produced data. Ordered from "the owner has
 * to act" to "the provider had a bad day".
 */
export const BING_DATA_STATES = [
  /** Data was fetched and is present. */
  'connected',
  /** No IntegrationConnection row for this account. */
  'not_connected',
  /** Connected, but the account never picked a Bing site for this profile. */
  'no_property_selected',
  /** Token refresh failed or the grant was revoked; the owner must reconnect. */
  'needs_reconnect',
  /** Authenticated, but this Bing account cannot read the selected site. */
  'no_access',
  /** The site is readable, but Bing reports no rows for the period. */
  'no_data',
  /** The site exists in the account but Bing has not verified ownership of it. */
  'not_verified',
  /** Timeout, quota or provider error. Transient by assumption. */
  'request_failed',
] as const;

export type BingDataState = (typeof BING_DATA_STATES)[number];

/** One entry of Bing's `GetUserSites`. */
export interface BingSite {
  /** The site URL exactly as Bing stated it; Bing matches on this string. */
  readonly siteUrl: string;
  readonly isVerified: boolean;
}

export interface BingDateRange {
  readonly startDate: string;
  readonly endDate: string;
}

/**
 * One row of Bing's `GetQueryStats`, reduced to the fields the report uses.
 *
 * ONE ROW IS ONE QUERY ON ONE DAY, not a query's period total. Bing returns its
 * whole retained history, so a query that had traffic on twenty days arrives as
 * twenty rows; `snapshot.ts` is what turns them into the period totals the
 * report shows.
 */
export interface BingQueryRow {
  readonly query: string;
  readonly clicks: number;
  readonly impressions: number;
  /** Derived, not reported: Bing states clicks and impressions but no rate. */
  readonly ctr: number;
  /**
   * Bing's `AvgImpressionPosition`. It is NOT the same measurement as Search
   * Console's `position`, so the two are never averaged or compared numerically.
   */
  readonly avgImpressionPosition: number | null;
  readonly avgClickPosition: number | null;
  /** The day Bing attributed the row to, ISO date; null when it stated none. */
  readonly date: string | null;
}

/**
 * One query's totals over the report period, summed from its daily rows.
 *
 * The positions are impression- and click-weighted rather than averaged: a day
 * with four impressions and a day with four thousand do not describe the site
 * equally, and a plain mean of the two is a number that means nothing. A weight
 * of zero leaves the position null, which is also what Bing does.
 */
export interface BingQueryTotal {
  readonly query: string;
  readonly clicks: number;
  readonly impressions: number;
  /** clicks / impressions over the period; 0 when there were no impressions. */
  readonly ctr: number;
  readonly avgImpressionPosition: number | null;
  readonly avgClickPosition: number | null;
  /** How many days of the period this query appeared on. */
  readonly days: number;
}

/** One day of Bing's `GetRankAndTrafficStats`. */
export interface BingTrafficDay {
  readonly date: string;
  readonly clicks: number;
  readonly impressions: number;
}

export interface BingTotals {
  readonly clicks: number;
  readonly impressions: number;
  /** clicks / impressions over the period; 0 when there were no impressions. */
  readonly ctr: number;
  /** How many days of the period Bing actually reported. */
  readonly days: number;
}

/** One of the two reads the Bing section makes. Named so a failure can say which. */
export type BingRead = 'traffic' | 'queries';

export interface BingSiteSummary {
  readonly siteUrl: string;
  /**
   * Period totals, or null when the traffic read itself failed.
   *
   * Null rather than zeroes: "Bing sent no clicks" and "we could not ask Bing
   * about clicks" send a reader to completely different places, and only one of
   * them is a fact about the site.
   */
  readonly totals: BingTotals | null;
  /** The same totals for the period immediately before; null when Bing had none. */
  readonly previousTotals: BingTotals | null;
  /**
   * The period's leading queries, one row per query. Null when the query read
   * failed; empty when Bing reported none inside the period.
   */
  readonly topQueries: readonly BingQueryTotal[] | null;
  readonly dailyTraffic: readonly BingTrafficDay[];
  /** Which reads did not answer. Empty when the section is complete. */
  readonly unavailableReads: readonly BingRead[];
}

export interface BingServiceResult<T> {
  readonly state: BingDataState;
  /** User-facing sentence. Never contains a status code or provider payload. */
  readonly detail: string;
  readonly data: T | null;
}

/**
 * What the Analytics scan module stores under `bing` in `metadataJson`, and what
 * the report and the export render. `readOnly` is persisted rather than assumed
 * so an exported report still states the access level it was produced under.
 */
export interface BingDataSnapshot {
  readonly source: 'bing';
  readonly readOnly: true;
  readonly fetchedAt: string;
  readonly dateRange: BingDateRange;
  readonly webmaster: BingServiceResult<BingSiteSummary>;
}

/**
 * Every query of the period, as period totals, for the checks. Never stored
 * whole — the snapshot keeps only the leading rows.
 */
export interface BingQueryDetail {
  readonly queries: readonly BingQueryTotal[];
  /**
   * False when this list is not the period's whole truth: the row cap was hit,
   * or Bing sent rows whose day could not be read and which are therefore in no
   * period at all. Anything derived from the totals has to say so.
   */
  readonly queriesComplete: boolean;
  /** Daily rows Bing returned for days outside the report period. */
  readonly rowsOutsidePeriod: number;
  /** Daily rows Bing returned with no readable date, counted nowhere else. */
  readonly rowsWithoutDate: number;
}

/** What one scan collected from Bing: the stored snapshot and the rows behind it. */
export interface BingScanData {
  readonly snapshot: BingDataSnapshot;
  /** Null whenever the snapshot carries no Bing data. */
  readonly detail: BingQueryDetail | null;
}
