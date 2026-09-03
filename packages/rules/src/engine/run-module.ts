// Прогон правил модуля (T-08): агрегаты уровня правила (D-016/D-121),
// fingerprint-v1 для каждого finding, дедуп по fingerprint и счётчики
// coverage (§15): страница с fetchError — applicable check, который не был
// завершён (иначе «сайт лежит» давал бы coverage = 1 вопреки D-026).

import type { ModuleName, RuleScoring, Severity } from '@fluxradar/contracts';
import { ruleById } from '@fluxradar/contracts';
import type { PageSnapshot } from '@fluxradar/crawler';
import { computeFingerprint, normalizeField } from '@fluxradar/fingerprint';

import { rulesForModule } from '../registry.js';
import type {
  PageRule,
  Rule,
  RuleEvaluation,
  RuleFinding,
  SiteContext,
  SiteRuleResult,
} from './types.js';

/**
 * Issue-подобный объект: finding + идентичность (fingerprint/domain) и поля,
 * которые ждёт scoring (ScoredFinding, T-04) — severity из реестра, агрегаты
 * affected/applicable одинаковы у всех findings одного ruleId (D-016).
 */
export interface IssueCandidate extends RuleFinding {
  readonly fingerprint: string;
  readonly domain: string;
  readonly severity: Severity | null;
  readonly scoreDelta: RuleScoring;
  readonly affectedTargets: number;
  readonly applicableTargets: number;
}

export interface ModuleRunResult {
  readonly evaluations: readonly RuleEvaluation[];
  /** Дедуплицированы по fingerprint (первое вхождение побеждает). */
  readonly findings: readonly IssueCandidate[];
  readonly applicableChecks: number;
  readonly completedApplicableChecks: number;
}

export function runModuleRules(module: ModuleName, ctx: SiteContext): ModuleRunResult {
  const rules = rulesForModule(module);
  const runs = rules.map((rule) => evaluateRule(rule, ctx));
  const evaluations = runs.map((run) => run.evaluation);
  const findings = dedupByFingerprint(runs.flatMap((run) => toIssueCandidates(run, ctx)));
  return {
    evaluations,
    findings,
    applicableChecks: sumBy(runs, (run) => run.applicableChecks),
    completedApplicableChecks: sumBy(runs, (run) => run.completedChecks),
  };
}

interface RuleRun {
  readonly evaluation: RuleEvaluation;
  readonly applicableChecks: number;
  readonly completedChecks: number;
}

function evaluateRule(rule: Rule, ctx: SiteContext): RuleRun {
  if (rule.kind === 'page') {
    return evaluatePageRule(rule, ctx);
  }
  return toScopedRuleRun(
    rule.descriptor.ruleId,
    rule.kind === 'site' ? rule.evaluateSite(ctx) : rule.evaluateApiChecks(ctx),
  );
}

/**
 * Page-rule: applicable targets определяет rule.isApplicable (по умолчанию —
 * успешно загруженные HTML-страницы). Снимки с fetchError, которые правило не
 * взяло в работу, идут в applicableChecks без completedChecks — незавершённые
 * проверки недостижимых страниц снижают coverage модуля (§15).
 */
function evaluatePageRule(rule: PageRule, ctx: SiteContext): RuleRun {
  const applicablePages = ctx.crawl.pages.filter((page) => rule.isApplicable(page));
  const applicableSet = new Set<PageSnapshot>(applicablePages);
  const unreachableOutside = ctx.crawl.pages.filter(
    (page) => page.fetchError !== undefined && !applicableSet.has(page),
  );
  const findings = applicablePages.flatMap((page) => rule.evaluatePage(page, ctx));
  const affectedTargets = new Set(findings.map((finding) => finding.normalizedUrl)).size;
  return {
    evaluation: {
      ruleId: rule.descriptor.ruleId,
      applicableTargets: applicablePages.length,
      affectedTargets,
      findings,
    },
    applicableChecks: applicablePages.length + unreachableOutside.length,
    completedChecks: applicablePages.length,
  };
}

/** Site/api-правила сами считают applicable/affected (форма SiteRuleResult). */
function toScopedRuleRun(ruleId: string, result: SiteRuleResult): RuleRun {
  return {
    evaluation: {
      ruleId,
      applicableTargets: result.applicableTargets,
      affectedTargets: result.affectedTargets,
      findings: result.findings,
    },
    applicableChecks: result.applicableTargets,
    completedChecks: result.applicableTargets,
  };
}

function toIssueCandidates(run: RuleRun, ctx: SiteContext): readonly IssueCandidate[] {
  const { ruleId, applicableTargets, affectedTargets, findings } = run.evaluation;
  const descriptor = ruleById(ruleId);
  if (descriptor === undefined) {
    throw new Error(`runModuleRules: правило ${ruleId} отсутствует в реестре rules-mvp-0.1`);
  }
  return findings.map((finding) => ({
    ...finding,
    fingerprint: fingerprintFor(finding, ctx.domain),
    domain: ctx.domain,
    severity: descriptor.severity,
    scoreDelta: descriptor.scoring,
    affectedTargets,
    applicableTargets,
  }));
}

/** normalized_url в fingerprint пуст для site/environment (D-019). */
function fingerprintFor(finding: RuleFinding, domain: string): string {
  const isSiteLevel = finding.targetKind === 'site' || finding.targetKind === 'environment';
  return computeFingerprint({
    domain,
    ruleId: finding.ruleId,
    targetKind: finding.targetKind,
    normalizedUrl: isSiteLevel ? '' : finding.normalizedUrl,
    normalizedResource: normalizeField(finding.normalizedResource),
    normalizedSelector: normalizeField(finding.normalizedSelector),
    normalizedParameter: normalizeField(finding.normalizedParameter),
    ruleVariant: finding.ruleVariant,
  });
}

function dedupByFingerprint(candidates: readonly IssueCandidate[]): readonly IssueCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.fingerprint)) {
      return false;
    }
    seen.add(candidate.fingerprint);
    return true;
  });
}

function sumBy(runs: readonly RuleRun[], pick: (run: RuleRun) => number): number {
  return runs.reduce((total, run) => total + pick(run), 0);
}
