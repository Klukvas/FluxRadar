// The client report: one finished scan as a document to print or save as PDF.
//
// The only thing a buyer could hand to a client or a developer was a JSON or CSV
// export, while the pricing page sells the Complete report for "a handover or a
// client report". This is that report — the same data as the dashboard and the
// Issue Center, laid out as pages: summary, sections, then every problem with
// the pages it was found on, one piece of evidence and the fix. The browser's
// print dialog turns it into a PDF, so no PDF engine ships with the product.

import { useEffect, useState } from 'react';

import { fetchActionPlan, type ActionPlanContent } from './action-plan';
import { actionPlanCopy } from './action-plan-copy';
import {
  apiRequest,
  apiRequestWithMeta,
  type Dashboard,
  type Issue,
  type IssueRuleGroup,
  type IssueSummary,
} from './api';
import { Button, LoadingState, StatusChip } from './components';
import { findingsCopy } from './findings-copy';
import { formatDate } from './format-date';
import type { Language } from './i18n';
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
  /** The Action Plan in the language the report showed; null when there is none. */
  readonly actionPlan: ActionPlanContent | null;
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

async function loadPrintData(scanId: string, planLanguage: string): Promise<PrintData> {
  const [dashboard, summary, findings, actionPlan] = await Promise.all([
    apiRequest<Dashboard>(`/scans/${encodeURIComponent(scanId)}/dashboard`),
    apiRequest<IssueSummary>(`/scans/${encodeURIComponent(scanId)}/issues/summary`).catch(
      () => null,
    ),
    loadAllIssues(scanId),
    // Only a Complete scan has a plan; anything else answers 403, and the
    // document prints without the section rather than failing.
    fetchActionPlan(scanId, planLanguage)
      .then((state) => state?.plan ?? null)
      .catch(() => null),
  ]);
  return { dashboard, summary, issues: findings.issues, totalIssues: findings.total, actionPlan };
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
  /** The Action Plan language the report showed; `?plan=` in the address. */
  planLanguage: string;
  onBack: () => void;
  onError: (value: string) => void;
}) {
  const f = findingsCopy[props.language].print;
  const [data, setData] = useState<PrintData | null>(null);
  const { onError } = props;

  useEffect(() => {
    let current = true;
    loadPrintData(props.scanId, props.planLanguage)
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
  }, [props.scanId, props.planLanguage, onError, f]);

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

function PrintDocument(props: { data: PrintData; language: Language }) {
  const { dashboard } = props.data;
  const { scan, overall } = dashboard;
  const f = findingsCopy[props.language];
  const domain = displayDomain(scan.domain);
  const byRule = new Map<string, Issue[]>();
  for (const issue of props.data.issues) {
    byRule.set(issue.ruleId, [...(byRule.get(issue.ruleId) ?? []), issue]);
  }
  const groups = problemGroups(props.data);
  const scored = overall.score !== null && overall.moduleWeights.length > 0;
  return (
    <article className="print-document">
      <header className="print-cover">
        <p className="print-kicker">FluxRadar</p>
        <h1>{f.print.preparedFor(domain)}</h1>
        <p className="muted">
          {f.print.generated(formatDate(new Date().toISOString(), props.language))}
        </p>
        <dl className="print-facts">
          <div>
            <dt>{f.print.plan}</dt>
            <dd>{scan.plan}</dd>
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

      <section className="print-section">
        <h2>{f.print.summaryHeading}</h2>
        <p>
          {props.data.summary === null
            ? f.fixFirst.pages(props.data.totalIssues)
            : props.data.summary.open === 0
              ? f.issues.summaryNone
              : f.issues.summaryLine(
                  props.data.summary.open,
                  props.data.summary.groups.filter((group) => group.openIssues > 0).length,
                )}
        </p>
        {props.data.summary === null ? null : (
          <ul className="print-severity">
            {(['Critical', 'High', 'Medium', 'Low'] as const).map((severity) => (
              <li key={severity}>
                <StatusChip status={severity} label={f.severity[severity]} />{' '}
                {props.data.summary?.bySeverity[severity] ?? 0}
              </li>
            ))}
          </ul>
        )}
      </section>

      {props.data.actionPlan === null ? null : (
        <PrintActionPlan plan={props.data.actionPlan} language={props.language} />
      )}

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
            {dashboard.modules.map((module) => (
              <tr key={module.module}>
                <td>{moduleLabel(module.module, props.language)}</td>
                <td>{moduleResultLabel(module, props.language)}</td>
                <td>{moduleScoreLabel(module, props.language)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="print-section">
        <h2>{f.print.problemsHeading}</h2>
        {groups.length === 0 ? (
          <p>{f.print.noFindings}</p>
        ) : (
          <>
            <p className="muted">{f.print.problemsLead}</p>
            {props.data.issues.length < props.data.totalIssues ? (
              <p className="print-note">
                {f.print.truncated(props.data.issues.length, props.data.totalIssues)}
              </p>
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

      <footer className="print-footer muted">{f.print.footer}</footer>
    </article>
  );
}

function PrintProblem(props: {
  number: number;
  group: IssueRuleGroup;
  issues: readonly Issue[];
  language: Language;
}) {
  const f = findingsCopy[props.language];
  const example = props.issues[0];
  const pages = [...new Set(props.issues.map((issue) => issue.targetUrl))];
  const shown = pages.slice(0, PAGES_PER_PROBLEM);
  const evidence =
    example === undefined
      ? null
      : (example.localized?.[props.language]?.evidenceExcerpt ?? example.evidenceExcerpt);
  const recommendation =
    example === undefined
      ? null
      : (example.localized?.[props.language]?.recommendation ?? example.recommendation);
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

/** The Action Plan after the summary: labelled as AI-written, with the counts as printed. */
function PrintActionPlan(props: { plan: ActionPlanContent; language: Language }) {
  const c = actionPlanCopy[props.language];
  const { plan } = props;
  return (
    <section className="print-section print-action-plan">
      <h2>
        {c.print.heading} <span className="print-ai-label">{c.aiLabel}</span>
      </h2>
      <p className="muted">
        {c.print.lead} {c.generatedAt(formatDate(plan.generatedAt, props.language))}.
      </p>
      {plan.caveats.map((caveat) => (
        <p key={caveat.module} className="print-note">
          {c.caveat(moduleLabel(caveat.module, props.language), caveat.status)}
        </p>
      ))}
      <h3>{c.overviewHeading}</h3>
      <p>{plan.overview}</p>
      <h3>{c.actionsHeading}</h3>
      <ol className="print-plan-actions">
        {plan.actions.map((action, index) => (
          <li key={index} className="print-plan-action">
            <strong>{action.title}</strong>
            <span className="muted">
              {' '}
              · {c.effort[action.effort]} ·{' '}
              {action.settled ? c.settled : c.counts(action.openIssues, action.totalIssues)}
            </span>
            <p>{action.why}</p>
            <ol>
              {action.steps.map((step, stepIndex) => (
                <li key={stepIndex}>{step}</li>
              ))}
            </ol>
            <p className="muted">
              {action.rules.map((rule) => ruleTitle(rule.ruleId, props.language)).join(' · ')}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
