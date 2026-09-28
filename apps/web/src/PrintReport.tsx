// The client report: one finished scan as a document to print or save as PDF.
//
// The only thing a buyer could hand to a client or a developer was a JSON or CSV
// export, while the pricing page sells the Complete report for "a handover or a
// client report". This is that report — the same data as the dashboard and the
// Issue Center, laid out as pages: summary, sections, then every problem with
// the pages it was found on, one piece of evidence and the fix. The browser's
// print dialog turns it into a PDF, so no PDF engine ships with the product.

import { useEffect, useState } from 'react';

import { actionPlanCopy } from './action-plan-copy';
import {
  apiRequest,
  apiRequestWithMeta,
  isActionPlanState,
  type ActionPlanContent,
  type Dashboard,
  type GeoProviderVisibility,
  type Issue,
  type IssueRuleGroup,
  type IssueSummary,
} from './api';
import { fetchScanComparison, type ScanComparison } from './comparison-api';
import { Button, LoadingState, StatusChip } from './components';
import { findingsCopy } from './findings-copy';
import { formatDate } from './format-date';
import { percentOf } from './GeoVisibility';
import { geoVisibilitySummaryOf } from './geo-visibility';
import { copy, fillCopy, type Language } from './i18n';
import { planIncludesIssueHistory, planName } from './plan-modules';
import { ComparisonPrintBlock } from './ScanComparisonPrint';
import { moduleLabel, ruleTitle } from './rule-titles';
import { displayDomain, moduleResultLabel, moduleScoreLabel } from './scan-status';
import './styles/print-report.css';

/** Findings the document lists at most; the Issue Center and CSV carry the rest. */
export const PRINT_FINDING_LIMIT = 1000;
const PRINT_PAGE_SIZE = 100;
/** Pages named under one problem before "…and N more". */
const PAGES_PER_PROBLEM = 12;

interface PrintData {
  readonly dashboard: Dashboard;
  readonly summary: IssueSummary | null;
  readonly issues: readonly Issue[];
  readonly totalIssues: number;
  /** The Action Plan in the requested language, when one has been written. */
  readonly actionPlan: ActionPlanContent | null;
  /**
   * The comparison with the previous scan; null when this plan carries no
   * finding history — in which case it is never asked for — or when the read did
   * not come back. The document is worth printing either way, so it is never the
   * reason the page fails to load.
   */
  readonly comparison: ScanComparison | null;
}

async function loadAllIssues(scanId: string): Promise<{ issues: Issue[]; total: number }> {
  const collected: Issue[] = [];
  let total = 0;
  for (let offset = 0; offset < PRINT_FINDING_LIMIT; offset += PRINT_PAGE_SIZE) {
    const page = await apiRequestWithMeta<Issue[]>(
      `/scans/${encodeURIComponent(scanId)}/issues?limit=${PRINT_PAGE_SIZE}&offset=${offset}`,
    );
    collected.push(...page.data);
    total = page.meta?.total ?? collected.length;
    if (page.data.length < PRINT_PAGE_SIZE || collected.length >= total) break;
  }
  return { issues: collected, total };
}

async function loadPrintData(scanId: string, planLanguage: string | null): Promise<PrintData> {
  const dashboardRead = apiRequest<Dashboard>(`/scans/${encodeURIComponent(scanId)}/dashboard`);
  // Asked only where the plan buys it. The endpoint would answer 403 on Free and
  // Basic and `fetchScanComparison` would swallow it — but a refusal is still a
  // request, and it counts against the comparison rate limit every time such a
  // report is printed. The plan is known one round trip in, so the read waits
  // for that instead of being fired blind; everything else still runs alongside.
  const comparisonRead = dashboardRead
    .then((dashboard) =>
      planIncludesIssueHistory(dashboard.scan.plan) ? fetchScanComparison(scanId) : null,
    )
    .catch(() => null);
  const [dashboard, summary, findings, actionPlan, comparison] = await Promise.all([
    dashboardRead,
    apiRequest<IssueSummary>(`/scans/${encodeURIComponent(scanId)}/issues/summary`).catch(
      () => null,
    ),
    loadAllIssues(scanId),
    // The document is worth printing without a plan, so this one may fail and
    // an unrecognised shape is treated as "no plan", never as an empty one.
    planLanguage === null
      ? Promise.resolve(null)
      : apiRequest<unknown>(
          `/scans/${encodeURIComponent(scanId)}/action-plan?language=${encodeURIComponent(planLanguage)}`,
        )
          .then((value) => (isActionPlanState(value) ? value.plan : null))
          .catch(() => null),
    comparisonRead,
  ]);
  return {
    dashboard,
    summary,
    issues: findings.issues,
    totalIssues: findings.total,
    actionPlan,
    comparison,
  };
}

/** The problems in summary order, or — without a summary — in the order findings arrived. */
function problemGroups(data: PrintData): readonly IssueRuleGroup[] {
  if (data.summary !== null && data.summary.groups.length > 0) return data.summary.groups;
  const seen = new Map<string, IssueRuleGroup>();
  for (const issue of data.issues) {
    const current = seen.get(issue.ruleId);
    seen.set(issue.ruleId, {
      ruleId: issue.ruleId,
      module: issue.module,
      severity: issue.severity,
      issues: (current?.issues ?? 0) + 1,
      openIssues: (current?.openIssues ?? 0) + 1,
    });
  }
  return [...seen.values()];
}

export function PrintReport(props: {
  scanId: string;
  language: Language;
  /** Which Action Plan to include; absent means the reader's own language. */
  planLanguage?: string | null;
  onBack: () => void;
  onError: (value: string) => void;
}) {
  const f = findingsCopy[props.language].print;
  const [data, setData] = useState<PrintData | null>(null);
  const { onError } = props;
  const planLanguage = props.planLanguage ?? props.language;

  useEffect(() => {
    let current = true;
    loadPrintData(props.scanId, planLanguage)
      .then((value) => {
        if (!current) return;
        setData(value);
        // The name the browser offers for the saved PDF.
        document.title = f.documentTitle(displayDomain(value.dashboard.scan.domain));
      })
      .catch((caught: unknown) => {
        if (current) onError(caught instanceof Error ? caught.message : f.loading);
      });
    return () => {
      current = false;
    };
  }, [props.scanId, planLanguage, onError, f]);

  return (
    <div className="print-shell">
      <div className="print-toolbar" role="toolbar" aria-label={f.windowTitle}>
        <Button onClick={props.onBack}>{f.back}</Button>
        <Button variant="primary" onClick={() => window.print()} disabled={data === null}>
          {f.print}
        </Button>
      </div>
      {data === null ? (
        <div className="print-loading" role="status">
          <LoadingState />
          <p>{f.loading}</p>
        </div>
      ) : (
        <PrintDocument data={data} language={props.language} />
      )}
    </div>
  );
}

/** The written plan as document pages: Overview, then each Action with its steps. */
function PrintActionPlan(props: { plan: ActionPlanContent; language: Language }) {
  const t = actionPlanCopy[props.language];
  return (
    <section className="print-section print-action-plan">
      <h2>
        {t.heading} <span className="muted">({t.aiLabel})</span>
      </h2>
      {props.plan.caveats.map((module) => (
        <p className="muted" key={module}>
          {t.caveat(moduleLabel(module, props.language))}
        </p>
      ))}
      <h3>{t.overviewHeading}</h3>
      <p>{props.plan.overview}</p>
      <h3>{t.actionsHeading}</h3>
      <ol>
        {props.plan.actions.map((action, index) => (
          <li key={`${index}:${action.title}`}>
            <strong>{action.title}</strong>
            <p>{action.why}</p>
            <ol>
              {action.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="muted">
              {t.effortLabel}: {t.effort[action.effort] ?? action.effort} ·{' '}
              {t.openIssues(action.openIssues, action.totalIssues)}
              {action.settled ? ` · ${t.settled}` : ''}
            </p>
            <p className="muted">
              {action.ruleIds.map((ruleId) => ruleTitle(ruleId, props.language)).join(' · ')}
            </p>
          </li>
        ))}
      </ol>
      {props.plan.reach === null ? null : (
        <p className="muted">{t.reach(props.plan.reach.share, props.plan.reach.rules)}</p>
      )}
      <p className="muted">
        {t.generatedAt(formatDate(props.plan.generatedAt, props.language), props.plan.modelId)}
      </p>
    </section>
  );
}

/** The cover: whose site, when it was scanned, the plan, the score and its coverage. */
function PrintCover(props: { dashboard: Dashboard; language: Language }) {
  const { scan, overall } = props.dashboard;
  const f = findingsCopy[props.language];
  const domain = displayDomain(scan.domain);
  const scored = overall.score !== null && overall.moduleWeights.length > 0;
  return (
    <header className="print-cover">
      <p className="print-kicker">FluxRadar</p>
      <h1>{f.print.preparedFor(domain)}</h1>
      <p className="muted">
        {f.print.generated(formatDate(new Date().toISOString(), props.language))}
      </p>
      <dl className="print-facts">
        <div>
          <dt>{f.print.plan}</dt>
          <dd>{planName(scan.plan)}</dd>
        </div>
        <div>
          <dt>{f.print.scanned}</dt>
          <dd>{formatDate(scan.completedAt ?? scan.createdAt, props.language)}</dd>
        </div>
        <div>
          <dt>{f.print.score}</dt>
          <dd>{scored ? `${overall.score?.toFixed(0)} / 100` : f.print.noScore}</dd>
        </div>
        <div>
          <dt>{f.print.coverage}</dt>
          <dd>{scored ? `${(overall.weightedCoverage * 100).toFixed(0)}%` : '—'}</dd>
        </div>
      </dl>
    </header>
  );
}

/** How much is open, and how severe. */
function PrintSummary(props: { data: PrintData; language: Language }) {
  const f = findingsCopy[props.language];
  const { summary, totalIssues } = props.data;
  return (
    <section className="print-section">
      <h2>{f.print.summaryHeading}</h2>
      <p>
        {summary === null
          ? f.fixFirst.pages(totalIssues)
          : summary.open === 0
            ? f.issues.summaryNone
            : f.issues.summaryLine(
                summary.open,
                summary.groups.filter((group) => group.openIssues > 0).length,
              )}
      </p>
      {summary === null ? null : (
        <ul className="print-severity">
          {(['Critical', 'High', 'Medium', 'Low'] as const).map((severity) => (
            <li key={severity}>
              <StatusChip status={severity} label={f.severity[severity]} />{' '}
              {summary.bySeverity[severity] ?? 0}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Each section's result and score. */
function PrintSections(props: { modules: Dashboard['modules']; language: Language }) {
  const f = findingsCopy[props.language];
  return (
    <section className="print-section">
      <h2>{f.print.sectionsHeading}</h2>
      <table className="print-table">
        <thead>
          <tr>
            <th>{f.print.section}</th>
            <th>{f.print.result}</th>
            <th>{f.print.score}</th>
          </tr>
        </thead>
        <tbody>
          {props.modules.map((module) => (
            <tr key={module.module}>
              <td>{moduleLabel(module.module, props.language)}</td>
              <td>{moduleResultLabel(module, props.language)}</td>
              <td>{moduleScoreLabel(module, props.language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * One signal's cell: mentions out of the answers in which it was measurable.
 *
 * "Not measurable" rather than 0%: a question that already named the brand or
 * the domain proves nothing either way, and printing 0% would read as a fail
 * the scan never observed.
 */
function printShareCell(
  measured: number,
  mentioned: number,
  share: number | null,
  notMeasurable: string,
): string {
  if (share === null) return notMeasurable;
  return `${mentioned}/${measured} (${percentOf(share)}%)`;
}

/** Why this engine has no score — the minimum comes from the summary, not the answer count. */
function printNoScore(
  provider: GeoProviderVisibility,
  minMeasuredForScore: number,
  language: Language,
): string {
  const t = copy[language].report;
  return provider.scoreUnavailableReason === 'not-measurable'
    ? t.geoVisibilityNotMeasurable
    : fillCopy(t.geoVisibilityNotEnoughAnswers, {
        min: minMeasuredForScore,
        brand: provider.brandMeasuredCount,
        domain: provider.domainMeasuredCount,
      });
}

/** What a partial score counts, appended after the number when only one signal reached it. */
function printScoreBasis(provider: GeoProviderVisibility, language: Language): string | null {
  const t = copy[language].report;
  if (provider.scoreBasis === 'brand-only') {
    return fillCopy(t.geoVisibilityScoreBasisBrandOnly, { domain: provider.domainMeasuredCount });
  }
  if (provider.scoreBasis === 'domain-only') {
    return fillCopy(t.geoVisibilityScoreBasisDomainOnly, { brand: provider.brandMeasuredCount });
  }
  return null;
}

/** Compact mirror of the report's "Visibility by engine" block: score and shares per engine. */
function PrintGeoVisibility(props: { dashboard: Dashboard; language: Language }) {
  const t = copy[props.language].report;
  const hasGeoAnswers = (props.dashboard.geoObservations ?? []).length > 0;
  if (!hasGeoAnswers) return null;
  const summary = geoVisibilitySummaryOf(props.dashboard.geoVisibilitySummary);
  return (
    <section className="print-section">
      <h2>{t.geoVisibilityHeading}</h2>
      {summary === null ? (
        <p className="muted">{t.geoVisibilityUnavailable}</p>
      ) : (
        <>
          <p className="muted">
            {fillCopy(t.geoVisibilityLead, {
              min: summary.minMeasuredForScore,
              brandWeight: percentOf(summary.weightBrand),
              domainWeight: percentOf(summary.weightDomain),
            })}
          </p>
          <table className="print-table">
            <thead>
              <tr>
                <th>{t.geoProvider}</th>
                <th>{t.geoVisibilityScoreLabel}</th>
                <th>{t.geoVisibilityBrandShareHeader}</th>
                <th>{t.geoVisibilityDomainShareHeader}</th>
              </tr>
            </thead>
            <tbody>
              {summary.providers.map((provider) => {
                const basisNote = printScoreBasis(provider, props.language);
                return (
                  <tr key={provider.provider}>
                    <td>{provider.label}</td>
                    <td>
                      {provider.visibilityScore === null
                        ? printNoScore(provider, summary.minMeasuredForScore, props.language)
                        : basisNote === null
                          ? `${provider.visibilityScore}/100`
                          : `${provider.visibilityScore}/100 — ${basisNote}`}
                    </td>
                    <td>
                      {printShareCell(
                        provider.brandMeasuredCount,
                        provider.brandMentionedCount,
                        provider.brandMentionedShare,
                        t.geoVisibilityNotMeasurableShort,
                      )}
                    </td>
                    <td>
                      {printShareCell(
                        provider.domainMeasuredCount,
                        provider.domainCitedCount,
                        provider.domainCitedShare,
                        t.geoVisibilityNotMeasurableShort,
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/** Every problem in summary order, with the findings that belong to it. */
function PrintProblems(props: { data: PrintData; language: Language }) {
  const f = findingsCopy[props.language];
  const { issues, totalIssues } = props.data;
  const byRule = new Map<string, Issue[]>();
  for (const issue of issues) {
    byRule.set(issue.ruleId, [...(byRule.get(issue.ruleId) ?? []), issue]);
  }
  const groups = problemGroups(props.data);
  return (
    <section className="print-section">
      <h2>{f.print.problemsHeading}</h2>
      {groups.length === 0 ? (
        <p>{f.print.noFindings}</p>
      ) : (
        <>
          <p className="muted">{f.print.problemsLead}</p>
          {issues.length < totalIssues ? (
            <p className="print-note">{f.print.truncated(issues.length, totalIssues)}</p>
          ) : null}
          {groups.map((group, index) => (
            <PrintProblem
              key={`${group.ruleId}:${group.module}`}
              number={index + 1}
              group={group}
              issues={byRule.get(group.ruleId) ?? []}
              language={props.language}
            />
          ))}
        </>
      )}
    </section>
  );
}

function PrintDocument(props: { data: PrintData; language: Language }) {
  const f = findingsCopy[props.language];
  const { dashboard, actionPlan } = props.data;
  return (
    <article className="print-document">
      <PrintCover dashboard={dashboard} language={props.language} />
      <PrintSummary data={props.data} language={props.language} />
      {actionPlan === null ? null : <PrintActionPlan plan={actionPlan} language={props.language} />}
      <PrintSections modules={dashboard.modules} language={props.language} />
      <PrintGeoVisibility dashboard={dashboard} language={props.language} />
      {props.data.comparison === null || !planIncludesIssueHistory(dashboard.scan.plan) ? null : (
        <ComparisonPrintBlock comparison={props.data.comparison} language={props.language} />
      )}
      <PrintProblems data={props.data} language={props.language} />
      <footer className="print-footer muted">{f.print.footer}</footer>
    </article>
  );
}

interface ExampleTexts {
  readonly evidence: string | null;
  readonly recommendation: string | null;
}

/** The example finding's evidence and recommendation, in the reader's language when it has one. */
function exampleTexts(example: Issue | undefined, language: Language): ExampleTexts {
  if (example === undefined) return { evidence: null, recommendation: null };
  const localized = example.localized?.[language];
  return {
    evidence: localized?.evidenceExcerpt ?? example.evidenceExcerpt,
    recommendation: localized?.recommendation ?? example.recommendation,
  };
}

function PrintProblem(props: {
  number: number;
  group: IssueRuleGroup;
  issues: readonly Issue[];
  language: Language;
}) {
  const f = findingsCopy[props.language];
  const pages = [...new Set(props.issues.map((issue) => issue.targetUrl))];
  const shown = pages.slice(0, PAGES_PER_PROBLEM);
  const { evidence, recommendation } = exampleTexts(props.issues[0], props.language);
  return (
    <div className="print-problem">
      <h3>
        {props.number}. {ruleTitle(props.group.ruleId, props.language)}
      </h3>
      <p className="print-problem__meta">
        <StatusChip status={props.group.severity} label={f.severity[props.group.severity]} />{' '}
        {moduleLabel(props.group.module, props.language)} ·{' '}
        {f.print.affectedPages(props.group.issues)} ·{' '}
        <span className="technical">{props.group.ruleId}</span>
      </p>
      {shown.length > 0 ? (
        <ul className="print-pages technical">
          {shown.map((page) => (
            <li key={page}>{page}</li>
          ))}
          {pages.length > shown.length ? (
            <li className="muted">{f.print.morePages(pages.length - shown.length)}</li>
          ) : null}
        </ul>
      ) : null}
      {evidence ? (
        <p>
          <strong>{f.print.evidence}:</strong> <span className="technical">{evidence}</span>
        </p>
      ) : null}
      {recommendation ? (
        <p>
          <strong>{f.print.recommendation}:</strong> {recommendation}
        </p>
      ) : null}
    </div>
  );
}
