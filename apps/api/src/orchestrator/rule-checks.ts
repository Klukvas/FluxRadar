// What each rule of a module did in one run, for the report's check list.
//
// A module row already carries its totals — applicable and completed checks —
// but a total cannot answer "which checks ran, and which of them found
// something". The counts here are the engine's own per-rule aggregates, and the
// title comes from the registry, so the report names a check the same way the
// rest of the product does.

import type { UxAiResponseResult } from '@fluxradar/ai';
import { ruleById } from '@fluxradar/contracts';
import type { RuleDescriptor } from '@fluxradar/contracts';
import type { ModuleRunResult, UxStaticEvidence } from '@fluxradar/rules';

interface RuleCounts {
  readonly ruleId: string;
  readonly applicableTargets: number;
  readonly affectedTargets: number;
}

const UX_AI_RULE_IDS = ['UX-CONV-AI-001', 'UX-CONV-AI-002', 'UX-CONV-AI-003'] as const;

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
  return evaluations.map(summaryOf);
}

/**
 * The UX/Conversion checks, counted per page from what the module found.
 *
 * UX/Conversion does not run through the rule engine, so there are no per-rule
 * aggregates to copy. Each static rule counts only the pages it can look at:
 * the entry page for the heading and action checks, pages with a form for the
 * submit check. The AI checks are listed only when the provider answered — a
 * review that never ran looked at nothing, and "not applicable" would claim the
 * pages gave it nothing to review.
 */
export function uxRuleCheckSummaries(
  evidence: UxStaticEvidence,
  ai: Pick<UxAiResponseResult, 'outcome' | 'findings'>,
): readonly RuleCheckSummary[] {
  const entryPages = Math.min(evidence.pages.length, 1);
  const staticCounts: readonly RuleCounts[] = [
    {
      ruleId: 'UX-CONV-STATIC-001',
      applicableTargets: entryPages,
      affectedTargets: pagesWith(evidence.findings, 'UX-CONV-STATIC-001'),
    },
    {
      ruleId: 'UX-CONV-STATIC-002',
      applicableTargets: entryPages,
      affectedTargets: pagesWith(evidence.findings, 'UX-CONV-STATIC-002'),
    },
    {
      ruleId: 'UX-CONV-STATIC-003',
      applicableTargets: evidence.summary.pagesWithForms,
      affectedTargets: pagesWith(evidence.findings, 'UX-CONV-STATIC-003'),
    },
  ];
  const aiCounts: readonly RuleCounts[] =
    ai.outcome.kind === 'response'
      ? UX_AI_RULE_IDS.map((ruleId) => ({
          ruleId,
          applicableTargets: evidence.pages.length,
          affectedTargets: pagesWith(ai.findings, ruleId),
        }))
      : [];
  return [...staticCounts, ...aiCounts].map(summaryOf);
}

function pagesWith(
  findings: readonly { readonly ruleId: string; readonly targetUrl: string }[],
  ruleId: string,
): number {
  return new Set(
    findings.filter((finding) => finding.ruleId === ruleId).map((finding) => finding.targetUrl),
  ).size;
}

function summaryOf(counts: RuleCounts): RuleCheckSummary {
  const descriptor = ruleById(counts.ruleId);
  if (descriptor === undefined) {
    throw new Error(`rule-checks: ${counts.ruleId} отсутствует в реестре`);
  }
  return {
    ruleId: counts.ruleId,
    title: descriptor.title,
    targetKind: descriptor.targetKind,
    scoring: descriptor.scoring,
    applicableTargets: counts.applicableTargets,
    affectedTargets: counts.affectedTargets,
  };
}
