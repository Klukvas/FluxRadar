// The Action Plan: from what a Complete scan found, Claude writes a short,
// prioritised list of changes for whoever fixes the site, under a jargon-free
// Overview the owner can forward to a client as is.
//
// The input is plain data the API builds from a scan. The prompt is assembled
// field by field from it, so what reaches Anthropic is exactly the list below:
// rule id, owner-facing title, section, highest open severity, open issue
// count, up to three page addresses without query string or fragment, the
// rule's recommendation texts, each section's status, score and coverage, and
// the domain. Evidence excerpts, screenshots and traces are not part of the
// input at all, and Analytics is refused outright: its findings are Search
// Console and GA4 data, which must not reach an AI provider.

import { ACTION_PLAN_NOTICE_VERSION, severityRank } from '@fluxradar/contracts';
import type {
  ActionPlanLanguage,
  ModuleName,
  ModuleRuntimeStatus,
  Severity,
} from '@fluxradar/contracts';

import {
  ACTION_PLAN_MAX_ACTIONS,
  ACTION_PLAN_MAX_STEPS,
  ACTION_PLAN_RESPONSE_SCHEMA,
  parseActionPlanResponse,
} from './action-plan-response.js';
import type { ActionPlanContent } from './action-plan-response.js';
import type { AiConsent } from './consent.js';
import { AiModuleError } from './errors.js';
import { AiQuotaTracker } from './quota.js';
import type { RedactionOptions } from './redaction.js';
import { runAiRequest } from './run-request.js';
import type { AiUnavailableReason } from './run-request.js';
import type { AiProvider, AiRequest, AiRequestCaps, NormalizedAiResponse } from './types.js';

export const ACTION_PLAN_PROMPT_VERSION = 'action-plan-v1';

/**
 * Claude Opus 5 thinks adaptively when `thinking` is left out, and its thinking
 * shares `max_tokens` with the answer; the shared 2,000-token cap would cut the
 * plan off mid-JSON. Input stays well inside the model's window: a large scan
 * is some 40 rules, and the bounds below keep each of them short.
 */
export const ACTION_PLAN_REQUEST_CAPS: AiRequestCaps = {
  maxInputTokens: 60_000,
  maxOutputTokens: 16_000,
};

/** A plan turn thinks before it answers; the 45-second default is for short requests. */
export const ACTION_PLAN_PROVIDER_TIMEOUT_MS = 120_000;

export const ACTION_PLAN_SAMPLE_URLS = 3;
const MAX_RECOMMENDATIONS = 5;
const MAX_TITLE_CHARS = 200;
const MAX_URL_CHARS = 500;
const MAX_RECOMMENDATION_CHARS = 700;

// The Action Plan is one request of its own, outside any scan run.
const ACTION_PLAN_SEQUENCE = 1;

/** A report section as the plan is told about it. */
export interface ActionPlanModuleInput {
  readonly module: ModuleName;
  readonly status: ModuleRuntimeStatus;
  /** 0..100, or null when the section was not scored. */
  readonly score: number | null;
  /** Completed share of the section's applicable checks, 0..1; null when not recorded. */
  readonly coverage: number | null;
}

/** One rule with open issues in the scan, merged across its severities. */
export interface ActionPlanRuleInput {
  readonly ruleId: string;
  /** The title the report shows, in the plan language when the catalogue has it. */
  readonly title: string;
  readonly module: ModuleName;
  /** The highest severity among the rule's open issues. */
  readonly severity: Severity;
  readonly openIssues: number;
  /** Pages the rule was found on; query string and fragment are removed here again. */
  readonly sampleUrls: readonly string[];
  /** The rule's distinct recommendation texts. */
  readonly recommendations: readonly string[];
}

export interface ActionPlanInput {
  readonly scanId: string;
  readonly domain: string;
  readonly language: ActionPlanLanguage;
  /** Built from the owner's click on Generate; its notice version must be the current one. */
  readonly consent: AiConsent | null;
  readonly modules: readonly ActionPlanModuleInput[];
  readonly rules: readonly ActionPlanRuleInput[];
}

export type ActionPlanFailureCode =
  | 'consent_missing'
  | 'redaction_blocked'
  | 'quota_exceeded'
  | 'provider_unavailable'
  | 'provider_contract'
  | 'refused'
  | 'truncated'
  | 'invalid_output'
  | 'no_actions';

export interface ActionPlanSucceeded {
  readonly status: 'succeeded';
  readonly content: ActionPlanContent;
  /** The exact redacted text sent to the provider. */
  readonly promptText: string;
  readonly promptVersion: string;
  /** Carries the model that served the answer, its request id and usage. */
  readonly response: NormalizedAiResponse;
  /** Rule ids the answer named that were unknown or already taken; for the logs. */
  readonly ignoredRuleIds: readonly string[];
}

export interface ActionPlanFailed {
  readonly status: 'failed';
  readonly failureCode: ActionPlanFailureCode;
  /** Our own description of what went wrong, for the logs; never the answer's text. */
  readonly detail: string;
  /** Present when the provider answered: an unusable answer still cost tokens. */
  readonly response: NormalizedAiResponse | null;
}

export type ActionPlanResult = ActionPlanSucceeded | ActionPlanFailed;

export interface ActionPlanOptions {
  readonly provider: AiProvider;
  readonly redaction?: RedactionOptions;
}

const UNAVAILABLE_CODES: Readonly<Record<AiUnavailableReason, ActionPlanFailureCode>> = {
  ConsentMissing: 'consent_missing',
  RedactionBlocked: 'redaction_blocked',
  QuotaExceeded: 'quota_exceeded',
  ProviderUnavailable: 'provider_unavailable',
  ProviderContract: 'provider_contract',
};

function languageName(language: ActionPlanLanguage): string {
  return new Intl.DisplayNames(['en'], { type: 'language' }).of(language) ?? language;
}

function clip(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/** The address without query string or fragment: those can carry personal data. */
export function withoutQueryAndFragment(address: string): string {
  try {
    const url = new URL(address);
    return `${url.origin}${url.pathname}`;
  } catch {
    // Not an absolute URL (a site-level target, say): cut at the first marker instead.
    return address.split(/[?#]/, 1)[0] ?? '';
  }
}

function validateInput(input: ActionPlanInput): void {
  if (input.scanId.trim() === '') throw new AiModuleError('ai: action plan — empty scanId');
  if (input.domain.trim() === '') throw new AiModuleError('ai: action plan — empty domain');
  // Analytics findings are Search Console and GA4 data; none of it may reach a provider.
  if (
    input.rules.some((rule) => rule.module === 'Analytics') ||
    input.modules.some((module) => module.module === 'Analytics')
  ) {
    throw new AiModuleError('ai: action plan — Analytics data must not be sent to a provider');
  }
  if (input.rules.length === 0) throw new AiModuleError('ai: action plan — no rule to plan');
  if (new Set(input.rules.map((rule) => rule.ruleId)).size !== input.rules.length) {
    throw new AiModuleError('ai: action plan — a rule appears twice; merge it by rule id');
  }
  if (input.rules.some((rule) => !Number.isInteger(rule.openIssues) || rule.openIssues < 1)) {
    throw new AiModuleError('ai: action plan — every rule needs at least one open issue');
  }
}

/** The system instructions; the one thing that varies is the plan language. */
export function actionPlanSystemInstructions(language: ActionPlanLanguage): string {
  const name = `${languageName(language)} (${language})`;
  return [
    'You write the Action Plan for a website audit report. Your reader is whoever will fix ' +
      'the site: a developer, an agency or the owner. The owner also forwards the overview ' +
      'to their client as it is.',
    'The input describes one audit of one site: each report section with its status, score ' +
      'and coverage, and each rule that has open issues, with its title, section, highest ' +
      'severity, number of open issues, up to three pages it was found on, and the ' +
      "rule's own recommendations.",
    'overview: one short paragraph of three to five sentences in plain words, without ' +
      'jargon, rule ids or abbreviations a non-technical client would not know. Say what ' +
      'state the site is in and what matters most. Do not promise rankings, traffic or sales.',
    `actions: at most ${ACTION_PLAN_MAX_ACTIONS}. An Action is one change a person makes in ` +
      'one go that resolves the issues of one or more rules. ruleIds names those rules, ' +
      'copied exactly from the input. title is an imperative phrase naming the change. why ' +
      'says what the change fixes and why it sits at this place in the order. steps are 1 ' +
      `to ${ACTION_PLAN_MAX_STEPS} concrete steps; when one rule has several causes, each ` +
      'cause is a step of the same Action. effort is small (under an hour), medium (up to ' +
      'a day) or large (more than a day).',
    'Order the Actions by impact over effort: the most benefit for the least work first, ' +
      'weighing severity, how widespread the issues are, and the section. Severity alone ' +
      'does not decide the order; when an Action comes before another whose rules are more ' +
      'severe, say in its why what makes it worth doing first.',
    'A rule belongs to at most one Action: never name the same rule id twice. Use only rule ' +
      'ids from the input, and leave out rules that do not fit; the report lists every issue ' +
      'anyway.',
    'Do not write how many issues, pages or rules are affected. The report shows live counts ' +
      'next to each Action, and they change as issues are dealt with.',
    'Base every statement on the input. Do not invent pages, tools, technologies or causes ' +
      'it does not show.',
    `Write every text value in ${name}. The titles and recommendations in the input may be ` +
      'in another language; translate them. Keep rule ids, addresses and code identifiers ' +
      'as they are.',
    'Keep the text short: titles under 80 characters, why under 300, each step under 200.',
  ].join('\n\n');
}

function moduleFact(module: ActionPlanModuleInput): string {
  const score = module.score === null ? 'not scored' : `score ${Math.round(module.score)}/100`;
  const coverage =
    module.coverage === null
      ? 'coverage not recorded'
      : `${Math.round(module.coverage * 100)}% of applicable checks completed`;
  return `Section ${module.module}: ${module.status}, ${score}, ${coverage}`;
}

/** One rule as a JSON line, built from the declared fields only. */
function ruleFact(rule: ActionPlanRuleInput): string {
  const sampleUrls = [
    ...new Set(rule.sampleUrls.map((url) => clip(withoutQueryAndFragment(url), MAX_URL_CHARS))),
  ]
    .filter((url) => url !== '')
    .slice(0, ACTION_PLAN_SAMPLE_URLS);
  const recommendations = [
    ...new Set(rule.recommendations.map((text) => clip(text, MAX_RECOMMENDATION_CHARS))),
  ]
    .filter((text) => text !== '')
    .slice(0, MAX_RECOMMENDATIONS);
  return `Rule ${JSON.stringify({
    ruleId: rule.ruleId,
    title: clip(rule.title, MAX_TITLE_CHARS),
    section: rule.module,
    severity: rule.severity,
    openIssues: rule.openIssues,
    samplePages: sampleUrls,
    recommendations,
  })}`;
}

/** Most severe first, then the most widespread: if the prompt is ever cut, the tail goes. */
function byPriority(left: ActionPlanRuleInput, right: ActionPlanRuleInput): number {
  return (
    severityRank(left.severity) - severityRank(right.severity) ||
    right.openIssues - left.openIssues ||
    left.ruleId.localeCompare(right.ruleId)
  );
}

export function buildActionPlanRequest(input: ActionPlanInput): AiRequest {
  validateInput(input);
  return {
    scanId: input.scanId,
    provider: 'anthropic',
    promptVersion: ACTION_PLAN_PROMPT_VERSION,
    sequence: ACTION_PLAN_SEQUENCE,
    question:
      `Write the Action Plan for ${input.domain}. The facts below list the report's ` +
      'sections and every rule with open issues. Answer with the JSON object the response ' +
      'schema describes, without Markdown or commentary.',
    brandFacts: [
      `Site: ${input.domain}`,
      ...input.modules.map(moduleFact),
      ...[...input.rules].sort(byPriority).map(ruleFact),
    ],
    pageTitles: [],
    systemInstructions: actionPlanSystemInstructions(input.language),
    // No reasoningMode: Opus 5 thinks adaptively when `thinking` is left out.
    responseSchema: ACTION_PLAN_RESPONSE_SCHEMA,
    caps: ACTION_PLAN_REQUEST_CAPS,
    refusalFallback: 'default',
  };
}

function failed(
  failureCode: ActionPlanFailureCode,
  detail: string,
  response: NormalizedAiResponse | null,
): ActionPlanFailed {
  return { status: 'failed', failureCode, detail, response };
}

/**
 * One attempt at a plan: one request through the shared pipeline (consent,
 * redaction, caps, the response contract), then a strict parse. Anything short
 * of a complete, valid answer is a failed attempt with a code.
 */
export async function runActionPlan(
  input: ActionPlanInput,
  options: ActionPlanOptions,
): Promise<ActionPlanResult> {
  const request = buildActionPlanRequest(input);
  const { outcome } = await runAiRequest(request, {
    provider: options.provider,
    quota: AiQuotaTracker.withLimit(1),
    consent: input.consent?.noticeVersion === ACTION_PLAN_NOTICE_VERSION ? input.consent : null,
    ...(options.redaction === undefined ? {} : { redaction: options.redaction }),
  });
  if (outcome.kind === 'unavailable') {
    return failed(UNAVAILABLE_CODES[outcome.reason], outcome.detail, null);
  }
  const { response } = outcome;
  if (response.finishReason === 'safety') {
    return failed('refused', 'the provider declined to answer', response);
  }
  if (response.finishReason === 'length') {
    return failed('truncated', 'the answer hit the output cap', response);
  }
  if (response.finishReason === 'error') {
    return failed('provider_unavailable', 'the provider ended the answer with an error', response);
  }
  const parsed = parseActionPlanResponse(
    response.rawText,
    input.rules.map((rule) => rule.ruleId),
  );
  if (parsed.kind === 'invalid') return failed(parsed.failureCode, parsed.detail, response);
  return {
    status: 'succeeded',
    content: parsed.content,
    promptText: outcome.promptText,
    promptVersion: request.promptVersion,
    response,
    ignoredRuleIds: parsed.ignoredRuleIds,
  };
}
