// What the Action Plan sends: one row per rule with an open issue, and the
// status line of each module. Nothing else leaves the product.
//
// The size of what is read is bounded by the RULESET, not by the crawl: counts
// come from one grouped query, and each rule contributes a handful of sample
// rows. A scan with 40 000 broken links builds the same prompt as one with four.

import { severityRank } from '@fluxradar/contracts';
import { RULE_TITLES } from '@fluxradar/rules';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { ActionPlanModuleInput, ActionPlanRuleInput } from '@fluxradar/ai';
import { ACTION_PLAN_EXCLUDED_MODULE } from '@fluxradar/ai';

import { OPEN_ISSUE_STATUSES } from '../issues/summary.ts';
import { localizedFindingTexts } from '../issues/localized-text.ts';

const MAX_SAMPLE_URLS = 3;
const MAX_RECOMMENDATIONS = 4;

/**
 * Rows read per rule to draw the samples from. The plan needs three URLs and
 * four recommendations, not every issue: a scan with 40 000 broken links must
 * cost the same to plan as one with four. Reading a few more rows than needed
 * leaves room to skip duplicates; if a rule's first rows all share one URL the
 * sample is simply shorter, which is a fair summary of that rule anyway.
 */
const SAMPLE_ROWS_PER_RULE = 12;

/** Open issues the plan is allowed to see: never the Analytics module (D-219). */
function plannableOpenIssues(): Prisma.IssueWhereInput {
  return {
    status: { in: [...OPEN_ISSUE_STATUSES] },
    module: { not: ACTION_PLAN_EXCLUDED_MODULE },
  };
}

interface IssueSampleRow {
  readonly targetUrl: string;
  readonly recommendation: string;
  readonly messagesJson: string | null;
}

/**
 * The URL as it may be shown to a provider: origin and path only.
 *
 * Query and fragment are noise for a plan and routinely carry personal data
 * (session ids, emails in unsubscribe links, tracking parameters). Credentials
 * embedded in the URL are worse — `https://user:pass@host/` is a password, and
 * crawlers do meet such links — so a URL carrying them is dropped rather than
 * cleaned: the point is that it never reaches a prompt. Anything that is not
 * http(s) (`javascript:`, `data:`, `mailto:`) is not a page and is dropped too.
 */
function pathOnly(targetUrl: string): string | null {
  try {
    const url = new URL(targetUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username !== '' || url.password !== '') return null;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function higherSeverity(left: string, right: string): string {
  return severityRank(left) <= severityRank(right) ? left : right;
}

/**
 * The rule's recommendation in the plan's language when the finding stored
 * message codes, and the stored English text otherwise. UX findings carry AI
 * free text and have no codes, which is why both paths exist.
 */
function recommendationFor(row: IssueSampleRow, language: string): string {
  const localized = localizedFindingTexts(row.messagesJson);
  if (localized === null) return row.recommendation;
  const texts = localized[language as keyof typeof localized];
  return texts?.recommendation ?? row.recommendation;
}

/** One rule's open issues, as the grouped count query returns them. */
interface RuleTotals {
  readonly ruleId: string;
  readonly module: string;
  readonly severity: string;
  readonly openIssues: number;
}

function takeDistinct(values: readonly string[], limit: number): readonly string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (value === '' || seen.has(value)) continue;
    seen.add(value);
    if (seen.size === limit) break;
  }
  return [...seen];
}

export interface ActionPlanScanInput {
  readonly modules: readonly ActionPlanModuleInput[];
  readonly rules: readonly ActionPlanRuleInput[];
  /** Modules that did not complete; the plan is shown with a caveat for each. */
  readonly incompleteModules: readonly string[];
}

function isIncomplete(status: string): boolean {
  return status !== 'Completed' && status !== 'Not applicable';
}

/**
 * The modules a caveat line is shown for above the plan ("Performance was only
 * partly checked — the plan may be incomplete"). Read on its own by the GET
 * route, which needs the caveats but not the prompt input.
 */
export async function incompleteModulesFor(
  prisma: PrismaClient,
  scanId: string,
): Promise<readonly string[]> {
  const modules = await prisma.scanModule.findMany({
    where: { scanId, module: { not: ACTION_PLAN_EXCLUDED_MODULE } },
    select: { module: true, runtimeStatus: true },
    orderBy: { module: 'asc' },
  });
  return modules
    .filter((module) => isIncomplete(module.runtimeStatus))
    .map((module) => module.module);
}

/**
 * The open issues of one scan, counted per rule.
 *
 * `summarizeIssues` groups by severity as well, so a rule whose severity the
 * model set per issue comes back as several rows; they are merged here and keep
 * the highest severity, because an Action is written per rule.
 */
async function readRuleTotals(
  prisma: PrismaClient,
  scanId: string,
): Promise<readonly RuleTotals[]> {
  const groups = await prisma.issue.groupBy({
    by: ['ruleId', 'module', 'severity'],
    where: { scanId, ...plannableOpenIssues() },
    _count: { _all: true },
  });
  const byRule = new Map<string, RuleTotals>();
  for (const group of groups) {
    const existing = byRule.get(group.ruleId);
    byRule.set(
      group.ruleId,
      existing === undefined
        ? {
            ruleId: group.ruleId,
            module: group.module,
            severity: group.severity,
            openIssues: group._count._all,
          }
        : {
            ...existing,
            severity: higherSeverity(existing.severity, group.severity),
            openIssues: existing.openIssues + group._count._all,
          },
    );
  }
  return [...byRule.values()].sort(
    (left, right) =>
      severityRank(left.severity) - severityRank(right.severity) ||
      right.openIssues - left.openIssues ||
      left.ruleId.localeCompare(right.ruleId),
  );
}

/**
 * The sample URLs and recommendations for one rule.
 *
 * One bounded query per rule rather than one unbounded query over every open
 * issue: the number of rules is fixed by the ruleset, the number of issues is
 * whatever the crawl found.
 */
async function readRuleSamples(
  prisma: PrismaClient,
  scanId: string,
  rule: RuleTotals,
  language: string,
): Promise<ActionPlanRuleInput> {
  const rows = await prisma.issue.findMany({
    where: { scanId, ruleId: rule.ruleId, ...plannableOpenIssues() },
    select: { targetUrl: true, recommendation: true, messagesJson: true },
    orderBy: [{ severityRank: 'asc' }, { id: 'asc' }],
    take: SAMPLE_ROWS_PER_RULE,
  });
  const urls = rows
    .map((row) => pathOnly(row.targetUrl))
    .filter((url): url is string => url !== null);
  return {
    ruleId: rule.ruleId,
    title: RULE_TITLES[rule.ruleId]?.en ?? rule.ruleId,
    module: rule.module,
    severity: rule.severity,
    openIssues: rule.openIssues,
    sampleUrls: takeDistinct(urls, MAX_SAMPLE_URLS),
    recommendations: takeDistinct(
      rows.map((row) => recommendationFor(row, language)),
      MAX_RECOMMENDATIONS,
    ),
  };
}

/**
 * Builds the plan input for one scan.
 *
 * The Analytics module is excluded here, not filtered later: its findings are
 * Google data and never reach an AI provider (D-219/D-232). `buildActionPlanRequest`
 * asserts the same thing, so a future caller cannot quietly widen it.
 */
export async function buildActionPlanScanInput(
  prisma: PrismaClient,
  scanId: string,
  language: string,
): Promise<ActionPlanScanInput> {
  const [modules, ruleTotals] = await Promise.all([
    prisma.scanModule.findMany({
      where: { scanId },
      select: { module: true, runtimeStatus: true, score: true, coverage: true },
      orderBy: { module: 'asc' },
    }),
    readRuleTotals(prisma, scanId),
  ]);

  const rules = await Promise.all(
    ruleTotals.map((rule) => readRuleSamples(prisma, scanId, rule, language)),
  );

  const planModules = modules
    .filter((module) => module.module !== ACTION_PLAN_EXCLUDED_MODULE)
    .map((module): ActionPlanModuleInput => ({
      module: module.module,
      status: module.runtimeStatus,
      score: module.score,
      coverage: module.coverage,
    }));

  return {
    modules: planModules,
    rules,
    incompleteModules: planModules
      .filter((module) => isIncomplete(module.status))
      .map((module) => module.module),
  };
}
