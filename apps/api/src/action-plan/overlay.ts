// The live numbers over a written plan.
//
// The plan's words are a snapshot; its counts are not. Per-Action open/total,
// whether an Action is settled, and Reach are all computed on read from the
// scan's current issue statuses, so marking issues Ignored or False Positive
// moves them immediately (D-232). Nothing here calls a settled Action "fixed" —
// inside one scan the only thing that can settle it is the owner's own triage.

import { ACTION_PLAN_EXCLUDED_MODULE } from '@fluxradar/ai';
import type { PrismaClient } from '@prisma/client';

import { OPEN_ISSUE_STATUSES } from '../issues/summary.ts';

/**
 * The rules an Action can name: never Analytics, whose findings are Google data
 * and never leave the product (D-219). The per-Action counts are drawn from
 * these, because an Action is written from what the model was shown.
 *
 * The REACH DENOMINATOR is deliberately not: `docs/CONTEXT.md` defines Reach as
 * "the share of a SCAN's open issues that at least one Action addresses", and a
 * scan's open issues include the Analytics ones the owner can see in the same
 * report. Excluding them would quietly redefine the number the UI puts in front
 * of the owner into "the share of what we were allowed to send", which reads as
 * a fuller plan than the site actually has. Not sending Analytics and not
 * counting it are two different promises: the first is a privacy rule, the
 * second would be a flattering denominator.
 */
const PLANNABLE_ISSUES = { module: { not: ACTION_PLAN_EXCLUDED_MODULE } } as const;

export interface ActionOverlay {
  readonly openIssues: number;
  readonly totalIssues: number;
  /** No open issue left on any of the Action's rules. */
  readonly settled: boolean;
}

export interface PlanReach {
  /**
   * Share of the scan's open issues at least one Action addresses, 0–1. The
   * denominator is every open issue the owner can see in this report; the
   * numerator only ever counts rules a written Action named.
   */
  readonly share: number;
  readonly addressedOpenIssues: number;
  readonly totalOpenIssues: number;
  readonly rules: number;
}

export interface ActionPlanOverlay {
  readonly actions: readonly ActionOverlay[];
  readonly reach: PlanReach;
}

export interface RuleIssueCounts {
  /** Open issues per plannable rule: the numerator's material. */
  readonly open: ReadonlyMap<string, number>;
  /** All issues per plannable rule, whatever their status. */
  readonly total: ReadonlyMap<string, number>;
  /** Every open issue of the scan, Analytics included: Reach's denominator. */
  readonly totalOpen: number;
}

export async function readRuleIssueCounts(
  prisma: PrismaClient,
  scanId: string,
): Promise<RuleIssueCounts> {
  const openStatuses = { status: { in: [...OPEN_ISSUE_STATUSES] } };
  const [all, open, totalOpen] = await Promise.all([
    prisma.issue.groupBy({
      by: ['ruleId'],
      where: { scanId, ...PLANNABLE_ISSUES },
      _count: { _all: true },
    }),
    prisma.issue.groupBy({
      by: ['ruleId'],
      where: { scanId, ...openStatuses, ...PLANNABLE_ISSUES },
      _count: { _all: true },
    }),
    prisma.issue.count({ where: { scanId, ...openStatuses } }),
  ]);
  return {
    open: new Map(open.map((row) => [row.ruleId, row._count._all])),
    total: new Map(all.map((row) => [row.ruleId, row._count._all])),
    totalOpen,
  };
}

export function overlayFor(
  actions: readonly { readonly ruleIds: readonly string[] }[],
  counts: RuleIssueCounts,
): ActionPlanOverlay {
  const actionOverlays = actions.map((action): ActionOverlay => {
    const openIssues = action.ruleIds.reduce(
      (sum, ruleId) => sum + (counts.open.get(ruleId) ?? 0),
      0,
    );
    return {
      openIssues,
      totalIssues: action.ruleIds.reduce((sum, ruleId) => sum + (counts.total.get(ruleId) ?? 0), 0),
      settled: openIssues === 0,
    };
  });
  // A rule belongs to at most one Action, so summing per Action would already be
  // correct; the set makes that independent of how the plan was reconciled.
  const addressedRules = new Set(actions.flatMap((action) => [...action.ruleIds]));
  const addressedOpenIssues = [...addressedRules].reduce(
    (sum, ruleId) => sum + (counts.open.get(ruleId) ?? 0),
    0,
  );
  return {
    actions: actionOverlays,
    reach: {
      share: counts.totalOpen === 0 ? 0 : addressedOpenIssues / counts.totalOpen,
      addressedOpenIssues,
      totalOpenIssues: counts.totalOpen,
      rules: addressedRules.size,
    },
  };
}
