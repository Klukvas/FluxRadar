// What the Action Plan answer must look like, and what survives of it.
//
// The provider is asked for schema-constrained JSON, but the schema it enforces
// cannot express counts or lengths, so the answer is parsed again here, strictly:
// an answer outside the contract is a failed attempt, never a guessed plan.
// Rule ids are then held to the scan: an id the input did not contain is
// dropped, and a rule stays only in the first Action that names it, so every
// stored Action joins back to the scan's issues and no issue counts twice.

import { z } from 'zod';

export const ACTION_PLAN_MAX_ACTIONS = 7;
export const ACTION_PLAN_MAX_STEPS = 5;
export const ACTION_PLAN_EFFORTS = ['small', 'medium', 'large'] as const;
export type ActionPlanEffort = (typeof ACTION_PLAN_EFFORTS)[number];

/** The lengths the instructions ask for, in characters. */
export const ACTION_PLAN_TEXT_TARGETS = { title: 80, why: 300, step: 200 } as const;

// Three times what the instructions ask for: room for a language that needs
// more characters, not for an essay. The overview has no number in the
// instructions (three to five sentences), so it gets a ceiling of its own.
const PARSER_HEADROOM = 3;
const MAX_OVERVIEW_CHARS = 2_000;
const MAX_TITLE_CHARS = ACTION_PLAN_TEXT_TARGETS.title * PARSER_HEADROOM;
const MAX_WHY_CHARS = ACTION_PLAN_TEXT_TARGETS.why * PARSER_HEADROOM;
const MAX_STEP_CHARS = ACTION_PLAN_TEXT_TARGETS.step * PARSER_HEADROOM;

/**
 * JSON Schema for `output_config.format`. Structured outputs reject count and
 * length constraints, so those live in the parser below instead. `ruleIds`
 * comes first: the model settles which rules an Action covers before it
 * writes about them.
 */
export const ACTION_PLAN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ruleIds: { type: 'array', items: { type: 'string' } },
          title: { type: 'string' },
          why: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
          effort: { type: 'string', enum: [...ACTION_PLAN_EFFORTS] },
        },
        required: ['ruleIds', 'title', 'why', 'steps', 'effort'],
        additionalProperties: false,
      },
    },
  },
  required: ['overview', 'actions'],
  additionalProperties: false,
} as const;

/** One change a person makes in one go, resolving the issues of one or more rules. */
export interface ActionPlanAction {
  readonly title: string;
  readonly why: string;
  readonly steps: readonly string[];
  readonly effort: ActionPlanEffort;
  readonly ruleIds: readonly string[];
}

/** What a plan says. Issue counts are not part of it: they are read live. */
export interface ActionPlanContent {
  readonly overview: string;
  readonly actions: readonly ActionPlanAction[];
}

export type ActionPlanParseResult =
  | {
      readonly kind: 'plan';
      readonly content: ActionPlanContent;
      /** Ids the answer named that were unknown or already taken, for the logs. */
      readonly ignoredRuleIds: readonly string[];
    }
  | {
      readonly kind: 'invalid';
      readonly failureCode: 'invalid_output' | 'no_actions';
      /** Our description of the problem; never contains the answer's text. */
      readonly detail: string;
    };

function boundedText(maxChars: number): z.ZodType<string> {
  return z
    .string()
    .transform((value) => value.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1).max(maxChars));
}

const actionSchema = z.strictObject({
  ruleIds: z.array(z.string().trim().min(1)).min(1),
  title: boundedText(MAX_TITLE_CHARS),
  why: boundedText(MAX_WHY_CHARS),
  steps: z.array(boundedText(MAX_STEP_CHARS)).min(1).max(ACTION_PLAN_MAX_STEPS),
  effort: z.enum(ACTION_PLAN_EFFORTS),
});

const planSchema = z.strictObject({
  overview: boundedText(MAX_OVERVIEW_CHARS),
  actions: z.array(actionSchema).max(ACTION_PLAN_MAX_ACTIONS),
});

type ParsedPlan = z.infer<typeof planSchema>;

function jsonPayload(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

interface Settled {
  readonly claimed: ReadonlySet<string>;
  readonly ignored: readonly string[];
  readonly actions: readonly ActionPlanAction[];
}

/**
 * Keeps each rule in the first Action that names it and drops ids the scan
 * does not have; an Action left without rules is dropped with them.
 */
function settleRules(parsed: ParsedPlan, knownRuleIds: ReadonlySet<string>): Settled {
  return parsed.actions.reduce<Settled>(
    (state, action) => {
      const named = [...new Set(action.ruleIds)];
      const kept = named.filter((ruleId) => knownRuleIds.has(ruleId) && !state.claimed.has(ruleId));
      const ignored = [...state.ignored, ...named.filter((ruleId) => !kept.includes(ruleId))];
      if (kept.length === 0) return { ...state, ignored };
      return {
        claimed: new Set([...state.claimed, ...kept]),
        ignored,
        actions: [...state.actions, { ...action, ruleIds: kept }],
      };
    },
    { claimed: new Set(), ignored: [], actions: [] },
  );
}

/** Parses an answer and holds its rule ids to the ones the scan sent. */
export function parseActionPlanResponse(
  rawText: string,
  knownRuleIds: readonly string[],
): ActionPlanParseResult {
  let payload: unknown;
  try {
    payload = jsonPayload(rawText);
  } catch {
    // The parser's message quotes the answer; the logs get only the fact.
    return { kind: 'invalid', failureCode: 'invalid_output', detail: 'answer is not valid JSON' };
  }
  const parsed = planSchema.safeParse(payload);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.map(String).join('.')}: ${issue.code}`,
    );
    return {
      kind: 'invalid',
      failureCode: 'invalid_output',
      detail: `answer breaks the plan contract (${problems.join('; ')})`,
    };
  }
  const settled = settleRules(parsed.data, new Set(knownRuleIds));
  if (settled.actions.length === 0) {
    return {
      kind: 'invalid',
      failureCode: 'no_actions',
      detail: 'no Action names a rule from this scan',
    };
  }
  return {
    kind: 'plan',
    content: { overview: parsed.data.overview, actions: settled.actions },
    ignoredRuleIds: [...new Set(settled.ignored)],
  };
}
