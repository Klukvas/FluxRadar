// A ready Action Plan on a report (D-232): the AI label, the caveats, the
// Overview, the Actions with their live counts, and Reach. Its text is a
// snapshot, its counts are live, and an Action whose issues are all settled
// folds away — it is never called "fixed", because within one scan only the
// owner's Ignored and False Positive, or a later scan, move it.

import { actionKey, type PlanAction, type PlanWithOverlay } from './action-plan';
import { actionPlanCopy } from './action-plan-copy';
import { Button, StatusChip } from './components';
import { formatDate } from './format-date';
import type { Language } from './i18n';
import { moduleLabel, ruleTitle } from './rule-titles';

type OpenProblem = (ruleId: string) => void;

function reachPercent(plan: PlanWithOverlay): number {
  return plan.reach.open === 0 ? 100 : Math.round((plan.reach.addressed / plan.reach.open) * 100);
}

function ActionRules(props: {
  action: PlanAction;
  language: Language;
  onOpenProblem: OpenProblem;
}) {
  const c = actionPlanCopy[props.language];
  return (
    <ul className="action-plan__rules">
      {props.action.rules.map((rule) => {
        const title = ruleTitle(rule.ruleId, props.language);
        const link = c.ruleLink(rule.openIssues, rule.totalIssues);
        return (
          <li key={rule.ruleId}>
            <span>{title}</span>
            <Button
              onClick={() => props.onOpenProblem(rule.ruleId)}
              aria-label={`${title}: ${link}`}
            >
              {link}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function ActionDetails(props: {
  action: PlanAction;
  language: Language;
  onOpenProblem: OpenProblem;
}) {
  return (
    <>
      <p className="action-plan__why">{props.action.why}</p>
      <ol className="action-plan__steps">
        {props.action.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <ActionRules
        action={props.action}
        language={props.language}
        onOpenProblem={props.onOpenProblem}
      />
    </>
  );
}

/** One Action: open ones show everything, settled ones fold behind their title. */
function PlanActionItem(props: {
  action: PlanAction;
  language: Language;
  onOpenProblem: OpenProblem;
}) {
  const c = actionPlanCopy[props.language];
  const { action } = props;
  const details = (
    <ActionDetails action={action} language={props.language} onOpenProblem={props.onOpenProblem} />
  );
  if (action.settled) {
    return (
      <li className="action-plan__action action-plan__action--settled">
        <details>
          <summary>
            <span className="action-plan__title">{action.title}</span>{' '}
            <StatusChip status="Settled" label={c.settled} />
          </summary>
          <p className="muted">{c.settledNote}</p>
          {details}
        </details>
      </li>
    );
  }
  return (
    <li className="action-plan__action">
      <div className="action-plan__action-head">
        <span className="action-plan__title">{action.title}</span>
        <span className="muted action-plan__facts">
          {c.effort[action.effort]} · {c.counts(action.openIssues, action.totalIssues)}
        </span>
      </div>
      {details}
    </li>
  );
}

/** The plan itself: caveats, the Overview, the Actions with live counts, and Reach. */
export function ActionPlanBody(props: {
  plan: PlanWithOverlay;
  language: Language;
  onOpenProblem: OpenProblem;
}) {
  const c = actionPlanCopy[props.language];
  const { plan } = props;
  return (
    <div className="action-plan__plan">
      <p className="action-plan__meta">
        <span className="action-plan__ai-label">{c.aiLabel}</span>{' '}
        <span className="muted">{c.generatedAt(formatDate(plan.generatedAt, props.language))}</span>
      </p>
      {plan.caveats.map((caveat) => (
        <p key={caveat.module} className="action-plan__caveat" role="note">
          {c.caveat(moduleLabel(caveat.module, props.language), caveat.status)}
        </p>
      ))}
      <h4>{c.overviewHeading}</h4>
      <p className="action-plan__overview">{plan.overview}</p>
      <h4>{c.actionsHeading}</h4>
      <ol className="action-plan__actions">
        {plan.actions.map((action) => (
          <PlanActionItem
            key={actionKey(action)}
            action={action}
            language={props.language}
            onOpenProblem={props.onOpenProblem}
          />
        ))}
      </ol>
      <p className="action-plan__reach">
        {plan.reach.open === 0
          ? c.reachAllSettled(plan.reach.rules)
          : c.reach(reachPercent(plan), plan.reach.rules)}
      </p>
    </div>
  );
}
