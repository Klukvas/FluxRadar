// The Google section of a report. It renders numbers only when Google actually
// returned them; every other case gets its own explanation, so "no property
// selected", "no access" and "Google was unreachable" never look alike.

import type { GoogleDataSnapshot, GoogleDataState, ScanModule, SearchConsoleRow } from './api';
import { Panel } from './components';

const STATE_TITLES: Readonly<Record<GoogleDataState, string>> = {
  connected: 'Data received',
  not_connected: 'Google not connected',
  no_property_selected: 'No property linked',
  needs_reconnect: 'Reconnect required',
  no_access: 'No access to this property',
  no_data: 'No data for this period',
  request_failed: 'Google data unavailable',
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

function Unavailable(props: { state: GoogleDataState; detail: string }) {
  return (
    <div className="google-panel__unavailable" role="status">
      <strong>{STATE_TITLES[props.state]}</strong>
      <p className="muted">{props.detail}</p>
    </div>
  );
}

function Metrics(props: { items: readonly { label: string; value: string }[] }) {
  return (
    <div className="report-meta" aria-label="Google metrics">
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
}) {
  if (props.rows.length === 0) return null;
  return (
    <table className="google-panel__table">
      <caption>{props.caption}</caption>
      <thead>
        <tr>
          <th scope="col">{props.columnLabel}</th>
          <th scope="col">Clicks</th>
          <th scope="col">Impressions</th>
          <th scope="col">CTR</th>
          <th scope="col">Position</th>
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

export function GoogleDataPanel({ snapshot }: { snapshot: GoogleDataSnapshot }) {
  const { searchConsole, analytics } = snapshot;
  return (
    <Panel title="Google data" className="google-panel">
      <p className="muted">
        Source: Google Search Console and Google Analytics 4 · read-only · period{' '}
        <span className="technical">
          {snapshot.dateRange.startDate} → {snapshot.dateRange.endDate}
        </span>{' '}
        · last fetched <span className="technical">{formatTimestamp(snapshot.fetchedAt)}</span> UTC
      </p>

      <section aria-label="Google Search Console">
        <h3 className="section-heading">Search Console</h3>
        {searchConsole.data === null ? (
          <Unavailable state={searchConsole.state} detail={searchConsole.detail} />
        ) : (
          <>
            <p className="muted technical">{searchConsole.data.siteUrl}</p>
            <Metrics
              items={[
                { label: 'Clicks', value: formatCount(searchConsole.data.totals.clicks) },
                { label: 'Impressions', value: formatCount(searchConsole.data.totals.impressions) },
                { label: 'CTR', value: formatPercent(searchConsole.data.totals.ctr) },
                {
                  label: 'Average position',
                  value: searchConsole.data.totals.position.toFixed(1),
                },
              ]}
            />
            <RowTable
              caption="Top queries"
              columnLabel="Query"
              rows={searchConsole.data.topQueries}
            />
            <RowTable caption="Top pages" columnLabel="Page" rows={searchConsole.data.topPages} />
          </>
        )}
      </section>

      <section aria-label="Google Analytics 4">
        <h3 className="section-heading">Analytics 4</h3>
        {analytics.data === null ? (
          <Unavailable state={analytics.state} detail={analytics.detail} />
        ) : (
          <>
            <p className="muted technical">
              {analytics.data.propertyName ?? `Property ${analytics.data.propertyId}`}
            </p>
            <Metrics
              items={[
                { label: 'Users', value: formatCount(analytics.data.users) },
                { label: 'Sessions', value: formatCount(analytics.data.sessions) },
                { label: 'Page views', value: formatCount(analytics.data.pageViews) },
                { label: 'Events', value: formatCount(analytics.data.events) },
                ...(analytics.data.keyEvents === null
                  ? []
                  : [{ label: 'Key events', value: formatCount(analytics.data.keyEvents) }]),
              ]}
            />
          </>
        )}
      </section>
    </Panel>
  );
}
