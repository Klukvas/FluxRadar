// The one way a written Action Plan is read.
//
// The GET route serves this, and so does anything else that shows a plan — the
// platform PDF integrator next. Having a single projection is what keeps those
// consistent: the live overlay, Reach and the incomplete-module caveats are
// computed the same way everywhere, and the fields that must never leave the
// product leave from nowhere.
//
// NOT projected, on purpose:
//   - `promptText` — the prompt carries the scan's sample URLs and is internal;
//   - `promptVersion` / `requestId` / `usageJson` — operational, not the owner's;
//   - anything that names the Analytics module (D-219): no Analytics rule can
//     appear in an Action, because none was ever sent. Its open issues are still
//     COUNTED in Reach's denominator, which is the scan's open issues — a count
//     is not a disclosure, and the alternative flatters the plan.
// The plan is a document to read, so it is served as this object only: there is
// no JSON or CSV export of it, and the report's exports do not carry it.

import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

import { findOwnReportScan } from '../scans/routes.ts';
import { incompleteModulesFor } from './input-builder.ts';
import { overlayFor, readRuleIssueCounts } from './overlay.ts';
import type { PlanReach } from './overlay.ts';

/**
 * What a stored plan must look like to be shown.
 *
 * The rows are written by this build, but they outlive it: a plan stored by an
 * older release, or one whose JSON was hand-edited, must not reach a renderer
 * that expects `steps` to be an array. Zod strips unknown keys, so a record that
 * grows a field later cannot leak it through this projection either.
 */
const storedPlanSchema = z.object({
  overview: z.string(),
  actions: z.array(
    z.object({
      title: z.string(),
      why: z.string(),
      steps: z.array(z.string()),
      effort: z.string(),
      ruleIds: z.array(z.string()),
    }),
  ),
});

export type StoredPlanContent = z.infer<typeof storedPlanSchema>;

/** A plan this build cannot read is reported as absent, never as an empty plan. */
export function parseStoredContent(contentJson: string): StoredPlanContent | null {
  try {
    const parsed = storedPlanSchema.safeParse(JSON.parse(contentJson));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface ProjectedAction {
  readonly title: string;
  readonly why: string;
  readonly steps: readonly string[];
  readonly effort: string;
  readonly ruleIds: readonly string[];
  /** Live counts over the scan's current issue statuses, not the snapshot's. */
  readonly openIssues: number;
  readonly totalIssues: number;
  readonly settled: boolean;
}

export interface ProjectedActionPlan {
  readonly language: string;
  readonly overview: string;
  readonly actions: readonly ProjectedAction[];
  readonly reach: PlanReach;
  /** Modules that did not complete; shown as a caveat above the plan. */
  readonly caveats: readonly string[];
  readonly generatedAt: string;
  readonly modelId: string;
  /** The Action Plan notice the owner accepted when they asked for this plan. */
  readonly noticeVersion: string;
}

/**
 * The plan written for one scan in one language, or null when there is none to
 * show. The caller has already established that this account may read the scan.
 */
export async function projectActionPlan(
  prisma: PrismaClient,
  scanId: string,
  language: string,
): Promise<ProjectedActionPlan | null> {
  const stored = await prisma.actionPlan.findUnique({
    where: { scanId_language: { scanId, language } },
  });
  if (stored === null) return null;
  const content = parseStoredContent(stored.contentJson);
  if (content === null) return null;

  const [caveats, counts] = await Promise.all([
    incompleteModulesFor(prisma, scanId),
    readRuleIssueCounts(prisma, scanId),
  ]);
  const overlay = overlayFor(content.actions, counts);
  return {
    language: stored.language,
    overview: content.overview,
    actions: content.actions.map((action, index) => ({
      title: action.title,
      why: action.why,
      steps: action.steps,
      effort: action.effort,
      ruleIds: action.ruleIds,
      ...(overlay.actions[index] ?? { openIssues: 0, totalIssues: 0, settled: true }),
    })),
    reach: overlay.reach,
    caveats,
    generatedAt: stored.generatedAt.toISOString(),
    modelId: stored.modelId,
    noticeVersion: stored.noticeVersion,
  };
}

/**
 * The same projection with the ownership and paid-access guard in front of it,
 * for callers that do not already hold the scan — the platform PDF build being
 * the first. It throws the usual 403/404 for a scan this account may not read,
 * so an integrator cannot accidentally serve one tenant's plan to another.
 */
export async function readOwnActionPlan(
  prisma: PrismaClient,
  accountId: string,
  scanId: string,
  language: string,
): Promise<ProjectedActionPlan | null> {
  await findOwnReportScan(prisma, accountId, scanId);
  return projectActionPlan(prisma, scanId, language);
}
