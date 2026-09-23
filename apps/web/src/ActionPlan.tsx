// The AI Action Plan block of a report (D-232).
//
// The plan's words are a snapshot; its counts are not. Everything numeric on
// screen — per-Action open/total, whether an Action is settled, Reach — comes
// from the server's live overlay over the scan's current issue statuses, so
// triaging an issue moves them without rewriting a word.
//
// Every response is shape-checked. The report's test mocks (and a stale
// deployment) answer any `/scans/...` path with a dashboard object, and drawing
// an idle button from one would offer to spend a generation this scan may not
// have.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  apiRequest,
  ApiRequestError,
  isActionPlanState,
  type ActionPlanState,
  type Scan,
} from './api';
import { actionPlanCopy, type ActionPlanCopy } from './action-plan-copy';
import { ACTION_PLAN_NOTICE_VERSION } from './ai-processing-notice';
import { Button, SelectField, StatusChip } from './components';
import { formatDate } from './format-date';
import type { Language } from './i18n';
import { moduleLabel, ruleTitle } from './rule-titles';
import { LANGUAGE_CODES, languageCodeLabel, targetLanguageCodes } from './target-languages';
import './styles/findings.css';

const POLL_INTERVAL_MS = 3000;
/**
 * The longest wait worth arming a timer for. The Plan Window is three days, so
 * anything beyond a week is a clock or a payload nobody should schedule around
 * — and `setTimeout` silently fires at once past 2^31 ms.
 */
const MAX_WINDOW_TIMER_MS = 7 * 24 * 60 * 60 * 1000;
/** Fire just after the boundary, so the comparison is never a tie. */
const WINDOW_TIMER_GRACE_MS = 1000;

export interface ActionPlanProps {
  readonly scan: Scan;
  readonly language: Language;
  /** The site profile's target languages, offered first in the picker. */
  readonly targetLanguages?: string | null;
  readonly onOpenProblem: (ruleId: string) => void;
  /** Buys a Complete scan; the Basic report has no plan to show. */
  readonly onUpgrade: () => void;
  /**
   * Whether this report still has open findings, or `null` while the report
   * does not know yet. The difference matters: "no open findings" is a state
   * with its own screen ("nothing to plan"), and showing it to a reader whose
   * issue summary is merely still loading would be a lie that then flips.
   */
  readonly hasOpenIssues: boolean | null;
  /**
   * Told whenever a ready plan appears or disappears for the selected language:
   * the report replaces its "fix these first" list with the plan, and must put
   * it back when the reader switches to a language that has none.
   */
  readonly onPlanReadyChange?: (ready: boolean) => void;
}

function planPath(scanId: string, language: string): string {
  return `/scans/${encodeURIComponent(scanId)}/action-plan?language=${encodeURIComponent(language)}`;
}

/**
 * Whether the three-day Plan Window has closed.
 *
 * The server refuses a generation after it (409 ACTION_PLAN_WINDOW_CLOSED), so
 * the button that asks for one is not offered — an enabled button the server
 * will always refuse is an invitation to a dead end. A date the browser cannot
 * read is treated as open and left to the server, which is the only authority
 * on it anyway.
 */
function isWindowClosed(windowEndsAt: string | null, now: number): boolean {
  const endsAt = windowEndEpoch(windowEndsAt);
  return endsAt !== null && endsAt < now;
}

/** The window's end as a timestamp, or null when there is none to read. */
function windowEndEpoch(windowEndsAt: string | null): number | null {
  if (windowEndsAt === null) return null;
  const endsAt = Date.parse(windowEndsAt);
  return Number.isNaN(endsAt) ? null : endsAt;
}

/**
 * The languages the picker offers: the profile's target languages first, then
 * the rest of the supported list. The reader's UI language is the default.
 */
function languageOptions(
  uiLanguage: Language,
  targetLanguages: string | null | undefined,
): readonly { value: string; label: string }[] {
  const ordered = [
    ...new Set<string>([uiLanguage, ...targetLanguageCodes(targetLanguages), ...LANGUAGE_CODES]),
  ];
  return ordered.map((code) => ({ value: code, label: languageCodeLabel(code, uiLanguage) }));
}

export function ActionPlan(props: ActionPlanProps) {
  const t = actionPlanCopy[props.language];
  const [selected, setSelected] = useState<string>(props.language);
  const [state, setState] = useState<ActionPlanState | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // The moment the refusals below are judged against. It moves when the Plan
  // Window closes under a report nobody touched (see the timer effect).
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  const load = useCallback(async (): Promise<ActionPlanState | null> => {
    try {
      const value = await apiRequest<unknown>(planPath(props.scan.id, selected));
      if (!isActionPlanState(value)) {
        setUnavailable(true);
        return null;
      }
      setUnavailable(false);
      if (mounted.current) setState(value);
      return value;
    } catch (error) {
      // A report this account may not generate from still reads; the block is
      // simply not offered.
      if (error instanceof ApiRequestError && error.status !== 0) setUnavailable(true);
      return null;
    }
  }, [props.scan.id, selected]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const planReady = state?.plan != null && !unavailable && props.scan.plan === 'Complete';
  const notifyPlanReady = props.onPlanReadyChange;
  useEffect(() => {
    notifyPlanReady?.(planReady);
  }, [notifyPlanReady, planReady]);

  // Poll only while a run is in flight, so a reload during generation picks the
  // plan up and an idle report makes no repeated requests.
  const running = state?.running ?? null;
  useEffect(() => {
    if (running === null) return undefined;
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  // The window closes on a clock, not on a request, and an idle report makes no
  // requests at all — so a report left open across the boundary would keep
  // offering a button the server has started refusing. One timer, set for the
  // moment it happens rather than a poll that asks all day.
  const windowEndsAt = state?.windowEndsAt ?? null;
  useEffect(() => {
    const endsAt = windowEndEpoch(windowEndsAt);
    if (endsAt === null) return undefined;
    const delay = endsAt - now;
    if (delay <= 0 || delay > MAX_WINDOW_TIMER_MS) return undefined;
    const timer = setTimeout(() => {
      if (mounted.current) setNow(Date.now());
    }, delay + WINDOW_TIMER_GRACE_MS);
    return () => clearTimeout(timer);
  }, [windowEndsAt, now]);

  if (props.scan.plan === 'Free') return null;
  if (props.scan.plan !== 'Complete') {
    return props.hasOpenIssues === true ? (
      <section className="report-block" aria-labelledby="action-plan-heading">
        <h3 id="action-plan-heading">{t.lockedTitle}</h3>
        <p>{t.lockedBody}</p>
        <div className="button-row">
          <Button variant="primary" onClick={props.onUpgrade}>
            {t.lockedAction}
          </Button>
        </div>
      </section>
    ) : null;
  }
  if (unavailable || state === null) return null;

  const plan = state.plan;
  const otherLanguages = state.languages.filter((language) => language !== selected);
  const attemptsLeft = state.remaining.attempts;
  // Three reasons the server would refuse, each with its own line on screen.
  // Everything left over is the ordinary idle state.
  const windowClosed = isWindowClosed(state.windowEndsAt, now);
  const nothingToPlan = props.hasOpenIssues === false;
  const canGenerate = attemptsLeft > 0 && state.remaining.successes > 0;
  const refusal = nothingToPlan ? t.nothingToPlan : windowClosed ? t.windowClosed : null;

  const start = async (): Promise<void> => {
    setStarting(true);
    setStartError(null);
    try {
      await apiRequest(`/scans/${encodeURIComponent(props.scan.id)}/action-plan`, {
        method: 'POST',
        // The notice the owner is reading as they click (t.consent), named in
        // the request so the stored attempt records what was actually shown.
        body: JSON.stringify({ language: selected, noticeVersion: ACTION_PLAN_NOTICE_VERSION }),
      });
      await load();
    } catch (error) {
      setStartError(error instanceof Error ? error.message : t.failed);
    } finally {
      if (mounted.current) setStarting(false);
    }
  };

  return (
    <section className="report-block action-plan" aria-labelledby="action-plan-heading">
      <div className="split">
        <h3 id="action-plan-heading">{t.heading}</h3>
        <StatusChip status="Informational" label={t.aiLabel} />
      </div>

      {plan === null ? (
        <>
          {refusal === null ? (
            <>
              <p className="muted">{t.idleLead}</p>
              <SelectField
                label={t.languageLabel}
                name="action-plan-language"
                value={selected}
                onChange={setSelected}
                options={[...languageOptions(props.language, props.targetLanguages)]}
              />
            </>
          ) : (
            <p className="muted action-plan__refusal">{refusal}</p>
          )}
          {otherLanguages.map((language) => (
            <p className="muted" key={language}>
              {t.otherLanguage(languageCodeLabel(language, props.language))}{' '}
              <Button onClick={() => setSelected(language)}>
                {languageCodeLabel(language, props.language)}
              </Button>
            </p>
          ))}
        </>
      ) : (
        <PlanBody plan={plan} language={props.language} onOpenProblem={props.onOpenProblem} />
      )}

      {state.running !== null ? (
        <p className="muted action-plan__running" role="status">
          {t.running}
        </p>
      ) : null}

      {state.running === null && state.lastFailure !== null && plan === null ? (
        <p className="muted action-plan__failed" role="status">
          {t.failed}
        </p>
      ) : null}
      {startError === null ? null : (
        <p className="muted action-plan__failed" role="status">
          {startError}
        </p>
      )}

      {state.running === null && refusal === null ? (
        <>
          <div className="button-row">
            <Button
              variant="primary"
              disabled={starting || !canGenerate}
              onClick={() => void start()}
            >
              {buttonLabel(t, state)}
            </Button>
          </div>
          <p className="muted action-plan__consent">{canGenerate ? t.consent : t.noAttemptsLeft}</p>
        </>
      ) : null}
      {/* A plan that is already written stays readable after the window closes;
          only the offer to write another one goes away, and it says why. */}
      {state.running === null && refusal !== null && plan !== null ? (
        <p className="muted action-plan__refusal">{refusal}</p>
      ) : null}
    </section>
  );
}

/**
 * What the one button says. A failed attempt with no plan on screen offers
 * another go rather than repeating the first-time invitation — the reader has
 * already accepted it once, and what they need to know is that they may retry.
 */
function buttonLabel(t: ActionPlanCopy, state: ActionPlanState): string {
  if (state.plan !== null) return t.regenerate(state.remaining.successes);
  return state.lastFailure === null ? t.generate : t.retry;
}

function PlanBody(props: {
  plan: NonNullable<ActionPlanState['plan']>;
  language: Language;
  onOpenProblem: (ruleId: string) => void;
}) {
  const t = actionPlanCopy[props.language];
  const { plan } = props;
  return (
    <>
      {plan.caveats.map((module) => (
        <p className="muted action-plan__caveat" key={module}>
          {t.caveat(moduleLabel(module, props.language))}
        </p>
      ))}
      <h4>{t.overviewHeading}</h4>
      <p className="action-plan__overview">{plan.overview}</p>
      <h4>{t.actionsHeading}</h4>
      <ol className="action-plan__actions">
        {plan.actions.map((action, index) => (
          <li
            key={`${index}:${action.title}`}
            className={
              action.settled
                ? 'action-plan__action action-plan__action--settled'
                : 'action-plan__action'
            }
          >
            <div className="split">
              <strong>{action.title}</strong>
              <small className="muted">
                {t.effortLabel}: {t.effort[action.effort] ?? action.effort}
              </small>
            </div>
            <p>{action.why}</p>
            {action.settled ? (
              <p className="muted">
                {t.settled}. {t.settledNote}
              </p>
            ) : (
              <ol className="action-plan__steps">
                {action.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
            <div className="action-plan__rules">
              <span className="muted">{t.openIssues(action.openIssues, action.totalIssues)}</span>
              {action.ruleIds.map((ruleId) => (
                <Button key={ruleId} onClick={() => props.onOpenProblem(ruleId)}>
                  {ruleTitle(ruleId, props.language)}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ol>
      {plan.reach === null ? null : (
        <p className="muted action-plan__reach">{t.reach(plan.reach.share, plan.reach.rules)}</p>
      )}
      <p className="muted action-plan__meta">
        {t.generatedAt(formatDate(plan.generatedAt, props.language), plan.modelId)}
      </p>
    </>
  );
}
