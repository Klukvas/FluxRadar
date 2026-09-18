// What the Analytics checks found beyond pass or fail (D-219): the organic
// trend they judged, the queries close to the top results, and the pages with
// the most search impressions next to the findings the report raised on them.
// Rendered under the check list in the Analytics card, above the Google data.

import {
  analyticsAnalysisOf,
  type AnalyticsTrend,
  type QueryOpportunity,
  type TopPageFindings,
} from './analytics-checks';
import type { ScanModule } from './api';
import { formatCount } from './GoogleDataPanel';
import { copy, fillCopy, type Language } from './i18n';

export function AnalyticsDetails(props: { module: ScanModule; language: Language }) {
  const analysis = analyticsAnalysisOf(props.module.metadata);
  if (analysis === null) return null;
  return (
    <>
      <TrendGroup trend={analysis.trend} language={props.language} />
      <NearTopGroup queries={analysis.nearTop} language={props.language} />
      <TopPagesGroup pages={analysis.topPages} language={props.language} />
    </>
  );
}

function TrendGroup(props: { trend: AnalyticsTrend | null; language: Language }) {
  const t = copy[props.language].report.checks;
  return (
    <div className="module-checks__group">
      <h4 className="module-checks__subheading">{t.analyticsTrendHeading}</h4>
      <p className="muted">
        {props.trend === null ? t.analyticsTrendNone : trendLine(props.trend, props.language)}
      </p>
    </div>
  );
}

function NearTopGroup(props: { queries: readonly QueryOpportunity[]; language: Language }) {
  const t = copy[props.language].report.checks;
  const google = copy[props.language].report.google;
  return (
    <div className="module-checks__group">
      <h4 className="module-checks__subheading">{t.analyticsNearHeading}</h4>
      <p className="muted">
        {props.queries.length === 0 ? t.analyticsNearNone : t.analyticsNearLead}
      </p>
      {props.queries.length === 0 ? null : (
        <div className="google-panel__scroll">
          <table className="google-panel__table">
            <thead>
              <tr>
                <th scope="col">{google.query}</th>
                <th scope="col">{google.impressions}</th>
                <th scope="col">{google.position}</th>
              </tr>
            </thead>
            <tbody>
              {props.queries.map((query) => (
                <tr key={query.query}>
                  <td className="technical">{query.query}</td>
                  <td>{formatCount(query.impressions)}</td>
                  <td>{query.position.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TopPagesGroup(props: { pages: readonly TopPageFindings[]; language: Language }) {
  if (props.pages.length === 0) return null;
  const t = copy[props.language].report.checks;
  const google = copy[props.language].report.google;
  return (
    <div className="module-checks__group">
      <h4 className="module-checks__subheading">{t.analyticsTopPagesHeading}</h4>
      <p className="muted">{t.analyticsTopPagesLead}</p>
      <div className="google-panel__scroll">
        <table className="google-panel__table">
          <thead>
            <tr>
              <th scope="col">{google.page}</th>
              <th scope="col">{google.impressions}</th>
              <th scope="col">{google.clicks}</th>
              <th scope="col">{t.analyticsFindingsColumn}</th>
              <th scope="col">{t.analyticsSeverityColumn}</th>
            </tr>
          </thead>
          <tbody>
            {props.pages.map((page) => (
              <tr key={page.url}>
                <td className="technical">{page.url}</td>
                <td>{formatCount(page.impressions)}</td>
                <td>{formatCount(page.clicks)}</td>
                <td>
                  {formatCount(page.findings)}
                  {page.ruleIds.length === 0 ? null : (
                    <small className="google-panel__rules technical">
                      {page.ruleIds.join(' · ')}
                    </small>
                  )}
                </td>
                <td>{page.highestSeverity ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function trendLine(trend: AnalyticsTrend, language: Language): string {
  const t = copy[language].report.checks;
  const template = trend.metric === 'clicks' ? t.analyticsTrendClicks : t.analyticsTrendImpressions;
  return fillCopy(template, {
    previous: formatCount(trend.previous),
    current: formatCount(trend.current),
    change: signedPercent(trend),
  });
}

/**
 * A typographic minus, so a fall never reads as a hyphenated range. The size is
 * rounded before the sign is put on, as the API rounds the drop in its finding:
 * Math.round(-67.5) is -67, and the card must not say 67 where the Issue Center
 * says 68.
 */
function signedPercent(trend: AnalyticsTrend): string {
  if (trend.previous === 0) return '—';
  const change = (trend.current - trend.previous) / trend.previous;
  const size = Math.round(Math.abs(change) * 100);
  if (size === 0) return '0%';
  return change > 0 ? `+${size}%` : `−${size}%`;
}
