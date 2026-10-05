// One page of findings, and the detail of the one that is open.

import { Fragment } from 'react';

import type { Issue } from './api';
import { Button, DataTable, FieldRow, StatusChip } from './components';
import { hasFindingExplainer } from './finding-explainers';
import { FindingExplainer } from './FindingExplainer';
import { findingEvidence } from './finding-variants';
import { findingsCopy } from './findings-copy';
import { copy, fillCopy, type Language } from './i18n';
import { moduleCoverageHref, moduleLabel, ruleTitle } from './rule-titles';

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
          const title = ruleTitle(issue.ruleId, props.language);
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
                    {issue.ruleId} · {moduleLabel(issue.module, props.language)}
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

function IssueDetail(props: { issue: Issue; language: Language; onClose: () => void }) {
  const { issue } = props;
  const t = copy[props.language].issues;
  const f = findingsCopy[props.language];
  const explained = hasFindingExplainer(issue.ruleId);
  const impact = (
    <FieldRow
      label={t.impact}
      value={fillCopy(t.impactValue, {
        affected: issue.affectedTargets,
        applicable: issue.applicableTargets,
        delta: issue.scoreDelta.toFixed(2),
      })}
    />
  );
  // The reader's language when the API rendered one; the stored text otherwise,
  // which is what an older finding or an AI-written one only has.
  const evidenceFields = (
    <>
      <FieldRow label={t.evidence} value={findingEvidence(issue, props.language) ?? t.noExcerpt} />
      <FieldRow
        label={t.recommendation}
        value={issue.localized?.[props.language]?.recommendation ?? issue.recommendation}
      />
    </>
  );
  const provenanceFields = (
    <>
      <FieldRow label={t.confidence} value={`${(issue.confidence * 100).toFixed(0)}%`} />
      <FieldRow label={t.columnRule} value={issue.ruleId} technical />
    </>
  );
  return (
    <div className="issue-detail">
      <div className="split">
        <strong>{ruleTitle(issue.ruleId, props.language)}</strong>
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
      {/* An explained rule reads top to bottom as plain language, so the header
          names and the rule id go behind one fold for whoever will do the work;
          a rule with no explanation keeps the fields it always had. */}
      {explained ? (
        <>
          {impact}
          <details className="finding-technical">
            <summary className="finding-technical__summary">{f.issues.technicalTitle}</summary>
            <div className="finding-technical__body">
              {evidenceFields}
              {provenanceFields}
            </div>
          </details>
        </>
      ) : (
        <>
          {evidenceFields}
          {impact}
          {provenanceFields}
        </>
      )}
      <p className="issue-detail__learn">
        <a href={moduleCoverageHref(issue.module)}>{f.issues.learnMore} →</a>
      </p>
    </div>
  );
}
