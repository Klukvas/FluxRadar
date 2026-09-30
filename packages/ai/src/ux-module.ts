// AI-assisted UX/Conversion analysis. The provider receives a bounded,
// redacted evidence package and must return a strict JSON finding contract.
// Invalid or unsupported output is unavailable, never a guessed result.

import type { Plan } from '@fluxradar/contracts';

import { isAcceptedNoticeVersion } from './consent.js';
import type { AiConsent } from './consent.js';
import { AiModuleError } from './errors.js';
import { AiQuotaTracker } from './quota.js';
import { runAiRequest } from './run-request.js';
import type { AiRequest, AiProvider } from './types.js';
import type { AiRequestOutcome } from './run-request.js';

export const UX_PROMPT_VERSION = 'ux-conversion-v4';
export const UX_SYSTEM_INSTRUCTIONS =
  'You are a careful UX and conversion reviewer. Use only the supplied evidence. ' +
  'Do not claim that a site converts or fails to convert, and do not invent missing facts. ' +
  'The evidence is static DOM text and metadata, without screenshots, computed styles, layout, ' +
  'color, size, viewport, or interaction observations. Do not make visual hierarchy or styling ' +
  'claims. Do not infer that two actions lack hierarchy or that multiple forms are confusing ' +
  'unless their supplied text or purposes directly support that conclusion. ' +
  'Return JSON only with a findings array. Each finding must cite one supplied page URL and ' +
  'quote or paraphrase evidence visible in the supplied snapshot.';

/**
 * The classes of claim the supplied evidence can never back.
 *
 * The evidence package is static DOM text: titles, headings, action and link
 * labels, form shapes, contact signals and the opening of the visible text.
 * Nothing in it is rendered — there is no screenshot, no computed style, no
 * geometry and no viewport — so a finding whose evidence rests on how the page
 * *looks* rests on nothing. That is a different failure from a malformed
 * response, and it is caught here rather than trusted to the prompt: the system
 * instructions forbid these claims, but an instruction is a request, not a
 * guarantee.
 *
 * The labels are stable machine values: they are what the orchestrator records
 * about a dropped finding, so a report can say *which kind* of claim was
 * dropped without storing the provider's sentence.
 */
export type UnsupportedClaimReason =
  | 'visual-hierarchy'
  | 'colour'
  | 'typography'
  | 'fold'
  | 'viewport'
  | 'screenshot'
  | 'geometry'
  | 'stylesheet'
  | 'spacing'
  | 'layout'
  | 'confusion-from-count';

/**
 * Assertions about rendering, matched as phrases rather than as bare words.
 *
 * A bare-substring denylist was the first attempt and it was wrong: it rejected
 * `The hero says "CSS training" but does not say whether classes are for
 * beginners or professionals` — a grounded claim about the supplied heading text
 * — because the page's own subject matter contains one of the words. What makes a
 * finding unsupported is not a word appearing anywhere in it, it is the finding
 * *asserting* something about how the page renders. So each entry here requires
 * the surrounding phrase, and quoted source wording is removed before matching
 * (`withoutQuotations`).
 *
 * This is pattern matching, not comprehension: it catches the categorical class
 * in its usual phrasings and it will miss a paraphrase built to evade it.
 * Nothing here promises a semantic guarantee — the prompt asks, this narrows,
 * and the residue is visible to the reader as a rejected claim rather than
 * silently shown as a fact.
 */
const UNSUPPORTED_CLAIM_PATTERNS: readonly {
  readonly reason: UnsupportedClaimReason;
  readonly pattern: RegExp;
}[] = [
  // `hierarchy` alone is deliberately absent: the headings ARE supplied, so a
  // claim about their order is a claim about the evidence.
  {
    reason: 'visual-hierarchy',
    pattern:
      /\bvisual(?:ly)?[\s-]+(?:hierarch|prominen|distinct|emphasi|weight|similar|identical|styl|design|dominant)/i,
  },
  {
    reason: 'colour',
    pattern:
      /\bcolou?r\s+(?:contrast|scheme|palette)\b|\bsame\s+colou?r\b|\bcontrast\s+ratio\b|\blow\s+contrast\b|\bblends?\s+in(?:to)?\s+the\s+background\b/i,
  },
  {
    reason: 'typography',
    pattern:
      /\bfont[\s-]*(?:size|weight|family|face)\b|\b(?:small|smaller|tiny|large|larger|big|bold|italic)\s+(?:font|type|typeface|text)\b|\bin\s+a\s+\w+\s+font\b/i,
  },
  { reason: 'fold', pattern: /\b(?:above|below)\s+the\s+fold\b/i },
  {
    reason: 'viewport',
    pattern:
      /\bviewports?\b|\bscreen\s+(?:size|width|height)\b|\boff-?screen\b|\bon\s+(?:mobile|desktop|tablet)\s+(?:screens?|devices?|viewports?)\b/i,
  },
  { reason: 'screenshot', pattern: /\bscreenshots?\b|\brendered\s+page\b/i },
  {
    reason: 'geometry',
    pattern:
      /\b\d+\s*(?:px|pixels?)\b|\bpixels?\s+(?:wide|high|tall|of|perfect)\b|\b(?:button|tap\s+target)\s+(?:size|area)\b|\btoo\s+(?:small|large)\s+to\s+(?:tap|click|read)\b/i,
  },
  {
    reason: 'stylesheet',
    pattern: /\bstylesheets?\b|\binline\s+styles?\b|\bcss\s+(?:rule|class|file|style|hides|sets)/i,
  },
  {
    reason: 'spacing',
    pattern:
      /\bwhite\s?space\b|\b(?:padding|margins?|spacing)\s+(?:is|are|around|between|of)\b|\b(?:tight|generous|excessive|no)\s+(?:padding|margins?|spacing)\b/i,
  },
  {
    reason: 'layout',
    pattern:
      /\blayout\b[^.]{0,40}\b(?:hides?|buries?|pushes?|obscures?|breaks?|crowds?)\b|\b(?:cluttered|cramped|crowded|unbalanced)\b/i,
  },
];

/**
 * A claim that several of something confuse the visitor.
 *
 * The supplied form evidence is a shape — control count, submit-control count
 * and the `action` target — and never a label or a purpose, so "two forms" is
 * all the provider can see about two forms. `The two forms have different
 * purposes but their presence creates confusion for visitors` was accepted by
 * the first version of this module and it is exactly the claim the evidence
 * cannot reach: it concedes the purposes differ and then asserts a visitor
 * reaction to their number.
 *
 * Rejected only for that shape — a count plus a confusion claim. A finding that
 * names something concrete the evidence does hold ("the only action is labelled
 * Submit", "the form has no submit control") never matches these, and a count
 * claim the page can actually ground survives (`groundsAmbiguity`).
 */
const CONFUSION_CLAIM =
  /\b(?:confus\w+|overwhelm\w+|distract\w+)\b|\bcompet\w+\s+for\s+attention\b/i;
const MULTIPLE_ELEMENTS =
  /\b(?:two|three|four|both|multiple|several|many|\d+)\s+(?:\w+\s+){0,2}(?:forms?|actions?|buttons?|ctas?|calls?\s+to\s+action|links?|fields?|menus?)\b/i;
/** The finding's own concession that the number is not the problem. */
const DISTINCT_PURPOSES =
  /\b(?:different|distinct|separate|unrelated|its\s+own|their\s+own)\s+(?:purposes?|goals?|intents?|jobs?|functions?|audiences?|roles?)\b/i;

const UX_RULE_IDS = new Set(['UX-CONV-AI-001', 'UX-CONV-AI-002', 'UX-CONV-AI-003']);
const SEVERITIES = new Set(['High', 'Medium', 'Low']);
// Six concise findings fit comfortably inside the shared 2,000-token response
// cap. Asking for twelve made normal multi-page reviews end mid-JSON, turning a
// valid provider response into an unusable contract failure.
const MAX_FINDINGS = 6;
const MAX_FIELD_LENGTH = 2_048;
const MAX_AI_VISIBLE_TEXT = 350;

const UX_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ruleId: {
            type: 'string',
            enum: ['UX-CONV-AI-001', 'UX-CONV-AI-002', 'UX-CONV-AI-003'],
          },
          targetUrl: { type: 'string' },
          severity: { type: 'string', enum: ['High', 'Medium', 'Low'] },
          evidence: { type: 'string' },
          recommendation: { type: 'string' },
          confidence: { type: 'number' },
          selector: { type: 'string' },
        },
        required: ['ruleId', 'targetUrl', 'severity', 'evidence', 'recommendation', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
} as const;

export interface UxAiPageEvidence {
  readonly url: string;
  readonly title: string;
  readonly headings: readonly string[];
  readonly actions: readonly string[];
  readonly links: readonly string[];
  readonly forms: readonly string[];
  readonly contactSignals: readonly string[];
  readonly visibleText: string;
}

export interface UxAiProfileContext {
  readonly industry?: string | null;
  readonly region?: string | null;
  readonly language?: string | null;
  readonly businessDescription?: string | null;
  readonly offerings?: string | null;
  readonly targetLanguages?: string | null;
  readonly targetAudience?: string | null;
}

export interface UxAiFinding {
  readonly ruleId: 'UX-CONV-AI-001' | 'UX-CONV-AI-002' | 'UX-CONV-AI-003';
  readonly targetUrl: string;
  readonly severity: 'High' | 'Medium' | 'Low';
  readonly evidence: string;
  readonly recommendation: string;
  readonly confidence: number;
  readonly selector?: string;
}

export interface UxAiInput {
  readonly scanId: string;
  readonly plan: Plan;
  readonly brand: string;
  readonly siteOrigin: string;
  readonly consent: AiConsent | null;
  readonly profileContext: UxAiProfileContext;
  readonly pages: readonly UxAiPageEvidence[];
}

export interface UxAiOptions {
  readonly provider: AiProvider;
  readonly quota: AiQuotaTracker;
  /**
   * Отмена прогона вызывающим (отменённый скан, останов воркера). Единственный
   * AI-запрос этого модуля прерывается, и наружу идёт AiRequestCancelledError,
   * а не статус Unavailable: отменённая проверка не результат модуля, и строку
   * модуля по ней писать нельзя.
   */
  readonly signal?: AbortSignal;
}

/**
 * A finding the contract accepted and the evidence cannot support.
 *
 * Kept out of `findings` and reported separately: the report may not show a
 * claim about how a page looks when nothing about how it looks was ever read.
 */
export interface UnsupportedUxClaim {
  readonly finding: UxAiFinding;
  /** Which class of claim the supplied package cannot back. */
  readonly reason: UnsupportedClaimReason;
}

/** Well-formed findings, split by whether the supplied evidence can back them. */
export interface UxAiClaims {
  readonly supported: readonly UxAiFinding[];
  readonly unsupported: readonly UnsupportedUxClaim[];
}

export interface UxAiResponseResult {
  readonly status: 'Completed' | 'Unavailable';
  readonly statusReason: string | null;
  readonly outcome: AiRequestOutcome;
  readonly quota: AiQuotaTracker;
  readonly findings: readonly UxAiFinding[];
  /**
   * Findings dropped because the evidence package cannot support them.
   *
   * Empty on every path that produced no findings at all. It is reported rather
   * than swallowed so the drop is visible to the caller; recording it alongside
   * the run belongs to the orchestrator, not here.
   */
  readonly unsupportedClaims: readonly UnsupportedUxClaim[];
}

function clean(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function contextFacts(context: UxAiProfileContext): readonly string[] {
  return [
    ['Industry or site type', context.industry],
    ['Business description', context.businessDescription],
    ['Services or products', context.offerings],
    ['Operating region', context.region],
    ['Primary language', context.language],
    ['Target languages', context.targetLanguages],
    ['Target audience', context.targetAudience],
  ].flatMap(([label, value]) => {
    const normalized = clean(value);
    return normalized === '' ? [] : [`${label}: ${normalized.slice(0, 360)}`];
  });
}

function pageFacts(pages: readonly UxAiPageEvidence[]): readonly string[] {
  return pages.map((page, index) => {
    return [
      `Page ${index + 1}: ${page.url}`,
      `title=${page.title || '(missing)'}`,
      `headings=${JSON.stringify(page.headings)}`,
      `actions=${JSON.stringify(page.actions)}`,
      `links=${JSON.stringify(page.links)}`,
      `forms=${JSON.stringify(page.forms)}`,
      `contactSignals=${JSON.stringify(page.contactSignals)}`,
      `visibleText=${page.visibleText.slice(0, MAX_AI_VISIBLE_TEXT) || '(empty)'}`,
    ].join(' | ');
  });
}

export function buildUxAiRequest(input: UxAiInput): AiRequest {
  return {
    scanId: input.scanId,
    provider: 'anthropic',
    promptVersion: UX_PROMPT_VERSION,
    sequence: 1001,
    question:
      `Review ${input.brand} at ${input.siteOrigin} for UX/Conversion. ` +
      'Return at most 6 actionable findings. Keep each evidence and recommendation value under 240 characters. ' +
      'Return one JSON object without Markdown fences or commentary. Use only these rule IDs: ' +
      'UX-CONV-AI-001 (value proposition clarity), UX-CONV-AI-002 (primary action clarity), ' +
      'UX-CONV-AI-003 (conversion friction and trust). ' +
      'If the evidence does not support a finding, omit it. Use the exact supplied page URL as targetUrl. ' +
      'JSON shape: {"findings":[{"ruleId":"...","targetUrl":"...","severity":"Low|Medium|High",' +
      '"evidence":"...","recommendation":"...","confidence":0.0,"selector":"..."}]}.',
    brandFacts: [...contextFacts(input.profileContext), ...pageFacts(input.pages)],
    pageTitles: input.pages.map((page) => page.title).filter((title) => title !== ''),
    systemInstructions: UX_SYSTEM_INSTRUCTIONS,
    // Sonnet 5 enables adaptive thinking by default and counts it against the
    // shared output budget. UX is bounded extraction, so reserve that budget
    // for the response and constrain it to the parser's schema.
    reasoningMode: 'disabled',
    responseSchema: UX_RESPONSE_SCHEMA,
  };
}

function jsonPayload(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string')
    throw new AiModuleError(`ai: UX response ${field} must be a string`);
  const normalized = clean(value);
  if (normalized === '' || normalized.length > MAX_FIELD_LENGTH) {
    throw new AiModuleError(`ai: UX response ${field} is empty or too long`);
  }
  return normalized;
}

function parseFinding(value: unknown, allowedUrls: ReadonlySet<string>): UxAiFinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AiModuleError('ai: UX response finding must be an object');
  }
  const record = value as Record<string, unknown>;
  const ruleId = record.ruleId;
  if (typeof ruleId !== 'string' || !UX_RULE_IDS.has(ruleId)) {
    throw new AiModuleError('ai: UX response contains an unsupported rule ID');
  }
  const targetUrl = nonEmptyString(record.targetUrl, 'targetUrl');
  if (!allowedUrls.has(targetUrl)) {
    throw new AiModuleError(`ai: UX response target URL was not supplied: ${targetUrl}`);
  }
  const severity = record.severity;
  if (typeof severity !== 'string' || !SEVERITIES.has(severity)) {
    throw new AiModuleError('ai: UX response severity is invalid');
  }
  const confidence = record.confidence;
  if (
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw new AiModuleError('ai: UX response confidence must be a number from 0 to 1');
  }
  const selector =
    record.selector === undefined ? undefined : nonEmptyString(record.selector, 'selector');
  return {
    ruleId: ruleId as UxAiFinding['ruleId'],
    targetUrl,
    severity: severity as UxAiFinding['severity'],
    evidence: nonEmptyString(record.evidence, 'evidence'),
    recommendation: nonEmptyString(record.recommendation, 'recommendation'),
    confidence,
    ...(selector === undefined ? {} : { selector }),
  };
}

/**
 * The finding's own words, with quoted source wording removed.
 *
 * Wording the provider quotes from the page is evidence, not an assertion: a
 * heading that says "CSS training" is a fact about the snapshot, and the finding
 * that reports it must survive. Only double and guillemet quotes are treated as
 * quotation — an apostrophe is indistinguishable from a single quote mark, and
 * stripping between apostrophes would eat ordinary prose.
 */
function withoutQuotations(evidence: string): string {
  return evidence.replace(/"[^"]*"|“[^”]*”|«[^»]*»/g, ' ');
}

/** The `action` targets the supplied form shapes name, ignoring the unset ones. */
function formActionTargets(page: UxAiPageEvidence): readonly string[] {
  return page.forms.flatMap((form) => {
    const action = /action=(\S+)/.exec(form)?.[1] ?? '';
    return action === '' ? [] : [action.toLowerCase()];
  });
}

/**
 * Whether the page itself holds the ambiguity a count claim asserts.
 *
 * Two forms posting to the same named endpoint, or two actions carrying the same
 * label, are ambiguity the snapshot shows — a reader can check it. A missing
 * `action` attribute is not counted: most pages have several such forms (search,
 * newsletter) and treating them as one target would ground every count claim and
 * undo the check.
 *
 * Each list is judged on its own. A link is also an action, so the same label
 * appearing in both is the ordinary case and says nothing; the analyzer already
 * de-duplicates within each list, which makes the label half a guard against a
 * future evidence shape rather than a live signal.
 */
function groundsAmbiguity(page: UxAiPageEvidence | undefined): boolean {
  if (page === undefined) return false;
  return (
    hasDuplicate(formActionTargets(page)) ||
    hasDuplicate(page.actions.map(labelKey)) ||
    hasDuplicate(page.links.map(labelKey))
  );
}

/** A link is stored as `label → href`; the label is what a visitor reads. */
function labelKey(label: string): string {
  return (label.split('→')[0] ?? '').trim().toLowerCase();
}

function hasDuplicate(values: readonly string[]): boolean {
  const named = values.filter((value) => value !== '');
  return new Set(named).size !== named.length;
}

/** Why the supplied package cannot back this finding, or null when it can. */
function unsupportedClaimReason(
  finding: UxAiFinding,
  pages: readonly UxAiPageEvidence[],
): UnsupportedClaimReason | null {
  const text = withoutQuotations(finding.evidence);
  const rendering = UNSUPPORTED_CLAIM_PATTERNS.find((entry) => entry.pattern.test(text));
  if (rendering !== undefined) return rendering.reason;
  if (!CONFUSION_CLAIM.test(text) || !MULTIPLE_ELEMENTS.test(text)) return null;
  // A finding that says the purposes differ has answered itself: what is left is
  // the number, and the number is not a visitor reaction.
  if (DISTINCT_PURPOSES.test(text)) return 'confusion-from-count';
  return groundsAmbiguity(pages.find((page) => page.url === finding.targetUrl))
    ? null
    : 'confusion-from-count';
}

/**
 * The response, parsed and then split by what the evidence can support.
 *
 * A MALFORMED FIELD AND AN UNSUPPORTED CLAIM ARE NOT THE SAME FAILURE, and they
 * end differently. A bad rule ID, an unknown target URL or a broken severity
 * means the parse itself cannot be trusted, so the whole response is rejected
 * (parseFinding throws). A claim about how the page looks is a defect of that
 * one finding: the other five are still well formed, still cite supplied pages
 * and are still independently checkable. Throwing them away would turn one stray
 * sentence into an unavailable review of a scan the reader paid for.
 *
 * Only the evidence is read. A recommendation that says "raise the contrast" is
 * ordinary advice about a claim the evidence does support; it asserts nothing
 * about what the crawl saw.
 */
export function parseUxAiClaims(rawText: string, pages: readonly UxAiPageEvidence[]): UxAiClaims {
  const payload = jsonPayload(rawText);
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new AiModuleError('ai: UX response must be an object');
  }
  const findings = (payload as Record<string, unknown>).findings;
  if (!Array.isArray(findings) || findings.length > MAX_FINDINGS) {
    throw new AiModuleError('ai: UX response findings must be an array of at most 6 items');
  }
  const allowed = new Set(pages.map((page) => page.url));
  const parsed = findings.map((finding) => parseFinding(finding, allowed));
  const fingerprints = new Set(
    parsed.map((finding) => `${finding.ruleId}|${finding.targetUrl}|${finding.selector ?? ''}`),
  );
  if (fingerprints.size !== parsed.length) {
    throw new AiModuleError('ai: UX response contains duplicate findings');
  }
  // Duplicates are judged over everything the provider sent: two identical
  // findings stay a broken response even when one of them would be dropped.
  const judged = parsed.map((finding) => ({
    finding,
    reason: unsupportedClaimReason(finding, pages),
  }));
  return {
    supported: judged.filter((entry) => entry.reason === null).map((entry) => entry.finding),
    unsupported: judged.flatMap((entry) =>
      entry.reason === null ? [] : [{ finding: entry.finding, reason: entry.reason }],
    ),
  };
}

/** The findings a report may show: `parseUxAiClaims` without the rejected ones. */
export function parseUxAiResponse(
  rawText: string,
  pages: readonly UxAiPageEvidence[],
): readonly UxAiFinding[] {
  return parseUxAiClaims(rawText, pages).supported;
}

export async function runUxAiAnalysis(
  input: UxAiInput,
  options: UxAiOptions,
): Promise<UxAiResponseResult> {
  if (input.pages.length === 0) {
    throw new AiModuleError('ai: UX analysis requires at least one reachable HTML page');
  }
  const request = buildUxAiRequest(input);
  const result = await runAiRequest(request, {
    provider: options.provider,
    quota: options.quota,
    consent:
      input.consent !== null && isAcceptedNoticeVersion(input.consent.noticeVersion)
        ? input.consent
        : null,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  if (result.outcome.kind === 'unavailable') {
    return {
      status: 'Unavailable',
      statusReason: result.outcome.reason,
      outcome: result.outcome,
      quota: result.quota,
      findings: [],
      unsupportedClaims: [],
    };
  }
  let claims: UxAiClaims;
  try {
    claims = parseUxAiClaims(result.outcome.response.rawText, input.pages);
  } catch (error) {
    return {
      status: 'Unavailable',
      statusReason: 'ProviderContract',
      outcome: {
        kind: 'unavailable',
        request,
        reason: 'ProviderContract',
        detail: error instanceof Error ? error.message : 'invalid UX response',
      },
      quota: result.quota,
      findings: [],
      unsupportedClaims: [],
    };
  }
  return {
    status: 'Completed',
    statusReason: null,
    outcome: result.outcome,
    quota: result.quota,
    findings: claims.supported,
    unsupportedClaims: claims.unsupported,
  };
}
