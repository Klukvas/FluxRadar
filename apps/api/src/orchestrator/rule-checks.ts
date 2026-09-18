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

export interface RuleCounts {
  readonly ruleId: string;
  readonly applicableTargets: number;
  readonly affectedTargets: number;
}

interface PageFinding {
  readonly ruleId: string;
  readonly targetUrl: string;
}

const UX_STATIC_RULE_IDS = ['UX-CONV-STATIC-001', 'UX-CONV-STATIC-002', 'UX-CONV-STATIC-003'];
const UX_AI_RULE_IDS = ['UX-CONV-AI-001', 'UX-CONV-AI-002', 'UX-CONV-AI-003'];

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
  return evaluations.map(ruleCheckSummary);
}

/**
 * The UX/Conversion checks, counted per page from what the module found.
 *
 * UX/Conversion does not run through the rule engine, so there are no per-rule
 * aggregates to copy; `uxRuleCounts` derives them. The AI checks are listed
 * only when the provider answered — a review that never ran looked at nothing,
 * and "not applicable" would claim the pages gave it nothing to review.
 */
export function uxRuleCheckSummaries(
  evidence: UxStaticEvidence,
  ai: Pick<UxAiResponseResult, 'outcome' | 'findings'>,
): readonly RuleCheckSummary[] {
  const ruleIds = [
    ...UX_STATIC_RULE_IDS,
    ...(ai.outcome.kind === 'response' ? UX_AI_RULE_IDS : []),
  ];
  const findings = [...evidence.findings, ...ai.findings];
  return ruleIds.map((ruleId) => ruleCheckSummary(uxRuleCounts(evidence, findings, ruleId)));
}

/**
 * What one UX rule looked at and what it found, counted in pages.
 *
 * Each rule counts only the pages it can look at: the entry page for the
 * heading and action checks, pages with a form for the submit check, every
 * analysed page for the AI review. The module score divides by these same
 * numbers, so "2 of 12 pages" in the check list and in the penalty can never
 * disagree. A finding on a page the rule would not count still widens the
 * denominator rather than scoring a page that was never "applicable".
 */
export function uxRuleCounts(
  evidence: UxStaticEvidence,
  findings: readonly PageFinding[],
  ruleId: string,
): RuleCounts {
  const affectedTargets = pagesWith(findings, ruleId);
  return {
    ruleId,
    applicableTargets: Math.max(uxApplicableTargets(evidence, ruleId), affectedTargets),
    affectedTargets,
  };
}

function uxApplicableTargets(evidence: UxStaticEvidence, ruleId: string): number {
  switch (ruleId) {
    case 'UX-CONV-STATIC-001':
    case 'UX-CONV-STATIC-002':
      return Math.min(evidence.pages.length, 1);
    case 'UX-CONV-STATIC-003':
      return evidence.summary.pagesWithForms;
    default:
      return evidence.pages.length;
  }
}

function pagesWith(findings: readonly PageFinding[], ruleId: string): number {
  return new Set(
    findings.filter((finding) => finding.ruleId === ruleId).map((finding) => finding.targetUrl),
  ).size;
}

/** The check-list entry for one rule: its registry title and scoring, and its counts. */
export function ruleCheckSummary(counts: RuleCounts): RuleCheckSummary {
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
