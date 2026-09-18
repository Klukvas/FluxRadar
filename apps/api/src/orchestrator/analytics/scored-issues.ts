// Issue rows for the Analytics findings and the score they add up to (D-219):
// the same §15 formula as every other section, with the aggregates each check
// counted. Findings of the informational rules never reach here — the checks
// produce none — so the score comes from the scored rules only.

import { ruleById } from '@fluxradar/contracts';
import { computeFingerprint, normalizeUrl } from '@fluxradar/fingerprint';
import { RULE_VARIANT_V1, renderFindingMessage, truncateExcerpt } from '@fluxradar/rules';

import type { IssueRowData } from '../module-result.ts';
import { scoreIssueRows, type ScoredIssueRows } from '../rule-penalties.ts';
import { ANALYTICS_MODULE, type AnalyticsCheck, type AnalyticsFinding } from './types.ts';

export function scoredAnalyticsIssues(
  scanId: string,
  domain: string,
  checks: readonly AnalyticsCheck[],
  observedAt: Date,
): ScoredIssueRows {
  return scoreIssueRows(
    checks.flatMap((check) =>
      check.findings.map((finding) => issueRow(scanId, domain, check, finding, observedAt)),
    ),
  );
}

function issueRow(
  scanId: string,
  domain: string,
  check: AnalyticsCheck,
  finding: AnalyticsFinding,
  observedAt: Date,
): IssueRowData {
  const descriptor = ruleById(finding.ruleId);
  if (descriptor === undefined || descriptor.severity === null) {
    throw new Error(`analytics: ${finding.ruleId} is not a scored rule of the registry`);
  }
  const siteLevel = finding.targetKind === 'site';
  // D-019: a site-level finding has no URL in its fingerprint.
  const normalizedUrl = siteLevel ? '' : normalizeUrl(finding.targetUrl);
  return {
    scanId,
    ruleId: finding.ruleId,
    module: ANALYTICS_MODULE,
    fingerprint: computeFingerprint({
      domain,
      ruleId: finding.ruleId,
      targetKind: finding.targetKind,
      normalizedUrl,
      normalizedResource: '',
      normalizedSelector: '',
      normalizedParameter: '',
      ruleVariant: RULE_VARIANT_V1,
    }),
    severity: descriptor.severity,
    category: descriptor.category,
    targetKind: finding.targetKind,
    normalizedUrl,
    normalizedResource: '',
    normalizedSelector: '',
    normalizedParameter: '',
    ruleVariant: RULE_VARIANT_V1,
    targetUrl: finding.targetUrl,
    evidenceType: finding.evidenceType,
    evidenceExcerpt: truncateExcerpt(english(finding.evidence)),
    evidenceGroupId: null,
    recommendation: english(finding.recommendation),
    messagesJson: JSON.stringify({
      evidence: finding.evidence,
      recommendation: finding.recommendation,
    }),
    confidence: 1,
    // §15: a site-level rule counts in full, whatever the check counted.
    applicableTargets: siteLevel ? 1 : check.applicableTargets,
    affectedTargets: siteLevel ? 1 : check.affectedTargets,
    // Filled in by scoreIssueRows.
    rulePenalty: 0,
    scoreDelta: 0,
    observedAt,
  };
}

function english(message: AnalyticsFinding['evidence']): string {
  const text = renderFindingMessage(message, 'en');
  if (text === null) {
    throw new Error(`analytics: message ${message.code} could not be rendered`);
  }
  return text;
}
