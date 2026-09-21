// The AI Action Plan on a report (D-232).
//
// On a Complete report the owner picks a language and asks Claude for a short,
// ordered list of changes; the API writes it in the background and this block
// polls until it is there, across a reload too. A ready plan in the chosen
// language takes the place of "Fix these first" (see ReportNextSteps). Its
// text is a snapshot, its counts are live, and an Action whose issues are all
// settled folds away — it is never called "fixed", because within one scan
// only the owner's Ignored and False Positive move it.

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import {
  PLAN_POLL_INTERVAL_MS,
  fetchActionPlan,
  plansLeft,
  requestActionPlan,
  type ActionPlanContent,
  type ActionPlanState,
  type PlanAction,
} from './action-plan';
import { actionPlanCopy, type ActionPlanCopy } from './action-plan-copy';
import { ApiRequestError } from './api';
import { Button, SelectField, StatusChip } from './components';
import { formatDate } from './format-date';
import type { Language } from './i18n';
import { moduleLabel, ruleTitle } from './rule-titles';
import { languageCodeLabel } from './target-languages';

export interface ActionPlanHandle {
  /** Null while loading, and whenever the answer is not an Action Plan state. */
  readonly state: ActionPlanState | null;
  readonly refresh: () => Promise<void>;
}

/** Reads the plan state of one scan in one language, polling while a run is in flight. */
export function useActionPlan(scanId: string | null, language: string): ActionPlanHandle {
  const [state, setState] = useState<ActionPlanState | null>(null);
  // Answers can overtake each other (a poll and a language switch); only the
  // latest request may set the state.
  const latest = useRef(0);
  const refresh = useCallback(async (): Promise<void> => {
    if (scanId === null) return;
    latest.current += 1;
    const request = latest.current;
    try {
      const next = await fetchActionPlan(scanId, language);
      if (request === latest.current) setState(next);
    } catch (caught) {
      // The report reads without this block; the findings are all still there.
      console.error('FluxRadar action plan unavailable', caught);
    }
  }, [scanId, language]);
  useEffect(() => {
    setState(null);
    void refresh();
    return () => {
      latest.current += 1;
    };
  }, [refresh]);
  const running = state?.run != null;
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => void refresh(), PLAN_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [running, refresh]);
  return { state, refresh };
}

function errorMessage(caught: unknown, copy: ActionPlanCopy): string {
  const code = caught instanceof ApiRequestError ? caught.code : null;
  switch (code) {
    case 'ACTION_PLAN_BUSY':
    case 'ACTION_PLAN_AI_UNAVAILABLE':
      return copy.errors.busy;
    case 'ACTION_PLAN_IN_PROGRESS':
      return copy.errors.inProgress;
    case 'ACTION_PLAN_LIMIT':
      return copy.errors.limit;
    case 'ACTION_PLAN_NOTICE_OUTDATED':
      return copy.errors.outdated;
    case 'RATE_LIMITED':
      return copy.errors.rateLimited;
    default:
      return copy.errors.generic;
  }
}

/** The last attempt, in the language shown, failed and left no plan to show instead. */
function failedIn(state: ActionPlanState, planLanguage: string): boolean {
  return state.run === null && state.plan === null && state.lastFailure?.language === planLanguage;
}

function reachPercent(plan: ActionPlanContent): number {
  return plan.reach.open === 0 ? 100 : Math.round((plan.reach.addressed / plan.reach.open) * 100);
}

function ActionDetails(props: {
  action: PlanAction;
  language: Language;
  onOpenProblem: (ruleId: string) => void;
}) {
  const c = actionPlanCopy[props.language];
  return (
    <>
      <p className="action-plan__why">{props.action.why}</p>
      <ol className="action-plan__steps">
        {props.action.steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
      <ul className="action-plan__rules">
        {props.action.rules.map((rule) => {
          const title = ruleTitle(rule.ruleId, props.language);
          return (
            <li key={rule.ruleId}>
              <span>{title}</span>
              <Button
                onClick={() => props.onOpenProblem(rule.ruleId)}
                aria-label={`${title}: ${c.ruleLink(rule.openIssues, rule.totalIssues)}`}
              >
                {c.ruleLink(rule.openIssues, rule.totalIssues)}
              </Button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The plan itself: caveats, the Overview, the Actions with live counts, and Reach. */
export function ActionPlanView(props: {
  plan: ActionPlanContent;
  language: Language;
  onOpenProblem: (ruleId: string) => void;
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
        {plan.actions.map((action, index) => (
          <li
            key={index}
            className={`action-plan__action${action.settled ? ' action-plan__action--settled' : ''}`}
          >
            {action.settled ? (
              <details>
                <summary>
                  <span className="action-plan__title">{action.title}</span>{' '}
                  <StatusChip status="Settled" label={c.settled} />
                </summary>
                <p className="muted">{c.settledNote}</p>
                <ActionDetails
                  action={action}
                  language={props.language}
                  onOpenProblem={props.onOpenProblem}
                />
              </details>
            ) : (
              <>
                <div className="action-plan__action-head">
                  <span className="action-plan__title">{action.title}</span>
                  <span className="muted action-plan__facts">
                    {c.effort[action.effort]} · {c.counts(action.openIssues, action.totalIssues)}
                  </span>
                </div>
                <ActionDetails
                  action={action}
                  language={props.language}
                  onOpenProblem={props.onOpenProblem}
                />
              </>
            )}
          </li>
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

/** What the block says above the plan: a run in flight, a failure, or why nothing can be asked. */
function PlanNotices(props: {
  state: ActionPlanState;
  planLanguage: string;
  language: Language;
  onPlanLanguage: (code: string) => void;
}) {
  const c = actionPlanCopy[props.language];
  const { state } = props;
  const label = (code: string) => languageCodeLabel(code, props.language);
  const otherLanguages = state.plan === null ? state.languages : [];
  return (
    <>
      {state.run !== null ? (
        <p className="action-plan__running" role="status">
          {c.running(label(state.run.language))}
        </p>
      ) : null}
      {failedIn(state, props.planLanguage) ? <p role="note">{c.failed}</p> : null}
      {state.plan === null && state.availability === 'nothing_to_plan' ? (
        <p className="muted">{c.nothingToPlan}</p>
      ) : null}
      {state.run === null && state.availability === 'window_closed' ? (
        <p className="muted">
          {state.windowEndsAt === null
            ? c.windowClosedUndated
            : c.windowClosed(formatDate(state.windowEndsAt, props.language))}
        </p>
      ) : null}
      {state.run === null && state.availability === 'limit_reached' ? (
        <p className="muted">{c.limitReached}</p>
      ) : null}
      {otherLanguages.map((code) => (
        <p key={code} className="action-plan__other">
          {c.otherLanguage(label(code))}{' '}
          <Button onClick={() => props.onPlanLanguage(code)}>
            {c.openOtherLanguage(label(code))}
          </Button>
        </p>
      ))}
    </>
  );
}

/** The block on a Complete report. Draws nothing while the state is unknown. */
export function ActionPlan(props: {
  scanId: string;
  language: Language;
  handle: ActionPlanHandle;
  planLanguage: string;
  planLanguageOptions: readonly string[];
  onPlanLanguage: (code: string) => void;
  onOpenProblem: (ruleId: string) => void;
}) {
  const c = actionPlanCopy[props.language];
  const consentId = useId();
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { state, refresh } = props.handle;
  if (state === null || state.availability === 'not_ready') return null;
  const canGenerate = state.availability === 'available' && state.run === null;
  const failedHere = failedIn(state, props.planLanguage);
  // Switching languages means something only when a plan can be asked for or
  // one exists in another language.
  const showPicker = canGenerate || state.languages.length > 0;
  const buttonLabel =
    state.plan !== null
      ? c.regenerate(plansLeft(state))
      : failedHere
        ? c.retry(plansLeft(state))
        : c.generate;
  const generate = async (): Promise<void> => {
    setWorking(true);
    setFailure(null);
    try {
      await requestActionPlan(props.scanId, props.planLanguage);
    } catch (caught) {
      setFailure(errorMessage(caught, c));
    } finally {
      setWorking(false);
      await refresh();
    }
  };
  return (
    <section className="report-block action-plan" aria-labelledby="action-plan-heading">
      <h3 id="action-plan-heading">{c.heading}</h3>
      {state.plan === null && canGenerate && !failedHere ? <p>{c.lead}</p> : null}
      <PlanNotices
        state={state}
        planLanguage={props.planLanguage}
        language={props.language}
        onPlanLanguage={props.onPlanLanguage}
      />
      {state.plan === null ? null : (
        <ActionPlanView
          plan={state.plan}
          language={props.language}
          onOpenProblem={props.onOpenProblem}
        />
      )}
      {failure === null ? null : (
        <p className="action-plan__error" role="alert">
          {failure}
        </p>
      )}
      {showPicker ? (
        <div className="action-plan__controls">
          <SelectField
            label={c.languageLabel}
            value={props.planLanguage}
            onChange={(code) => {
              setFailure(null);
              props.onPlanLanguage(code);
            }}
            options={props.planLanguageOptions.map((code) => ({
              value: code,
              label: languageCodeLabel(code, props.language),
            }))}
          />
          {canGenerate ? (
            <div className="action-plan__generate">
              <Button
                variant={state.plan === null ? 'primary' : 'default'}
                disabled={working}
                onClick={() => void generate()}
                aria-describedby={consentId}
              >
                {working ? c.working : buttonLabel}
              </Button>
              <p className="muted action-plan__consent" id={consentId}>
                {c.consent}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** A Basic report's promise of the plan: no AI call, the way on is a Complete scan. */
export function LockedActionPlan(props: { language: Language; onUpgrade: () => void }) {
  const c = actionPlanCopy[props.language].locked;
  return (
    <section
      className="report-block action-plan action-plan--locked"
      aria-labelledby="action-plan-locked-heading"
    >
      <h3 id="action-plan-locked-heading">{c.heading}</h3>
      <p>{c.body}</p>
      <div className="button-row">
        <Button onClick={props.onUpgrade}>{c.action}</Button>
      </div>
    </section>
  );
}
