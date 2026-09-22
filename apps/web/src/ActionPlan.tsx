// The AI Action Plan block on a report (D-232).
//
// On a Complete report the owner picks a language and asks Claude for a short,
// ordered list of changes; the API writes it in the background and this block
// polls until it is there, across a reload too. A ready plan in the chosen
// language takes the place of "Fix these first" (see ReportNextSteps), and
// ActionPlanBody draws it.

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { ActionPlanBody } from './ActionPlanBody';
import {
  PLAN_POLL_INTERVAL_MS,
  PLAN_REFUSED_FAILURE,
  fetchActionPlan,
  planIn,
  plansLeft,
  requestActionPlan,
  shouldPoll,
  type ActionPlanState,
  type PlanLanguageChoice,
} from './action-plan';
import { actionPlanCopy, type ActionPlanCopy } from './action-plan-copy';
import { ApiRequestError } from './api';
import { Button, SelectField } from './components';
import { formatDate } from './format-date';
import type { Language } from './i18n';
import { languageCodeLabel } from './target-languages';

export interface ActionPlanHandle {
  /**
   * The latest answer: null while loading, and whenever the answer is not an
   * Action Plan state. Right after a language switch it is still the previous
   * language's; `planIn` reads the plan of the language shown.
   */
  readonly state: ActionPlanState | null;
  /** Asks again about the scan and the language shown when it is called. */
  readonly refresh: () => Promise<void>;
}

interface PlanAnswers {
  readonly state: ActionPlanState | null;
  /** Answers in a row that said "not ready yet"; see PLAN_NOT_READY_POLL_LIMIT. */
  readonly notReadyStreak: number;
  /** The last request failed: nothing is asked again until something else asks. */
  readonly failed: boolean;
}

const NO_ANSWERS: PlanAnswers = { state: null, notReadyStreak: 0, failed: false };

function withAnswer(previous: PlanAnswers, next: ActionPlanState | null): PlanAnswers {
  return {
    state: next,
    notReadyStreak: next?.availability === 'not_ready' ? previous.notReadyStreak + 1 : 0,
    failed: false,
  };
}

/**
 * Reads the plan state of one scan in one language, and asks again while a
 * plan is being written or the scan is about to be ready for one. One request
 * at a time: the next poll is scheduled only once the previous answer is in,
 * and a failed request (a refund, a lost session) stops the polling.
 */
export function useActionPlan(scanId: string | null, language: string): ActionPlanHandle {
  const [answers, setAnswers] = useState<PlanAnswers>(NO_ANSWERS);
  // What the report shows now. Every request asks about it — a click that
  // started before a language switch refreshes the new language — and an
  // answer that arrives after the reader moved on is dropped.
  const shown = useRef({ scanId, language });
  const refresh = useCallback(async (): Promise<void> => {
    const asked = shown.current;
    if (asked.scanId === null) return;
    const isStillShown = () => shown.current === asked;
    try {
      const next = await fetchActionPlan(asked.scanId, asked.language);
      if (isStillShown()) setAnswers((previous) => withAnswer(previous, next));
    } catch (caught) {
      // The report reads without this block; the findings are all still there.
      console.error('FluxRadar action plan unavailable', caught);
      if (isStillShown()) setAnswers((previous) => ({ ...previous, failed: true }));
    }
  }, []);
  useEffect(() => {
    shown.current = { scanId, language };
    void refresh();
  }, [scanId, language, refresh]);
  // Another scan starts from nothing. Another language keeps the block, and
  // the picker with its focus, until its own answer arrives.
  useEffect(() => {
    setAnswers(NO_ANSWERS);
  }, [scanId]);
  useEffect(() => {
    const { state, notReadyStreak, failed } = answers;
    if (failed || state === null || !shouldPoll(state, notReadyStreak)) return undefined;
    const timer = setTimeout(() => void refresh(), PLAN_POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [answers, refresh]);
  return { state: answers.state, refresh };
}

/** What the owner is told when the API would not start a plan. */
function startFailureMessage(caught: unknown, copy: ActionPlanCopy): string {
  if (!(caught instanceof ApiRequestError)) {
    console.error('FluxRadar action plan could not be started', caught);
    return copy.errors.generic;
  }
  switch (caught.code) {
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
      // The refreshed state says why (the window closed, nothing left to plan).
      return copy.errors.generic;
  }
}

interface Generation {
  readonly working: boolean;
  readonly failure: string | null;
  readonly start: () => Promise<void>;
  readonly clearFailure: () => void;
}

/** A click on Generate: the POST, then the state read again whatever it answered. */
function useGeneration(
  scanId: string,
  planLanguage: string,
  handle: ActionPlanHandle,
  copy: ActionPlanCopy,
): Generation {
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const start = async (): Promise<void> => {
    setWorking(true);
    setFailure(null);
    try {
      await requestActionPlan(scanId, planLanguage);
    } catch (caught) {
      setFailure(startFailureMessage(caught, copy));
    } finally {
      setWorking(false);
      await handle.refresh();
    }
  };
  return { working, failure, start, clearFailure: () => setFailure(null) };
}

/** The last attempt, in the language shown, failed and left no plan to show instead. */
function failedIn(state: ActionPlanState, planLanguage: string): boolean {
  return (
    state.run === null &&
    planIn(state, planLanguage) === null &&
    state.lastFailure?.language === planLanguage
  );
}

/** Why nothing can be asked for right now, when that is the case. */
function unavailableNotice(
  state: ActionPlanState,
  language: Language,
  copy: ActionPlanCopy,
): string | null {
  if (state.run !== null) return null;
  switch (state.availability) {
    case 'window_closed':
      return state.windowEndsAt === null
        ? copy.windowClosedUndated
        : copy.windowClosed(formatDate(state.windowEndsAt, language));
    case 'limit_reached':
      return copy.limitReached;
    default:
      return null;
  }
}

/** What the block says above the plan: a run in flight, a failure, or why nothing can be asked. */
function PlanNotices(props: {
  state: ActionPlanState;
  planLanguage: PlanLanguageChoice;
  language: Language;
}) {
  const c = actionPlanCopy[props.language];
  const { state } = props;
  const shown = props.planLanguage.value;
  const label = (code: string) => languageCodeLabel(code, props.language);
  const planShown = planIn(state, shown) !== null;
  const otherLanguages = planShown ? [] : state.languages.filter((code) => code !== shown);
  const unavailable = unavailableNotice(state, props.language, c);
  return (
    <>
      {state.run === null ? null : (
        <p className="action-plan__running" role="status">
          {c.running(label(state.run.language))}
        </p>
      )}
      {failedIn(state, shown) ? (
        <p role="note">{state.lastFailure?.code === PLAN_REFUSED_FAILURE ? c.refused : c.failed}</p>
      ) : null}
      {!planShown && state.availability === 'nothing_to_plan' ? (
        <p className="muted">{c.nothingToPlan}</p>
      ) : null}
      {unavailable === null ? null : <p className="muted">{unavailable}</p>}
      {otherLanguages.map((code) => (
        <p key={code} className="action-plan__other">
          {c.otherLanguage(label(code))}{' '}
          <Button onClick={() => props.planLanguage.onChange(code)}>
            {c.openOtherLanguage(label(code))}
          </Button>
        </p>
      ))}
    </>
  );
}

/** The language picker and, when a plan can be asked for, the button with its consent line. */
function PlanControls(props: {
  state: ActionPlanState;
  hasPlan: boolean;
  canGenerate: boolean;
  language: Language;
  planLanguage: PlanLanguageChoice;
  generation: Generation;
}) {
  const c = actionPlanCopy[props.language];
  const consentId = useId();
  const { state, planLanguage, generation } = props;
  // Switching languages means something only when a plan can be asked for or
  // one exists in another language.
  if (!props.canGenerate && state.languages.length === 0) return null;
  const left = plansLeft(state);
  const idleLabel = props.hasPlan
    ? c.regenerate(left)
    : failedIn(state, planLanguage.value)
      ? c.retry(left)
      : c.generate;
  return (
    <div className="action-plan__controls">
      <SelectField
        label={c.languageLabel}
        value={planLanguage.value}
        onChange={(code) => {
          generation.clearFailure();
          planLanguage.onChange(code);
        }}
        options={planLanguage.options.map((code) => ({
          value: code,
          label: languageCodeLabel(code, props.language),
        }))}
      />
      {props.canGenerate ? (
        <div className="action-plan__generate">
          <Button
            variant={props.hasPlan ? 'default' : 'primary'}
            disabled={generation.working}
            onClick={() => void generation.start()}
            aria-describedby={consentId}
          >
            {generation.working ? c.working : idleLabel}
          </Button>
          <p className="muted action-plan__consent" id={consentId}>
            {c.consent}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** The block on a Complete report. Draws nothing while the state is unknown. */
export function ActionPlan(props: {
  scanId: string;
  language: Language;
  handle: ActionPlanHandle;
  planLanguage: PlanLanguageChoice;
  onOpenProblem: (ruleId: string) => void;
}) {
  const c = actionPlanCopy[props.language];
  const shown = props.planLanguage.value;
  const generation = useGeneration(props.scanId, shown, props.handle, c);
  const { state } = props.handle;
  if (state === null || state.availability === 'not_ready') return null;
  const plan = planIn(state, shown);
  const canGenerate = state.availability === 'available' && state.run === null;
  return (
    <section className="report-block action-plan" aria-labelledby="action-plan-heading">
      <h3 id="action-plan-heading">{c.heading}</h3>
      {plan === null && canGenerate && !failedIn(state, shown) ? <p>{c.lead}</p> : null}
      <PlanNotices state={state} planLanguage={props.planLanguage} language={props.language} />
      {plan === null ? null : (
        <ActionPlanBody plan={plan} language={props.language} onOpenProblem={props.onOpenProblem} />
      )}
      {generation.failure === null ? null : (
        <p className="action-plan__error" role="alert">
          {generation.failure}
        </p>
      )}
      <PlanControls
        state={state}
        hasPlan={plan !== null}
        canGenerate={canGenerate}
        language={props.language}
        planLanguage={props.planLanguage}
        generation={generation}
      />
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
