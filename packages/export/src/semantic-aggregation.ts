// Агрегатные проверки EXPORT-001 (инвариант 9 + D-016/§15): уникальность
// fingerprint, согласованность агрегатов правила между records, пересчёт
// rule_penalty той же integer-hundredths математикой, что и score engine
// (computeModuleScore, D-119), metric_key-контракт performance-правил.
// Плюс дешёвые наборные проверки из инварианта 13: один summary на snapshot
// (D-024) и один scan_id на весь набор.

import type { ExportRecord, IssueRecord } from '@fluxradar/contracts';
import type { ScoredFinding } from '@fluxradar/scoring';
import { computeModuleScore } from '@fluxradar/scoring';

import type { SemanticViolation } from './semantic-validator.js';

interface IndexedIssue {
  readonly record: IssueRecord;
  readonly index: number;
}

/** Rule_id правил Performance (§7); других PERF-источников metric_key нет. */
const PERFORMANCE_RULE_PREFIX = 'PERF-';

export function aggregateViolations(
  records: readonly ExportRecord[],
): readonly SemanticViolation[] {
  const issues = records.flatMap((record, index) =>
    record.record_type === 'issue' ? [{ record, index }] : [],
  );
  return [
    ...setViolations(records),
    ...fingerprintUniquenessViolations(issues),
    ...issues.flatMap(({ record, index }) => metricKeyViolations(record, index)),
    ...ruleGroupViolations(issues),
    ...unusableModuleViolations(records, issues),
  ];
}

/** Инвариант 13 (частично, D-024): один summary и один scan_id внутри snapshot-а. */
function setViolations(records: readonly ExportRecord[]): readonly SemanticViolation[] {
  const found: SemanticViolation[] = [];
  const summaryCount = records.filter((record) => record.record_type === 'summary').length;
  if (summaryCount > 1) {
    found.push({
      invariant: 'EXPORT-001/13',
      recordIndex: null,
      message: `в snapshot ${summaryCount} summary records — terminal record должен быть один (D-024)`,
    });
  }
  const scanIds = [...new Set(records.map((record) => record.scan_id))];
  if (scanIds.length > 1) {
    found.push({
      invariant: 'EXPORT-001/13',
      recordIndex: null,
      message: `records смешивают сканы: ${scanIds.join(', ')}`,
    });
  }
  return found;
}

/** Инвариант 9: один fingerprint не может быть посчитан дважды. */
function fingerprintUniquenessViolations(
  issues: readonly IndexedIssue[],
): readonly SemanticViolation[] {
  const firstSeen = new Map<string, number>();
  const found: SemanticViolation[] = [];
  for (const { record, index } of issues) {
    const previous = firstSeen.get(record.fingerprint);
    if (previous !== undefined) {
      found.push({
        invariant: 'EXPORT-001/9',
        recordIndex: index,
        message: `fingerprint ${record.fingerprint} дублирует record #${previous} — считается дважды`,
      });
    } else {
      firstSeen.set(record.fingerprint, index);
    }
  }
  return found;
}

/**
 * Инвариант 9 (metric-часть): performance-правила обязаны нести канонический
 * metric_key `normalized_url|profile|cache_mode|metric_name`, закодированный
 * и в rule_variant; у остальных правил metric_key = null (§16).
 */
function metricKeyViolations(record: IssueRecord, index: number): readonly SemanticViolation[] {
  const label = `issue ${record.rule_id}`;
  if (!record.rule_id.startsWith(PERFORMANCE_RULE_PREFIX)) {
    return record.metric_key === null
      ? []
      : [
          {
            invariant: 'EXPORT-001/9',
            recordIndex: index,
            message: `${label}: metric_key у non-performance issue обязан быть null (§16)`,
          },
        ];
  }
  const problem = performanceMetricKeyProblem(record);
  if (problem === null) {
    return [];
  }
  return [{ invariant: 'EXPORT-001/9', recordIndex: index, message: `${label}: ${problem}` }];
}

function performanceMetricKeyProblem(record: IssueRecord): string | null {
  const key = record.metric_key;
  if (key === null || key === '') {
    return 'performance issue требует непустой metric_key';
  }
  const parts = key.split('|');
  if (parts.length !== 4 || parts.slice(1).some((part) => part === '')) {
    return `metric_key «${key}» не в канонической форме normalized_url|profile|cache_mode|metric_name`;
  }
  if (parts[0] !== record.normalized_url) {
    return `metric_key url «${parts[0] ?? ''}» != normalized_url «${record.normalized_url}»`;
  }
  if (!record.rule_variant.includes(key)) {
    return `rule_variant «${record.rule_variant}» не кодирует metric_key «${key}»`;
  }
  return null;
}

/**
 * D-016 + инвариант 9: агрегаты правила одинаковы у всех его records, а
 * rule_penalty совпадает с пересчётом формулы §15 (max severity per rule,
 * severity weight × min(1, affected/applicable), half-up в сотых — D-119).
 * rule_penalty = 0 — explicit non-scoring resolver, формула не применяется.
 */
function ruleGroupViolations(issues: readonly IndexedIssue[]): readonly SemanticViolation[] {
  const byRule = groupBy(issues, ({ record }) => record.rule_id);
  const consistency = [...byRule.values()].flatMap(groupConsistencyViolations);
  if (consistency.length > 0) {
    return consistency; // пересчёт формулы по рассинхронённым агрегатам бессмыслен
  }
  const byModule = groupBy(issues, ({ record }) => record.module);
  return [...byModule.values()].flatMap(modulePenaltyViolations);
}

function groupConsistencyViolations(group: readonly IndexedIssue[]): readonly SemanticViolation[] {
  const [first, ...rest] = group;
  if (first === undefined) {
    return [];
  }
  const fields = [
    ['module', (record: IssueRecord) => record.module],
    ['target_kind', (record: IssueRecord) => record.target_kind],
    ['rule_penalty', (record: IssueRecord) => record.rule_penalty],
    ['applicable_targets', (record: IssueRecord) => record.applicable_targets],
    ['affected_targets', (record: IssueRecord) => record.affected_targets],
  ] as const;
  return rest.flatMap(({ record, index }) =>
    fields.flatMap(([field, read]) =>
      read(record) === read(first.record)
        ? []
        : [
            {
              invariant: 'EXPORT-001/9',
              recordIndex: index,
              message:
                `issue ${record.rule_id}: ${field} ${String(read(record))} расходится с ` +
                `record #${first.index} (${String(read(first.record))}) — агрегат правила един (D-016)`,
            },
          ],
    ),
  );
}

/** Пересчёт агрегатных penalty модуля тем же движком, что считал score (D-119). */
function modulePenaltyViolations(moduleIssues: readonly IndexedIssue[]): readonly SemanticViolation[] {
  const scored = moduleIssues.filter(({ record }) => record.rule_penalty > 0);
  if (scored.length === 0) {
    return [];
  }
  const moduleName = scored[0]?.record.module ?? '';
  const findings: readonly ScoredFinding[] = scored.map(({ record }) => ({
    ruleId: record.rule_id,
    fingerprint: record.fingerprint,
    severity: record.severity,
    scoreDelta: 'scored',
    targetKind: record.target_kind,
    affectedTargets: record.affected_targets,
    applicableTargets: record.applicable_targets,
  }));
  try {
    const { rulePenalties } = computeModuleScore(findings);
    const expectedByRule = new Map(rulePenalties.map((entry) => [entry.ruleId, entry.penalty]));
    return scored.flatMap(({ record, index }) => {
      const expected = expectedByRule.get(record.rule_id);
      if (expected === undefined || expected === record.rule_penalty) {
        return [];
      }
      return [
        {
          invariant: 'EXPORT-001/9',
          recordIndex: index,
          message:
            `issue ${record.rule_id}: rule_penalty ${record.rule_penalty} != пересчёту §15 ` +
            `(${expected} = weight(${record.severity}) × min(1, ` +
            `${record.affected_targets}/${record.applicable_targets}), half-up в сотых)`,
        },
      ];
    });
  } catch (error) {
    // computeModuleScore бросает на входе, невозможном для валидного набора
    // records, — переводим в violation, не глотая деталей.
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        invariant: 'EXPORT-001/9',
        recordIndex: null,
        message: `модуль ${moduleName}: пересчёт penalty невозможен — ${message}`,
      },
    ];
  }
}

/**
 * Инвариант 5 (cross-record): completed-but-unusable модуль (Completed,
 * score null) существует только без issue records (§15 coverage contract).
 */
function unusableModuleViolations(
  records: readonly ExportRecord[],
  issues: readonly IndexedIssue[],
): readonly SemanticViolation[] {
  const unusableModules = new Set(
    records.flatMap((record) =>
      record.record_type === 'module' && record.module_status === 'Completed' && record.score === null
        ? [record.module]
        : [],
    ),
  );
  if (unusableModules.size === 0) {
    return [];
  }
  return issues.flatMap(({ record, index }) =>
    unusableModules.has(record.module)
      ? [
          {
            invariant: 'EXPORT-001/5',
            recordIndex: index,
            message:
              `issue ${record.rule_id}: completed-but-unusable модуль ${record.module} ` +
              `не может иметь issue records (§15)`,
          },
        ]
      : [],
  );
}

function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): ReadonlyMap<K, readonly T[]> {
  const groups = new Map<K, readonly T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}
