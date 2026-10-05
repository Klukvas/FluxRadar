// One page of findings, and the detail of the one that is open.

import { Fragment } from 'react';

import type { Issue } from './api';
import { Button, DataTable, FieldRow, StatusChip } from './components';
import { hasFindingExplainer, problemTechnicalName, problemTitle } from './finding-explainers';
import { FindingExplainer } from './FindingExplainer';
import { findingEvidence } from './finding-variants';
import { findingsCopy } from './findings-copy';
import { copy, fillCopy, type Language } from './i18n';
import { moduleCoverageHref, moduleLabel } from './rule-titles';

/** The statuses an owner may set. Resolved and Reopened belong to the scanner. */
export const USER_STATUSES = ['New', 'Acknowledged', 'Ignored', 'False Positive'] as const;

export function IssueTable(props: {
  issues: readonly Issue[];
  language: Language;
  selectedIssue: Issue | null;
  onSelect: (issue: Issue | null) => void;
  onStatus: (issue: Issue, status: string) => void;
}) {
  const t = copy[props.language].issues;
  const f = findingsCopy[props.language];
  return (
    <DataTable>
      <thead>
        <tr>
          <th>{t.columnSeverity}</th>
          <th>{f.issues.columnProblem}</th>
          <th>{t.columnTarget}</th>
          <th>{t.columnStatus}</th>
          <th>{t.columnAction}</th>
        </tr>
      </thead>
      <tbody>
        {props.issues.map((issue) => {
          const isExpanded = props.selectedIssue?.id === issue.id;
          const detailId = `issue-detail-${issue.id}`;
          const title = problemTitle(issue.ruleId, props.language);
          return (
            <Fragment key={issue.id}>
              <tr>
                <td data-label={t.columnSeverity}>
                  <StatusChip status={issue.severity} label={f.severity[issue.severity]} />
                </td>
                <td data-label={f.issues.columnProblem}>
                  <strong className="issue-title">{title}</strong>
                  <br />
                  <span className="muted technical">
                    {problemTechnicalName(issue.ruleId, props.language)} ·{' '}
                    {moduleLabel(issue.module, props.language)}
                  </span>
                </td>
                <td data-label={t.columnTarget} className="technical issue-target">
                  {issue.targetUrl}
                </td>
                <td data-label={t.columnStatus}>
                  <StatusChip status={issue.status} label={f.status[issue.status]} />
                </td>
                <td data-label={t.columnAction}>
                  <div className="button-row">
                    <Button
                      onClick={() => props.onSelect(isExpanded ? null : issue)}
                      aria-expanded={isExpanded}
                      aria-controls={detailId}
                    >
                      {isExpanded ? t.hideDetails : t.details}
                    </Button>
                    <select
                      className="control"
                      aria-label={`${t.columnStatus}: ${title}`}
                      value={
                        (USER_STATUSES as readonly string[]).includes(issue.status)
                          ? issue.status
                          : 'New'
                      }
                      onChange={(event) => props.onStatus(issue, event.target.value)}
                    >
                      {USER_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {f.status[status] ?? status}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
              </tr>
              {isExpanded ? (
                <tr id={detailId} className="issue-detail-row">
                  <td colSpan={5} className="issue-detail-cell">
                    <IssueDetail
                      issue={issue}
                      language={props.language}
                      onClose={() => props.onSelect(null)}
                    />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </DataTable>
  );
}

/**
 * The finding's evidence and recommendation in the reader's language when the
 * API rendered one; the stored text otherwise, which is what an older finding
 * or an AI-written one only has.
 */
function EvidenceFields(props: { issue: Issue; language: Language }) {
  const t = copy[props.language].issues;
  const { issue } = props;
  return (
    <>
      <FieldRow label={t.evidence} value={findingEvidence(issue, props.language) ?? t.noExcerpt} />
      <FieldRow
        label={t.recommendation}
        value={issue.localized?.[props.language]?.recommendation ?? issue.recommendation}
      />
    </>
  );
}

/**
 * The fold for whoever will do the work: the scoring and provenance fields
 * always, and the raw evidence too when a plain explanation stands in for it.
 */
function TechnicalDetails(props: { issue: Issue; language: Language; withEvidence: boolean }) {
  const t = copy[props.language].issues;
  const f = findingsCopy[props.language];
  const { issue } = props;
  return (
    <details className="finding-technical">
      <summary className="finding-technical__summary">{f.issues.technicalTitle}</summary>
      <div className="finding-technical__body">
        {props.withEvidence ? <EvidenceFields issue={issue} language={props.language} /> : null}
        <FieldRow
          label={t.impact}
          value={fillCopy(t.impactValue, {
            affected: issue.affectedTargets,
            applicable: issue.applicableTargets,
            delta: issue.scoreDelta.toFixed(2),
          })}
        />
        <FieldRow label={t.confidence} value={`${(issue.confidence * 100).toFixed(0)}%`} />
        <FieldRow label={t.columnRule} value={issue.ruleId} technical />
      </div>
    </details>
  );
}

/**
 * One finding, read top to bottom as the owner needs it: what the problem is
 * in plain words, where it is, and only then — one fold down, for whoever will
 * do the work — the scoring and provenance fields. "Impact 61/61 targets ·
 * score -10.00", "Confidence 100%" and a rule id used to come before anything
 * an owner could act on.
 *
 * A rule with no plain-language explanation has nothing to replace its
 * evidence and recommendation, so those stay in view; only the scoring and
 * provenance fold away.
 */
function IssueDetail(props: { issue: Issue; language: Language; onClose: () => void }) {
  const { issue } = props;
  const t = copy[props.language].issues;
  const f = findingsCopy[props.language];
  const explained = hasFindingExplainer(issue.ruleId);
  return (
    <div className="issue-detail">
      <div className="split">
        <strong>{problemTitle(issue.ruleId, props.language)}</strong>
        <Button onClick={props.onClose}>{t.closeDetails}</Button>
      </div>
      {/* Open here: the panel is where the owner came to understand the
          finding. */}
      <FindingExplainer ruleId={issue.ruleId} language={props.language} open />
      <FieldRow
        label={t.columnSeverity}
        value={<StatusChip status={issue.severity} label={f.severity[issue.severity]} />}
      />
      <FieldRow
        label={t.columnStatus}
        value={<StatusChip status={issue.status} label={f.status[issue.status]} />}
      />
      <FieldRow label={t.columnTarget} value={issue.targetUrl} technical />
      {explained ? null : <EvidenceFields issue={issue} language={props.language} />}
      <TechnicalDetails issue={issue} language={props.language} withEvidence={explained} />
      <p className="issue-detail__learn">
        <a href={moduleCoverageHref(issue.module)}>{f.issues.learnMore} →</a>
      </p>
    </div>
  );
}
