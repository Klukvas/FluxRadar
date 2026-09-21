// The Action Plan as the report reads it (D-232): the API's answer, checked
// field by field before anything is drawn from it.
//
// Every workspace test answers unknown API paths with a scan or a dashboard,
// and a block that trusted the shape would crash dozens of unrelated tests —
// or, in production, a report whose API is one release behind. An answer that
// is not exactly this shape reads as "unavailable", and the block draws nothing.

import { ACTION_PLAN_NOTICE_VERSION } from './action-plan-notice';
import { apiRequest } from './api';
import { LANGUAGE_CODES, targetLanguageCodes } from './target-languages';

/** How often the report asks again while a plan is being written. */
export const PLAN_POLL_INTERVAL_MS = 3000;

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

export interface PlanRule {
  readonly ruleId: string;
  readonly openIssues: number;
  readonly totalIssues: number;
}

export interface PlanAction {
  readonly title: string;
  readonly why: string;
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

export interface ActionPlanContent {
  readonly language: string;
  readonly generatedAt: string;
  readonly modelId: string;
  readonly overview: string;
  readonly actions: readonly PlanAction[];
  readonly reach: { readonly addressed: number; readonly open: number; readonly rules: number };
  readonly caveats: readonly PlanCaveat[];
}

export interface ActionPlanState {
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
  readonly plan: ActionPlanContent | null;
}

type Fields = Readonly<Record<string, unknown>>;

function record(value: unknown): Fields | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : null;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

function strings(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every(isString) ? value : null;
}

function readRule(value: unknown): PlanRule | null {
  const fields = record(value);
  if (fields === null) return null;
  const { ruleId, openIssues, totalIssues } = fields;
  return isString(ruleId) && isCount(openIssues) && isCount(totalIssues)
    ? { ruleId, openIssues, totalIssues }
    : null;
}

function readAction(value: unknown): PlanAction | null {
  const fields = record(value);
  if (fields === null) return null;
  const steps = strings(fields.steps);
  const rules = Array.isArray(fields.rules) ? fields.rules.map(readRule) : null;
  const effort = PLAN_EFFORTS.find((known) => known === fields.effort);
  if (
    !isString(fields.title) ||
    !isString(fields.why) ||
    steps === null ||
    effort === undefined ||
    rules === null ||
    rules.some((rule) => rule === null) ||
    !isCount(fields.openIssues) ||
    !isCount(fields.totalIssues) ||
    typeof fields.settled !== 'boolean'
  ) {
    return null;
  }
  return {
    title: fields.title,
    why: fields.why,
    steps,
    effort,
    rules: rules as PlanRule[],
    openIssues: fields.openIssues,
    totalIssues: fields.totalIssues,
    settled: fields.settled,
  };
}

function readCaveat(value: unknown): PlanCaveat | null {
  const fields = record(value);
  return fields !== null && isString(fields.module) && isString(fields.status)
    ? { module: fields.module, status: fields.status }
    : null;
}

function readPlan(value: unknown): ActionPlanContent | null {
  const fields = record(value);
  const reach = record(fields?.reach);
  if (fields === null || reach === null) return null;
  const actions = Array.isArray(fields.actions) ? fields.actions.map(readAction) : null;
  const caveats = Array.isArray(fields.caveats) ? fields.caveats.map(readCaveat) : null;
  if (
    !isString(fields.language) ||
    !isString(fields.generatedAt) ||
    !isString(fields.modelId) ||
    !isString(fields.overview) ||
    actions === null ||
    actions.some((action) => action === null) ||
    caveats === null ||
    caveats.some((caveat) => caveat === null) ||
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
    actions: actions as PlanAction[],
    reach: { addressed: reach.addressed, open: reach.open, rules: reach.rules },
    caveats: caveats as PlanCaveat[],
  };
}

function readRun(value: unknown): ActionPlanState['run'] | undefined {
  if (value === null) return null;
  const fields = record(value);
  return fields !== null && isString(fields.language) && isString(fields.startedAt)
    ? { language: fields.language, startedAt: fields.startedAt }
    : undefined;
}

function readFailure(value: unknown): ActionPlanState['lastFailure'] | undefined {
  if (value === null) return null;
  const fields = record(value);
  return fields !== null &&
    isString(fields.code) &&
    isString(fields.language) &&
    isString(fields.at)
    ? { code: fields.code, language: fields.language, at: fields.at }
    : undefined;
}

/** The API's answer, or null when it is not an Action Plan state at all. */
export function readActionPlanState(value: unknown): ActionPlanState | null {
  const fields = record(value);
  const remaining = record(fields?.remaining);
  if (fields === null || remaining === null) return null;
  const availability = PLAN_AVAILABILITIES.find((known) => known === fields.availability);
  const languages = strings(fields.languages);
  const run = readRun(fields.run);
  const lastFailure = readFailure(fields.lastFailure);
  const plan = fields.plan === null ? null : readPlan(fields.plan);
  if (
    !isString(fields.language) ||
    availability === undefined ||
    languages === null ||
    run === undefined ||
    lastFailure === undefined ||
    !isCount(remaining.successes) ||
    !isCount(remaining.attempts) ||
    !(fields.windowEndsAt === null || isString(fields.windowEndsAt)) ||
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
    windowEndsAt: fields.windowEndsAt as string | null,
    plan,
  };
}

/** Plans still to be had: each costs a success and an attempt. */
export function plansLeft(state: ActionPlanState): number {
  return Math.min(state.remaining.successes, state.remaining.attempts);
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

/** A language code the picker lists, or null — for a code read from a URL. */
export function listedPlanLanguage(code: string | null): string | null {
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
