// @fluxradar/scoring — чистый score engine плана §15 (T-04): без I/O,
// детерминированные функции над результатами rule engine и модулей.

export { round2 } from './round2.js';

export { computeModuleScore } from './module-score.js';
export type { ModuleScoreResult, RulePenalty, ScoredFinding } from './module-score.js';

export { computeCoverage } from './coverage.js';
export type { CoverageInput, ModuleCoverage } from './coverage.js';

export { hasUsableOutput } from './usable-output.js';
export type { ModuleOutputSignal, OutputSignalKind, UsableOutputInput } from './usable-output.js';

export {
  WEIGHTED_COVERAGE_NORMAL_MIN,
  WEIGHTED_COVERAGE_PROVISIONAL_MIN,
  computeOverallScore,
} from './overall-score.js';
export type {
  ModuleScoreSummary,
  ModuleWeightBreakdown,
  OverallScoreResult,
  OverallVerdict,
} from './overall-score.js';
