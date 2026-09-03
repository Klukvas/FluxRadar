// Сборка канонических export records §16 из доменных данных скана (T-11).
// D-014: каждое поле data dictionary присутствует явно, absent запрещён —
// билдеры всегда выдают полный record с explicit null. Инварианты, которые
// дешевле гарантировать построением, чем проверять постфактум: fingerprint
// пересчитывается из компонент (EXPORT-001/8), score_delta = −rule_penalty
// (EXPORT-001/7, D-016), site-level targets = 1 (D-019/§15).

import type {
  AiResponseRecord,
  ExportPlanLabel,
  IssueRecord,
  ModuleRecord,
  SummaryRecord,
} from '@fluxradar/contracts';
import { EXPORT_SCHEMA_VERSION } from '@fluxradar/contracts';
import { computeFingerprint } from '@fluxradar/fingerprint';

import type {
  AiResponseRecordInput,
  IssueRecordInput,
  ModuleRecordInput,
  ScanExportContext,
  SummaryRecordInput,
} from './builder-inputs.js';
import {
  assertCheckCounts,
  assertExcerptCap,
  assertIssueTargets,
  assertPenalty,
  assertReasonContract,
  assertUnitRange,
  assertUsage,
  assertUtcTimestamp,
} from './builder-guards.js';
import { ExportBuildError } from './errors.js';

/** §16/D-108: export records существуют только для Complete-плана. */
const EXPORT_PLAN_LABEL: ExportPlanLabel = 'Complete Scan';

// Явные null-блоки вместо спредов по типам contracts: WithNull*-интерфейсы там
// внутренние, а литералы с as const дают точные типы null для narrowed records.
const NULL_ISSUE_FIELDS = {
  applicable_targets: null,
  affected_targets: null,
  rule_penalty: null,
  score_delta: null,
  issue_id: null,
  fingerprint: null,
  rule_id: null,
  target_kind: null,
  normalized_url: null,
  normalized_resource: null,
  normalized_selector: null,
  normalized_parameter: null,
  rule_variant: null,
  metric_key: null,
  evidence_group_id: null,
  category: null,
  severity: null,
  confidence: null,
  status: null,
  target_url: null,
  evidence_type: null,
  evidence_ref: null,
  evidence_excerpt: null,
  recommendation: null,
} as const;

const NULL_AI_FIELDS = {
  request_id_source: null,
  usage_source: null,
  tokenizer_version: null,
  provider: null,
  api_version: null,
  model_id: null,
  prompt_version: null,
  request_id: null,
  ai_request_key: null,
  raw_text: null,
  provider_created_at: null,
  finish_reason: null,
  citations: null,
  usage: null,
  deletion_evidence_ref: null,
} as const;

export function buildSummaryRecord(
  context: ScanExportContext,
  input: SummaryRecordInput,
): SummaryRecord {
  assertReasonContract('summary', input.scanStatus === 'Completed', input.statusReason);
  assertUnitRange('summary coverage', input.coverage);
  if (
    input.score !== null &&
    (!Number.isFinite(input.score) || input.score < 0 || input.score > 100)
  ) {
    throw new ExportBuildError(
      `summary: score должен быть null или в [0, 100], получено ${input.score}`,
    );
  }
  return {
    ...identityFields(context, input.observedAt),
    ...NULL_ISSUE_FIELDS,
    ...NULL_AI_FIELDS,
    record_type: 'summary',
    module: null,
    module_status: null,
    scan_status: input.scanStatus,
    coverage: input.coverage,
    applicable_checks: null,
    completed_applicable_checks: null,
    score: input.score,
    status_reason: input.statusReason,
  };
}

export function buildModuleRecord(
  context: ScanExportContext,
  input: ModuleRecordInput,
): ModuleRecord {
  assertReasonContract(
    `module ${input.module}`,
    input.moduleStatus === 'Completed',
    input.statusReason,
  );
  assertUnitRange(`module ${input.module} coverage`, input.coverage);
  assertCheckCounts(input);
  if (
    input.score !== null &&
    (input.moduleStatus === 'Unavailable' || input.moduleStatus === 'Not applicable')
  ) {
    throw new ExportBuildError(
      `module ${input.module}: score у статуса ${input.moduleStatus} обязан быть null (§15/§16)`,
    );
  }
  return {
    ...identityFields(context, input.observedAt),
    ...NULL_ISSUE_FIELDS,
    ...NULL_AI_FIELDS,
    record_type: 'module',
    module: input.module,
    module_status: input.moduleStatus,
    scan_status: null,
    coverage: input.coverage,
    applicable_checks: input.applicableChecks,
    completed_applicable_checks: input.completedApplicableChecks,
    score: input.score,
    status_reason: input.statusReason,
  };
}

export function buildIssueRecord(context: ScanExportContext, input: IssueRecordInput): IssueRecord {
  assertIssueTargets(input);
  assertUnitRange(`issue ${input.ruleId} confidence`, input.confidence);
  assertPenalty(input);
  assertExcerptCap(input);
  const fingerprint = computeFingerprint({
    domain: context.domain,
    ruleId: input.ruleId,
    targetKind: input.targetKind,
    normalizedUrl: input.normalizedUrl,
    normalizedResource: input.normalizedResource,
    normalizedSelector: input.normalizedSelector,
    normalizedParameter: input.normalizedParameter,
    ruleVariant: input.ruleVariant,
  });
  if (input.expectedFingerprint !== undefined && input.expectedFingerprint !== fingerprint) {
    throw new ExportBuildError(
      `issue ${input.issueId} (${input.ruleId}): сохранённый fingerprint ${input.expectedFingerprint} ` +
        `не совпадает с пересчётом ${fingerprint} — рассинхрон компонент fingerprint-v1 (EXPORT-001/8)`,
    );
  }
  return {
    ...identityFields(context, input.observedAt),
    ...NULL_AI_FIELDS,
    record_type: 'issue',
    module: input.module,
    module_status: input.moduleStatus,
    scan_status: null,
    coverage: null,
    applicable_checks: null,
    completed_applicable_checks: null,
    score: null,
    applicable_targets: input.applicableTargets,
    affected_targets: input.affectedTargets,
    rule_penalty: input.rulePenalty,
    // −0 нормализуется в 0: JSON не различает их, а сравнения на равенство различают.
    score_delta: input.rulePenalty === 0 ? 0 : -input.rulePenalty,
    issue_id: input.issueId,
    fingerprint,
    rule_id: input.ruleId,
    target_kind: input.targetKind,
    normalized_url: input.normalizedUrl,
    normalized_resource: input.normalizedResource,
    normalized_selector: input.normalizedSelector,
    normalized_parameter: input.normalizedParameter,
    rule_variant: input.ruleVariant,
    metric_key: input.metricKey ?? null,
    evidence_group_id: input.evidenceGroupId ?? null,
    category: input.category,
    severity: input.severity,
    confidence: input.confidence,
    status: input.status,
    target_url: input.targetUrl,
    evidence_type: input.evidenceType,
    evidence_ref: input.evidenceRef,
    evidence_excerpt: input.evidenceExcerpt,
    recommendation: input.recommendation,
    status_reason: null,
  };
}

export function buildAiResponseRecord(
  context: ScanExportContext,
  input: AiResponseRecordInput,
): AiResponseRecord {
  assertReasonContract('ai_response', input.moduleStatus === 'Completed', input.statusReason);
  assertUsage(input);
  if (input.providerCreatedAt !== null) {
    assertUtcTimestamp('ai_response provider_created_at', input.providerCreatedAt);
  }
  return {
    ...identityFields(context, input.observedAt),
    ...NULL_ISSUE_FIELDS,
    record_type: 'ai_response',
    module: 'AI SEO / GEO',
    module_status: input.moduleStatus,
    scan_status: null,
    coverage: null,
    applicable_checks: null,
    completed_applicable_checks: null,
    score: null,
    request_id_source: input.requestIdSource,
    usage_source: input.usageSource,
    tokenizer_version: input.tokenizerVersion ?? null,
    provider: input.provider,
    api_version: input.apiVersion,
    model_id: input.modelId,
    prompt_version: input.promptVersion,
    request_id: input.requestId,
    ai_request_key: input.aiRequestKey,
    raw_text: input.rawText,
    provider_created_at: input.providerCreatedAt,
    citations: input.citations,
    usage: {
      input_tokens: input.usage.inputTokens,
      output_tokens: input.usage.outputTokens,
      total_tokens: input.usage.totalTokens,
      reasoning_units: input.usage.reasoningUnits ?? null,
      search_units: input.usage.searchUnits ?? null,
      citation_units: input.usage.citationUnits ?? null,
    },
    finish_reason: input.finishReason,
    deletion_evidence_ref: input.deletionEvidenceRef,
    status_reason: input.statusReason,
  };
}

function identityFields(context: ScanExportContext, observedAt: string | undefined) {
  for (const [field, value] of [
    ['scan_id', context.scanId],
    ['domain', context.domain],
    ['ruleset_version', context.rulesetVersion],
  ] as const) {
    if (value.trim() === '') {
      throw new ExportBuildError(`контекст скана: поле ${field} обязано быть непустым (§16)`);
    }
  }
  const observed = observedAt ?? context.completedAt;
  assertUtcTimestamp('started_at', context.startedAt);
  assertUtcTimestamp('completed_at', context.completedAt);
  assertUtcTimestamp('observed_at', observed);
  if (
    !(Date.parse(context.startedAt) <= Date.parse(observed)) ||
    !(Date.parse(observed) <= Date.parse(context.completedAt))
  ) {
    throw new ExportBuildError(
      `timestamps нарушают started_at <= observed_at <= completed_at (EXPORT-001/2): ` +
        `${context.startedAt} / ${observed} / ${context.completedAt}`,
    );
  }
  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    scan_id: context.scanId,
    domain: context.domain,
    plan: EXPORT_PLAN_LABEL,
    started_at: context.startedAt,
    completed_at: context.completedAt,
    observed_at: observed,
    ruleset_version: context.rulesetVersion,
  } as const;
}
