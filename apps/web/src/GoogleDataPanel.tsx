// The Google section of a report. It renders numbers only when Google actually
// returned them; every other case gets its own explanation, so "no property
// selected", "no access" and "Google was unreachable" never look alike.
//
// Every word on it used to be an English literal — the headings, the column
// names, the metric labels and the sentence under a state that had no data — so
// a Ukrainian report switched language for one panel. All of it now comes from
// the dictionary, including the per-state sentence: the API sends an English one
// with the snapshot and it is used only for a state this build does not know.

import type { GoogleDataSnapshot, GoogleDataState, ScanModule, SearchConsoleRow } from './api';
import { Panel } from './components';
import { copy, fillCopy, type Language } from './i18n';

type GoogleCopy = (typeof copy)['en']['report']['google'];

const STATE_TITLE_KEYS: Readonly<Record<GoogleDataState, keyof GoogleCopy>> = {
  connected: 'stateConnected',
  not_connected: 'stateNotConnected',
  no_property_selected: 'stateNoPropertySelected',
  needs_reconnect: 'stateNeedsReconnect',
  no_access: 'stateNoAccess',
  no_data: 'stateNoData',
  request_failed: 'stateRequestFailed',
};

const STATE_DETAIL_KEYS: Readonly<Record<GoogleDataState, keyof GoogleCopy>> = {
  connected: 'detailConnected',
  not_connected: 'detailNotConnected',
  no_property_selected: 'detailNoPropertySelected',
  needs_reconnect: 'detailNeedsReconnect',
  no_access: 'detailNoAccess',
  no_data: 'detailNoData',
  request_failed: 'detailRequestFailed',
};

function isSnapshot(value: unknown): value is GoogleDataSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { source?: unknown }).source === 'google'
  );
}

/** Reads the Google snapshot the Analytics module stored, if the scan produced one. */
export function googleSnapshotOf(modules: readonly ScanModule[]): GoogleDataSnapshot | null {
  const analytics = modules.find((module) => module.module === 'Analytics');
  return isSnapshot(analytics?.metadata) ? analytics.metadata : null;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toISOString().replace('T', ' ').slice(0, 16);
}

/**
 * A state with no data, named and explained.
 *
 * The sentence is written here per state rather than taken from the snapshot,
 * because the wire one is English. The wire sentence is the fallback for a state
 * this build has no key for — better the API's own words than none.
 */
function Unavailable(props: { state: GoogleDataState; detail: string; language: Language }) {
  const t = copy[props.language].report.google;
  const titleKey = STATE_TITLE_KEYS[props.state];
  const detailKey = STATE_DETAIL_KEYS[props.state];
  return (
    <div className="google-panel__unavailable" role="status">
      <strong>{titleKey === undefined ? props.state : t[titleKey]}</strong>
      <p className="muted">{detailKey === undefined ? props.detail : t[detailKey]}</p>
    </div>
  );
}

function Metrics(props: { items: readonly { label: string; value: string }[]; label: string }) {
  return (
    <div className="report-meta" aria-label={props.label}>
      {props.items.map((item) => (
        <span key={item.label}>
          <small>{item.label}</small>
          <strong className="technical">{item.value}</strong>
        </span>
      ))}
    </div>
  );
}

function RowTable(props: {
  caption: string;
  columnLabel: string;
  rows: readonly SearchConsoleRow[];
  language: Language;
}) {
  const t = copy[props.language].report.google;
  if (props.rows.length === 0) return null;
  return (
    <table className="google-panel__table">
      <caption>{props.caption}</caption>
      <thead>
        <tr>
          <th scope="col">{props.columnLabel}</th>
          <th scope="col">{t.clicks}</th>
          <th scope="col">{t.impressions}</th>
          <th scope="col">{t.ctr}</th>
          <th scope="col">{t.position}</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row) => (
          <tr key={row.key}>
            <td className="technical">{row.key}</td>
            <td>{formatCount(row.clicks)}</td>
            <td>{formatCount(row.impressions)}</td>
            <td>{formatPercent(row.ctr)}</td>
            <td>{row.position.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function GoogleDataPanel({
  snapshot,
  language,
}: {
  snapshot: GoogleDataSnapshot;
  language: Language;
}) {
  const t = copy[language].report.google;
  const { searchConsole, analytics } = snapshot;
  return (
    <Panel title={t.panelTitle} className="google-panel">
      <p className="muted">
        {t.sourceNote}{' '}
        <span className="technical">
          {snapshot.dateRange.startDate} → {snapshot.dateRange.endDate}
        </span>{' '}
        · {t.lastFetched} <span className="technical">{formatTimestamp(snapshot.fetchedAt)}</span>{' '}
        UTC
      </p>

      <section aria-label={t.searchConsoleHeading}>
        <h3 className="section-heading">{t.searchConsoleHeading}</h3>
        {searchConsole.data === null ? (
          <Unavailable
            state={searchConsole.state}
            detail={searchConsole.detail}
            language={language}
          />
        ) : (
          <>
            <p className="muted technical">{searchConsole.data.siteUrl}</p>
            <Metrics
              label={t.metricsLabel}
              items={[
                { label: t.clicks, value: formatCount(searchConsole.data.totals.clicks) },
                {
                  label: t.impressions,
                  value: formatCount(searchConsole.data.totals.impressions),
                },
                { label: t.ctr, value: formatPercent(searchConsole.data.totals.ctr) },
                {
                  label: t.averagePosition,
                  value: searchConsole.data.totals.position.toFixed(1),
                },
              ]}
            />
            <RowTable
              caption={t.topQueries}
              columnLabel={t.query}
              rows={searchConsole.data.topQueries}
              language={language}
            />
            <RowTable
              caption={t.topPages}
              columnLabel={t.page}
              rows={searchConsole.data.topPages}
              language={language}
            />
          </>
        )}
      </section>

      <section aria-label={t.analyticsHeading}>
        <h3 className="section-heading">{t.analyticsHeading}</h3>
        {analytics.data === null ? (
          <Unavailable state={analytics.state} detail={analytics.detail} language={language} />
        ) : (
          <>
            <p className="muted technical">
              {analytics.data.propertyName ??
                fillCopy(t.property, { id: analytics.data.propertyId })}
            </p>
            <Metrics
              label={t.metricsLabel}
              items={[
                { label: t.users, value: formatCount(analytics.data.users) },
                { label: t.sessions, value: formatCount(analytics.data.sessions) },
                { label: t.pageViews, value: formatCount(analytics.data.pageViews) },
                { label: t.events, value: formatCount(analytics.data.events) },
                ...(analytics.data.keyEvents === null
                  ? []
                  : [{ label: t.keyEvents, value: formatCount(analytics.data.keyEvents) }]),
              ]}
            />
          </>
        )}
      </section>
    </Panel>
  );
}
