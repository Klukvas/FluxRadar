// The Action Plan as the report reads it (D-232): the API's answer, checked
// field by field before anything is drawn from it.
//
// Every workspace test answers unknown API paths with a scan or a dashboard,
// and a block that trusted the shape would crash dozens of unrelated tests —
// or, in production, a report whose API is one release behind. An answer that
// is not exactly this shape reads as "unavailable", and the block draws nothing.

import { ACTION_PLAN_NOTICE_VERSION } from './action-plan-notice';
import { apiRequest } from './api';
import { asRecord } from './module-metadata';
import { LANGUAGE_CODES, targetLanguageCodes } from './target-languages';

/** How long the report waits after one answer before asking again. */
export const PLAN_POLL_INTERVAL_MS = 3000;
/**
 * Answers in a row that may say "not ready" before the report stops asking —
 * about two minutes. A finished scan's last step (Google data) takes seconds;
 * a scan whose job never finishes must not be asked about for as long as the
 * page stays open.
 */
export const PLAN_NOT_READY_POLL_LIMIT = 40;

/**
 * The API declares both lists again (apps/api/src/action-plan/policy.ts and
 * @fluxradar/ai), and its web-contract test fails when they drift: an answer
 * with a value missing here reads as no answer, and the block disappears.
 */
export const PLAN_AVAILABILITIES = [
  'available',
  'not_ready',
  'window_closed',
  'nothing_to_plan',
  'limit_reached',
] as const;
export type PlanAvailability = (typeof PLAN_AVAILABILITIES)[number];

export const PLAN_EFFORTS = ['small', 'medium', 'large'] as const;
export type PlanEffort = (typeof PLAN_EFFORTS)[number];

/** The failure the report explains on its own: Claude declined to write the plan. */
export const PLAN_REFUSED_FAILURE = 'refused';

export interface PlanRule {
  readonly ruleId: string;
  readonly openIssues: number;
  readonly totalIssues: number;
}

export interface PlanAction {
  readonly title: string;
  readonly why: string;
  /** Distinct: a repeated step is dropped, so each step's text is its key. */
  readonly steps: readonly string[];
  readonly effort: PlanEffort;
  readonly rules: readonly PlanRule[];
  readonly openIssues: number;
  readonly totalIssues: number;
  /** No open issue left among its rules — never "fixed": Resolved comes from a later scan. */
  readonly settled: boolean;
}

export interface PlanCaveat {
  readonly module: string;
  readonly status: string;
}

/** A stored plan under its live counts, as the API returns it. */
export interface PlanWithOverlay {
  readonly language: string;
  readonly generatedAt: string;
  readonly modelId: string;
  readonly overview: string;
  readonly actions: readonly PlanAction[];
  readonly reach: { readonly addressed: number; readonly open: number; readonly rules: number };
  readonly caveats: readonly PlanCaveat[];
}

export interface ActionPlanState {
  /** The language asked for; everything but `plan` is the same in every language. */
  readonly language: string;
  readonly availability: PlanAvailability;
  readonly languages: readonly string[];
  readonly run: { readonly language: string; readonly startedAt: string } | null;
  readonly lastFailure: {
    readonly code: string;
    readonly language: string;
    readonly at: string;
  } | null;
  readonly remaining: { readonly successes: number; readonly attempts: number };
  readonly windowEndsAt: string | null;
  readonly plan: PlanWithOverlay | null;
}

/** The plan language a report shows, the languages it offers, and how to change it. */
export interface PlanLanguageChoice {
  readonly value: string;
  readonly options: readonly string[];
  readonly onChange: (code: string) => void;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

function strings(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every(isString) ? value : null;
}

/** Every entry read, or null when any of them is not the expected shape. */
function readAll<T>(value: unknown, read: (entry: unknown) => T | null): readonly T[] | null {
  if (!Array.isArray(value)) return null;
  const entries = value.map(read);
  return entries.every((entry): entry is T => entry !== null) ? entries : null;
}

function readRule(value: unknown): PlanRule | null {
  const fields = asRecord(value);
  if (fields === null) return null;
  const { ruleId, openIssues, totalIssues } = fields;
  return isString(ruleId) && isCount(openIssues) && isCount(totalIssues)
    ? { ruleId, openIssues, totalIssues }
    : null;
}

function readAction(value: unknown): PlanAction | null {
  const fields = asRecord(value);
  if (fields === null) return null;
  const steps = strings(fields.steps);
  const rules = readAll(fields.rules, readRule);
  const effort = PLAN_EFFORTS.find((known) => known === fields.effort);
  if (
    !isString(fields.title) ||
    !isString(fields.why) ||
    steps === null ||
    effort === undefined ||
    rules === null ||
    !isCount(fields.openIssues) ||
    !isCount(fields.totalIssues) ||
    typeof fields.settled !== 'boolean'
  ) {
    return null;
  }
  return {
    title: fields.title,
    why: fields.why,
    steps: [...new Set(steps)],
    effort,
    rules,
    openIssues: fields.openIssues,
    totalIssues: fields.totalIssues,
    settled: fields.settled,
  };
}

function readCaveat(value: unknown): PlanCaveat | null {
  const fields = asRecord(value);
  return fields !== null && isString(fields.module) && isString(fields.status)
    ? { module: fields.module, status: fields.status }
    : null;
}

function readPlan(value: unknown): PlanWithOverlay | null {
  const fields = asRecord(value);
  const reach = asRecord(fields?.reach);
  if (fields === null || reach === null) return null;
  const actions = readAll(fields.actions, readAction);
  const caveats = readAll(fields.caveats, readCaveat);
  if (
    !isString(fields.language) ||
    !isString(fields.generatedAt) ||
    !isString(fields.modelId) ||
    !isString(fields.overview) ||
    actions === null ||
    caveats === null ||
    !isCount(reach.addressed) ||
    !isCount(reach.open) ||
    !isCount(reach.rules)
  ) {
    return null;
  }
  return {
    language: fields.language,
    generatedAt: fields.generatedAt,
    modelId: fields.modelId,
    overview: fields.overview,
    actions,
    reach: { addressed: reach.addressed, open: reach.open, rules: reach.rules },
    caveats,
  };
}

function readRun(value: unknown): ActionPlanState['run'] | undefined {
  if (value === null) return null;
  const fields = asRecord(value);
  return fields !== null && isString(fields.language) && isString(fields.startedAt)
    ? { language: fields.language, startedAt: fields.startedAt }
    : undefined;
}

function readFailure(value: unknown): ActionPlanState['lastFailure'] | undefined {
  if (value === null) return null;
  const fields = asRecord(value);
  return fields !== null &&
    isString(fields.code) &&
    isString(fields.language) &&
    isString(fields.at)
    ? { code: fields.code, language: fields.language, at: fields.at }
    : undefined;
}

/** The API's answer, or null when it is not an Action Plan state at all. */
export function readActionPlanState(value: unknown): ActionPlanState | null {
  const fields = asRecord(value);
  const remaining = asRecord(fields?.remaining);
  if (fields === null || remaining === null) return null;
  const availability = PLAN_AVAILABILITIES.find((known) => known === fields.availability);
  const languages = strings(fields.languages);
  const run = readRun(fields.run);
  const lastFailure = readFailure(fields.lastFailure);
  const plan = fields.plan === null ? null : readPlan(fields.plan);
  const windowEndsAt = fields.windowEndsAt;
  if (
    !isString(fields.language) ||
    availability === undefined ||
    languages === null ||
    run === undefined ||
    lastFailure === undefined ||
    !isCount(remaining.successes) ||
    !isCount(remaining.attempts) ||
    !(windowEndsAt === null || isString(windowEndsAt)) ||
    (fields.plan !== null && plan === null)
  ) {
    return null;
  }
  return {
    language: fields.language,
    availability,
    languages,
    run,
    lastFailure,
    remaining: { successes: remaining.successes, attempts: remaining.attempts },
    windowEndsAt,
    plan,
  };
}

/** Plans still to be had: each costs a success and an attempt. */
export function plansLeft(state: ActionPlanState): number {
  return Math.min(state.remaining.successes, state.remaining.attempts);
}

/**
 * Whether the report should ask again: a plan is being written, or the scan
 * is finished but its last step (Google data) is not, so a plan may be asked
 * for in a moment. `notReadyStreak` counts the answers in a row that said so.
 */
export function shouldPoll(state: ActionPlanState, notReadyStreak: number): boolean {
  if (state.run !== null) return true;
  return state.availability === 'not_ready' && notReadyStreak < PLAN_NOT_READY_POLL_LIMIT;
}

/** The plan `state` holds for `language`; null while the answer is another language's. */
export function planIn(state: ActionPlanState | null, language: string): PlanWithOverlay | null {
  return state !== null && state.language === language ? state.plan : null;
}

/**
 * A key of an Action's own: a rule belongs to one Action only (the API keeps
 * it in the first that names it), so its rules name it.
 */
export function actionKey(action: PlanAction): string {
  return action.rules.map((rule) => rule.ruleId).join(' ');
}

/**
 * The languages the picker offers: the site profile's own target languages
 * first, then the reader's, then every other listed one in picker order.
 */
export function planLanguageOptions(
  uiLanguage: string,
  profileTargetLanguages: string | null | undefined,
): readonly string[] {
  const first = [...targetLanguageCodes(profileTargetLanguages ?? ''), uiLanguage];
  return [...new Set([...first, ...LANGUAGE_CODES])].filter((code) =>
    (LANGUAGE_CODES as readonly string[]).includes(code),
  );
}

const PLAN_QUERY_PARAMETER = 'plan';

/** The query the print view reads its plan language from. */
export function planSearch(language: string): string {
  return `?${new URLSearchParams({ [PLAN_QUERY_PARAMETER]: language }).toString()}`;
}

/** The plan language a print address names, or null when it names none the picker lists. */
export function planLanguageFromSearch(search: string): string | null {
  const code = new URLSearchParams(search).get(PLAN_QUERY_PARAMETER);
  return code !== null && (LANGUAGE_CODES as readonly string[]).includes(code) ? code : null;
}

export async function fetchActionPlan(
  scanId: string,
  language: string,
): Promise<ActionPlanState | null> {
  const value = await apiRequest<unknown>(
    `/scans/${encodeURIComponent(scanId)}/action-plan?language=${encodeURIComponent(language)}`,
  );
  return readActionPlanState(value);
}

/** Starts a generation; the click is the consent, under the notice the button shows. */
export async function requestActionPlan(scanId: string, language: string): Promise<void> {
  await apiRequest<unknown>(`/scans/${encodeURIComponent(scanId)}/action-plan`, {
    method: 'POST',
    body: JSON.stringify({ language, noticeVersion: ACTION_PLAN_NOTICE_VERSION }),
  });
}
