// What the report reads about a scan's Action Plan (D-232): whether one may be
// asked for, the run in flight, the last failure, the budget left, and the plan
// in the requested language with its live overlay.
//
// The plan's text is a snapshot, but its counts are not: per-Action open/total,
// settled Actions and Reach are computed on every read from the issues' current
// statuses. Within one scan they move only when the owner marks issues Ignored
// or False Positive (Resolved comes from a later scan), which is why the report
// calls an Action "settled" and never "fixed".

import { ACTION_PLAN_EFFORTS } from '@fluxradar/ai';
import type { ActionPlanLanguage } from '@fluxradar/contracts';
import type { PrismaClient, Scan, ScanModule } from '@prisma/client';
import { z } from 'zod';

import { JOB_STATUSES } from '../billing/constants.ts';
import { paidAccessDenial } from '../billing/report-access.ts';
import type { ApiLogger } from '../http/logger.ts';
import { OPEN_ISSUE_STATUSES } from '../issues/summary.ts';
import type { OwnScan } from '../scans/routes.ts';
import {
  ACTION_PLAN_ATTEMPT_STATUSES,
  ACTION_PLAN_READY_STATUSES,
  SECTIONS_OUTSIDE_THE_PLAN,
  isRunInFlight,
  planWindowEndsAt,
  remainingBudget,
  type ActionPlanAvailability,
  type ActionPlanBudget,
} from './policy.ts';

/** The facts every decision about a plan starts from. */
export interface PlanFacts {
  /** Terminal, the job done and the finish time recorded. */
  readonly ready: boolean;
  readonly windowEndsAt: Date | null;
  /** Open issues outside Analytics: the ones a plan can address. */
  readonly plannableOpenIssues: number;
}

export async function readPlanFacts(prisma: PrismaClient, scan: Scan): Promise<PlanFacts> {
  const [job, plannableOpenIssues] = await Promise.all([
    prisma.job.findUnique({ where: { scanId: scan.id }, select: { status: true } }),
    prisma.issue.count({
      where: {
        scanId: scan.id,
        status: { in: [...OPEN_ISSUE_STATUSES] },
        module: { not: 'Analytics' },
      },
    }),
  ]);
  const ready =
    ACTION_PLAN_READY_STATUSES.has(scan.status) &&
    job?.status === JOB_STATUSES.done &&
    scan.completedAt !== null;
  return { ready, windowEndsAt: planWindowEndsAt(scan.completedAt), plannableOpenIssues };
}

export function isWindowOpen(facts: PlanFacts, now: Date): boolean {
  return facts.windowEndsAt !== null && now.getTime() < facts.windowEndsAt.getTime();
}

/** The same order of refusals the POST applies, for a report deciding what to offer. */
export function planAvailability(
  scan: OwnScan,
  facts: PlanFacts,
  now: Date,
): ActionPlanAvailability {
  if (!facts.ready) return 'not_ready';
  // Generating is new work bought with the purchase, like a retry: an expired
  // or suspended entitlement closes the window whatever the date.
  if (!isWindowOpen(facts, now) || paidAccessDenial(scan, { now }) !== null) {
    return 'window_closed';
  }
  if (facts.plannableOpenIssues === 0) return 'nothing_to_plan';
  const budget = remainingBudget(scan);
  if (budget.successes === 0 || budget.attempts === 0) return 'limit_reached';
  return 'available';
}

const storedContentSchema = z.object({
  overview: z.string(),
  actions: z.array(
    z.object({
      title: z.string(),
      why: z.string(),
      steps: z.array(z.string()),
      effort: z.enum(ACTION_PLAN_EFFORTS),
      ruleIds: z.array(z.string()),
    }),
  ),
});

/** One rule of an Action with its live counts; the report links each to its issues. */
export interface PlannedRule {
  readonly ruleId: string;
  readonly openIssues: number;
  readonly totalIssues: number;
}

export interface PlannedAction {
  readonly title: string;
  readonly why: string;
  readonly steps: readonly string[];
  readonly effort: (typeof ACTION_PLAN_EFFORTS)[number];
  readonly ruleIds: readonly string[];
  readonly rules: readonly PlannedRule[];
  readonly openIssues: number;
  readonly totalIssues: number;
  /** No open issue left among its rules; not "fixed" — see the note at the top. */
  readonly settled: boolean;
}

export interface PlanCaveat {
  readonly module: string;
  readonly status: string;
}

export interface ActionPlanDto {
  readonly language: string;
  readonly generatedAt: string;
  readonly modelId: string;
  readonly overview: string;
  readonly actions: readonly PlannedAction[];
  /** Open issues the plan addresses, of all open issues (Analytics included), and its rules. */
  readonly reach: { readonly addressed: number; readonly open: number; readonly rules: number };
  readonly caveats: readonly PlanCaveat[];
}

export interface ActionPlanView {
  readonly language: ActionPlanLanguage;
  readonly availability: ActionPlanAvailability;
  readonly languages: readonly string[];
  readonly run: { readonly language: string; readonly startedAt: string } | null;
  readonly lastFailure: {
    readonly code: string;
    readonly language: string;
    readonly at: string;
  } | null;
  readonly remaining: ActionPlanBudget;
  readonly windowEndsAt: string | null;
  readonly plan: ActionPlanDto | null;
}

interface StatusCounts {
  readonly open: number;
  readonly total: number;
}

async function countsByRule(
  prisma: PrismaClient,
  scanId: string,
): Promise<ReadonlyMap<string, StatusCounts>> {
  const rows = await prisma.issue.groupBy({
    by: ['ruleId', 'status'],
    where: { scanId },
    _count: { _all: true },
  });
  const open = new Set<string>(OPEN_ISSUE_STATUSES);
  return rows.reduce<ReadonlyMap<string, StatusCounts>>((counts, row) => {
    const current = counts.get(row.ruleId) ?? { open: 0, total: 0 };
    return new Map([
      ...counts,
      [
        row.ruleId,
        {
          open: current.open + (open.has(row.status) ? row._count._all : 0),
          total: current.total + row._count._all,
        },
      ],
    ]);
  }, new Map());
}

/** One line above the plan per section that was not fully checked and could have added to it. */
export function planCaveats(modules: readonly ScanModule[]): readonly PlanCaveat[] {
  return modules
    .filter(
      (module) =>
        !SECTIONS_OUTSIDE_THE_PLAN.has(module.module) &&
        (module.runtimeStatus === 'Partial' || module.runtimeStatus === 'Unavailable'),
    )
    .map((module) => ({ module: module.module, status: module.runtimeStatus }));
}

function withOverlay(
  content: z.infer<typeof storedContentSchema>,
  counts: ReadonlyMap<string, StatusCounts>,
): Pick<ActionPlanDto, 'actions' | 'reach'> {
  const actions = content.actions.map((action): PlannedAction => {
    const rules = action.ruleIds.map((ruleId) => ({
      ruleId,
      openIssues: counts.get(ruleId)?.open ?? 0,
      totalIssues: counts.get(ruleId)?.total ?? 0,
    }));
    const openIssues = rules.reduce((sum, rule) => sum + rule.openIssues, 0);
    const totalIssues = rules.reduce((sum, rule) => sum + rule.totalIssues, 0);
    return { ...action, rules, openIssues, totalIssues, settled: openIssues === 0 };
  });
  const rules = new Set(content.actions.flatMap((action) => action.ruleIds));
  return {
    actions,
    reach: {
      addressed: actions.reduce((sum, action) => sum + action.openIssues, 0),
      open: [...counts.values()].reduce((sum, count) => sum + count.open, 0),
      rules: rules.size,
    },
  };
}

async function readPlan(
  prisma: PrismaClient,
  scan: OwnScan,
  language: ActionPlanLanguage,
  logger: ApiLogger,
): Promise<ActionPlanDto | null> {
  const stored = await prisma.actionPlan.findUnique({
    where: { scanId_language: { scanId: scan.id, language } },
    select: { contentJson: true, generatedAt: true, modelId: true },
  });
  if (stored === null) return null;
  let parsed: z.infer<typeof storedContentSchema>;
  try {
    parsed = storedContentSchema.parse(JSON.parse(stored.contentJson));
  } catch (error) {
    // Written by this API after a strict parse; unreadable means a bug, and the
    // report is better without the block than with a broken one.
    logger.error('stored action plan is unreadable', {
      scanId: scan.id,
      language,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  return {
    language,
    generatedAt: stored.generatedAt.toISOString(),
    modelId: stored.modelId,
    overview: parsed.overview,
    ...withOverlay(parsed, await countsByRule(prisma, scan.id)),
    caveats: planCaveats(scan.modules),
  };
}

export async function readActionPlanView(
  prisma: PrismaClient,
  scan: OwnScan,
  language: ActionPlanLanguage,
  now: Date,
  logger: ApiLogger,
): Promise<ActionPlanView> {
  const [facts, plans, lastAttempt, plan] = await Promise.all([
    readPlanFacts(prisma, scan),
    prisma.actionPlan.findMany({
      where: { scanId: scan.id },
      select: { language: true },
      orderBy: { language: 'asc' },
    }),
    prisma.actionPlanAttempt.findFirst({
      where: { scanId: scan.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        status: true,
        failureCode: true,
        language: true,
        finishedAt: true,
        createdAt: true,
      },
    }),
    readPlan(prisma, scan, language, logger),
  ]);
  const inFlight = isRunInFlight(scan.actionPlanRunStartedAt, now);
  return {
    language,
    availability: planAvailability(scan, facts, now),
    languages: plans.map((row) => row.language),
    run:
      inFlight && scan.actionPlanRunStartedAt !== null && scan.actionPlanRunLanguage !== null
        ? {
            language: scan.actionPlanRunLanguage,
            startedAt: scan.actionPlanRunStartedAt.toISOString(),
          }
        : null,
    lastFailure:
      lastAttempt?.status === ACTION_PLAN_ATTEMPT_STATUSES.failed
        ? {
            code: lastAttempt.failureCode ?? 'unknown',
            language: lastAttempt.language,
            at: (lastAttempt.finishedAt ?? lastAttempt.createdAt).toISOString(),
          }
        : null,
    remaining: remainingBudget(scan),
    windowEndsAt: facts.windowEndsAt?.toISOString() ?? null,
    plan,
  };
}
