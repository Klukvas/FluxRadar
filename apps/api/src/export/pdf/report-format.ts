// How the report writes the values it repeats: a domain, a moment, a share, a
// plan name and the overall score. One source each, so the cover, the plan and
// the findings never state the same value two ways.

import type { ScanModule } from '@prisma/client';
import {
  isLegacyPlan,
  isModuleName,
  readStoredPlan,
  SIDE_SCORE_MODULES,
  storedPlanScoreWeights,
  type StoredPlan,
} from '@fluxradar/contracts';
import { computeStoredScanOverallScore } from '@fluxradar/scoring';

import type { ReportCopy } from './copy.ts';

export function displayDomain(domain: string): string {
  try {
    return new URL(domain).host;
  } catch {
    return domain;
  }
}

export function timestamp(value: Date | null): string {
  return value === null ? '—' : value.toISOString().replace('T', ' ').slice(0, 16);
}

/** A stored ISO moment written the way the rest of the document writes one. */
export function storedTimestamp(value: string | null): string | null {
  if (value === null || value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : timestamp(parsed);
}

export function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

/** The plan as the report names it; a retired plan is named as archived. */
export function planText(storedPlan: string, copy: ReportCopy): string {
  const plan = readStoredPlan(storedPlan);
  return isLegacyPlan(plan) ? copy.legacyPlans[plan] : plan;
}

/**
 * A section score as the report draws it: rounded, or null when the stored
 * value is not a number within 0..100. An out-of-range value is not clamped
 * into a believable one; the section is shown as not scored (and NaN would
 * fail inside PDFKit).
 */
export function clampScore(score: number | null): number | null {
  if (score === null || !Number.isFinite(score) || score < 0 || score > 100) return null;
  return Math.round(score);
}

/**
 * normal: drawn as the score. provisional: drawn with a "provisional" label,
 * as the browser report does. insufficient: no number, a sentence instead.
 */
export type ReportScoreVerdict = 'normal' | 'provisional' | 'insufficient';

export interface ReportOverallScore {
  readonly verdict: ReportScoreVerdict;
  /** 0..100; null when the verdict is `insufficient`. */
  readonly score: number | null;
}

const INSUFFICIENT: ReportOverallScore = { verdict: 'insufficient', score: null };

export type ModuleSummary = Parameters<typeof computeStoredScanOverallScore>[1][number];

function moduleSummaries(modules: readonly ScanModule[]): readonly ModuleSummary[] {
  return modules.flatMap((module) =>
    isModuleName(module.module)
      ? [
          {
            module: module.module,
            moduleStatus: module.runtimeStatus as ModuleSummary['moduleStatus'],
            coverage: module.coverage ?? 0,
            score: module.score,
            usableOutput: module.usableOutput,
          },
        ]
      : [],
  );
}

/**
 * The module sets the scoring package refuses by design: a duplicate row, a
 * score or coverage out of range, a section the plan does not weigh. The JSON
 * export enforces these by refusing the scan; the PDF states such a scan as
 * having too little data for an overall score instead of refusing the whole
 * document over one figure. Anything else the package throws is a defect and
 * propagates.
 */
export function scoringRefuses(plan: StoredPlan, summaries: readonly ModuleSummary[]): boolean {
  const names = summaries.map((summary) => summary.module);
  const weights = storedPlanScoreWeights(plan, names);
  const outOfRange = (value: number | null, max: number): boolean =>
    value !== null && (!Number.isFinite(value) || value < 0 || value > max);
  return (
    new Set(names).size !== names.length ||
    summaries.some(
      (summary) =>
        outOfRange(summary.score, 100) ||
        outOfRange(summary.coverage, 1) ||
        (weights[summary.module] === undefined && !SIDE_SCORE_MODULES.includes(summary.module)),
    )
  );
}

/**
 * The overall score exactly as the export records derive it (build-records.ts):
 * the module summaries through the scoring package. For every current plan
 * `computeStoredScanOverallScore` is `computeOverallScore(parsePlan(...))`; a
 * retired plan reads its weights from the stored modules instead of failing.
 */
export function reportOverallScore(
  plan: string,
  modules: readonly ScanModule[],
): ReportOverallScore {
  const storedPlan = readStoredPlan(plan);
  const summaries = moduleSummaries(modules);
  if (scoringRefuses(storedPlan, summaries)) return INSUFFICIENT;
  const overall = computeStoredScanOverallScore(storedPlan, summaries);
  const score = clampScore(overall.score);
  if (overall.verdict === 'insufficient_data' || score === null) return INSUFFICIENT;
  return { verdict: overall.verdict, score };
}
