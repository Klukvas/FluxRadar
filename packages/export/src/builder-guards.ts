// Fail-fast guards record-билдеров (T-11): нарушение контракта §16/D-014..D-019
// во входе — баг вызывающего кода, запись не собирается. Каждая проверка
// дублируется semantic-валидатором для записей, пришедших извне.

import { EVIDENCE_EXCERPT_MAX_CHARS } from '@fluxradar/contracts';

import type {
  AiResponseRecordInput,
  IssueRecordInput,
  ModuleRecordInput,
} from './builder-inputs.js';
import { ExportBuildError } from './errors.js';

/** §16: UTC RFC3339 c суффиксом Z; другие оффсеты запрещены схемой (pattern Z$). */
export function assertUtcTimestamp(field: string, value: string): void {
  if (!value.endsWith('Z') || Number.isNaN(Date.parse(value))) {
    throw new ExportBuildError(
      `${field}: ожидается RFC3339 UTC c суффиксом Z, получено «${value}»`,
    );
  }
}

export function assertReasonContract(
  label: string,
  isOrdinaryCompleted: boolean,
  reason: string | null,
): void {
  if (isOrdinaryCompleted && reason !== null) {
    throw new ExportBuildError(
      `${label}: status_reason у обычного Completed обязан быть null (§16)`,
    );
  }
  if (!isOrdinaryCompleted && (reason === null || reason.trim() === '')) {
    throw new ExportBuildError(
      `${label}: не-Completed статус требует непустой status_reason (§16)`,
    );
  }
}

export function assertUnitRange(label: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new ExportBuildError(`${label}: значение должно быть в [0, 1], получено ${value}`);
  }
}

export function assertCheckCounts(input: ModuleRecordInput): void {
  for (const [name, value] of [
    ['applicable_checks', input.applicableChecks],
    ['completed_applicable_checks', input.completedApplicableChecks],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new ExportBuildError(
        `module ${input.module}: ${name} должен быть целым >= 0, получено ${value}`,
      );
    }
  }
  if (input.completedApplicableChecks > input.applicableChecks) {
    throw new ExportBuildError(
      `module ${input.module}: completed (${input.completedApplicableChecks}) не может превышать ` +
        `applicable (${input.applicableChecks}) (EXPORT-001/4)`,
    );
  }
}

export function assertIssueTargets(input: IssueRecordInput): void {
  for (const [name, value] of [
    ['applicable_targets', input.applicableTargets],
    ['affected_targets', input.affectedTargets],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new ExportBuildError(
        `issue ${input.ruleId}: ${name} должен быть целым >= 0, получено ${value}`,
      );
    }
  }
  if (input.affectedTargets > input.applicableTargets) {
    throw new ExportBuildError(
      `issue ${input.ruleId}: affected_targets > applicable_targets (EXPORT-001/6)`,
    );
  }
  const isSiteLevel = input.targetKind === 'site' || input.targetKind === 'environment';
  if (isSiteLevel && (input.applicableTargets !== 1 || input.affectedTargets !== 1)) {
    throw new ExportBuildError(
      `issue ${input.ruleId}: site-level targets обязаны быть 1/1 (§15/EXPORT-001/6)`,
    );
  }
  if (isSiteLevel && input.normalizedUrl !== '') {
    throw new ExportBuildError(
      `issue ${input.ruleId}: для site-level normalized_url — пустая строка (D-019)`,
    );
  }
}

export function assertPenalty(input: IssueRecordInput): void {
  const { rulePenalty } = input;
  if (!Number.isFinite(rulePenalty) || rulePenalty < 0 || rulePenalty > 25) {
    throw new ExportBuildError(
      `issue ${input.ruleId}: rule_penalty должен быть в [0, 25], получено ${rulePenalty} (§16)`,
    );
  }
  // Penalty приходит из scoring в целых сотых (D-119) — иная точность означает,
  // что значение считали в обход движка.
  if (Math.round(rulePenalty * 100) / 100 !== rulePenalty) {
    throw new ExportBuildError(
      `issue ${input.ruleId}: rule_penalty ${rulePenalty} не представим в сотых (D-119/D-021)`,
    );
  }
}

export function assertExcerptCap(input: IssueRecordInput): void {
  if (
    input.evidenceExcerpt !== null &&
    [...input.evidenceExcerpt].length > EVIDENCE_EXCERPT_MAX_CHARS
  ) {
    throw new ExportBuildError(
      `issue ${input.ruleId}: evidence_excerpt длиннее ${EVIDENCE_EXCERPT_MAX_CHARS} символов (§16); ` +
        'усечение — обязанность rule engine, билдер не портит evidence молча',
    );
  }
}

export function assertUsage(input: AiResponseRecordInput): void {
  const { usage } = input;
  for (const [name, value] of [
    ['input_tokens', usage.inputTokens],
    ['output_tokens', usage.outputTokens],
    ['total_tokens', usage.totalTokens],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new ExportBuildError(
        `ai_response: usage.${name} должен быть целым >= 0, получено ${value}`,
      );
    }
  }
  if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
    throw new ExportBuildError(
      `ai_response: usage.total_tokens (${usage.totalTokens}) != input + output ` +
        `(${usage.inputTokens} + ${usage.outputTokens}) (§5/EXPORT-001/10)`,
    );
  }
  if (
    input.usageSource === 'estimated' &&
    (input.tokenizerVersion === undefined ||
      input.tokenizerVersion === null ||
      input.tokenizerVersion.trim() === '')
  ) {
    throw new ExportBuildError(
      'ai_response: usage_source=estimated требует непустой tokenizer_version (§16/EXPORT-001/10)',
    );
  }
}
