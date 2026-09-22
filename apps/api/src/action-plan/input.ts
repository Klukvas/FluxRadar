// What a scan tells the Action Plan: its open issues outside Analytics, folded
// by rule, with a few page addresses and the rule's own recommendations, and
// the state of each report section.
//
// Only the fields the plan needs are read. Evidence excerpts, screenshots and
// traces are never selected, and Analytics rows are filtered out in every
// query: their findings are Search Console and GA4 data, which must not reach
// an AI provider (D-232).

import {
  ACTION_PLAN_SAMPLE_URLS,
  type ActionPlanInput,
  type ActionPlanModuleInput,
  type ActionPlanRuleInput,
  type AiConsent,
} from '@fluxradar/ai';
import {
  ACTION_PLAN_NOTICE_VERSION,
  MODULE_RUNTIME_STATUSES,
  SEVERITIES,
  isModuleName,
  severityRank,
  type ActionPlanLanguage,
  type Severity,
} from '@fluxradar/contracts';
import { ruleTitle, type FindingLanguage } from '@fluxradar/rules';
import { Prisma, type PrismaClient, type ScanModule } from '@prisma/client';

import { localizedFindingTexts } from '../issues/localized-text.ts';
import { OPEN_ISSUE_STATUSES } from '../issues/summary.ts';
import { ANALYTICS_MODULE, plannableIssueWhere } from './policy.ts';

export interface PlannedScan {
  readonly id: string;
  readonly domain: string;
  readonly modules: readonly ScanModule[];
}

interface RuleCount {
  readonly ruleId: string;
  readonly module: string;
  readonly severity: string;
  readonly count: number;
}

interface SamplePage {
  readonly ruleId: string;
  readonly page: string;
}

interface RecommendationVariant {
  readonly ruleId: string;
  readonly recommendation: string;
  readonly messagesJson: string | null;
}

/** The consent a click on Generate gives: Anthropic, under the notice shown with the button. */
export function actionPlanConsent(scanId: string): AiConsent {
  return { scanId, providers: ['anthropic'], noticeVersion: ACTION_PLAN_NOTICE_VERSION };
}

/**
 * Titles and recommendations exist in English and Ukrainian; for any other
 * plan language the English text is sent and the model translates it.
 */
function catalogueLanguage(language: ActionPlanLanguage): FindingLanguage {
  return language === 'uk' ? 'uk' : 'en';
}

/** plannableIssueWhere, for the raw queries below. */
const plannableIssueSql = (scanId: string): Prisma.Sql =>
  Prisma.sql`"scanId" = ${scanId}
    AND "status" IN (${Prisma.join([...OPEN_ISSUE_STATUSES])})
    AND "module" <> ${ANALYTICS_MODULE}`;

/**
 * Up to three distinct pages per rule, most severe first, with query string
 * and fragment removed before they are compared: `?utm=` variants of one page
 * are one page, and those parts can carry personal data.
 */
async function samplePages(prisma: PrismaClient, scanId: string): Promise<readonly SamplePage[]> {
  return prisma.$queryRaw<SamplePage[]>(Prisma.sql`
    SELECT "ruleId", "page"
    FROM (
      SELECT "ruleId", "page",
             ROW_NUMBER() OVER (PARTITION BY "ruleId" ORDER BY MIN("severityRank"), "page") AS "position"
      FROM (
        SELECT "ruleId", "severityRank",
               split_part(split_part("targetUrl", '#', 1), '?', 1) AS "page"
        FROM "Issue"
        WHERE ${plannableIssueSql(scanId)}
      ) AS "open"
      GROUP BY "ruleId", "page"
    ) AS "ranked"
    WHERE "position" <= ${ACTION_PLAN_SAMPLE_URLS}
    ORDER BY "ruleId", "position"`);
}

/**
 * Every distinct recommendation of a rule, most severe first. The stored
 * English text is the variant (templates carry constants, not per-issue
 * values), and the message code of its most severe issue renders the same
 * variant in Ukrainian. UX findings written by a model have no code and carry
 * their own English text.
 */
async function recommendationVariants(
  prisma: PrismaClient,
  scanId: string,
): Promise<readonly RecommendationVariant[]> {
  return prisma.$queryRaw<RecommendationVariant[]>(Prisma.sql`
    SELECT "ruleId", "recommendation",
           (array_agg("messagesJson" ORDER BY "severityRank", "id"))[1] AS "messagesJson"
    FROM "Issue"
    WHERE ${plannableIssueSql(scanId)}
    GROUP BY "ruleId", "recommendation"
    ORDER BY "ruleId", MIN("severityRank"), "recommendation"`);
}

function knownSeverity(value: string): Severity {
  // Every stored severity is one of these; an unknown one ranks last rather
  // than failing the plan.
  return SEVERITIES.find((severity) => severity === value) ?? 'Low';
}

/** Folds per-severity counts into one entry per rule, wearing its worst open severity. */
function foldRules(counts: readonly RuleCount[]): ReadonlyMap<string, RuleCount> {
  return counts.reduce<ReadonlyMap<string, RuleCount>>((folded, row) => {
    const current = folded.get(row.ruleId);
    const severity =
      current === undefined || severityRank(row.severity) < severityRank(current.severity)
        ? row.severity
        : current.severity;
    return new Map([
      ...folded,
      [
        row.ruleId,
        {
          ruleId: row.ruleId,
          module: current?.module ?? row.module,
          severity,
          count: (current?.count ?? 0) + row.count,
        },
      ],
    ]);
  }, new Map());
}

function localizedRecommendation(
  variant: RecommendationVariant,
  language: FindingLanguage,
): string {
  return (
    localizedFindingTexts(variant.messagesJson)?.[language].recommendation ?? variant.recommendation
  );
}

function grouped<T extends { readonly ruleId: string }, V>(
  rows: readonly T[],
  value: (row: T) => V,
): ReadonlyMap<string, readonly V[]> {
  return rows.reduce<ReadonlyMap<string, readonly V[]>>(
    (groups, row) =>
      new Map([...groups, [row.ruleId, [...(groups.get(row.ruleId) ?? []), value(row)]]]),
    new Map(),
  );
}

function moduleInputs(modules: readonly ScanModule[]): readonly ActionPlanModuleInput[] {
  return modules.flatMap((module) => {
    const status = MODULE_RUNTIME_STATUSES.find((known) => known === module.runtimeStatus);
    if (
      module.module === ANALYTICS_MODULE ||
      !isModuleName(module.module) ||
      status === undefined
    ) {
      return [];
    }
    return [{ module: module.module, status, score: module.score, coverage: module.coverage }];
  });
}

function hostnameOf(domain: string): string {
  try {
    return new URL(domain).hostname;
  } catch {
    return domain;
  }
}

async function openRuleCounts(prisma: PrismaClient, scanId: string): Promise<RuleCount[]> {
  const rows = await prisma.issue.groupBy({
    by: ['ruleId', 'module', 'severity'],
    where: plannableIssueWhere(scanId),
    _count: { _all: true },
  });
  return rows.map((row) => ({
    ruleId: row.ruleId,
    module: row.module,
    severity: row.severity,
    count: row._count._all,
  }));
}

/** The rules of the plan's input, each with its pages and texts; Analytics never gets here. */
async function ruleInputs(
  prisma: PrismaClient,
  scanId: string,
  language: FindingLanguage,
): Promise<readonly ActionPlanRuleInput[]> {
  const [counts, pages, variants] = await Promise.all([
    openRuleCounts(prisma, scanId),
    samplePages(prisma, scanId),
    recommendationVariants(prisma, scanId),
  ]);
  const pagesByRule = grouped(pages, (row) => row.page);
  const textsByRule = grouped(variants, (row) => localizedRecommendation(row, language));
  return [...foldRules(counts).values()].flatMap((rule): ActionPlanRuleInput[] =>
    isModuleName(rule.module)
      ? [
          {
            ruleId: rule.ruleId,
            title: ruleTitle(rule.ruleId, language),
            module: rule.module,
            severity: knownSeverity(rule.severity),
            openIssues: rule.count,
            sampleUrls: pagesByRule.get(rule.ruleId) ?? [],
            recommendations: textsByRule.get(rule.ruleId) ?? [],
          },
        ]
      : [],
  );
}

/** The plan's input for one scan and language; `rules` is empty when nothing is open. */
export async function buildActionPlanInput(
  prisma: PrismaClient,
  scan: PlannedScan,
  language: ActionPlanLanguage,
): Promise<ActionPlanInput> {
  return {
    scanId: scan.id,
    domain: hostnameOf(scan.domain),
    language,
    consent: actionPlanConsent(scan.id),
    modules: moduleInputs(scan.modules),
    rules: await ruleInputs(prisma, scan.id, catalogueLanguage(language)),
  };
}
