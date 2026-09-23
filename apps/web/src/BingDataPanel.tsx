// The Bing section of a report. It sits beside the Google panel inside the
// Analytics card, and it is deliberately a panel of its own: Bing is a separate
// grant over a separate index, and a reader has to be able to tell which search
// engine a number came from.
//
// Three things it will not do:
//
//   * show a zero it did not measure. Each of the two Bing reads — daily traffic
//     and top queries — can fail on its own, and the half that failed is named
//     instead of being printed as 0;
//   * compare Bing's average position with Search Console's. They are different
//     measurements over different indexes, so the number is shown as Bing's own
//     and never differenced against Google's;
//   * score anything. Bing coverage is informational in this release, so its
//     findings are shown as notes and take no part in any score;
//   * read the API's English back to a reader who asked for Ukrainian. States
//     and findings are both written in the reader's language — the findings from
//     their code and evidence numbers (`bing-findings-copy.ts`), with the stored
//     sentence kept only as the fallback for a code this build does not know.

import type { BingDataSnapshot, BingDataState, BingFinding, BingSection, ScanModule } from './api';
import { bingFindingText } from './bing-findings-copy';
import { CheckRow } from './CheckRow';
import { copy, fillCopy, type Language } from './i18n';
import { asRecord } from './module-metadata';
import { formatCount } from './GoogleDataPanel';

/** Keyed by `Language`, so the English and Ukrainian panels share one type. */
type BingCopy = (typeof copy)[Language]['report']['bing'];

const STATE_TITLE_KEYS: Readonly<Record<BingDataState, keyof BingCopy>> = {
  connected: 'stateConnected',
  not_connected: 'stateNotConnected',
  no_property_selected: 'stateNoSiteSelected',
  needs_reconnect: 'stateNeedsReconnect',
  no_access: 'stateNoAccess',
  no_data: 'stateNoData',
  not_verified: 'stateNotVerified',
  request_failed: 'stateRequestFailed',
};

const STATE_DETAIL_KEYS: Readonly<Record<BingDataState, keyof BingCopy>> = {
  connected: 'detailConnected',
  not_connected: 'detailNotConnected',
  no_property_selected: 'detailNoSiteSelected',
  needs_reconnect: 'detailNeedsReconnect',
  no_access: 'detailNoAccess',
  no_data: 'detailNoData',
  not_verified: 'detailNotVerified',
  request_failed: 'detailRequestFailed',
};

function isSnapshot(value: unknown): value is BingDataSnapshot {
  const record = asRecord(value);
  return record !== null && record.source === 'bing' && asRecord(record.webmaster) !== null;
}

/**
 * The Bing section the Analytics module stored, or null for a report that has
 * none — every scan run before Bing existed, and every deployment without it.
 */
export function bingSectionIn(module: ScanModule): BingSection | null {
  const section = asRecord(asRecord(module.metadata)?.bing);
  if (section === null || !isSnapshot(section.snapshot)) return null;
  const findings = section.findings;
  return {
    snapshot: section.snapshot,
    findings: Array.isArray(findings) ? (findings as readonly BingFinding[]) : [],
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toISOString().replace('T', ' ').slice(0, 16);
}

function Unavailable(props: { state: BingDataState; detail: string; language: Language }) {
  const t = copy[props.language].report.bing;
  const titleKey = STATE_TITLE_KEYS[props.state];
  const detailKey = STATE_DETAIL_KEYS[props.state];
  return (
    <div className="google-panel__unavailable" role="status">
      <strong>{titleKey === undefined ? props.state : t[titleKey]}</strong>
      {/* The API sends an English sentence with every state; it is the fallback
          for a state this build has no key for, never the default. */}
      <p className="muted">{detailKey === undefined ? props.detail : t[detailKey]}</p>
    </div>
  );
}

export function BingDataPanel({ section, language }: { section: BingSection; language: Language }) {
  const t = copy[language].report.bing;
  const { snapshot, findings } = section;
  const summary = snapshot.webmaster.data;
  return (
    <div className="module-checks__group google-panel">
      <h4 className="module-checks__subheading">{t.panelTitle}</h4>
      <p className="muted">
        {t.sourceNote}{' '}
        <span className="technical">
          {snapshot.dateRange.startDate} → {snapshot.dateRange.endDate}
        </span>{' '}
        · {t.lastFetched} <span className="technical">{formatTimestamp(snapshot.fetchedAt)}</span>{' '}
        UTC
      </p>
      {summary === null ? (
        <Unavailable
          state={snapshot.webmaster.state}
          detail={snapshot.webmaster.detail}
          language={language}
        />
      ) : (
        <>
          <p className="muted technical">{summary.siteUrl}</p>
          {summary.totals === null ? (
            <p className="muted" role="status">
              {t.trafficUnavailable}
            </p>
          ) : (
            <div className="report-meta" aria-label={t.metricsLabel}>
              <span>
                <small>{t.clicks}</small>
                <strong className="technical">{formatCount(summary.totals.clicks)}</strong>
              </span>
              <span>
                <small>{t.impressions}</small>
                <strong className="technical">{formatCount(summary.totals.impressions)}</strong>
              </span>
              <span>
                <small>{t.ctr}</small>
                <strong className="technical">{formatPercent(summary.totals.ctr)}</strong>
              </span>
              <span>
                {/* Days reported, not days in the period: a site Bing has only
                    tracked for a week must not read as four weeks of zeroes. */}
                <small>{t.daysReported}</small>
                <strong className="technical">{formatCount(summary.totals.days)}</strong>
              </span>
            </div>
          )}
          {summary.previousTotals === null ? null : (
            <p className="muted">
              {fillCopy(t.previousPeriod, {
                clicks: formatCount(summary.previousTotals.clicks),
                impressions: formatCount(summary.previousTotals.impressions),
              })}
            </p>
          )}
          {summary.topQueries === null ? (
            <p className="muted" role="status">
              {t.queriesUnavailable}
            </p>
          ) : summary.topQueries.length === 0 ? null : (
            <div className="google-panel__scroll">
              <table className="google-panel__table">
                <caption>{t.topQueries}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t.query}</th>
                    <th scope="col">{t.clicks}</th>
                    <th scope="col">{t.impressions}</th>
                    <th scope="col">{t.ctr}</th>
                    <th scope="col">{t.bingPosition}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.topQueries.map((row) => (
                    <tr key={row.query}>
                      <td className="technical">{row.query}</td>
                      <td>{formatCount(row.clicks)}</td>
                      <td>{formatCount(row.impressions)}</td>
                      <td>{formatPercent(row.ctr)}</td>
                      <td>
                        {row.avgImpressionPosition === null
                          ? '—'
                          : row.avgImpressionPosition.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">{t.positionNote}</p>
            </div>
          )}
        </>
      )}
      {findings.length === 0 ? null : (
        <div className="module-checks__group">
          <h5 className="google-panel__service">{t.findingsHeading}</h5>
          <p className="muted">{t.findingsNote}</p>
          <ul className="module-checks__list">
            {findings.map((finding) => {
              // The API's sentence is English; the reader's language is not
              // necessarily. Rebuilt from the code and the evidence numbers,
              // with the stored sentence as the fallback (bing-findings-copy.ts).
              const text = bingFindingText(finding, language);
              return (
                <CheckRow
                  key={finding.code}
                  // Never a failure colour: an informational finding that is
                  // styled as an issue reads as something the score was cut for.
                  resultClass="skipped"
                  resultLabel={
                    finding.severity === 'attention' ? t.severityAttention : t.severityInfo
                  }
                  title={text.summary}
                  detail={`${finding.code} · ${text.recommendation}`}
                />
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
