// AI-assisted UX/Conversion analysis. The provider receives a bounded,
// redacted evidence package and must return a strict JSON finding contract.
// Invalid or unsupported output is unavailable, never a guessed result.

import type { Plan } from '@fluxradar/contracts';

import { isAcceptedAiProcessingNoticeVersion } from './consent.js';
import type { AiConsent } from './consent.js';
import { AiModuleError } from './errors.js';
import { AiQuotaTracker } from './quota.js';
import { runAiRequest } from './run-request.js';
import type { AiRequest, AiProvider } from './types.js';
import type { AiRequestOutcome } from './run-request.js';

export const UX_PROMPT_VERSION = 'ux-conversion-v3';
export const UX_SYSTEM_INSTRUCTIONS =
  'You are a careful UX and conversion reviewer. Use only the supplied evidence. ' +
  'Do not claim that a site converts or fails to convert, and do not invent missing facts. ' +
  'Return JSON only with a findings array. Each finding must cite one supplied page URL and ' +
  'quote or paraphrase evidence visible in the supplied snapshot.';

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
}

export interface UxAiResponseResult {
  readonly status: 'Completed' | 'Unavailable';
  readonly statusReason: string | null;
  readonly outcome: AiRequestOutcome;
  readonly quota: AiQuotaTracker;
  readonly findings: readonly UxAiFinding[];
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

export function parseUxAiResponse(
  rawText: string,
  allowedUrls: readonly string[],
): readonly UxAiFinding[] {
  const payload = jsonPayload(rawText);
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new AiModuleError('ai: UX response must be an object');
  }
  const findings = (payload as Record<string, unknown>).findings;
  if (!Array.isArray(findings) || findings.length > MAX_FINDINGS) {
    throw new AiModuleError('ai: UX response findings must be an array of at most 6 items');
  }
  const allowed = new Set(allowedUrls);
  const parsed = findings.map((finding) => parseFinding(finding, allowed));
  const fingerprints = new Set(
    parsed.map((finding) => `${finding.ruleId}|${finding.targetUrl}|${finding.selector ?? ''}`),
  );
  if (fingerprints.size !== parsed.length) {
    throw new AiModuleError('ai: UX response contains duplicate findings');
  }
  return parsed;
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
      input.consent !== null && isAcceptedAiProcessingNoticeVersion(input.consent.noticeVersion)
        ? input.consent
        : null,
  });
  if (result.outcome.kind === 'unavailable') {
    return {
      status: 'Unavailable',
      statusReason: result.outcome.reason,
      outcome: result.outcome,
      quota: result.quota,
      findings: [],
    };
  }
  let findings: readonly UxAiFinding[];
  try {
    findings = parseUxAiResponse(
      result.outcome.response.rawText,
      input.pages.map((page) => page.url),
    );
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
    };
  }
  return {
    status: 'Completed',
    statusReason: null,
    outcome: result.outcome,
    quota: result.quota,
    findings,
  };
}
