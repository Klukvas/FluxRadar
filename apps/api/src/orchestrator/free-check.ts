// Free-проверка (§18): фиксированные 4 правила против homepage —
// title, H1, meta description, индексация (FREE_CHECK_RULE_IDS, contracts).
// Мини-раннер повторяет агрегацию page-правил движка rules (D-156/D-121):
// прогон полного SEO-модуля с последующей фильтрацией исказил бы счётчики
// applicable/completed и показал бы пользователю Free находки платных правил.

import { FREE_CHECK_RULE_IDS, ruleById } from '@fluxradar/contracts';
import type { PageSnapshot } from '@fluxradar/crawler';
import { computeFingerprint, normalizeField } from '@fluxradar/fingerprint';
import { SEO_RULES } from '@fluxradar/rules';
import type { IssueCandidate, ModuleRunResult, PageRule, SiteContext } from '@fluxradar/rules';

function freeCheckRules(): readonly PageRule[] {
  return FREE_CHECK_RULE_IDS.map((ruleId) => {
    const rule = SEO_RULES.find((candidate) => candidate.descriptor.ruleId === ruleId);
    if (rule === undefined || rule.kind !== 'page') {
      // Все 4 правила Free-проверки — page-level по построению T-08.
      throw new Error(`free-check: правило ${ruleId} не найдено среди page-правил SEO`);
    }
    return rule;
  });
}

/**
 * Why a Free module row carries no score.
 *
 * Free has no tariff score weights (§18), so `score` is null by design rather
 * than for lack of readable data. The report has to be able to tell those two
 * apart, and a Completed module may not carry a status_reason (§15/§16) — so
 * the reason travels in the module metadata instead.
 */
export const FREE_CHECK_SCORING_REASON = 'NotScoredOnFreePlan';

/**
 * What the Free check actually looked at.
 *
 * The paid SEO module reports structured data and social preview coverage; the
 * Free check runs the four homepage rules above and nothing else. Writing the
 * paid metadata onto a Free row would advertise checks that never ran, so the
 * row carries the real rule list, taken from the registry rather than restated.
 */
export function freeCheckMetadata(): Record<string, unknown> {
  return {
    freeCheck: true,
    scope: 'homepage only',
    scoring: FREE_CHECK_SCORING_REASON,
    automation: 'static-html-homepage',
    checks: FREE_CHECK_RULE_IDS.map((ruleId) => ({ ruleId, title: descriptorFor(ruleId).title })),
  };
}

function descriptorFor(ruleId: string): { readonly title: string } {
  const descriptor = ruleById(ruleId);
  if (descriptor === undefined) {
    throw new Error(`free-check: ${ruleId} отсутствует в реестре`);
  }
  return descriptor;
}

/** Идентичная run-module сборка fingerprint (D-019 не задействован: все page). */
function fingerprintFor(candidateDomain: string, finding: IssueCandidate): string {
  return computeFingerprint({
    domain: candidateDomain,
    ruleId: finding.ruleId,
    targetKind: finding.targetKind,
    normalizedUrl: finding.normalizedUrl,
    normalizedResource: normalizeField(finding.normalizedResource),
    normalizedSelector: normalizeField(finding.normalizedSelector),
    normalizedParameter: normalizeField(finding.normalizedParameter),
    ruleVariant: finding.ruleVariant,
  });
}

export function runFreeCheck(ctx: SiteContext): ModuleRunResult {
  const evaluations = [];
  const candidates: IssueCandidate[] = [];
  let applicableChecks = 0;
  let completedApplicableChecks = 0;

  for (const rule of freeCheckRules()) {
    const descriptor = ruleById(rule.descriptor.ruleId);
    if (descriptor === undefined) {
      throw new Error(`free-check: ${rule.descriptor.ruleId} отсутствует в реестре`);
    }
    const applicablePages = ctx.crawl.pages.filter((page) => rule.isApplicable(page));
    const applicableSet = new Set<PageSnapshot>(applicablePages);
    // Снимок с fetchError вне applicable-набора — незакрытая проверка (D-156).
    const unreachableOutside = ctx.crawl.pages.filter(
      (page) => page.fetchError !== undefined && !applicableSet.has(page),
    );
    const findings = applicablePages.flatMap((page) => rule.evaluatePage(page, ctx));
    const affectedTargets = new Set(findings.map((finding) => finding.normalizedUrl)).size;

    evaluations.push({
      ruleId: rule.descriptor.ruleId,
      applicableTargets: applicablePages.length,
      affectedTargets,
      findings,
    });
    applicableChecks += applicablePages.length + unreachableOutside.length;
    completedApplicableChecks += applicablePages.length;

    for (const finding of findings) {
      const candidate: IssueCandidate = {
        ...finding,
        fingerprint: '',
        domain: ctx.domain,
        severity: descriptor.severity,
        scoreDelta: descriptor.scoring,
        affectedTargets,
        applicableTargets: applicablePages.length,
      };
      candidates.push({ ...candidate, fingerprint: fingerprintFor(ctx.domain, candidate) });
    }
  }

  const seen = new Set<string>();
  const findings = candidates.filter((candidate) => {
    if (seen.has(candidate.fingerprint)) {
      return false;
    }
    seen.add(candidate.fingerprint);
    return true;
  });

  return { evaluations, findings, applicableChecks, completedApplicableChecks };
}
