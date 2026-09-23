// The Action Plan, as the PDF renderer asks for it.
//
// The renderer deliberately owns nothing but a shape and the rules that shape
// obeys (`export/pdf/render.ts`), and this package owns the plan. The adapter
// between the two lives here, on this side, so the exporter keeps no dependency
// on the AI feature and the plan keeps no dependency on PDF.
//
// The only thing it may lose in translation is a field the document has no place
// for — never a field the document would have to guess at. `promptText` and
// `usage` are not translated because they are not in `ProjectedActionPlan` at
// all: the projection has no field for either, which is what keeps a prompt out
// of a customer deliverable by construction rather than by review.

import type { PrismaClient } from '@prisma/client';

import type { ActionPlanLoader, ActionPlanProjection } from '../export/pdf/render.ts';
import { readOwnActionPlan, type ProjectedActionPlan } from './projection.ts';

/** Efforts the document can render; anything else is left unnamed rather than guessed. */
const RENDERABLE_EFFORTS = new Set(['small', 'medium', 'large']);

function effortOf(value: string): 'small' | 'medium' | 'large' {
  return RENDERABLE_EFFORTS.has(value) ? (value as 'small' | 'medium' | 'large') : 'medium';
}

/** The plan in the exporter's shape. Pure, so the mapping is testable on its own. */
export function toPdfProjection(plan: ProjectedActionPlan): ActionPlanProjection {
  return {
    overview: plan.overview,
    caveats: plan.caveats,
    actions: plan.actions.map((action) => ({
      title: action.title,
      why: action.why,
      steps: action.steps,
      effort: effortOf(action.effort),
      ruleIds: action.ruleIds,
      openIssues: action.openIssues,
      totalIssues: action.totalIssues,
      settled: action.settled,
    })),
    reach: plan.reach,
    metadata: {
      modelId: plan.modelId,
      // The plan's prompt VERSION is not part of the projection; the document
      // shows the model and the time instead of inventing one.
      promptVersion: null,
      noticeVersion: plan.noticeVersion,
      generatedAt: plan.generatedAt,
    },
  };
}

/**
 * The loader the PDF route is wired with.
 *
 * `readOwnActionPlan` re-checks that this account may read this scan before it
 * returns anything, so a mis-wired caller cannot serve one tenant's plan to
 * another, and it reads the plan stored for the language the document is being
 * written in — never a fallback, which would grow an English chapter inside a
 * Ukrainian report. Only READY plans are stored, so a generation in flight or a
 * failed one is simply `null` and the document has no plan chapter.
 */
export function actionPlanPdfLoader(prisma: PrismaClient): ActionPlanLoader {
  return async ({ accountId, scanId, language }) => {
    const plan = await readOwnActionPlan(prisma, accountId, scanId, language);
    return plan === null ? null : toPdfProjection(plan);
  };
}
