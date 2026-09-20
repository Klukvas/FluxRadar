// The Issue Center's problem view: one row per rule, most urgent first.
//
// A problem is what an owner actually fixes — one template, one header, one
// setting — so it is the unit the list is read in. Opening one shows its
// findings page by page; settled problems (everything ignored, marked false or
// resolved) stay listed, dimmed, so the count of problems does not jump around
// as an owner works through them.

import type { IssueSummary } from './api';
import { Button, DataTable, EmptyState, StatusChip } from './components';
import { findingsCopy } from './findings-copy';
import { copy, type Language } from './i18n';
import { moduleLabel, ruleTitle } from './rule-titles';

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
          const title = ruleTitle(group.ruleId, props.language);
          const settled = group.openIssues === 0;
          return (
            <tr
              key={`${group.ruleId}:${group.module}:${group.severity}`}
              className={settled ? 'issue-group--settled' : undefined}
            >
              <td data-label={t.columnSeverity}>
                <StatusChip status={group.severity} label={f.severity[group.severity]} />
              </td>
              <td data-label={f.issues.columnProblem}>
                <strong className="issue-title">{title}</strong>
                <br />
                <span className="muted technical">
                  {group.ruleId} · {moduleLabel(group.module, props.language)}
                </span>
              </td>
              <td data-label={f.issues.columnPages}>
                {settled
                  ? f.issues.groupSettled(group.issues)
                  : f.issues.groupCount(group.openIssues, group.issues)}
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
