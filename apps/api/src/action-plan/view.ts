// What the report reads about a scan's Action Plan (D-232): whether one may be
// asked for, the run in flight, the last failure, the budget left, and the plan
// in the requested language with its live overlay.
//
// The plan's text is a snapshot, but its counts are not: per-Action open/total,
// settled Actions and Reach are computed on every read from the issues' current
// statuses. Within one scan they move only when the owner marks issues Ignored
// or False Positive (Resolved comes from a later scan), which is why the report
// calls an Action "settled" and never "fixed".

import { ACTION_PLAN_EFFORTS, type ActionPlanAction, type ActionPlanContent } from '@fluxradar/ai';
import type { ActionPlanLanguage } from '@fluxradar/contracts';
import type { PrismaClient, ScanModule } from '@prisma/client';
import { z } from 'zod';

import { JOB_STATUSES } from '../billing/constants.ts';
import { paidAccessDenial } from '../billing/report-access.ts';
import type { ApiLogger } from '../http/logger.ts';
import { OPEN_ISSUE_STATUSES } from '../issues/summary.ts';
import type { OwnScan } from '../scans/routes.ts';
import {
  ACTION_PLAN_ATTEMPT_STATUSES,
  SECTIONS_OUTSIDE_THE_PLAN,
  isReadyStatus,
  isRunInFlight,
  planWindowEndsAt,
  plannableIssueWhere,
  remainingBudget,
  type ActionPlanAvailability,
  type ActionPlanBudget,
} from './policy.ts';

/** Nothing spent yet: the budget of a snapshot no attempt has been made in. */
const UNSPENT = { actionPlanSuccesses: 0, actionPlanAttempts: 0 } as const;

/** The facts every decision about a plan starts from. */
export interface PlanFacts {
  /** Terminal, the job done and the finish time recorded. */
  readonly ready: boolean;
  /** The Plan Window's end, or the entitlement's expiry when that comes first. */
  readonly windowEndsAt: Date | null;
  /** Open issues outside Analytics: the ones a plan can address. */
  readonly plannableOpenIssues: number;
}

function earliest(first: Date | null, second: Date | null | undefined): Date | null {
  if (first === null || second == null) return first ?? second ?? null;
  return first.getTime() <= second.getTime() ? first : second;
}

export async function readPlanFacts(prisma: PrismaClient, scan: OwnScan): Promise<PlanFacts> {
  const [job, plannableOpenIssues] = await Promise.all([
    prisma.job.findUnique({ where: { scanId: scan.id }, select: { status: true } }),
    prisma.issue.count({ where: plannableIssueWhere(scan.id) }),
  ]);
  const ready =
    isReadyStatus(scan.status) && job?.status === JOB_STATUSES.done && scan.completedAt !== null;
  // Generating is new work bought with the purchase: once the entitlement has
  // expired, the window has closed whatever its own end says.
  const windowEndsAt = earliest(
    planWindowEndsAt(scan.completedAt),
    scan.purchase?.entitlement?.expiresAt,
  );
  return { ready, windowEndsAt, plannableOpenIssues };
}

export function isWindowOpen(facts: PlanFacts, now: Date): boolean {
  return facts.windowEndsAt !== null && now.getTime() < facts.windowEndsAt.getTime();
}

/** The same order of refusals the POST applies, for a report deciding what to offer. */
export function planAvailability(
  scan: OwnScan,
  facts: PlanFacts,
  budget: ActionPlanBudget,
  now: Date,
): ActionPlanAvailability {
  if (!facts.ready) return 'not_ready';
  if (!isWindowOpen(facts, now) || paidAccessDenial(scan, { now }) !== null) {
    return 'window_closed';
  }
  if (facts.plannableOpenIssues === 0) return 'nothing_to_plan';
  if (budget.successes === 0 || budget.attempts === 0) return 'limit_reached';
  return 'available';
}

const storedContentSchema: z.ZodType<ActionPlanContent> = z.object({
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

/** A stored Action with its live counts. */
export interface PlannedAction extends ActionPlanAction {
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

/** A stored plan as the report shows it: the snapshot text under live counts. */
export interface PlanWithOverlay {
  readonly language: string;
  readonly generatedAt: string;
  readonly modelId: string;
  readonly overview: string;
  readonly actions: readonly PlannedAction[];
  /** Open issues the plan addresses, of all open issues (Analytics included), and its rules. */
  readonly reach: { readonly addressed: number; readonly open: number; readonly rules: number };
  readonly caveats: readonly PlanCaveat[];
}

export interface ActionPlanState {
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
  readonly plan: PlanWithOverlay | null;
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
  content: ActionPlanContent,
  counts: ReadonlyMap<string, StatusCounts>,
): Pick<PlanWithOverlay, 'actions' | 'reach'> {
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
): Promise<PlanWithOverlay | null> {
  if (scan.completedAt === null) return null;
  const stored = await prisma.actionPlan.findFirst({
    where: { scanId: scan.id, language, generatedAt: { gte: scan.completedAt } },
    select: { contentJson: true, generatedAt: true, modelId: true },
  });
  if (stored === null) return null;
  let parsed: ActionPlanContent;
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

/** The languages the current snapshot has a plan in. */
async function plannedLanguages(prisma: PrismaClient, scan: OwnScan): Promise<readonly string[]> {
  if (scan.completedAt === null) return [];
  const plans = await prisma.actionPlan.findMany({
    where: { scanId: scan.id, generatedAt: { gte: scan.completedAt } },
    select: { language: true },
    orderBy: { language: 'asc' },
  });
  return plans.map((row) => row.language);
}

interface SnapshotAttempt {
  readonly status: string;
  readonly failureCode: string | null;
  readonly language: string;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
}

/** The latest attempt of the current snapshot; see isOfCurrentSnapshot. */
async function latestAttempt(prisma: PrismaClient, scan: OwnScan): Promise<SnapshotAttempt | null> {
  if (scan.completedAt === null) return null;
  return prisma.actionPlanAttempt.findFirst({
    where: { scanId: scan.id, createdAt: { gte: scan.completedAt } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { status: true, failureCode: true, language: true, finishedAt: true, createdAt: true },
  });
}

function lastFailure(attempt: SnapshotAttempt | null): ActionPlanState['lastFailure'] {
  if (attempt?.status !== ACTION_PLAN_ATTEMPT_STATUSES.failed) return null;
  return {
    code: attempt.failureCode ?? 'unknown',
    language: attempt.language,
    at: (attempt.finishedAt ?? attempt.createdAt).toISOString(),
  };
}

/**
 * The budget left in the current snapshot. Counters no attempt of it stands
 * behind were left by an earlier one, and the next claim resets them
 * (run-state.ts): until then they must not be read as spent.
 */
function snapshotBudget(scan: OwnScan, latest: SnapshotAttempt | null): ActionPlanBudget {
  return remainingBudget(latest === null ? UNSPENT : scan);
}

function runInFlight(scan: OwnScan, now: Date): ActionPlanState['run'] {
  const startedAt = scan.actionPlanRunStartedAt;
  const language = scan.actionPlanRunLanguage;
  if (!isRunInFlight(startedAt, scan.completedAt, now)) return null;
  if (startedAt === null || language === null) return null;
  return { language, startedAt: startedAt.toISOString() };
}

export async function readActionPlanState(
  prisma: PrismaClient,
  scan: OwnScan,
  language: ActionPlanLanguage,
  now: Date,
  logger: ApiLogger,
): Promise<ActionPlanState> {
  const [facts, languages, latest, plan] = await Promise.all([
    readPlanFacts(prisma, scan),
    plannedLanguages(prisma, scan),
    latestAttempt(prisma, scan),
    readPlan(prisma, scan, language, logger),
  ]);
  const remaining = snapshotBudget(scan, latest);
  return {
    language,
    availability: planAvailability(scan, facts, remaining, now),
    languages,
    run: runInFlight(scan, now),
    lastFailure: lastFailure(latest),
    remaining,
    windowEndsAt: facts.windowEndsAt?.toISOString() ?? null,
    plan,
  };
}
