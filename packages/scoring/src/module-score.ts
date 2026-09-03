// Module score по плану §15: dedup по fingerprint → max severity per rule
// (D-020) → rule_penalty → module_score = round2(max(0, 100 − Σ rule_penalty)).
// Весь расчёт идёт в целых сотых (integer hundredths), чтобы исключить
// накопление float-ошибок (риск из T-04); см. D-119.

import type { RuleScoring, Severity, TargetKind } from '@fluxradar/contracts';
import { SEVERITY_WEIGHTS } from '@fluxradar/contracts';

/**
 * Один finding после rule engine, готовый к score-агрегации.
 * `affectedTargets`/`applicableTargets` — агрегаты уровня правила (D-016):
 * у всех findings одного `ruleId` значения совпадают; для site-level оба
 * равны 1 (§15). `scoreDelta: 'informational'` — явный score_delta=0 от
 * resolver-а, такой finding не входит в Σ rule_penalty.
 */
export interface ScoredFinding {
  readonly ruleId: string;
  readonly fingerprint: string;
  /** null допустим только для informational findings (D-109). */
  readonly severity: Severity | null;
  readonly scoreDelta: RuleScoring;
  readonly targetKind: TargetKind;
  readonly affectedTargets: number;
  readonly applicableTargets: number;
}

/**
 * Агрегатный penalty правила — один и тот же для всех issue records этого
 * `ruleId` (D-016); суммирование по records запрещено, UI показывает вклад
 * на уровне правила.
 */
export interface RulePenalty {
  readonly ruleId: string;
  /** Максимальная severity среди уникальных scored findings правила (D-020). */
  readonly severity: Severity;
  readonly affectedTargets: number;
  readonly applicableTargets: number;
  /** Точное значение в двух десятичных знаках (считался в целых сотых). */
  readonly penalty: number;
}

export interface ModuleScoreResult {
  /** `round2(max(0, 100 − Σ rule_penalty))`; точен в двух знаках. */
  readonly score: number;
  /** Разбор по правилам (отсортирован по ruleId): Σ penalty = 100 − score до клэмпа. */
  readonly rulePenalties: readonly RulePenalty[];
}

/** Site-level по §15 — полный вес без доли targets; 'api' — page-level (D-120). */
const SITE_LEVEL_TARGET_KINDS: readonly TargetKind[] = ['site', 'environment'];

const MAX_MODULE_SCORE_HUNDREDTHS = 100 * 100;

export function computeModuleScore(findings: readonly ScoredFinding[]): ModuleScoreResult {
  findings.forEach(validateFinding);
  const uniqueScored = dedupByFingerprint(
    findings.filter((finding) => finding.scoreDelta === 'scored'),
  );
  const rulePenalties = [...groupByRuleId(uniqueScored).entries()]
    .map(([ruleId, ruleFindings]) => aggregateRulePenalty(ruleId, ruleFindings))
    .sort((a, b) => (a.ruleId < b.ruleId ? -1 : 1));
  const totalPenaltyHundredths = rulePenalties.reduce(
    (sum, rule) => sum + Math.round(rule.penalty * 100),
    0,
  );
  const scoreHundredths = Math.max(0, MAX_MODULE_SCORE_HUNDREDTHS - totalPenaltyHundredths);
  return { score: scoreHundredths / 100, rulePenalties };
}

/** Повторы одного fingerprint считаются один раз (§15); первый выигрывает. */
function dedupByFingerprint(findings: readonly ScoredFinding[]): readonly ScoredFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    if (seen.has(finding.fingerprint)) {
      return false;
    }
    seen.add(finding.fingerprint);
    return true;
  });
}

function groupByRuleId(
  findings: readonly ScoredFinding[],
): ReadonlyMap<string, readonly ScoredFinding[]> {
  const groups = new Map<string, readonly ScoredFinding[]>();
  for (const finding of findings) {
    groups.set(finding.ruleId, [...(groups.get(finding.ruleId) ?? []), finding]);
  }
  return groups;
}

function aggregateRulePenalty(ruleId: string, ruleFindings: readonly ScoredFinding[]): RulePenalty {
  const [first, ...rest] = ruleFindings;
  if (first === undefined) {
    throw new Error(`Правило ${ruleId} без findings — ошибка группировки`);
  }
  if (rest.some((finding) => finding.targetKind !== first.targetKind)) {
    throw new Error(`Правило ${ruleId}: findings с разными targetKind`);
  }
  const severity = maxSeverity(ruleId, ruleFindings);
  // D-121: берём максимум агрегатов по findings правила — по контракту D-016
  // они совпадают, максимум даёт детерминизм при рассинхроне входа.
  const affectedTargets = Math.max(...ruleFindings.map((finding) => finding.affectedTargets));
  const applicableTargets = Math.max(...ruleFindings.map((finding) => finding.applicableTargets));
  const weightHundredths = SEVERITY_WEIGHTS[severity] * 100;
  const penaltyHundredths = SITE_LEVEL_TARGET_KINDS.includes(first.targetKind)
    ? weightHundredths
    : pageLevelPenaltyHundredths(weightHundredths, affectedTargets, applicableTargets);
  return {
    ruleId,
    severity,
    affectedTargets,
    applicableTargets,
    penalty: penaltyHundredths / 100,
  };
}

/**
 * `severity_weight × min(1, affected / applicable)` в целых сотых:
 * `floor((2n + d) / 2d)` — точное целочисленное деление с half-up (D-021/D-119).
 */
function pageLevelPenaltyHundredths(
  weightHundredths: number,
  affectedTargets: number,
  applicableTargets: number,
): number {
  if (affectedTargets >= applicableTargets) {
    return weightHundredths;
  }
  const numerator = weightHundredths * affectedTargets;
  return Math.floor((2 * numerator + applicableTargets) / (2 * applicableTargets));
}

function maxSeverity(ruleId: string, ruleFindings: readonly ScoredFinding[]): Severity {
  const severities = ruleFindings
    .map((finding) => finding.severity)
    .filter((severity): severity is Severity => severity !== null);
  const [first, ...rest] = severities;
  if (first === undefined || severities.length !== ruleFindings.length) {
    throw new Error(`Правило ${ruleId}: scored finding без severity (нарушение D-109)`);
  }
  return rest.reduce(
    (max, severity) => (SEVERITY_WEIGHTS[severity] > SEVERITY_WEIGHTS[max] ? severity : max),
    first,
  );
}

function validateFinding(finding: ScoredFinding): void {
  const { ruleId, fingerprint, severity, scoreDelta, targetKind } = finding;
  const label = `${ruleId || '<без ruleId>'}`;
  if (ruleId === '' || fingerprint === '') {
    throw new Error(`Finding ${label}: ruleId и fingerprint обязательны`);
  }
  if (scoreDelta === 'scored' && severity === null) {
    throw new Error(`Finding ${label}: scored finding обязан иметь severity (D-109)`);
  }
  validateTargetCounts(finding, label);
  if (
    SITE_LEVEL_TARGET_KINDS.includes(targetKind) &&
    (finding.affectedTargets !== 1 || finding.applicableTargets !== 1)
  ) {
    throw new Error(`Finding ${label}: для site-level affected и applicable targets равны 1 (§15)`);
  }
}

function validateTargetCounts(finding: ScoredFinding, label: string): void {
  for (const [name, value] of [
    ['affectedTargets', finding.affectedTargets],
    ['applicableTargets', finding.applicableTargets],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Finding ${label}: ${name} должен быть целым >= 0, получено ${value}`);
    }
  }
  if (finding.scoreDelta === 'scored' && finding.applicableTargets < 1) {
    // §15: rule с applicable_targets=0 — Not applicable и не имеет scored findings.
    throw new Error(`Finding ${label}: scored finding с applicable_targets=0 невозможен (§15)`);
  }
}
