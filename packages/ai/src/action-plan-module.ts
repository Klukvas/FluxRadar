// The Action Plan request (D-232): one Claude call that turns a Complete scan's
// rule metadata into a prioritized plan for whoever fixes the site.
//
// What leaves this module is deliberately narrow — rule id, owner-facing title,
// module, highest open severity, open issue count, up to three sample URLs,
// the rule's own recommendations, and the module status line. No
// `evidence_excerpt`, no screenshots or traces, and nothing from the Analytics
// module, whose findings are Google data (D-219). `buildActionPlanRequest`
// enforces both rules rather than trusting its caller.

import { AI_REQUEST_CAPS, ACTION_PLAN_MAX_ACTIONS } from '@fluxradar/contracts';
import type { AiRequestCapsShape } from '@fluxradar/contracts';

import { AiModuleError } from './errors.js';
import { AiQuotaTracker } from './quota.js';
import { runAiRequest } from './run-request.js';
import type { AiRequestOutcome } from './run-request.js';
import type { AiConsent } from './consent.js';
import type { AiProvider, AiRequest } from './types.js';

export const ACTION_PLAN_PROMPT_VERSION = 'action-plan-v1';

/** The module whose findings are Google data and never reach a provider. */
export const ACTION_PLAN_EXCLUDED_MODULE = 'Analytics';

/**
 * §5's 8,000/2,000 caps describe scan-pipeline requests. Adaptive thinking plus
 * a seven-Action plan does not fit in 2,000 output tokens, so this request runs
 * under its own caps (D-232). Search is not used at all.
 */
export const ACTION_PLAN_CAPS: AiRequestCapsShape = {
  maxInputTokens: 24_000,
  maxOutputTokens: 16_000,
  maxReasoningUnits: AI_REQUEST_CAPS.maxReasoningUnits,
  maxSearchUnits: 0,
  maxCitationUnits: 0,
  maxSearchContentTokens: 0,
};

/** Adaptive thinking is slow; the provider gets room before the deadline. */
export const ACTION_PLAN_TIMEOUT_MS = 120_000;

export const ACTION_PLAN_EFFORTS = ['small', 'medium', 'large'] as const;
export type ActionPlanEffort = (typeof ACTION_PLAN_EFFORTS)[number];

export interface ActionPlanModuleInput {
  readonly module: string;
  readonly status: string;
  readonly score: number | null;
  readonly coverage: number | null;
}

export interface ActionPlanRuleInput {
  readonly ruleId: string;
  /** The owner-facing title, not the registry's engineer label. */
  readonly title: string;
  readonly module: string;
  /** Highest severity still open for this rule in this scan. */
  readonly severity: string;
  readonly openIssues: number;
  /** At most three, already stripped of query and fragment. */
  readonly sampleUrls: readonly string[];
  /** The rule's distinct rendered recommendations, in the plan's language set. */
  readonly recommendations: readonly string[];
}

export interface ActionPlanInput {
  readonly scanId: string;
  readonly domain: string;
  /** ISO 639-1 code the plan is written in. */
  readonly language: string;
  readonly modules: readonly ActionPlanModuleInput[];
  readonly rules: readonly ActionPlanRuleInput[];
  readonly consent: AiConsent | null;
}

export interface ActionPlanAction {
  readonly title: string;
  readonly why: string;
  readonly steps: readonly string[];
  readonly effort: ActionPlanEffort;
  readonly ruleIds: readonly string[];
}

export interface ActionPlanContent {
  readonly overview: string;
  readonly actions: readonly ActionPlanAction[];
}

const MAX_STEPS = 5;
const MAX_FIELD_LENGTH = 2_048;
const MAX_OVERVIEW_LENGTH = 4_096;
const MAX_SAMPLE_URLS = 3;

const ACTION_PLAN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          why: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
          effort: { type: 'string', enum: ['small', 'medium', 'large'] },
          ruleIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'why', 'steps', 'effort', 'ruleIds'],
        additionalProperties: false,
      },
    },
  },
  required: ['overview', 'actions'],
  additionalProperties: false,
} as const;

export const ACTION_PLAN_SYSTEM_INSTRUCTIONS =
  'You write a prioritized Action Plan for whoever fixes a website. ' +
  'Start with an Overview: a short, jargon-free paragraph the site owner can forward to a ' +
  'client as it is. Then write at most ' +
  `${ACTION_PLAN_MAX_ACTIONS} Actions, ordered by impact over effort. ` +
  'Explain in "why" whenever a Low-severity rule is placed above a High-severity one. ' +
  'Each Action resolves the issues of one or more of the supplied rules, and a rule belongs ' +
  'to at most one Action. Use only the supplied rule ids. ' +
  'Never write issue counts or numbers of affected pages: the report shows live counts beside ' +
  'each Action and your text would contradict them. ' +
  'Do not invent findings, and do not contradict a rule’s own recommendation. ' +
  'Return one JSON object and nothing else.';

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function moduleFacts(modules: readonly ActionPlanModuleInput[]): readonly string[] {
  return modules.map((module) => {
    const score = module.score === null ? 'none' : String(module.score);
    const coverage = module.coverage === null ? 'unknown' : module.coverage.toFixed(2);
    return `Module ${module.module}: status=${module.status}, score=${score}, coverage=${coverage}`;
  });
}

function ruleFacts(rules: readonly ActionPlanRuleInput[]): readonly string[] {
  return rules.map((rule) => {
    const urls = rule.sampleUrls.slice(0, MAX_SAMPLE_URLS);
    return [
      `Rule ${rule.ruleId}`,
      `module=${rule.module}`,
      `title=${cleanText(rule.title)}`,
      `severity=${rule.severity}`,
      `openIssues=${rule.openIssues}`,
      `sampleUrls=${JSON.stringify(urls)}`,
      `recommendations=${JSON.stringify(rule.recommendations.map(cleanText))}`,
    ].join(' | ');
  });
}

/**
 * Builds the request, refusing anything that would widen what leaves the
 * product: an Analytics rule, an Analytics module status line, or a scan with no
 * rules to plan from.
 */
export function buildActionPlanRequest(input: ActionPlanInput): AiRequest {
  if (input.rules.length === 0) {
    throw new AiModuleError('ai: action plan needs at least one rule with an open issue');
  }
  const analyticsRule = input.rules.find((rule) => rule.module === ACTION_PLAN_EXCLUDED_MODULE);
  if (analyticsRule !== undefined) {
    throw new AiModuleError(
      `ai: action plan input contains an ${ACTION_PLAN_EXCLUDED_MODULE} rule ` +
        `(${analyticsRule.ruleId}); that module's findings are Google data and never leave the product`,
    );
  }
  // The module facts are Google data too: an Analytics score is computed from
  // Search Console and GA4, and the status line alone would still send it.
  const analyticsModule = input.modules.find(
    (module) => module.module === ACTION_PLAN_EXCLUDED_MODULE,
  );
  if (analyticsModule !== undefined) {
    throw new AiModuleError(
      `ai: action plan input contains the ${ACTION_PLAN_EXCLUDED_MODULE} module status; ` +
        'that module is computed from Google data and never leaves the product',
    );
  }
  return {
    scanId: input.scanId,
    provider: 'anthropic',
    promptVersion: ACTION_PLAN_PROMPT_VERSION,
    sequence: 1,
    question:
      `Write the Action Plan for ${input.domain}. ` +
      `Write every word of it in the language with ISO 639-1 code "${input.language}", ` +
      'translating the supplied English rule titles and recommendations as needed. ' +
      'JSON shape: {"overview":"...","actions":[{"title":"...","why":"...",' +
      '"steps":["..."],"effort":"small|medium|large","ruleIds":["..."]}]}. ' +
      `Each Action carries 1 to ${MAX_STEPS} steps and at least one rule id.`,
    brandFacts: [...moduleFacts(input.modules), ...ruleFacts(input.rules)],
    pageTitles: [],
    systemInstructions: ACTION_PLAN_SYSTEM_INSTRUCTIONS,
    // Opus 5 thinks adaptively when `thinking` is omitted, and the ordering
    // judgement this plan asks for is exactly what that budget is for.
    responseSchema: ACTION_PLAN_RESPONSE_SCHEMA,
    caps: ACTION_PLAN_CAPS,
    allowModelFallback: true,
  };
}

function requiredString(value: unknown, field: string, maxLength = MAX_FIELD_LENGTH): string {
  if (typeof value !== 'string') {
    throw new AiModuleError(`ai: action plan ${field} must be a string`);
  }
  const normalized = cleanText(value);
  if (normalized === '' || normalized.length > maxLength) {
    throw new AiModuleError(`ai: action plan ${field} is empty or too long`);
  }
  return normalized;
}

function parseSteps(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STEPS) {
    throw new AiModuleError(`ai: action plan steps must be an array of 1 to ${MAX_STEPS} items`);
  }
  return value.map((step, index) => requiredString(step, `steps[${index}]`));
}

function parseEffort(value: unknown): ActionPlanEffort {
  if (typeof value !== 'string' || !(ACTION_PLAN_EFFORTS as readonly string[]).includes(value)) {
    throw new AiModuleError('ai: action plan effort must be small, medium or large');
  }
  return value as ActionPlanEffort;
}

function parseRuleIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AiModuleError('ai: action plan ruleIds must be a non-empty array');
  }
  return value.map((ruleId, index) => requiredString(ruleId, `ruleIds[${index}]`, 64));
}

function jsonPayload(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

/**
 * Parses the model's answer and reconciles it with the rules that were sent.
 *
 * The schema cannot express the cross-field rules, so they are applied here:
 * ids the scan never produced are dropped, a rule named by two Actions stays
 * only in the first, and an Action left without a rule is not an Action at all
 * (CONTEXT.md). A plan with nothing left is an invalid attempt, not an empty
 * plan the owner has to read.
 */
export function parseActionPlanResponse(
  rawText: string,
  knownRuleIds: readonly string[],
): ActionPlanContent {
  let payload: unknown;
  try {
    payload = jsonPayload(rawText);
  } catch {
    throw new AiModuleError('ai: action plan response is not valid JSON');
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new AiModuleError('ai: action plan response must be an object');
  }
  const record = payload as Record<string, unknown>;
  const overview = requiredString(record.overview, 'overview', MAX_OVERVIEW_LENGTH);
  const rawActions = record.actions;
  if (!Array.isArray(rawActions) || rawActions.length > ACTION_PLAN_MAX_ACTIONS) {
    throw new AiModuleError(
      `ai: action plan actions must be an array of at most ${ACTION_PLAN_MAX_ACTIONS} items`,
    );
  }

  const known = new Set(knownRuleIds);
  const claimed = new Set<string>();
  const actions: ActionPlanAction[] = [];
  for (const rawAction of rawActions) {
    if (typeof rawAction !== 'object' || rawAction === null || Array.isArray(rawAction)) {
      throw new AiModuleError('ai: action plan action must be an object');
    }
    const action = rawAction as Record<string, unknown>;
    // `claimed` also deduplicates inside one Action: a model that names the same
    // rule twice would otherwise have its issues counted twice in the overlay.
    const ruleIds = parseRuleIds(action.ruleIds).filter((ruleId) => {
      if (!known.has(ruleId) || claimed.has(ruleId)) return false;
      claimed.add(ruleId);
      return true;
    });
    if (ruleIds.length === 0) continue;
    actions.push({
      title: requiredString(action.title, 'title'),
      why: requiredString(action.why, 'why'),
      steps: parseSteps(action.steps),
      effort: parseEffort(action.effort),
      ruleIds,
    });
  }
  if (actions.length === 0) {
    throw new AiModuleError('ai: action plan has no Action tied to a rule from this scan');
  }
  return { overview, actions };
}

export interface ActionPlanOptions {
  readonly provider: AiProvider;
  /**
   * Cancellation owned by the caller. A customer who deleted the scan, or an API
   * shutting down, must not keep paying for a plan nobody will read.
   */
  readonly signal?: AbortSignal;
}

export type ActionPlanResult =
  | {
      readonly status: 'Succeeded';
      readonly content: ActionPlanContent;
      readonly outcome: Extract<AiRequestOutcome, { kind: 'response' }>;
      readonly request: AiRequest;
    }
  | {
      readonly status: 'Failed';
      /** A short code; provider text never reaches storage or the customer. */
      readonly failureCode: string;
      readonly outcome: AiRequestOutcome | null;
      readonly request: AiRequest;
    };

/**
 * One plan attempt. It runs through `runAiRequest` so redaction, the prompt cap
 * and the §5 envelope contract apply, with a quota of exactly one request: the
 * plan is not part of a scan and does not spend the scan's AI quota (D-232).
 */
export async function runActionPlan(
  input: ActionPlanInput,
  options: ActionPlanOptions,
): Promise<ActionPlanResult> {
  const request = buildActionPlanRequest(input);
  const result = await runAiRequest(request, {
    provider: options.provider,
    quota: AiQuotaTracker.withLimit(1),
    consent: input.consent,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  if (result.outcome.kind === 'unavailable') {
    return {
      status: 'Failed',
      failureCode: result.outcome.reason,
      outcome: result.outcome,
      request,
    };
  }
  if (result.outcome.response.finishReason === 'safety') {
    // A final refusal — including one the server-side fallback could not avoid —
    // is a failed attempt, not a plan.
    return { status: 'Failed', failureCode: 'ProviderRefusal', outcome: result.outcome, request };
  }
  let content: ActionPlanContent;
  try {
    content = parseActionPlanResponse(
      result.outcome.response.rawText,
      input.rules.map((rule) => rule.ruleId),
    );
  } catch {
    return { status: 'Failed', failureCode: 'ProviderContract', outcome: result.outcome, request };
  }
  return { status: 'Succeeded', content, outcome: result.outcome, request };
}
