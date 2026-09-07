// The report dashboard of one finished scan.
//
// Everything on it is written for a site owner: the score, the coverage and the
// findings are explained in place, and a section that could not be measured says
// so instead of showing a zero that would read like a bad result.

import { useCallback, useEffect, useState } from 'react';

import {
  apiRequest,
  type Dashboard,
  type ExportPayload,
  type Scan,
  type ScanModule,
} from './api';
import {
  Button,
  EmptyState,
  LoadingState,
  Panel,
  ProgressBar,
  ScoreDial,
  StatusChip,
  Window,
} from './components';
import { GoogleDataPanel, googleSnapshotOf } from './GoogleDataPanel';
import { copy, type Language } from './i18n';
import { chipStatusFor, displayDomain, moduleResultLabel } from './scan-status';

export function ResultsScreen(props: {
  scan: Scan | null;
  language: Language;
  onScan: (scan: Scan) => void;
  onIssues: () => void;
  onReports: () => void;
  onError: (value: string) => void;
}) {
  const t = copy[props.language].report;
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  // Kept on the screen instead of only in the app-wide dialog: a report that
  // could not be opened has to say so where the report would have been, and
  // offer the way back, rather than leaving an empty window behind an alert.
  const [failure, setFailure] = useState<string | null>(null);
  const scanId = props.scan?.id ?? null;
  const { onScan, onError } = props;
  const load = useCallback(async (): Promise<void> => {
    if (scanId === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailure(null);
    try {
      const value = await apiRequest<Dashboard>(`/scans/${scanId}/dashboard`);
      setDashboard(value);
      onScan(value.scan);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t.errorTitle;
      setFailure(message);
      onError(message);
    } finally {
      setLoading(false);
    }
  }, [scanId, onScan, onError, t.errorTitle]);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading)
    return (
      <Window title={t.loadingTitle}>
        <LoadingState />
      </Window>
    );
  if (failure !== null)
    return (
      <Window title={t.loadingTitle}>
        <Panel title={t.errorTitle}>
          <p className="muted" role="alert">
            {failure}
          </p>
          <div className="button-row">
            <Button variant="primary" onClick={() => void load()}>
              {t.retry}
            </Button>
            <Button onClick={props.onReports}>{t.emptyAction}</Button>
          </div>
        </Panel>
      </Window>
    );
  if (!dashboard)
    return (
      <Window title={t.loadingTitle}>
        <EmptyState
          title={t.emptyTitle}
          description={t.emptyBody}
          action={
            <Button variant="primary" onClick={props.onReports}>
              {t.emptyAction}
            </Button>
          }
        />
      </Window>
    );
  const { scan, overall } = dashboard;
  // Present only when the scan actually stored a Google snapshot; a plan without
  // the Analytics module renders no Google section at all.
  const googleSnapshot = googleSnapshotOf(dashboard.modules);
  return (
    <div className="stack">
      <Window title={`${t.windowTitle} · ${displayDomain(scan.domain)}`}>
        <div className="split">
          <div>
            <h2 className="section-heading">{t.signalHeading}</h2>
            <div className="report-meta" aria-label={t.detailsLabel}>
              <span>
                <small>{t.website}</small>
                <strong className="technical">{displayDomain(scan.domain)}</strong>
              </span>
              <span>
                <small>{t.plan}</small>
                <strong>{scan.plan}</strong>
              </span>
              <span>
                <small>{t.report}</small>
                <strong className="technical">{scan.id}</strong>
              </span>
            </div>
          </div>
          <ScoreDial
            score={overall.score}
            verdict={overall.verdict}
            coverage={overall.weightedCoverage}
          />
        </div>
        <section className="report-help" aria-label={t.helpHeading}>
          <h3 className="section-heading">{t.helpHeading}</h3>
          <dl className="report-help__list">
            <div>
              <dt>{t.helpScoreTerm}</dt>
              <dd>{t.helpScoreBody}</dd>
            </div>
            <div>
              <dt>{t.helpCoverageTerm}</dt>
              <dd>{t.helpCoverageBody}</dd>
            </div>
            <div>
              <dt>{t.helpFindingsTerm}</dt>
              <dd>{t.helpFindingsBody}</dd>
            </div>
          </dl>
        </section>
        <div className="module-grid">
          {dashboard.modules.map((module) => (
            <div className="module-card" key={module.module}>
              <div className="split">
                <strong>{module.module}</strong>
                <StatusChip
                  status={chipStatusFor(module)}
                  label={moduleResultLabel(module, props.language)}
                />
              </div>
              <div
                className={
                  module.score === null
                    ? 'module-card__score module-card__score--null'
                    : 'module-card__score'
                }
              >
                {module.score === null ? t.noScore : module.score.toFixed(2)}
              </div>
              <ModuleMetadata module={module} />
              {module.usableOutput && module.coverage !== null ? (
                <ProgressBar value={module.coverage * 100} label={`${module.module} coverage`} />
              ) : (
                <div className="module-card__coverage-unavailable" role="status">
                  {moduleResultLabel(module, props.language)} · {t.coverageUnavailable}
                </div>
              )}
            </div>
          ))}
        </div>
        {dashboard.modules.some((module) => module.module === 'Accessibility') ? (
          <aside className="accessibility-note" aria-label={t.accessibilityLabel}>
            <strong>{t.accessibilityTitle}</strong>
            <p>{t.accessibilityBody}</p>
            <small>{t.accessibilityNote}</small>
          </aside>
        ) : null}
        {googleSnapshot === null ? null : <GoogleDataPanel snapshot={googleSnapshot} />}
        <p className="muted report-help__cta">{t.issuesCta}</p>
        <div className="button-row">
          <Button onClick={props.onIssues} variant="primary">
            {t.openIssues}
          </Button>
          {scan.plan === 'Complete' ? (
            <ExportButtons scanId={scan.id} onError={props.onError} />
          ) : (
            <span className="muted">{t.exportComplete}</span>
          )}
          <Button onClick={props.onReports}>{copy[props.language].reports.windowTitle}</Button>
        </div>
        <div className="breadcrumb">
          {scan.id} · {scan.rulesetVersion} · coverage {(overall.weightedCoverage * 100).toFixed(0)}
          %
        </div>
      </Window>
    </div>
  );
}

function ModuleMetadata({ module }: { module: ScanModule }) {
  if (module.module === 'Accessibility') {
    return <small className="module-card__meta">WCAG 2.2 AA · EN 301 549 · Section 508</small>;
  }
  if (module.module === 'Security') {
    return <small className="module-card__meta">OWASP ASVS · Public Security Profile</small>;
  }
  if (module.module === 'Privacy') {
    return <small className="module-card__meta">Public technical consent signals</small>;
  }
  if (module.module === 'SEO') {
    return <small className="module-card__meta">JSON-LD · Open Graph · Twitter Cards</small>;
  }
  if (module.module === 'Analytics') {
    return (
      <small className="module-card__meta">Google Search Console · Analytics 4 · read-only</small>
    );
  }
  if (module.module === 'AI SEO / GEO') {
    const pages = asRecord(module.metadata?.pages);
    const checked = numberValue(pages?.checked);
    const structured = numberValue(pages?.structuredData);
    return (
      <small className="module-card__meta">
        Public AI readiness
        {checked !== null && structured !== null
          ? ` · ${structured}/${checked} pages with structured data`
          : ''}
      </small>
    );
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function ExportButtons(props: { scanId: string; onError: (value: string) => void }) {
  const downloadJson = async () => {
    try {
      const value = await apiRequest<ExportPayload>(`/scans/${props.scanId}/export?format=json`);
      download(
        `fluxradar-${props.scanId}.json`,
        JSON.stringify(value.records, null, 2),
        'application/json',
      );
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'JSON export failed');
    }
  };
  const downloadCsv = async () => {
    try {
      const value = await apiRequest<string>(`/scans/${props.scanId}/export?format=csv`);
      download(`fluxradar-${props.scanId}.csv`, value, 'text/csv');
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'CSV export failed');
    }
  };
  return (
    <>
      <Button onClick={() => void downloadJson()}>JSON</Button>
      <Button onClick={() => void downloadCsv()}>CSV</Button>
    </>
  );
}

function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
