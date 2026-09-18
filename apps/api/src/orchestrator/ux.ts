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
import { uxRuleCounts } from './rule-checks.ts';
import { scoreIssueRows, type ScoredIssueRows } from './rule-penalties.ts';
import { redact } from '@fluxradar/ai';

export interface UxConversionRun extends ScoredIssueRows {
  readonly staticEvidence: UxStaticEvidence;
  readonly ai: UxAiResponseResult;
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
): Promise<UxConversionRun> {
  const staticEvidence = analyzeUxStatic(ctx);
  if (staticEvidence.pages.length === 0) {
    throw new Error('UX/Conversion requires at least one reachable HTML page');
  }
  const ai = await runUxAiAnalysis(
    {
      scanId,
      plan,
      brand,
      siteOrigin,
      consent,
      profileContext: profileContext(profile),
      pages: aiPageEvidence(staticEvidence),
    },
    { provider, quota },
  );
  return {
    staticEvidence,
    ai,
    ...scoredUxIssues(scanId, ctx.domain, staticEvidence, ai.findings, observedAt),
  };
}
