// The report dashboard of one finished scan.
//
// Everything on it is written for a site owner: the score, the coverage and the
// findings are explained in place, and a section that could not be measured says
// so instead of showing a zero that would read like a bad result.

import { useCallback, useEffect, useState } from 'react';

import { apiRequest, type Dashboard, type ExportPayload, type Scan, type ScanModule } from './api';
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
import { copy, fillCopy, type Language } from './i18n';
import { modulesBeyondPlan } from './plan-modules';
import { chipStatusFor, displayDomain, moduleResultLabel, moduleScoreLabel } from './scan-status';
import { statusKind } from './status-kind';

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
  // No weighted module at all means the plan carries no score by definition —
  // not that this particular scan came back empty. Read from the tariff weights
  // the API already sends rather than from the plan name, so a plan that gains
  // weights later stops taking this branch on its own.
  // The `score === null` half is belt-and-braces: a plan with weights always
  // reports them, so a number arriving without any is a contract the UI does not
  // understand — and hiding a real score behind this branch would be its own lie.
  const unscoredPlan = overall.moduleWeights.length === 0 && overall.score === null;
  const checksLine = checksSummary(dashboard.modules, props.language);
  return (
    <div className="stack">
      <Window title={`${t.windowTitle} · ${displayDomain(scan.domain)}`}>
        <div className="split">
          <div>
            <h2 className="section-heading">{t.signalHeading}</h2>
            <div className="report-meta" aria-label={t.detailsLabel}>
              <span>
                <small>{t.siteAddress}</small>
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
          {unscoredPlan ? (
            <div className="score-dial" role="status" aria-label={t.unscoredLabel}>
              <div className="score-dial__number">—</div>
              <div className="score-dial__label">{t.unscoredLabel}</div>
              <div className="score-dial__coverage">{checksLine}</div>
            </div>
          ) : (
            <ScoreDial
              score={overall.score}
              verdict={overall.verdict}
              coverage={overall.weightedCoverage}
            />
          )}
        </div>
        {unscoredPlan ? (
          <p className="muted">{fillCopy(t.unscoredLead, { plan: scan.plan })}</p>
        ) : null}
        <section className="report-help" aria-label={t.helpHeading}>
          <h3 className="section-heading">{t.helpHeading}</h3>
          <dl className="report-help__list">
            <div>
              <dt>{t.helpScoreTerm}</dt>
              <dd>
                {unscoredPlan
                  ? fillCopy(t.unscoredScoreBody, { plan: scan.plan })
                  : t.helpScoreBody}
              </dd>
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
            // The card wears its own result: a section on a finished report is a
            // terminal fact, and the accent edge says which kind before the chip
            // beside it is read. Colour is never the only carrier — the chip
            // carries the same fact in words.
            <div
              className={`module-card module-card--${statusKind(chipStatusFor(module))}`}
              key={module.module}
            >
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
                {moduleScoreLabel(module, props.language)}
              </div>
              <ModuleMetadata module={module} scored={!unscoredPlan} />
              {module.usableOutput && module.coverage !== null ? (
                // Named, and drawn as a measurement rather than as progress: an
                // unlabelled zebra bar at 100% beside a Completed chip was the
                // one thing on this card that still looked like a running scan.
                <ProgressBar
                  variant="result"
                  caption={t.helpCoverageTerm}
                  value={module.coverage * 100}
                  label={`${module.module} coverage`}
                />
              ) : (
                <div className="module-card__coverage-unavailable" role="status">
                  {moduleResultLabel(module, props.language)} · {t.coverageUnavailable}
                </div>
              )}
            </div>
          ))}
        </div>
        <PlanScope modules={dashboard.modules} plan={scan.plan} language={props.language} />
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
          {scan.id} · {scan.rulesetVersion} ·{' '}
          {unscoredPlan ? checksLine : `coverage ${(overall.weightedCoverage * 100).toFixed(0)}%`}
        </div>
      </Window>
    </div>
  );
}

/**
 * The one line an unscored report can put where the coverage number goes.
 *
 * Completed checks, not a percentage: on a plan with no score weights the
 * weighted coverage is 0 by construction, and printing it would repeat the very
 * claim this screen exists to stop making. A scan that read nothing says so.
 *
 * Both halves are counted over the modules that produced usable output, so the
 * ratio stays a statement about one set of results. Counting the denominator
 * over every module would fold in checks belonging to a module that returned
 * nothing, and the line would read as a shortfall in the checks that did run.
 */
function checksSummary(modules: readonly ScanModule[], language: Language): string {
  const t = copy[language].report;
  const usable = modules.filter((module) => module.usableOutput);
  if (usable.length === 0) {
    return t.unscoredChecksNone;
  }
  return fillCopy(t.unscoredChecks, {
    completed: sumChecks(usable, (module) => module.completedApplicableChecks),
    applicable: sumChecks(usable, (module) => module.applicableChecks),
  });
}

function sumChecks(
  modules: readonly ScanModule[],
  select: (module: ScanModule) => number | null,
): number {
  return modules.reduce((total, module) => total + (select(module) ?? 0), 0);
}

/**
 * What this plan looked at, and what it did not.
 *
 * The cards above show the sections that ran; a section the plan does not carry
 * sends no module row at all, so its absence is invisible. That is how a Free
 * report came to read as a clean bill of health for security and accessibility,
 * which were never opened. The right-hand list names them and the plan that adds
 * each one, taken from the tariff matrix rather than from a sales page.
 *
 * A native `<details>` because the answer is a footnote, not the report: shut by
 * default, keyboard-operable and announced as a disclosure without a line of
 * script or a single ARIA attribute of our own.
 */
function PlanScope(props: {
  modules: readonly ScanModule[];
  plan: Scan['plan'];
  language: Language;
}) {
  const t = copy[props.language].report;
  const locked = modulesBeyondPlan(props.plan);
  return (
    <details className="plan-scope">
      <summary className="plan-scope__summary">
        {fillCopy(t.scopeSummary, { plan: props.plan })}
      </summary>
      <p className="muted plan-scope__lead">{t.scopeLead}</p>
      <div className="plan-scope__columns">
        <section aria-label={t.scopeIncludedTerm}>
          <h4 className="plan-scope__term">{t.scopeIncludedTerm}</h4>
          <ul className="plan-scope__list">
            {props.modules.map((module) => (
              <li key={module.module}>
                <strong>{module.module}</strong>
                <span className="plan-scope__detail">{scopeDetail(module, props.language)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label={t.scopeLockedTerm}>
          <h4 className="plan-scope__term">{t.scopeLockedTerm}</h4>
          {locked.length === 0 ? (
            <p className="muted plan-scope__detail">{t.scopeLockedNone}</p>
          ) : (
            <ul className="plan-scope__list">
              {locked.map((entry) => (
                <li key={entry.module}>
                  <strong>{entry.module}</strong>
                  <span className="plan-scope__detail">
                    {fillCopy(t.scopeUnlock, { plan: entry.plan })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </details>
  );
}

/**
 * One line about what a section that ran actually did.
 *
 * Everything in it comes off the module row: how it ended, how many of its
 * applicable checks closed, and — where the row recorded them, as the Free check
 * does — the names of the checks themselves. Nothing is filled in from the plan.
 */
function scopeDetail(module: ScanModule, language: Language): string {
  const t = copy[language].report;
  const parts = [moduleResultLabel(module, language)];
  if (module.completedApplicableChecks !== null && module.applicableChecks !== null) {
    parts.push(
      fillCopy(t.scopeChecks, {
        completed: module.completedApplicableChecks,
        applicable: module.applicableChecks,
      }),
    );
  }
  parts.push(...checkTitles(module.metadata));
  return parts.join(' · ');
}

function ModuleMetadata({ module, scored }: { module: ScanModule; scored: boolean }) {
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
    // The Free check runs four homepage rules and none of the structured-data or
    // social-preview ones, so the paid module's line would name checks that
    // never ran. What the module row itself recorded wins; failing that, a scan
    // known not to be the full module says nothing rather than something false.
    const checks = checkTitles(module.metadata);
    if (checks.length > 0) {
      return <small className="module-card__meta">{checks.join(' · ')}</small>;
    }
    return scored ? (
      <small className="module-card__meta">JSON-LD · Open Graph · Twitter Cards</small>
    ) : null;
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

/** Titles of the checks a module row says it ran; empty when it recorded none. */
function checkTitles(metadata: Readonly<Record<string, unknown>> | undefined): readonly string[] {
  const checks = metadata?.checks;
  if (!Array.isArray(checks)) {
    return [];
  }
  return checks.flatMap((entry: unknown) => {
    const title = asRecord(entry)?.title;
    return typeof title === 'string' && title !== '' ? [title] : [];
  });
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
