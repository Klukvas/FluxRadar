// Orchestration seam for the UX/Conversion module. Static evidence is produced
// by @fluxradar/rules; the AI adapter only interprets that evidence. Both kinds
// of finding become ordinary Issue rows and score the section's own 0–100
// result (D-218), which stays outside the overall score.

import { computeFingerprint, normalizeField, normalizeUrl } from '@fluxradar/fingerprint';
import {
  analyzeUxStatic,
  truncateExcerpt,
  type FindingMessageRef,
  type FindingMessages,
  type SiteContext,
  type UxStaticEvidence,
  type UxStaticFinding,
} from '@fluxradar/rules';
import {
  AiRequestAbortedError,
  runUxAiAnalysis,
  type AiConsent,
  type AiProvider,
  type AiQuotaTracker,
  type UxAiFinding,
  type UxAiProfileContext,
  type UxAiResponseResult,
} from '@fluxradar/ai';
import type { Severity } from '@fluxradar/contracts';
import type { SiteProfile } from '@prisma/client';

import type { IssueRowData } from './module-result.ts';
import { UX_AI_RULE_IDS, UX_STATIC_RULE_IDS, uxRuleCounts, uxRulePages } from './rule-checks.ts';
import { scoreIssueRows, type ScoredIssueRows } from './rule-penalties.ts';
import type { RuleCoverage } from './run-coverage.ts';
import { redact } from '@fluxradar/ai';

/**
 * Итог AI-части модуля: результат адаптера либо проверка, прерванная отменой.
 *
 * Прерванная проверка — не «Unavailable по вине провайдера»: ai_response нет,
 * квота не списана, и сказать о сайте ей нечего. Но три статические проверки к
 * этому моменту уже завершены, и по §15/§575 завершённая часть сохраняется как
 * Partial — поэтому отмена не отменяет запись модуля, а только его AI-четверть.
 */
export interface UxAiCancelled {
  readonly status: 'Unavailable';
  readonly statusReason: 'ScanCancelled';
  readonly outcome: null;
  readonly findings: readonly UxAiFinding[];
}

export type UxAiPhase = UxAiResponseResult | UxAiCancelled;

const UX_AI_CANCELLED: UxAiCancelled = {
  status: 'Unavailable',
  statusReason: 'ScanCancelled',
  outcome: null,
  findings: [],
};

export interface UxConversionRun extends ScoredIssueRows {
  readonly staticEvidence: UxStaticEvidence;
  readonly ai: UxAiPhase;
}

type UxFinding = UxAiFinding | UxStaticFinding;

function profileContext(profile: SiteProfile): UxAiProfileContext {
  return {
    industry: profile.industry,
    region: profile.region,
    language: profile.language,
    businessDescription: profile.businessDescription,
    offerings: profile.offerings,
    targetLanguages: profile.targetLanguages,
    targetAudience: profile.targetAudience,
  };
}

function aiPageEvidence(staticEvidence: UxStaticEvidence) {
  return staticEvidence.pages.map((page) => ({
    url: page.url,
    title: page.title,
    headings: page.headings,
    actions: page.actions,
    links: page.links,
    forms: page.forms,
    contactSignals: page.contactSignals,
    visibleText: page.visibleText,
  }));
}

/**
 * Message values pass through the same redaction as the stored English text:
 * a localized rendering must not show what the stored excerpt hides.
 */
function redactedMessages(messages: FindingMessages): FindingMessages {
  return {
    evidence: redactedMessage(messages.evidence),
    recommendation: redactedMessage(messages.recommendation),
  };
}

function redactedMessage(message: FindingMessageRef): FindingMessageRef {
  return {
    code: message.code,
    params: Object.fromEntries(
      Object.entries(message.params).map(([name, value]) => [
        name,
        typeof value === 'string' ? redact(value).text : value,
      ]),
    ),
  };
}

function validSeverity(value: Severity): Severity {
  if (value === 'High' || value === 'Medium' || value === 'Low') return value;
  throw new Error(`UX/Conversion returned invalid severity ${value}`);
}

function candidateRow(
  scanId: string,
  domain: string,
  finding: UxFinding,
  source: 'static' | 'ai',
  observedAt: Date,
): IssueRowData {
  const normalizedUrl = normalizeUrl(finding.targetUrl);
  const selector = normalizeField(finding.selector ?? '');
  const ruleVariant = 'v1';
  return {
    scanId,
    ruleId: finding.ruleId,
    module: 'UX/Conversion',
    fingerprint: computeFingerprint({
      domain,
      ruleId: finding.ruleId,
      targetKind: 'page',
      normalizedUrl,
      normalizedResource: '',
      normalizedSelector: selector,
      normalizedParameter: '',
      ruleVariant,
    }),
    severity: validSeverity(finding.severity),
    category: source === 'static' ? 'deterministic-ux' : 'ai-assisted-ux',
    targetKind: 'page',
    normalizedUrl,
    normalizedResource: '',
    normalizedSelector: selector,
    normalizedParameter: '',
    ruleVariant,
    targetUrl: finding.targetUrl,
    evidenceType: source === 'static' ? 'dom' : 'mixed',
    evidenceExcerpt: truncateExcerpt(redact(finding.evidence).text),
    evidenceGroupId: null,
    recommendation: redact(finding.recommendation).text,
    messagesJson:
      'messages' in finding && finding.messages !== undefined
        ? JSON.stringify(redactedMessages(finding.messages))
        : null,
    confidence: finding.confidence,
    // Rule-level aggregates are filled in by scoredUxIssues, the penalty by scoreIssueRows.
    applicableTargets: 0,
    affectedTargets: 0,
    rulePenalty: 0,
    scoreDelta: 0,
    observedAt,
  };
}

/**
 * Issue rows for every UX finding, and the score they add up to (D-218).
 *
 * The same §15 formula as every other section: each rule costs its highest
 * severity's weight times the share of the pages it looked at that it flagged.
 */
export function scoredUxIssues(
  scanId: string,
  domain: string,
  evidence: UxStaticEvidence,
  aiFindings: readonly UxAiFinding[],
  observedAt: Date,
): ScoredIssueRows {
  const findings = [...evidence.findings, ...aiFindings];
  const candidates = [
    ...evidence.findings.map((finding) =>
      candidateRow(scanId, domain, finding, 'static', observedAt),
    ),
    ...aiFindings.map((finding) => candidateRow(scanId, domain, finding, 'ai', observedAt)),
  ];
  return scoreIssueRows(
    candidates.map((row) => {
      const counts = uxRuleCounts(evidence, findings, row.ruleId);
      return {
        ...row,
        applicableTargets: counts.applicableTargets,
        affectedTargets: counts.affectedTargets,
      };
    }),
  );
}

/**
 * What every UX check read in this run — the proof the next scan needs before it
 * may call one of these findings fixed (§14, run-coverage.ts).
 *
 * The AI checks report nothing when the provider did not answer: a review that
 * never ran looked at no page, and claiming otherwise would let the next scan
 * close an AI finding the model never had a chance to repeat.
 */
export function uxRuleCoverage(
  run: Pick<UxConversionRun, 'staticEvidence' | 'ai'>,
): readonly RuleCoverage[] {
  const aiAnswered = run.ai.outcome?.kind === 'response';
  return [
    ...UX_STATIC_RULE_IDS.map((ruleId) => ({
      ruleId,
      checkedTargets: normalizedPageUrls(run, ruleId),
    })),
    ...UX_AI_RULE_IDS.map((ruleId) => ({
      ruleId,
      checkedTargets: aiAnswered ? normalizedPageUrls(run, ruleId) : [],
    })),
  ];
}

function normalizedPageUrls(
  run: Pick<UxConversionRun, 'staticEvidence'>,
  ruleId: string,
): readonly string[] {
  // The same normalization the issue rows use, so a target matches its finding.
  return uxRulePages(run.staticEvidence, ruleId).map((page) => normalizeUrl(page.url));
}

export async function runUxConversion(
  scanId: string,
  plan: 'Complete',
  brand: string,
  siteOrigin: string,
  ctx: SiteContext,
  profile: SiteProfile,
  consent: AiConsent | null,
  provider: AiProvider,
  quota: AiQuotaTracker,
  observedAt: Date,
  signal?: AbortSignal,
): Promise<UxConversionRun> {
  const staticEvidence = analyzeUxStatic(ctx);
  if (staticEvidence.pages.length === 0) {
    throw new Error('UX/Conversion requires at least one reachable HTML page');
  }
  const ai = await runUxAi(
    {
      scanId,
      plan,
      brand,
      siteOrigin,
      consent,
      profileContext: profileContext(profile),
      pages: aiPageEvidence(staticEvidence),
    },
    { provider, quota, ...(signal !== undefined ? { signal } : {}) },
  );
  return {
    staticEvidence,
    ai,
    ...scoredUxIssues(scanId, ctx.domain, staticEvidence, ai.findings, observedAt),
  };
}

/**
 * The AI review, with a cancellation reported rather than thrown.
 *
 * A cancelled scan interrupts the request instead of paying for an answer
 * nobody will read, and the adapter raises `AiRequestAbortedError` for it. That
 * is the end of this check, not of the module: the three static checks already
 * finished, and §575 keeps a completed part as `Partial`. Losing them would
 * throw away work the user paid for to describe the moment of cancellation.
 */
async function runUxAi(
  input: Parameters<typeof runUxAiAnalysis>[0],
  options: Parameters<typeof runUxAiAnalysis>[1],
): Promise<UxAiPhase> {
  try {
    return await runUxAiAnalysis(input, options);
  } catch (error) {
    if (error instanceof AiRequestAbortedError) {
      return UX_AI_CANCELLED;
    }
    throw error;
  }
}
