// Общие фикстуры тестов T-11: канонический пример §16 (дословно из плана)
// и валидный snapshot Complete-скана, собранный билдерами. Негативные пробы
// тесты строят сами, порча по одному полю от этих валидных записей.

import type { ExportRecord, IssueRecord } from '@fluxradar/contracts';
import { computeFingerprint } from '@fluxradar/fingerprint';

import type { ScanExportContext } from '../builder-inputs.js';
import {
  buildAiResponseRecord,
  buildIssueRecord,
  buildModuleRecord,
  buildSummaryRecord,
} from '../builders.js';

/**
 * Канонический JSON record из плана §16 — дословно, включая placeholder-значения
 * `...`. Проходит JSON Schema как есть; для semantic-проверки fingerprint
 * заменяется на настоящий пересчёт (см. canonicalIssueWithRealFingerprint).
 */
export const CANONICAL_ISSUE_EXAMPLE = {
  schema_version: '1.0',
  record_type: 'issue',
  scan_id: 'scan_01J...',
  domain: 'https://example.com',
  plan: 'Complete Scan',
  started_at: '2026-09-03T10:00:00Z',
  completed_at: '2026-09-03T10:12:00Z',
  observed_at: '2026-09-03T10:05:00Z',
  ruleset_version: 'rules-v1',
  module: 'SEO',
  module_status: 'Completed',
  scan_status: null,
  status_reason: null,
  rule_id: 'SEO-TECH-004',
  target_kind: 'page',
  normalized_url: 'https://example.com/page',
  normalized_resource: '',
  normalized_selector: '',
  normalized_parameter: '',
  rule_variant: 'v1',
  evidence_group_id: 'eg_01J...',
  coverage: null,
  applicable_checks: null,
  completed_applicable_checks: null,
  score: null,
  applicable_targets: 1,
  affected_targets: 1,
  rule_penalty: 10.0,
  score_delta: -10.0,
  issue_id: 'iss_01J...',
  fingerprint: 'fluxradar-fp-v1:...',
  category: 'canonical',
  severity: 'High',
  confidence: 0.98,
  status: 'New',
  target_url: 'https://example.com/page',
  evidence_type: 'http',
  evidence_ref: '/reports/report_01J/evidence/iss_01J',
  evidence_excerpt: 'HTTP 200; canonical points to https://example.com/other',
  recommendation: 'Set a self-referencing canonical URL.',
  metric_key: null,
} as const;

/** Канонический пример с настоящим fingerprint-v1 (инвариант 8 требует пересчёта). */
export function canonicalIssueWithRealFingerprint(): Record<string, unknown> {
  return {
    ...CANONICAL_ISSUE_EXAMPLE,
    fingerprint: computeFingerprint({
      domain: CANONICAL_ISSUE_EXAMPLE.domain,
      ruleId: CANONICAL_ISSUE_EXAMPLE.rule_id,
      targetKind: CANONICAL_ISSUE_EXAMPLE.target_kind,
      normalizedUrl: CANONICAL_ISSUE_EXAMPLE.normalized_url,
      normalizedResource: CANONICAL_ISSUE_EXAMPLE.normalized_resource,
      normalizedSelector: CANONICAL_ISSUE_EXAMPLE.normalized_selector,
      normalizedParameter: CANONICAL_ISSUE_EXAMPLE.normalized_parameter,
      ruleVariant: CANONICAL_ISSUE_EXAMPLE.rule_variant,
    }),
  };
}

export const FIXTURE_CONTEXT: ScanExportContext = {
  scanId: 'scan_01JFIXTURE',
  domain: 'https://example.com',
  startedAt: '2026-09-03T10:00:00Z',
  completedAt: '2026-09-03T10:12:00Z',
  rulesetVersion: 'rules-mvp-0.1',
};

/** SEO-TECH-004: rule-агрегат High, 2 из 10 страниц → penalty 10 × 0.2 = 2.00. */
export function fixtureSeoIssue(page: 'a' | 'b'): IssueRecord {
  return buildIssueRecord(FIXTURE_CONTEXT, {
    issueId: `iss_seo_${page}`,
    module: 'SEO',
    moduleStatus: 'Completed',
    ruleId: 'SEO-TECH-004',
    targetKind: 'page',
    normalizedUrl: `https://example.com/${page}`,
    normalizedResource: '',
    normalizedSelector: '',
    normalizedParameter: '',
    ruleVariant: 'v1',
    category: 'canonical',
    severity: 'High',
    confidence: 0.98,
    status: 'New',
    targetUrl: `https://example.com/${page}`,
    evidenceType: 'http',
    evidenceRef: `/reports/report_01J/evidence/iss_seo_${page}`,
    evidenceExcerpt: `HTTP 200; canonical points to https://example.com/other-${page}`,
    recommendation: 'Set a self-referencing canonical URL.',
    applicableTargets: 10,
    affectedTargets: 2,
    rulePenalty: 2,
    observedAt: '2026-09-03T10:05:00Z',
  });
}

/** Site-level Critical (§15: полный вес 25, targets 1/1, normalized_url — ''). */
export function fixtureSecurityIssue(): IssueRecord {
  return buildIssueRecord(FIXTURE_CONTEXT, {
    issueId: 'iss_sec_hsts',
    module: 'Security',
    moduleStatus: 'Completed',
    ruleId: 'SEC-PASSIVE-003',
    targetKind: 'site',
    normalizedUrl: '',
    normalizedResource: 'security-headers',
    normalizedSelector: '',
    normalizedParameter: 'strict-transport-security',
    ruleVariant: 'v1',
    category: 'transport-security',
    severity: 'Critical',
    confidence: 1,
    status: 'New',
    targetUrl: 'https://example.com/',
    evidenceType: 'http',
    evidenceRef: '/reports/report_01J/evidence/iss_sec_hsts',
    // Ведущий «=» — проба формула-инъекции для CSV-writer (§25 EXPORT-003).
    evidenceExcerpt: '=HYPERLINK("https://evil.example/x") missing Strict-Transport-Security',
    recommendation: 'Add Strict-Transport-Security with a positive max-age.',
    applicableTargets: 1,
    affectedTargets: 1,
    rulePenalty: 25,
    observedAt: '2026-09-03T10:04:00Z',
  });
}

/** Полный валидный snapshot: summary + 3 module + ai_response + 3 issue. */
export function buildFixtureRecords(): readonly ExportRecord[] {
  const summary = buildSummaryRecord(FIXTURE_CONTEXT, {
    scanStatus: 'Completed',
    statusReason: null,
    coverage: 1,
    score: 96.5,
  });
  const modules = [
    buildModuleRecord(FIXTURE_CONTEXT, {
      module: 'SEO',
      moduleStatus: 'Completed',
      coverage: 1,
      applicableChecks: 10,
      completedApplicableChecks: 10,
      score: 98,
      statusReason: null,
      observedAt: '2026-09-03T10:05:00Z',
    }),
    buildModuleRecord(FIXTURE_CONTEXT, {
      module: 'AI SEO / GEO',
      moduleStatus: 'Completed',
      coverage: 1,
      applicableChecks: 5,
      completedApplicableChecks: 5,
      score: 100,
      statusReason: null,
      observedAt: '2026-09-03T10:06:00Z',
    }),
    buildModuleRecord(FIXTURE_CONTEXT, {
      module: 'Security',
      moduleStatus: 'Completed',
      coverage: 1,
      applicableChecks: 4,
      completedApplicableChecks: 4,
      score: 75,
      statusReason: null,
      observedAt: '2026-09-03T10:04:00Z',
    }),
  ];
  const aiResponse = buildAiResponseRecord(FIXTURE_CONTEXT, {
    moduleStatus: 'Completed',
    statusReason: null,
    provider: 'openai',
    apiVersion: 'v1',
    modelId: 'gpt-5-mini',
    promptVersion: 'geo-questions-v1',
    requestId: 'req_000001',
    requestIdSource: 'provider',
    aiRequestKey: 'ai:scan_01JFIXTURE:openai:6a1f:1',
    rawText: 'Example.com is a well-known brand, cited by "review" sites.',
    providerCreatedAt: '2026-09-03T10:06:00Z',
    citations: ['https://example.com'],
    usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 },
    usageSource: 'provider',
    tokenizerVersion: null,
    finishReason: 'stop',
    deletionEvidenceRef: 'ai-001/deletion/req_000001',
    observedAt: '2026-09-03T10:06:00Z',
  });
  return [
    summary,
    ...modules,
    aiResponse,
    fixtureSeoIssue('a'),
    fixtureSeoIssue('b'),
    fixtureSecurityIssue(),
  ];
}
