// Scoring issue rows that were built outside the rule engine — UX/Conversion
// (D-218) and Analytics (D-219). Both already know each rule's aggregates; this
// is the one place that turns them into the §15 module score and stamps every
// row of a rule with the rule's penalty, so an export can recompute it (D-016).

import { TARGET_KINDS, type TargetKind } from '@fluxradar/contracts';
import { computeModuleScore } from '@fluxradar/scoring';

import type { IssueRowData } from './module-result.ts';

export interface ScoredIssueRows {
  /** `round2(max(0, 100 − Σ rule_penalty))`, 100 when there are no rows. */
  readonly score: number;
  readonly issueRows: readonly IssueRowData[];
}

/**
 * Deduplicates by fingerprint (the last row of a fingerprint wins, as the UX
 * writer always did), scores what is left and returns the rows with their
 * rule's penalty and score delta filled in.
 */
export function scoreIssueRows(rows: readonly IssueRowData[]): ScoredIssueRows {
  const unique = [...new Map(rows.map((row) => [row.fingerprint, row])).values()];
  const { score, rulePenalties } = computeModuleScore(
    unique.map((row) => ({
      ruleId: row.ruleId,
      fingerprint: row.fingerprint,
      severity: row.severity,
      scoreDelta: 'scored' as const,
      targetKind: targetKindOf(row),
      affectedTargets: row.affectedTargets,
      applicableTargets: row.applicableTargets,
    })),
  );
  const penaltyByRule = new Map(rulePenalties.map((rule) => [rule.ruleId, rule.penalty]));
  return {
    score,
    issueRows: unique.map((row) => {
      const penalty = penaltyByRule.get(row.ruleId) ?? 0;
      return { ...row, rulePenalty: penalty, scoreDelta: penalty === 0 ? 0 : -penalty };
    }),
  };
}

function targetKindOf(row: IssueRowData): TargetKind {
  const kind = TARGET_KINDS.find((candidate) => candidate === row.targetKind);
  if (kind === undefined) {
    throw new Error(`issue ${row.ruleId}: unknown target kind ${row.targetKind}`);
  }
  return kind;
}
