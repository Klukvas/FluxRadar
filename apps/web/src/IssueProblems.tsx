// The Issue Center's problem view: one row per rule, most urgent first.
//
// A problem is what an owner actually fixes — one template, one header, one
// setting — so it is the unit the list is read in. Opening one shows its
// findings page by page; settled problems (everything ignored, marked false or
// resolved) stay listed, dimmed, so the count of problems does not jump around
// as an owner works through them.

import type { IssueSummary } from './api';
import { Button, DataTable, EmptyState, StatusChip } from './components';
import { findingCountsPages, problemTechnicalName, problemTitle } from './finding-explainers';
import { FindingExplainer } from './FindingExplainer';
import { findingsCopy } from './findings-copy';
import { copy, type Language } from './i18n';
import { moduleLabel } from './rule-titles';

export function IssueProblems(props: {
  summary: IssueSummary;
  language: Language;
  onOpen: (ruleId: string) => void;
}) {
  const t = copy[props.language].issues;
  const f = findingsCopy[props.language];
  if (props.summary.groups.length === 0) {
    return <EmptyState title={t.emptyAll} description={t.emptyAllBody} />;
  }
  return (
    <DataTable>
      <thead>
        <tr>
          <th>{t.columnSeverity}</th>
          <th>{f.issues.columnProblem}</th>
          <th>{f.issues.columnPages}</th>
          <th>{t.columnAction}</th>
        </tr>
      </thead>
      <tbody>
        {props.summary.groups.map((group) => {
          const title = problemTitle(group.ruleId, props.language);
          const settled = group.openIssues === 0;
          // Said in pages only where one finding is one page: a cookie or a
          // broken link counted as a page would overstate the reach.
          const countsPages = findingCountsPages(group.ruleId);
          return (
            <tr
              // One row per rule, per section — the same identity the API now
              // groups by. Severity used to be part of this key and of the
              // API's, so a rule with findings at two severities was listed
              // twice, both rows opening the same findings.
              key={`${group.ruleId}:${group.module}`}
              className={settled ? 'issue-group--settled' : undefined}
            >
              <td data-label={t.columnSeverity}>
                <StatusChip status={group.severity} label={f.severity[group.severity]} />
              </td>
              <td data-label={f.issues.columnProblem}>
                <strong className="issue-title">{title}</strong>
                <br />
                <span className="muted technical">
                  {problemTechnicalName(group.ruleId, props.language)} ·{' '}
                  {moduleLabel(group.module, props.language)}
                </span>
                {/* Folded: the row has to stay one row per problem. */}
                <FindingExplainer ruleId={group.ruleId} language={props.language} />
              </td>
              <td data-label={f.issues.columnPages}>
                {settled
                  ? f.issues.groupSettled(group.issues, countsPages)
                  : f.issues.groupCount(group.openIssues, group.issues, countsPages)}
              </td>
              <td data-label={t.columnAction}>
                <Button
                  variant={settled ? 'default' : 'primary'}
                  onClick={() => props.onOpen(group.ruleId)}
                  aria-label={f.issues.showFindingsFor(title)}
                >
                  {f.issues.showFindings}
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}
