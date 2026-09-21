// The Action Plan's rules of engagement (D-232): who may ask for a plan, when,
// and how often. The HTTP layer (routes.ts) and the read model (view.ts) both
// decide from here, so what the report offers and what the API accepts cannot
// drift apart.

import type { ScanRuntimeStatus } from '@fluxradar/contracts';

/** Plans a scan snapshot may produce, across all languages. */
export const ACTION_PLAN_MAX_SUCCESSES = 3;
/** Attempts of any outcome per scan snapshot: failures cost money too. */
export const ACTION_PLAN_MAX_ATTEMPTS = 6;
/** Attempts across the whole product in any 24 hours; the spend ceiling. */
export const ACTION_PLAN_DAILY_LIMIT = 100;
export const ACTION_PLAN_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A run claimed longer ago than this is presumed dead and may be taken over.
 * The provider call is bounded at two minutes, so a live run never gets here.
 */
export const ACTION_PLAN_RUN_STALE_MS = 5 * 60 * 1000;

/** The Plan Window: how long after a scan's latest run finished a plan may be asked for. */
export const ACTION_PLAN_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Terminal statuses a plan can be written from. Analytics is written after the
 * status is settled (orchestrator/worker.ts), so the job must be done as well.
 */
export const ACTION_PLAN_READY_STATUSES: ReadonlySet<string> = new Set<ScanRuntimeStatus>([
  'Completed',
  'Partial',
  'Failed',
  'Cancelled',
]);

/**
 * Sections whose findings never reach a plan, so their status says nothing
 * about the plan's completeness: Analytics is never sent to the provider, and
 * AI SEO / GEO findings are informational and never become issues (D-109).
 */
export const SECTIONS_OUTSIDE_THE_PLAN: ReadonlySet<string> = new Set([
  'Analytics',
  'AI SEO / GEO',
]);

export const ACTION_PLAN_ATTEMPT_STATUSES = {
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
} as const;

/** Why generating a plan is not possible right now, or `available`. */
export type ActionPlanAvailability =
  'available' | 'not_ready' | 'window_closed' | 'nothing_to_plan' | 'limit_reached';

export interface ActionPlanBudget {
  readonly successes: number;
  readonly attempts: number;
}

export function remainingBudget(scan: {
  readonly actionPlanSuccesses: number;
  readonly actionPlanAttempts: number;
}): ActionPlanBudget {
  return {
    successes: Math.max(0, ACTION_PLAN_MAX_SUCCESSES - scan.actionPlanSuccesses),
    attempts: Math.max(0, ACTION_PLAN_MAX_ATTEMPTS - scan.actionPlanAttempts),
  };
}

/** When the Plan Window closes; null while the scan has not recorded a finished run. */
export function planWindowEndsAt(completedAt: Date | null): Date | null {
  return completedAt === null ? null : new Date(completedAt.getTime() + ACTION_PLAN_WINDOW_MS);
}

/** A claimed run that is still alive, as opposed to one presumed dead. */
export function isRunInFlight(startedAt: Date | null, now: Date): boolean {
  return startedAt !== null && now.getTime() - startedAt.getTime() < ACTION_PLAN_RUN_STALE_MS;
}
