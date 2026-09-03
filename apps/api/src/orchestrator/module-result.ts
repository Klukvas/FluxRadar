// Финализация одного rules-модуля: coverage (§15 contract), module score
// (T-04), usable output (§18 + D-026) и материал Issue-строк. Единственная
// нетривиальная политика здесь — D-026 на уровне скана: если НИ ОДНА страница
// обхода не загрузилась, любые findings деривативны от недоступности цели и
// usable output не создают (сигналы помечаются targetUnreachable).

import type { ModuleName, Plan, Severity } from '@fluxradar/contracts';
import { ruleById } from '@fluxradar/contracts';
import type { IssueCandidate, ModuleRunResult } from '@fluxradar/rules';
import type { ModuleOutputSignal } from '@fluxradar/scoring';
import { computeCoverage, computeModuleScore, hasUsableOutput } from '@fluxradar/scoring';

export const MODULE_STATUS_REASONS = {
  noApplicableTargets: 'NoApplicableTargets',
  targetsUnreachable: 'TargetsUnreachable',
  targetsPartiallyUnreachable: 'TargetsPartiallyUnreachable',
} as const;

export interface FinalizedModule {
  readonly runtimeStatus: string;
  readonly statusReason: string | null;
  readonly coverage: number;
  readonly score: number | null;
  readonly applicableChecks: number;
  readonly completedApplicableChecks: number;
  readonly usableOutput: boolean;
  /** Агрегатный penalty правила (D-016) — одинаков у всех issues одного rule_id. */
  readonly rulePenaltyByRule: ReadonlyMap<string, number>;
}

function statusReasonFor(applicable: number, completed: number): string | undefined {
  if (applicable === 0) {
    return MODULE_STATUS_REASONS.noApplicableTargets;
  }
  if (completed === 0) {
    return MODULE_STATUS_REASONS.targetsUnreachable;
  }
  if (completed < applicable) {
    return MODULE_STATUS_REASONS.targetsPartiallyUnreachable;
  }
  // Обычный Completed обязан иметь status_reason = null (§15/§16).
  return undefined;
}

function outputSignals(result: ModuleRunResult, siteReachable: boolean): readonly ModuleOutputSignal[] {
  const findingSignals = result.findings.map((finding) => ({
    kind: 'finding' as const,
    hasEvidence: finding.evidenceType !== 'none' || finding.evidenceExcerpt !== '',
    // D-026: на полностью недоступном сайте каждый finding — производная
    // недоступности цели и в usable output не засчитывается.
    targetUnreachable: siteReachable ? finding.targetUnreachable === true : true,
  }));
  // Сам вычисленный score/вердикт модуля — валидный сохранённый результат
  // (§18: «валидный metric, score или finding»), но только на достижимом сайте.
  return [...findingSignals, { kind: 'score', hasEvidence: siteReachable }];
}

export function finalizeRuleModule(
  result: ModuleRunResult,
  plan: Plan,
  siteReachable: boolean,
): FinalizedModule {
  const { applicableChecks, completedApplicableChecks } = result;
  const reason = statusReasonFor(applicableChecks, completedApplicableChecks);
  const coverage = computeCoverage({
    applicableChecks,
    completedApplicableChecks,
    ...(reason !== undefined ? { statusReason: reason } : {}),
  });

  // Free score не рассчитывается (§15); score существует только у Completed/Partial.
  const scoreEligible =
    plan !== 'Free' && (coverage.status === 'Completed' || coverage.status === 'Partial');
  const scoreResult = scoreEligible ? computeModuleScore(result.findings) : null;

  const usableOutput = hasUsableOutput({
    completedApplicableChecks,
    signals: outputSignals(result, siteReachable),
  });

  return {
    runtimeStatus: coverage.status,
    statusReason: coverage.statusReason,
    coverage: coverage.coverage,
    score: scoreResult?.score ?? null,
    applicableChecks,
    completedApplicableChecks,
    usableOutput,
    rulePenaltyByRule: new Map(
      (scoreResult?.rulePenalties ?? []).map((penalty) => [penalty.ruleId, penalty.penalty]),
    ),
  };
}

/** Данные для prisma.issue.createMany (без начального статуса — его даёт issue-sync). */
export interface IssueRowData {
  readonly scanId: string;
  readonly ruleId: string;
  readonly module: string;
  readonly fingerprint: string;
  readonly severity: Severity;
  readonly category: string;
  readonly targetKind: string;
  readonly normalizedUrl: string;
  readonly normalizedResource: string;
  readonly normalizedSelector: string;
  readonly normalizedParameter: string;
  readonly ruleVariant: string;
  readonly targetUrl: string;
  readonly evidenceType: string;
  readonly evidenceExcerpt: string | null;
  readonly evidenceGroupId: string | null;
  readonly recommendation: string;
  readonly confidence: number;
  readonly applicableTargets: number;
  readonly affectedTargets: number;
  readonly rulePenalty: number;
  readonly scoreDelta: number;
  readonly observedAt: Date;
}

export function issueRowsForModule(
  scanId: string,
  module: ModuleName,
  candidates: readonly IssueCandidate[],
  finalized: FinalizedModule,
  observedAt: Date,
): readonly IssueRowData[] {
  return candidates.flatMap((candidate) => {
    if (candidate.severity === null) {
      // Informational-правила (D-109) не образуют Issue-строк: у issue record
      // §16 severity обязателен, а score_delta таких находок всегда 0.
      return [];
    }
    const descriptor = ruleById(candidate.ruleId);
    const penalty = finalized.rulePenaltyByRule.get(candidate.ruleId) ?? 0;
    return [
      {
        scanId,
        ruleId: candidate.ruleId,
        module,
        fingerprint: candidate.fingerprint,
        severity: candidate.severity,
        category: descriptor?.category ?? module,
        targetKind: candidate.targetKind,
        normalizedUrl: candidate.normalizedUrl,
        normalizedResource: candidate.normalizedResource,
        normalizedSelector: candidate.normalizedSelector,
        normalizedParameter: candidate.normalizedParameter,
        ruleVariant: candidate.ruleVariant,
        targetUrl: candidate.targetUrl,
        evidenceType: candidate.evidenceType,
        evidenceExcerpt: candidate.evidenceExcerpt === '' ? null : candidate.evidenceExcerpt,
        evidenceGroupId: candidate.evidenceGroupId ?? null,
        recommendation: candidate.recommendation,
        confidence: candidate.confidence,
        applicableTargets: candidate.applicableTargets,
        affectedTargets: candidate.affectedTargets,
        rulePenalty: penalty,
        // D-016: score_delta = −агрегатный penalty; −0 нормализуется в 0.
        scoreDelta: penalty === 0 ? 0 : -penalty,
        observedAt,
      },
    ];
  });
}
