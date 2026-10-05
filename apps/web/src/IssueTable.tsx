// One page of findings, and the detail of the one that is open.

import { Fragment } from 'react';

import type { Issue } from './api';
import { Button, DataTable, FieldRow, StatusChip } from './components';
import {
  findingCountsPages,
  hasFindingExplainer,
  problemSupportCode,
  problemTechnicalName,
  problemTitle,
} from './finding-explainers';
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
  /**
   * The one problem this list is filtered to, or null for every finding.
   *
   * One problem open is the normal case — "Pages only one other page links to"
   * arrived as fourteen rows whose Problem cell held the same two lines
   * fourteen times, and the addresses, the one thing that differed, were the
   * narrowest column on the screen. Filtered to one problem, the screen names
   * it once above this table and the rows are the addresses.
   *
   * It is the caller's filter, never a guess from the rows: on the unfiltered
   * tab a first page that happens to hold one rule is not one problem, and
   * laying it out as one would rebuild the table under the reader the moment
   * "Show 50 more" brought a second rule in.
   */
  soleRuleId: string | null;
  selectedIssue: Issue | null;
  onSelect: (issue: Issue | null) => void;
  onStatus: (issue: Issue, status: string) => void;
}) {
  const t = copy[props.language].issues;
  const f = findingsCopy[props.language];
  const sole = props.soleRuleId;
  const columns = sole === null ? 5 : 4;
  return (
    <DataTable>
      <thead>
        <tr>
          <th>{t.columnSeverity}</th>
          {sole === null ? <th>{f.issues.columnProblem}</th> : null}
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
          const supportCode = problemSupportCode(issue.ruleId, props.language);
          return (
            <Fragment key={issue.id}>
              <tr>
                <td data-label={t.columnSeverity}>
                  <StatusChip status={issue.severity} label={f.severity[issue.severity]} />
                </td>
                {/* The problem's own name and its section. The rule's
                      technical title said the same thing in the developer's
                      words and now lives in the technical fold; the bare id of
                      a rule with no plain name restates nothing, so it stays. */}
                {sole === null ? (
                  <td data-label={f.issues.columnProblem}>
                    <strong className="issue-title">{title}</strong>
                    <br />
                    <span className="muted">
                      {moduleLabel(issue.module, props.language)}
                      {supportCode === null ? null : (
                        <>
                          {' · '}
                          <span className="technical">{supportCode}</span>
                        </>
                      )}
                    </span>
                  </td>
                ) : null}
                <td data-label={t.columnTarget} className="technical issue-target">
                  {issue.targetUrl}
                </td>
                <td data-label={t.columnStatus}>
                  <StatusChip status={issue.status} label={f.status[issue.status]} />
                </td>
                <td data-label={t.columnAction}>
                  <div className="button-row">
                    {/* The one control that opens and closes this finding.
                          The open panel used to carry a second "Close details"
                          of its own, so one finding had two names for one
                          thing and neither was obviously the other's pair. */}
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
                  <td colSpan={columns} className="issue-detail-cell">
                    <IssueDetail issue={issue} language={props.language} />
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
 * always, the rule's own technical title, and the raw evidence too when a plain
 * explanation stands in for it.
 *
 * Every label here says what the number is. "Impact 14/59 targets · score
 * -0.24" packed three things an owner cannot read into one row: "targets" is
 * not their word, and the delta is a number on a scale nothing on the screen
 * names. They are two rows now, each in words, and the score says which way it
 * moves. A penalty is stored negative, so its size is what is printed.
 */
function TechnicalDetails(props: { issue: Issue; language: Language; withEvidence: boolean }) {
  const t = copy[props.language].issues;
  const f = findingsCopy[props.language];
  const { issue } = props;
  const countsPages = findingCountsPages(issue.ruleId);
  return (
    <details className="finding-technical">
      <summary className="finding-technical__summary">{f.issues.technicalTitle}</summary>
      <div className="finding-technical__body">
        {props.withEvidence ? <EvidenceFields issue={issue} language={props.language} /> : null}
        <FieldRow
          label={countsPages ? t.impact : t.impactTargets}
          value={(countsPages ? t.impactValue : t.impactTargetsValue)(
            issue.affectedTargets,
            issue.applicableTargets,
          )}
        />
        <FieldRow
          label={t.scoreEffect}
          value={
            issue.scoreDelta === 0
              ? t.scoreEffectNone
              : fillCopy(t.scoreEffectValue, { delta: Math.abs(issue.scoreDelta).toFixed(2) })
          }
        />
        <FieldRow label={t.confidence} value={`${(issue.confidence * 100).toFixed(0)}%`} />
        {/* The rule's title in the developer's own words, moved off the row
            above where it restated the problem's plain name. Labelled by what
            it is, not "Rule" — the column header's word, which reads as
            something the owner broke. */}
        {hasFindingExplainer(issue.ruleId) ? (
          <FieldRow
            label={t.ruleNameLabel}
            value={problemTechnicalName(issue.ruleId, props.language)}
          />
        ) : null}
        <FieldRow label={t.ruleIdLabel} value={issue.ruleId} technical />
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
function IssueDetail(props: { issue: Issue; language: Language }) {
  const { issue } = props;
  const t = copy[props.language].issues;
  const f = findingsCopy[props.language];
  const explained = hasFindingExplainer(issue.ruleId);
  const meaning = f.severityMeaning[issue.severity];
  return (
    <div className="issue-detail">
      <strong>{problemTitle(issue.ruleId, props.language)}</strong>
      {/* Open here: the panel is where the owner came to understand the
          finding. */}
      <FindingExplainer ruleId={issue.ruleId} language={props.language} open />
      {/* The chip, and — where there is room for it — what its word means in
          terms of when to act. */}
      <FieldRow
        label={t.columnSeverity}
        value={
          <>
            <StatusChip status={issue.severity} label={f.severity[issue.severity]} />
            {meaning === undefined ? null : <span className="muted"> — {meaning}</span>}
          </>
        }
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
