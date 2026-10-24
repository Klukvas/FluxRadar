// The report dashboard of one finished scan.
//
// Everything on it is written for a site owner: the score, the coverage and the
// findings are explained in place, and a section that could not be measured says
// so instead of showing a zero that would read like a bad result.

import { Fragment, useCallback, useEffect, useState, type MouseEvent } from 'react';

import {
  apiDownload,
  apiRequest,
  ApiRequestError,
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
import { checkCopyTitle } from './check-titles';
import { findingsCopy } from './findings-copy';
import { geoVisibilitySummaryOf } from './geo-visibility';
import { copy, fillCopy, type Language } from './i18n';
import { asRecord, geoAnswerDigestOf, numberValue } from './module-metadata';
import { geoAwareProblemOpener, GEO_SUMMARY_MODULE } from './geo-summary-rules';
import { hasModuleChecks, ModuleChecksPanel, moduleChecksId } from './ModuleChecks';
import { moduleResponsibilities, moduleStatusReasons } from './module-status';
import {
  isLegacyPlan,
  modulesBeyondPlan,
  planIncludesExport,
  planName,
  type PaidPlan,
} from './plan-modules';
import { chipStatusFor, displayDomain, moduleResultLabel, moduleScoreLabel } from './scan-status';
import {
  checksSummary,
  FreeCheckStatus,
  reportChecksOf,
  ReportHeaderMeta,
  ReportHelp,
  ReportTechnicalDetails,
} from './ReportHeader';
import { ReportNextStepsWithSummary, useIssueSummary } from './ReportNextSteps';
import { useReportViewed } from './funnel-analytics';
import { nothingWasChecked, reportFailureCopy, siteReadFailureOf } from './report-failure-copy';
import { moduleLabel } from './rule-titles';
import { ScanComparisonPanel } from './ScanComparison';
import { SiteCoveragePanel } from './SiteCoverage';
import { statusKind } from './status-kind';

export function ResultsScreen(props: {
  scan: Scan | null;
  language: Language;
  /** The site profile's target languages; the Action Plan picker offers them first. */
  targetLanguages?: string | null;
  onScan: (scan: Scan) => void;
  onIssues: () => void;
  /** Opens the Issue Center on one problem's findings. */
  onOpenProblem?: (ruleId: string) => void;
  /**
   * Opens the scan form for the same site on `plan`: Basic from a Free report's
   * upsell, Complete from an archived report's locked Action Plan.
   */
  onUpgrade?: (scan: Scan, plan: PaidPlan) => void;
  /** Opens the printable client report. */
  onPrint?: (scan: Scan) => void;
  /** Opens another report of the same site — the previous scan's, from the
      comparison panel. Absent leaves that report named but unlinked. */
  onOpenScan?: (scanId: string) => void;
  /** Retries the one unfinished section of a Partial scan. */
  onRetry?: (scan: Scan) => Promise<void>;
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
  const { onScan, onError, onRetry } = props;
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
  // Fetched once the dashboard is here, and only here: the next-step blocks
  // and the Free result panel both count from it, and a second request for
  // the same summary could only disagree with the first.
  const issueSummary = useIssueSummary(dashboard?.scan.id ?? null);
  useReportViewed(dashboard?.scan ?? null);
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
  const geoObservations = dashboard.geoObservations ?? [];
  const geoEvidence = dashboard.geoEvidence ?? null;
  const geoVisibilitySummary = geoVisibilitySummaryOf(dashboard.geoVisibilitySummary);
  // No page of the site was read: one block explains it, and the section cards —
  // each saying the same "Unavailable" — fold into a single line.
  const siteFailure = siteReadFailureOf(scan, dashboard.modules);
  // One reading of what the checks came to, for the Free panel and the checks
  // line alike, so the two cannot disagree about an unread site.
  const checks = reportChecksOf(dashboard.modules, siteFailure !== null);
  const checksLine = checksSummary(checks, props.language);
  // Read once: the next-step blocks and the action row below both turn on it,
  // and a row offering an export of a report whose own blocks say nothing was
  // checked is the contradiction this answers.
  const checkedNothing = nothingWasChecked(scan, dashboard.modules);
  const hasGeoFactFindings = dashboard.modules.some(
    (module) =>
      module.module === GEO_SUMMARY_MODULE &&
      (geoAnswerDigestOf(module.metadata)?.facts?.groups.length ?? 0) > 0,
  );
  return (
    <div className="stack">
      <Window title={`${t.windowTitle} · ${displayDomain(scan.domain)}`}>
        <div className="split">
          <div>
            <h2 className="section-heading">{t.signalHeading}</h2>
            <ReportHeaderMeta scan={scan} language={props.language} />
          </div>
          {/* The Free panel first: a Free check of a site that could not be
              read ends as Failed, and its owner must not get the paid
              report's "Unavailable" dial for a plan that has no score. */}
          {unscoredPlan ? (
            <FreeCheckStatus checks={checks} summary={issueSummary} language={props.language} />
          ) : scoreUnavailable ? (
            <div className="score-dial" role="status" aria-label={t.verdictUnavailable}>
              <div className="score-dial__number">—</div>
              <div className="score-dial__label">{t.helpScoreTerm}</div>
              <StatusChip status={scan.status} label={t.verdictUnavailable} />
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
        {unscoredPlan ? <p className="muted">{t.unscoredLead}</p> : null}
        <ReportNextStepsWithSummary
          scan={scan}
          summary={issueSummary}
          language={props.language}
          targetLanguages={props.targetLanguages}
          onOpenProblem={geoAwareProblemOpener(props, scan.id, setOpenChecks)}
          onAllProblems={props.onIssues}
          onUpgrade={(plan) => props.onUpgrade?.(scan, plan)}
          onRetry={onRetry === undefined ? undefined : () => onRetry(scan)}
          siteFailure={siteFailure}
          nothingChecked={checkedNothing}
          hasGeoFactFindings={hasGeoFactFindings}
        />
        <ReportHelp unscoredPlan={unscoredPlan} plan={scan.plan} language={props.language} />
        {/* Before the section cards, because every coverage figure on them is
            module coverage and means something narrower than a reader assumes. */}
        {siteFailure === null ? (
          <SiteCoveragePanel summary={scan.crawlSummary} language={props.language} />
        ) : null}
        {/* Directly after the coverage panel, and before the section cards: a
            reader who has just been told how much of the site was read is in
            exactly the right place to be told what changed since last time, and
            both facts qualify every score below them. */}
        <ScanComparisonPanel
          scan={scan}
          language={props.language}
          {...(props.onOpenScan === undefined ? {} : { onOpenScan: props.onOpenScan })}
        />
        {siteFailure !== null ? (
          <UncheckedSections modules={dashboard.modules} language={props.language} />
        ) : (
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
                      evidence={geoEvidence}
                      visibilitySummary={geoVisibilitySummary}
                      language={props.language}
                      onOpenProblem={props.onOpenProblem}
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        )}
        <PlanScope modules={dashboard.modules} plan={scan.plan} language={props.language} />
        {/* A report that checked nothing has nothing to open, print or export:
            an Issue Center with no findings, a PDF of "Nothing was checked" and
            a JSON file of an empty list were four dead ends under a block that
            had just said to run the scan again. The way back to the reports
            list stays, and so does that block's own guidance. */}
        {checkedNothing ? (
          <>
            <p className="muted report-help__cta">{reportFailureCopy[props.language].noExports}</p>
            <div className="button-row">
              <Button onClick={props.onReports} variant="primary">
                {copy[props.language].reports.windowTitle}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="muted report-help__cta">{t.issuesCta}</p>
            <div className="button-row">
              <Button onClick={props.onIssues} variant="primary">
                {t.openIssues}
              </Button>
              {/* The server-rendered document and the printable page are both
                  offered, in that order: the download carries every finding, and
                  the page is the fallback that needs no server work when it
                  cannot. */}
              {scan.plan === 'Free' ? null : (
                <PdfDownloadButton scan={scan} language={props.language} onError={props.onError} />
              )}
              {props.onPrint === undefined ? null : (
                <Button onClick={() => props.onPrint?.(scan)} aria-describedby="print-hint">
                  {findingsCopy[props.language].print.open}
                </Button>
              )}
              {planIncludesExport(scan.plan) ? (
                <ExportButtons scan={scan} onError={props.onError} />
              ) : (
                <span className="muted">{t.exportComplete}</span>
              )}
              <Button onClick={props.onReports}>{copy[props.language].reports.windowTitle}</Button>
            </div>
            {scan.plan === 'Free' ? null : (
              <p id="pdf-hint" className="muted report-print-hint">
                {findingsCopy[props.language].download.pdfHint}
              </p>
            )}
            {props.onPrint === undefined ? null : (
              <p id="print-hint" className="muted report-print-hint">
                {findingsCopy[props.language].print.openHint}
              </p>
            )}
          </>
        )}
        <ReportTechnicalDetails
          scan={scan}
          language={props.language}
          checksFigure={
            unscoredPlan
              ? checksLine
              : fillCopy(t.coverageValue, {
                  percent: (overall.weightedCoverage * 100).toFixed(0),
                })
          }
        />
      </Window>
    </div>
  );
}

/** The section cards of a site that could not be read, as one line of names. */
function UncheckedSections(props: { modules: readonly ScanModule[]; language: Language }) {
  if (props.modules.length === 0) return null;
  const names = props.modules.map((module) => moduleLabel(module.module, props.language));
  return (
    <p className="muted" role="status">
      {reportFailureCopy[props.language].sectionsNotChecked(names.join(', '))}
    </p>
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
        {fillCopy(t.scopeSummary, { plan: planName(props.plan, props.language) })}
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
            <p className="muted plan-scope__detail">
              {isLegacyPlan(props.plan) ? t.scopeLockedArchived : t.scopeLockedNone}
            </p>
          ) : (
            <ul className="plan-scope__list">
              {locked.map((entry) => (
                <li key={entry.module}>
                  <strong>{entry.module}</strong>
                  <span className="plan-scope__detail">
                    {fillCopy(t.scopeUnlock, { plan: planName(entry.plan, props.language) })}
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
  parts.push(...checkTitles(module.metadata, language));
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
    const checks = checkTitles(module.metadata, language);
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
  // Whose problem it is, after the reason and in its own voice: the reason
  // says what happened, and an owner reading "the AI service answered in a
  // form FluxRadar does not accept" beside a "Checked with limits" chip still
  // had no way to tell whether their site was at fault or whether they were
  // meant to act on it.
  const responsibilities = moduleResponsibilities(module, language);
  return (
    <div className="module-card__reason">
      <span className="module-card__reason-label">{copy[language].report.reasonLabel}</span>
      {reasons.map((reason) => (
        <p key={reason}>{reason}</p>
      ))}
      {responsibilities.map((responsibility) => (
        <p key={responsibility} className="module-card__responsibility">
          {responsibility}
        </p>
      ))}
    </div>
  );
}

/**
 * Names of the checks a module row says it ran, in the report language; empty
 * when it recorded none. The stored title is the fallback for a rule the report
 * has no copy for.
 */
function checkTitles(
  metadata: Readonly<Record<string, unknown>> | undefined,
  language: Language,
): readonly string[] {
  const checks = metadata?.checks;
  if (!Array.isArray(checks)) {
    return [];
  }
  return checks.flatMap((entry: unknown) => {
    const record = asRecord(entry);
    const title = record?.title;
    if (typeof title !== 'string' || title === '') return [];
    const ruleId = record?.ruleId;
    return [(typeof ruleId === 'string' ? checkCopyTitle(ruleId, language) : undefined) ?? title];
  });
}

/**
 * `fluxradar-shop.example.com-2026-09-18`: the site and the day of the scan.
 * The file used to be named after the scan's database id, so a folder of
 * exports could not be told apart without opening each one.
 */
export function exportBaseName(scan: Pick<Scan, 'domain' | 'completedAt' | 'createdAt'>): string {
  const day = (scan.completedAt ?? scan.createdAt).slice(0, 10);
  const host = displayDomain(scan.domain).replace(/[^a-z0-9.-]+/gi, '-');
  return `fluxradar-${host}-${day}`;
}

/**
 * Downloads the server-rendered report.
 *
 * Its own component because it has a state the other buttons do not: rendering a
 * large report takes a few seconds on the server, and a button that looks idle
 * while it happens gets clicked again. A refusal is reported in the reader's own
 * words — `PDF_TOO_LARGE` names the exports that do hold everything — and the
 * printable page beside it stays available either way.
 */
function PdfDownloadButton(props: {
  scan: Scan;
  language: Language;
  onError: (value: string) => void;
}) {
  const t = findingsCopy[props.language].download;
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const result = await apiDownload(
        `/scans/${props.scan.id}/report.pdf?language=${props.language}`,
      );
      saveBlob(result.filename ?? `${exportBaseName(props.scan)}.pdf`, result.blob);
    } catch (caught) {
      const code = caught instanceof ApiRequestError ? caught.code : null;
      props.onError(code === 'PDF_TOO_LARGE' ? t.tooLarge : t.failed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button onClick={() => void download()} disabled={busy} aria-describedby="pdf-hint">
      {busy ? t.preparing : t.pdf}
    </Button>
  );
}

function ExportButtons(props: { scan: Scan; onError: (value: string) => void }) {
  const scanId = props.scan.id;
  const baseName = exportBaseName(props.scan);
  const downloadJson = async () => {
    try {
      const value = await apiRequest<ExportPayload>(`/scans/${scanId}/export?format=json`);
      download(`${baseName}.json`, JSON.stringify(value.records, null, 2), 'application/json');
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'JSON export failed');
    }
  };
  const downloadCsv = async () => {
    try {
      const value = await apiRequest<string>(`/scans/${scanId}/export?format=csv`);
      download(`${baseName}.csv`, value, 'text/csv');
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

/** Saves bytes the server already produced, without re-encoding them. */
function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
