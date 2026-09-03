// Общий score по §15: effective_weight_i = tariff_weight_i × coverage_i при
// usable output, иначе 0; weighted_coverage делится на Σ tariff weights ВСЕХ
// модулей тарифа (включая Unavailable / Not applicable / completed-but-unusable);
// в итоговую дробь входят только модули с ew > 0 и числовым score. Пороги
// 0.80 / 0.50 одинаковы для Complete и Basic (D-017). UX/Conversion и Analytics
// не имеют tariff weight (SIDE_SCORE_MODULES) и в общий score не входят.

import type { ModuleExportStatus, ModuleName, Plan } from '@fluxradar/contracts';
import { MODULE_NAMES, SIDE_SCORE_MODULES, TARIFFS } from '@fluxradar/contracts';

import { round2 } from './round2.js';

/** Per-module вход общего score; поля соответствуют module export record. */
export interface ModuleScoreSummary {
  readonly module: ModuleName;
  readonly moduleStatus: ModuleExportStatus;
  /** Точный coverage 0..1 (из computeCoverage). */
  readonly coverage: number;
  /** null для Unavailable / Not applicable / completed-but-unusable. */
  readonly score: number | null;
  readonly usableOutput: boolean;
}

export type OverallVerdict = 'normal' | 'provisional' | 'insufficient_data';

export interface ModuleWeightBreakdown {
  readonly module: ModuleName;
  readonly tariffWeight: number;
  readonly effectiveWeight: number;
}

export interface OverallScoreResult {
  readonly verdict: OverallVerdict;
  /** round2 от взвешенного среднего; null при insufficient_data. */
  readonly score: number | null;
  /** Точное значение; для отображения округлять через round2. */
  readonly weightedCoverage: number;
  /** Все модули тарифа со score weight — применённые веса для отчёта (§15). */
  readonly moduleWeights: readonly ModuleWeightBreakdown[];
}

export const WEIGHTED_COVERAGE_NORMAL_MIN = 0.8;
export const WEIGHTED_COVERAGE_PROVISIONAL_MIN = 0.5;
/** Поглощает двоичный float-шум при сравнении с порогами (D-122). */
const THRESHOLD_EPSILON = 1e-9;

export function computeOverallScore(
  plan: Plan,
  modules: readonly ModuleScoreSummary[],
): OverallScoreResult {
  const scoreWeights = TARIFFS[plan].scoreWeights;
  const summaryByModule = indexByModule(plan, modules, scoreWeights);
  const moduleWeights = buildModuleWeights(scoreWeights, summaryByModule);
  const tariffWeightTotal = sumBy(moduleWeights, (entry) => entry.tariffWeight);
  const effectiveWeightTotal = sumBy(moduleWeights, (entry) => entry.effectiveWeight);
  if (tariffWeightTotal <= 0) {
    // Free / пустой тариф: нулевой знаменатель — Insufficient data, не исключение (D-123).
    return { verdict: 'insufficient_data', score: null, weightedCoverage: 0, moduleWeights };
  }
  const weightedCoverage = effectiveWeightTotal / tariffWeightTotal;
  const verdict = verdictFor(weightedCoverage);
  const score =
    verdict === 'insufficient_data' ? null : weightedScore(moduleWeights, summaryByModule);
  if (score === null) {
    return { verdict: 'insufficient_data', score: null, weightedCoverage, moduleWeights };
  }
  return { verdict, score, weightedCoverage, moduleWeights };
}

function verdictFor(weightedCoverage: number): OverallVerdict {
  if (weightedCoverage >= WEIGHTED_COVERAGE_NORMAL_MIN - THRESHOLD_EPSILON) {
    return 'normal';
  }
  if (weightedCoverage >= WEIGHTED_COVERAGE_PROVISIONAL_MIN - THRESHOLD_EPSILON) {
    return 'provisional';
  }
  return 'insufficient_data';
}

function indexByModule(
  plan: Plan,
  modules: readonly ModuleScoreSummary[],
  scoreWeights: Readonly<Partial<Record<ModuleName, number>>>,
): ReadonlyMap<ModuleName, ModuleScoreSummary> {
  const byModule = new Map<ModuleName, ModuleScoreSummary>();
  for (const summary of modules) {
    validateSummary(summary);
    if (scoreWeights[summary.module] === undefined) {
      if (SIDE_SCORE_MODULES.includes(summary.module)) {
        continue; // §15: побочные оценки 0–100 показываются отдельно.
      }
      throw new Error(`Модуль ${summary.module} не входит в score тарифа ${plan}`);
    }
    if (byModule.has(summary.module)) {
      throw new Error(`Дубликат модуля ${summary.module} во входе общего score`);
    }
    byModule.set(summary.module, summary);
  }
  return byModule;
}

/** Модуль тарифа без входной записи получает effective weight 0. */
function buildModuleWeights(
  scoreWeights: Readonly<Partial<Record<ModuleName, number>>>,
  summaryByModule: ReadonlyMap<ModuleName, ModuleScoreSummary>,
): readonly ModuleWeightBreakdown[] {
  return MODULE_NAMES.flatMap((module) => {
    const tariffWeight = scoreWeights[module];
    if (tariffWeight === undefined) {
      return [];
    }
    const summary = summaryByModule.get(module);
    const effectiveWeight =
      summary !== undefined && isScoreEligible(summary) ? tariffWeight * summary.coverage : 0;
    return [{ module, tariffWeight, effectiveWeight }];
  });
}

/**
 * effective weight > 0 только при usable output и терминальном Completed/Partial;
 * Unavailable / Not applicable дают 0 независимо от переданного coverage (§15).
 */
function isScoreEligible(summary: ModuleScoreSummary): boolean {
  return (
    summary.usableOutput &&
    (summary.moduleStatus === 'Completed' || summary.moduleStatus === 'Partial')
  );
}

function weightedScore(
  moduleWeights: readonly ModuleWeightBreakdown[],
  summaryByModule: ReadonlyMap<ModuleName, ModuleScoreSummary>,
): number | null {
  const scored = moduleWeights.flatMap((entry) => {
    if (entry.effectiveWeight <= 0) {
      return [];
    }
    const score = summaryByModule.get(entry.module)?.score;
    return typeof score === 'number' ? [{ score, effectiveWeight: entry.effectiveWeight }] : [];
  });
  const weightTotal = sumBy(scored, (entry) => entry.effectiveWeight);
  if (weightTotal <= 0) {
    return null;
  }
  return round2(sumBy(scored, (entry) => entry.score * entry.effectiveWeight) / weightTotal);
}

function validateSummary(summary: ModuleScoreSummary): void {
  const { module, coverage, score } = summary;
  if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1) {
    throw new Error(`Модуль ${module}: coverage должен быть в [0, 1], получено ${coverage}`);
  }
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) {
    throw new Error(`Модуль ${module}: score должен быть null или в [0, 100], получено ${score}`);
  }
}

function sumBy<T>(items: readonly T[], select: (item: T) => number): number {
  return items.reduce((total, item) => total + select(item), 0);
}
