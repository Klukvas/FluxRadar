// Shared vocabulary for the Google data flow. Every surface — discovery route,
// scan snapshot and report UI — reports one of these states, so a missing
// property, a revoked grant and a provider outage never collapse into the same
// "unavailable" message.

/**
 * Why a Google service has (or has not) produced data. Ordered from "user has
 * to act" to "provider had a bad day"; the UI renders a distinct explanation
 * per value and never shows a raw HTTP status.
 */
export const GOOGLE_DATA_STATES = [
  /** Data was fetched and is present. */
  'connected',
  /** No IntegrationConnection row for this account. */
  'not_connected',
  /** Connected, but the account never picked a property for this site. */
  'no_property_selected',
  /** Token refresh failed or the grant was revoked; the user must reconnect. */
  'needs_reconnect',
  /** Authenticated, but the Google account cannot read this property. */
  'no_access',
  /** Authorized and readable, but the period contains zero rows. */
  'no_data',
  /** Timeout, quota or provider error. Transient by assumption. */
  'request_failed',
] as const;

export type GoogleDataState = (typeof GOOGLE_DATA_STATES)[number];

export interface SearchConsoleSite {
  readonly siteUrl: string;
  readonly permissionLevel: string;
}

export interface Ga4Property {
  /** Bare numeric id, without the `properties/` resource prefix. */
  readonly propertyId: string;
  readonly displayName: string;
  readonly accountName: string;
}

export interface DateRange {
  readonly startDate: string;
  readonly endDate: string;
}

export interface SearchConsoleRow {
  readonly key: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  readonly position: number;
}

export interface SearchConsoleTotals {
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  readonly position: number;
}

export interface SearchConsoleSummary {
  readonly siteUrl: string;
  readonly totals: SearchConsoleTotals;
  readonly topQueries: readonly SearchConsoleRow[];
  readonly topPages: readonly SearchConsoleRow[];
}

export interface Ga4Summary {
  readonly propertyId: string;
  readonly propertyName: string | null;
  readonly users: number;
  readonly sessions: number;
  readonly pageViews: number;
  readonly events: number;
  /**
   * GA4 renamed `conversions` to `keyEvents`; older properties may reject the
   * metric entirely, so it stays optional rather than failing the whole report.
   */
  readonly keyEvents: number | null;
}

export interface GoogleServiceResult<T> {
  readonly state: GoogleDataState;
  /** User-facing sentence. Never contains a status code or provider payload. */
  readonly detail: string;
  readonly data: T | null;
}

/**
 * What the Analytics scan module stores in `metadataJson` and what the report
 * renders. `readOnly` is persisted rather than assumed so an exported report
 * still states the access level it was produced under.
 */
export interface GoogleDataSnapshot {
  readonly source: 'google';
  readonly readOnly: true;
  readonly fetchedAt: string;
  readonly dateRange: DateRange;
  readonly searchConsole: GoogleServiceResult<SearchConsoleSummary>;
  readonly analytics: GoogleServiceResult<Ga4Summary>;
}
