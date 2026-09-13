// What each rule of a module did in one run, for the report's check list.
//
// A module row already carries its totals — applicable and completed checks —
// but a total cannot answer "which checks ran, and which of them found
// something". The counts here are the engine's own per-rule aggregates, and the
// title comes from the registry, so the report names a check the same way the
// rest of the product does.

import { ruleById } from '@fluxradar/contracts';
import type { RuleDescriptor } from '@fluxradar/contracts';
import type { ModuleRunResult } from '@fluxradar/rules';

export interface RuleCheckSummary {
  readonly ruleId: string;
  readonly title: string;
  readonly targetKind: RuleDescriptor['targetKind'];
  readonly scoring: RuleDescriptor['scoring'];
  readonly applicableTargets: number;
  readonly affectedTargets: number;
}

/**
 * One summary per evaluated rule, in the engine's order.
 *
 * A rule with no applicable target stays in the list: "nothing on these pages
 * matched this check" is part of what the section did, and dropping it would
 * make a check that never looked indistinguishable from one that was never run.
 */
export function ruleCheckSummaries(
  evaluations: ModuleRunResult['evaluations'],
): readonly RuleCheckSummary[] {
  return evaluations.map((evaluation) => {
    const descriptor = ruleById(evaluation.ruleId);
    if (descriptor === undefined) {
      throw new Error(`rule-checks: ${evaluation.ruleId} отсутствует в реестре`);
    }
    return {
      ruleId: evaluation.ruleId,
      title: descriptor.title,
      targetKind: descriptor.targetKind,
      scoring: descriptor.scoring,
      applicableTargets: evaluation.applicableTargets,
      affectedTargets: evaluation.affectedTargets,
    };
  });
}
