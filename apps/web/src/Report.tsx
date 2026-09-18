// The report dashboard of one finished scan.
//
// Everything on it is written for a site owner: the score, the coverage and the
// findings are explained in place, and a section that could not be measured says
// so instead of showing a zero that would read like a bad result.

import { Fragment, useCallback, useEffect, useState, type MouseEvent } from 'react';

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
import { copy, fillCopy, type Language } from './i18n';
import { asRecord, numberValue } from './module-metadata';
import { hasModuleChecks, ModuleChecksPanel, moduleChecksId } from './ModuleChecks';
import { moduleStatusReasons } from './module-status';
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
  // The section whose check list is open. One at a time, so the list always
  // sits directly under the card that was clicked. Keyed by scan as well as by
  // section name: a section of the same name on another report is not the one
  // the reader opened, and must not arrive already open.
  const [openChecks, setOpenChecks] = useState<{
    readonly scanId: string;
    readonly module: string;
  } | null>(null);
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
  // No weighted module at all means the plan carries no score by definition —
  // not that this particular scan came back empty. Read from the tariff weights
  // the API already sends rather than from the plan name, so a plan that gains
  // weights later stops taking this branch on its own.
  // The `score === null` half is belt-and-braces: a plan with weights always
  // reports them, so a number arriving without any is a contract the UI does not
  // understand — and hiding a real score behind this branch would be its own lie.
  const unscoredPlan = overall.moduleWeights.length === 0 && overall.score === null;
  // A failed/cancelled run can still contain useful module results from before
  // the platform failure. Those results stay visible below, but their weighted
  // aggregate is not a completed site score and must not wear a green verdict.
  const scoreUnavailable = /failed|cancelled/i.test(scan.status);
  const checksLine = checksSummary(dashboard.modules, props.language);
  const geoObservations = dashboard.geoObservations ?? [];
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
              {scan.profileConfigVersion === undefined ? null : (
                <span>
                  <small>{t.configurationVersion}</small>
                  <strong>v{scan.profileConfigVersion}</strong>
                </span>
              )}
            </div>
          </div>
          {unscoredPlan || scoreUnavailable ? (
            <div
              className="score-dial"
              role="status"
              aria-label={scoreUnavailable ? t.verdictUnavailable : t.unscoredLabel}
            >
              <div className="score-dial__number">—</div>
              <div className="score-dial__label">
                {scoreUnavailable ? t.helpScoreTerm : t.unscoredLabel}
              </div>
              {scoreUnavailable ? (
                <StatusChip status={scan.status} label={t.verdictUnavailable} />
              ) : null}
              <div className="score-dial__coverage">{checksLine}</div>
            </div>
          ) : (
            <ScoreDial
              score={overall.score}
              language={props.language}
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
          {dashboard.modules.map((module) => {
            const expandable = hasModuleChecks(module, geoObservations);
            const open =
              expandable && openChecks?.scanId === scan.id && openChecks.module === module.module;
            const toggle = (): void =>
              setOpenChecks(open ? null : { scanId: scan.id, module: module.module });
            // The card wears its own result: a section on a finished report is a
            // terminal fact, and the accent edge says which kind before the chip
            // beside it is read. Colour is never the only carrier — the chip
            // carries the same fact in words.
            return (
              <Fragment key={module.module}>
                <div
                  className={moduleCardClass(module, expandable, open)}
                  onClick={expandable ? (event) => toggleFromCard(event, toggle) : undefined}
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
                  <ModuleMetadata
                    module={module}
                    scored={!unscoredPlan}
                    language={props.language}
                  />
                  {module.usableOutput && module.coverage !== null ? (
                    // Named, and drawn as a measurement rather than as progress: an
                    // unlabelled zebra bar at 100% beside a Completed chip was the
                    // one thing on this card that still looked like a running scan.
                    <ProgressBar
                      variant="result"
                      caption={t.helpCoverageTerm}
                      value={module.coverage * 100}
                      label={fillCopy(t.moduleCoverageLabel, { module: module.module })}
                    />
                  ) : (
                    <div className="module-card__coverage-unavailable" role="status">
                      {moduleResultLabel(module, props.language)} · {t.coverageUnavailable}
                    </div>
                  )}
                  <ModuleReasons module={module} language={props.language} />
                  {expandable ? (
                    <div className="module-card__actions">
                      <Button
                        aria-expanded={open}
                        aria-controls={moduleChecksId(module.module)}
                        onClick={toggle}
                      >
                        {open ? t.checks.hide : t.checks.show}
                      </Button>
                    </div>
                  ) : null}
                </div>
                {open ? (
                  <ModuleChecksPanel
                    module={module}
                    observations={geoObservations}
                    language={props.language}
                  />
                ) : null}
              </Fragment>
            );
          })}
        </div>
        <PlanScope modules={dashboard.modules} plan={scan.plan} language={props.language} />
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
          {unscoredPlan
            ? checksLine
            : fillCopy(t.coverageValue, {
                percent: (overall.weightedCoverage * 100).toFixed(0),
              })}
        </div>
      </Window>
    </div>
  );
}

function moduleCardClass(module: ScanModule, expandable: boolean, open: boolean): string {
  return [
    `module-card module-card--${statusKind(chipStatusFor(module))}`,
    expandable ? 'module-card--expandable' : null,
    open ? 'module-card--open' : null,
  ]
    .filter((part) => part !== null)
    .join(' ');
}

/**
 * A click anywhere on an openable card toggles its check list — except on the
 * card's own button, which toggles it already and would otherwise do it twice.
 */
function toggleFromCard(event: MouseEvent<HTMLDivElement>, toggle: () => void): void {
  if (event.target instanceof Element && event.target.closest('button') !== null) return;
  toggle();
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

/**
 * The standards one section works to, under its name.
 *
 * Standard names — WCAG 2.2 AA, OWASP ASVS, JSON-LD — are the same string in
 * every language and stay as written; the prose around them used to be English
 * literals and is now read from the dictionary, so a Ukrainian card no longer
 * mixes the two.
 */
function ModuleMetadata({
  module,
  scored,
  language,
}: {
  module: ScanModule;
  scored: boolean;
  language: Language;
}) {
  const t = copy[language].report;
  if (module.module === 'Accessibility') {
    return <small className="module-card__meta">WCAG 2.2 AA · EN 301 549 · Section 508</small>;
  }
  if (module.module === 'Security') {
    return <small className="module-card__meta">OWASP ASVS · Public Security Profile</small>;
  }
  if (module.module === 'Privacy') {
    return <small className="module-card__meta">{t.metaPrivacy}</small>;
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
    return scored ? <small className="module-card__meta">{t.metaSeo}</small> : null;
  }
  if (module.module === 'Analytics') {
    return <SideScoreMeta line={t.metaAnalytics} language={language} />;
  }
  if (module.module === 'AI SEO / GEO') {
    const pages = asRecord(module.metadata?.pages);
    const checked = numberValue(pages?.checked);
    const structured = numberValue(pages?.structuredData);
    return (
      <small className="module-card__meta">
        {t.metaAiReadiness}
        {checked !== null && structured !== null
          ? ` · ${fillCopy(t.metaAiStructured, { structured, checked })}`
          : ''}
      </small>
    );
  }
  if (module.module === 'UX/Conversion') {
    return <SideScoreMeta line={t.metaUx} language={language} />;
  }
  return null;
}

/**
 * UX/Conversion and Analytics score their own findings (§15) but carry no weight
 * in the overall score. Said on the card, so a finding there that leaves the
 * overall number unmoved does not read as a bug.
 */
function SideScoreMeta({ line, language }: { line: string; language: Language }) {
  return (
    <small className="module-card__meta">
      {line}
      <br />
      {copy[language].report.metaSideScore}
    </small>
  );
}

/**
 * Why this section ended where it did.
 *
 * The card said "Unavailable" for a Performance section with no measurement
 * service configured and for one whose provider was down, and "Not applicable"
 * for a section the product has no check for — three different things to do
 * about it, spelled with one word. The module row has carried the machine reason
 * all along; this is where it is finally read.
 */
function ModuleReasons({ module, language }: { module: ScanModule; language: Language }) {
  const reasons = moduleStatusReasons(module, language);
  if (reasons.length === 0) return null;
  return (
    <div className="module-card__reason">
      <span className="module-card__reason-label">{copy[language].report.reasonLabel}</span>
      {reasons.map((reason) => (
        <p key={reason}>{reason}</p>
      ))}
    </div>
  );
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
