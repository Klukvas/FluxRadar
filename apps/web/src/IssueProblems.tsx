// The Issue Center's problem view: one row per rule, most urgent first.
//
// A problem is what an owner actually fixes — one template, one header, one
// setting — so it is the unit the list is read in. Opening one shows its
// findings page by page; settled problems (everything ignored, marked false or
// resolved) stay listed, dimmed, so the count of problems does not jump around
// as an owner works through them.

import type { IssueSummary } from './api';
import { Button, DataTable, EmptyState, StatusChip } from './components';
import { findingCountsPages, problemSupportCode, problemTitle } from './finding-explainers';
import { FindingExplainer, FindingWhat } from './FindingExplainer';
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
          const supportCode = problemSupportCode(group.ruleId, props.language);
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
                {/* The section, plus the rule id for a rule with no plain
                    name of its own. What used to be here as well was the
                    rule's technical title — "Page held by a single internal
                    link" under "Pages only one other page links to" — the same
                    problem in the developer's words, read as a second problem.
                    It lives in the finding's technical fold now; the bare id
                    stays, because for an unexplained rule it restates nothing
                    and is what support is asked about. */}
                <span className="muted">
                  {moduleLabel(group.module, props.language)}
                  {supportCode === null ? null : (
                    <>
                      {' · '}
                      <span className="technical">{supportCode}</span>
                    </>
                  )}
                </span>
                {/* What the check found, said on the row: the fold below is
                    the rest of the explanation, and a row whose only readable
                    part was its name made understanding the list a click per
                    problem. */}
                <FindingWhat ruleId={group.ruleId} language={props.language} />
                {/* Why it matters, what to do and what one finding counts stay
                    folded: the row has to stay one row per problem. */}
                <FindingExplainer
                  ruleId={group.ruleId}
                  language={props.language}
                  withWhat={false}
                />
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
