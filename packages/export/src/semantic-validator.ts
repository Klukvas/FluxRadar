// Semantic validator EXPORT-001 (проверка №2, после JSON Schema): per-record
// инварианты 1–8 + AI-инварианты usage (10) здесь, агрегатные проверки (9)
// в semantic-aggregation.ts. Валидатор не бросает на нарушениях данных —
// возвращает полный список violations, чтобы CI/export показал все причины
// отказа сразу; выбрасывание — только для багов вызывающего кода.

import type {
  AiResponseRecord,
  ExportRecord,
  IssueRecord,
  ModuleRecord,
  SummaryRecord,
} from '@fluxradar/contracts';
import { EXPORT_SCHEMA_VERSION } from '@fluxradar/contracts';
import { computeFingerprint } from '@fluxradar/fingerprint';

import { aggregateViolations } from './semantic-aggregation.js';

export interface SemanticViolation {
  /** Номер инварианта EXPORT-001 (или решения), который нарушен. */
  readonly invariant: string;
  /** Индекс record во входном списке; null — нарушение уровня набора records. */
  readonly recordIndex: number | null;
  readonly message: string;
}

export type SemanticValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly SemanticViolation[] };

/** Поглощает двоичный float-шум в равенствах coverage (та же логика, что D-122). */
export const COVERAGE_EPSILON = 1e-9;

/** Порог публикации summary score: weighted coverage >= 0.50 (§15). */
const SUMMARY_SCORE_MIN_COVERAGE = 0.5;

export function validateExportSemantics(
  records: readonly ExportRecord[],
): SemanticValidationResult {
  const violations = [
    ...records.flatMap((record, index) => recordViolations(record, index)),
    ...aggregateViolations(records),
  ];
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

export function violation(
  invariant: string,
  recordIndex: number | null,
  message: string,
): SemanticViolation {
  return { invariant, recordIndex, message };
}

function recordViolations(record: ExportRecord, index: number): readonly SemanticViolation[] {
  const common = [...planViolations(record, index), ...timestampViolations(record, index)];
  switch (record.record_type) {
    case 'summary':
      return [...common, ...summaryViolations(record, index)];
    case 'module':
      return [...common, ...moduleViolations(record, index)];
    case 'ai_response':
      return [...common, ...aiResponseViolations(record, index)];
    case 'issue':
      return [...common, ...issueViolations(record, index)];
  }
}

/** Инвариант 1: Complete-only plan и единственная schema_version. */
function planViolations(record: ExportRecord, index: number): readonly SemanticViolation[] {
  const found: SemanticViolation[] = [];
  if (record.plan !== 'Complete Scan') {
    found.push(violation('EXPORT-001/1', index, `plan «${record.plan}» — export существует только для Complete Scan`));
  }
  if (record.schema_version !== EXPORT_SCHEMA_VERSION) {
    found.push(violation('EXPORT-001/1', index, `schema_version «${record.schema_version}» != «${EXPORT_SCHEMA_VERSION}»`));
  }
  return found;
}

/** Инвариант 2: UTC Z и started_at <= observed_at <= completed_at. */
function timestampViolations(record: ExportRecord, index: number): readonly SemanticViolation[] {
  const fields = [
    ['started_at', record.started_at],
    ['observed_at', record.observed_at],
    ['completed_at', record.completed_at],
  ] as const;
  const invalid = fields.filter(
    ([, value]) => !value.endsWith('Z') || Number.isNaN(Date.parse(value)),
  );
  if (invalid.length > 0) {
    return invalid.map(([field, value]) =>
      violation('EXPORT-001/2', index, `${field} «${value}» — не RFC3339 UTC с суффиксом Z`),
    );
  }
  const [started, observed, completed] = fields.map(([, value]) => Date.parse(value));
  if (!(started !== undefined && observed !== undefined && completed !== undefined)) {
    return []; // недостижимо: fields — фиксированная тройка (защита noUncheckedIndexedAccess)
  }
  if (started <= observed && observed <= completed) {
    return [];
  }
  return [
    violation(
      'EXPORT-001/2',
      index,
      `нарушен порядок started_at <= observed_at <= completed_at: ` +
        `${record.started_at} / ${record.observed_at} / ${record.completed_at}`,
    ),
  ];
}

function summaryViolations(record: SummaryRecord, index: number): readonly SemanticViolation[] {
  const found: SemanticViolation[] = [];
  const needsReason = record.scan_status !== 'Completed';
  found.push(...reasonViolations('summary', record.status_reason, needsReason, index));
  // Инвариант 5: summary score публикуется только при weighted coverage >= 0.50
  // и наличии usable output; NoUsableOutput/Insufficient data → score null.
  if (record.score !== null && record.coverage < SUMMARY_SCORE_MIN_COVERAGE - COVERAGE_EPSILON) {
    found.push(
      violation(
        'EXPORT-001/5',
        index,
        `summary score ${record.score} при weighted coverage ${record.coverage} < 0.50 (§15)`,
      ),
    );
  }
  return found;
}

function moduleViolations(record: ModuleRecord, index: number): readonly SemanticViolation[] {
  const needsReason = record.module_status !== 'Completed';
  return [
    ...reasonViolations(`module ${record.module}`, record.status_reason, needsReason, index),
    ...coverageViolations(record, index),
    ...moduleScoreViolations(record, index),
  ];
}

/** Инвариант 4: согласованность coverage со счётчиками и статусом. */
function coverageViolations(record: ModuleRecord, index: number): readonly SemanticViolation[] {
  const { applicable_checks: applicable, completed_applicable_checks: completed } = record;
  const label = `module ${record.module}`;
  if (completed > applicable) {
    return [violation('EXPORT-001/4', index, `${label}: completed ${completed} > applicable ${applicable}`)];
  }
  const found: SemanticViolation[] = [];
  const expectedCoverage = applicable > 0 ? completed / applicable : 0;
  if (Math.abs(record.coverage - expectedCoverage) > COVERAGE_EPSILON) {
    found.push(
      violation(
        'EXPORT-001/4',
        index,
        `${label}: coverage ${record.coverage} != completed/applicable = ${expectedCoverage}`,
      ),
    );
  }
  const statusProblem = moduleStatusMismatch(record);
  if (statusProblem !== null) {
    found.push(violation('EXPORT-001/4', index, `${label}: ${statusProblem}`));
  }
  return found;
}

/** Coverage/status contract v1 (§15): допустимые комбинации статуса и счётчиков. */
function moduleStatusMismatch(record: ModuleRecord): string | null {
  const { applicable_checks: applicable, completed_applicable_checks: completed } = record;
  switch (record.module_status) {
    case 'Completed':
      return applicable > 0 && completed === applicable
        ? null
        : `Completed требует applicable > 0 и completed = applicable (${completed}/${applicable})`;
    case 'Partial':
      return completed > 0 && completed < applicable
        ? null
        : `Partial требует 0 < completed < applicable (${completed}/${applicable})`;
    case 'Unavailable':
      return applicable > 0 && completed === 0
        ? null
        : `Unavailable требует applicable > 0 и completed = 0 (${completed}/${applicable})`;
    case 'Not applicable':
      return applicable === 0 ? null : `Not applicable требует applicable_checks = 0 (${applicable})`;
  }
}

/** Инвариант 5: score существует только у Completed/Partial с usable checks. */
function moduleScoreViolations(record: ModuleRecord, index: number): readonly SemanticViolation[] {
  if (record.score === null) {
    return []; // Unavailable / Not applicable / completed-but-unusable (§15).
  }
  const scoreEligible =
    (record.module_status === 'Completed' || record.module_status === 'Partial') &&
    record.completed_applicable_checks > 0;
  if (scoreEligible) {
    return [];
  }
  return [
    violation(
      'EXPORT-001/5',
      index,
      `module ${record.module}: score ${record.score} у статуса ${record.module_status} ` +
        `без завершённых применимых проверок запрещён (§15)`,
    ),
  ];
}

function aiResponseViolations(record: AiResponseRecord, index: number): readonly SemanticViolation[] {
  const needsReason = record.module_status !== 'Completed';
  const found = [...reasonViolations('ai_response', record.status_reason, needsReason, index)];
  const { input_tokens: input, output_tokens: output, total_tokens: total } = record.usage;
  // §1057/инвариант 10: total = input + output и estimated → tokenizer_version.
  if (total !== input + output) {
    found.push(
      violation('EXPORT-001/10', index, `usage.total_tokens ${total} != input ${input} + output ${output}`),
    );
  }
  if (
    record.usage_source === 'estimated' &&
    (record.tokenizer_version === null || record.tokenizer_version.trim() === '')
  ) {
    found.push(
      violation('EXPORT-001/10', index, 'usage_source=estimated требует непустой tokenizer_version'),
    );
  }
  return found;
}

function issueViolations(record: IssueRecord, index: number): readonly SemanticViolation[] {
  const label = `issue ${record.rule_id}`;
  const found: SemanticViolation[] = [];
  // Инвариант 3: причина живёт в module/ai_response record, у issue — всегда null.
  if (record.status_reason !== null) {
    found.push(violation('EXPORT-001/3', index, `${label}: status_reason у issue record обязан быть null`));
  }
  found.push(...issueTargetViolations(record, index, label));
  // Инвариант 7 (D-016): score_delta — точная противоположность агрегатного penalty.
  if (record.score_delta !== -record.rule_penalty) {
    found.push(
      violation(
        'EXPORT-001/7',
        index,
        `${label}: score_delta ${record.score_delta} != -rule_penalty (-${record.rule_penalty})`,
      ),
    );
  }
  found.push(...fingerprintViolations(record, index, label));
  return found;
}

/** Инвариант 6: affected <= applicable; site-level targets ровно 1/1. */
function issueTargetViolations(
  record: IssueRecord,
  index: number,
  label: string,
): readonly SemanticViolation[] {
  const found: SemanticViolation[] = [];
  if (record.affected_targets > record.applicable_targets) {
    found.push(
      violation(
        'EXPORT-001/6',
        index,
        `${label}: affected_targets ${record.affected_targets} > applicable_targets ${record.applicable_targets}`,
      ),
    );
  }
  const isSiteLevel = record.target_kind === 'site' || record.target_kind === 'environment';
  if (isSiteLevel && (record.applicable_targets !== 1 || record.affected_targets !== 1)) {
    found.push(
      violation(
        'EXPORT-001/6',
        index,
        `${label}: site-level targets обязаны быть 1/1, получено ` +
          `${record.affected_targets}/${record.applicable_targets}`,
      ),
    );
  }
  if (isSiteLevel && record.normalized_url !== '') {
    found.push(
      violation('D-019', index, `${label}: для site-level normalized_url — пустая строка`),
    );
  }
  return found;
}

/** Инвариант 8: fingerprint пересчитывается из точного набора восьми компонент. */
function fingerprintViolations(
  record: IssueRecord,
  index: number,
  label: string,
): readonly SemanticViolation[] {
  const recomputed = computeFingerprint({
    domain: record.domain,
    ruleId: record.rule_id,
    targetKind: record.target_kind,
    normalizedUrl: record.normalized_url,
    normalizedResource: record.normalized_resource,
    normalizedSelector: record.normalized_selector,
    normalizedParameter: record.normalized_parameter,
    ruleVariant: record.rule_variant,
  });
  if (recomputed === record.fingerprint) {
    return [];
  }
  return [
    violation(
      'EXPORT-001/8',
      index,
      `${label}: fingerprint ${record.fingerprint} не совпадает с пересчётом ${recomputed}`,
    ),
  ];
}

/** Инвариант 3: непустой reason для не-Completed веток, null — для обычного Completed. */
function reasonViolations(
  label: string,
  reason: string | null,
  needsReason: boolean,
  index: number,
): readonly SemanticViolation[] {
  if (needsReason && (reason === null || reason.trim() === '')) {
    return [violation('EXPORT-001/3', index, `${label}: не-Completed статус требует непустой status_reason`)];
  }
  if (!needsReason && reason !== null) {
    return [violation('EXPORT-001/3', index, `${label}: status_reason у обычного Completed обязан быть null`)];
  }
  return [];
}
