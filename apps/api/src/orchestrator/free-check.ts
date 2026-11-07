// Free-проверка (§18, D-237): фиксированный набор правил против homepage —
// title, H1, meta description, индексация, social preview, alt изображений
// (FREE_CHECK_RULE_IDS, contracts — единственный источник списка и его длины).
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
      // Все правила Free-проверки — page-level (ruleset.test.ts это держит).
      throw new Error(`free-check: правило ${ruleId} не найдено среди page-правил SEO`);
    }
    return rule;
  });
}

/**
 * What a Free SEO score is a score of.
 *
 * Free used to carry no score at all (`NotScoredOnFreePlan`, D-123). D-236
 * scores the Free homepage rules with the same rule penalties as every other
 * rules module, and the number describes the homepage only — never the site.
 * The row says so, so the report can label it a homepage score. The report
 * shows it out of 40 (free-score.ts, D-237); the stored value stays 0–100.
 */
export const FREE_CHECK_SCORE_SCOPE = 'homepage';

/**
 * The reason a Free row stored before D-236 carries, matched by readers of old
 * reports (the web app's scan-status.ts keeps the literal). Nothing writes it.
 */
export const LEGACY_FREE_CHECK_SCORING_REASON = 'NotScoredOnFreePlan';

/**
 * What the Free check actually looked at.
 *
 * The paid SEO module reports site-wide structured data and social preview
 * coverage; the Free check runs the homepage rules in FREE_CHECK_RULE_IDS and
 * nothing else. Writing the paid metadata onto a Free row would advertise
 * site-wide counts that were never taken, so the row carries the real rule
 * list, taken from the registry rather than restated.
 */
export function freeCheckMetadata(): Record<string, unknown> {
  return {
    freeCheck: true,
    scope: 'homepage only',
    scoreScope: FREE_CHECK_SCORE_SCOPE,
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
    const applicablePages = ctx.crawl.pages.filter((page) => rule.isApplicable(page, ctx));
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
      // Как и в движке: проверенными считаются только страницы, которые правило
      // взяло в работу (§14, run-coverage.ts).
      checkedTargets: applicablePages.map((page) => page.normalizedUrl),
      // Free — одна homepage-проверка правилами, ни одно из которых не смотрит
      // за пределы самой страницы.
      inputTargets: rule.inputTargets?.(ctx) ?? [],
      requestedInputs: rule.requestedInputs?.(ctx),
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
