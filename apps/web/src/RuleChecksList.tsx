import { localizedCheckTitle } from './check-titles';
import { CheckRow } from './CheckRow';
import { copy, fillCopy, type Language } from './i18n';
import {
  ruleCheckResult,
  type RuleCheck,
  type RuleCheckResult,
  type RuleCheckOutcome,
} from './module-metadata';

export const RESULT_CLASS: Readonly<Record<RuleCheckResult, string>> = {
  passed: 'passed',
  issues: 'issues',
  noted: 'noted',
  // Unchecked is not a pass and not a failure: it reads as the same muted row
  // as a check nobody needed, with the word beside it saying which it was.
  notChecked: 'skipped',
  notApplicable: 'skipped',
};

export function RuleChecksList(props: {
  checks: readonly RuleCheck[];
  language: Language;
  lead?: string;
  hideLead?: boolean;
  onOpenProblem?: (ruleId: string) => void;
}) {
  const t = copy[props.language].report.checks;
  return (
    <>
      {props.hideLead ? null : <p className="muted">{props.lead ?? t.ruleLead}</p>}
      <ul className="module-checks__list">
        {props.checks.map((check) => {
          const result = ruleCheckResult(check);
          return (
            <CheckRow
              key={check.ruleId}
              resultClass={RESULT_CLASS[result]}
              resultLabel={resultLabel(result, props.language)}
              title={checkTitle(check, props.language)}
              detail={`${check.ruleId} · ${checkDetail(check, result, props.language)}`}
              onOpenProblem={
                result === 'issues' && props.onOpenProblem !== undefined
                  ? () => props.onOpenProblem?.(check.ruleId)
                  : undefined
              }
            />
          );
        })}
      </ul>
    </>
  );
}

export function resultLabel(result: RuleCheckResult, language: Language): string {
  const t = copy[language].report.checks;
  const labels: Readonly<Record<RuleCheckResult, string>> = {
    passed: t.resultPassed,
    issues: t.resultIssues,
    noted: t.resultNoted,
    notChecked: t.resultNotChecked,
    notApplicable: t.resultNotApplicable,
  };
  return labels[result];
}

/**
 * The check's name in the reader's language.
 *
 * Only checks the report has written copy for are translated; any other falls
 * back to the registry title rather than to nothing.
 */
function checkTitle(check: RuleCheck, language: Language): string {
  return localizedCheckTitle(check.ruleId, check.title, language);
}

function checkDetail(check: RuleCheck, result: RuleCheckOutcome, language: Language): string {
  const t = copy[language].report.checks;
  const counts = { affected: check.affectedTargets, applicable: check.applicableTargets };
  const perPage = check.targetKind === 'page';
  switch (result) {
    case 'notApplicable': {
      // The rule's own reason first, the rule's general sentence next: a report
      // written before rules named their reason still says something truer than
      // "nothing on the pages matched", and one written after says exactly what
      // happened.
      const reasons: Readonly<Record<string, string | undefined>> = t.notApplicableReasons;
      const named =
        check.notApplicableReason === null
          ? undefined
          : reasons[`${check.ruleId}:${check.notApplicableReason}`];
      return named ?? reasons[check.ruleId] ?? t.detailNotApplicable;
    }
    case 'passed':
      return perPage ? fillCopy(t.detailPassedPages, counts) : t.detailPassed;
    case 'issues':
      return perPage ? fillCopy(t.detailIssuesPages, counts) : t.detailIssues;
    case 'noted':
      return perPage ? fillCopy(t.detailNotedPages, counts) : t.detailNoted;
  }
}
