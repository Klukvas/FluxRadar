// SEO-TECH-007 — дубли URL (site-level; severity из реестра contracts).
//
// Оракул: каждая группа crawl.urlVariants — normalizedUrl, обнаруженный под
// ≥2 raw-вариантами (краулер уже отфильтровал одиночные) — даёт один
// site-level finding; parameter = normalizedUrl группы (различает
// fingerprint-ы групп при пустом normalized_url D-019), excerpt перечисляет
// raw-варианты. Applicable — сайт (1); affected — 1 при любом числе групп.

import { requireDescriptor } from '../engine/descriptor.js';
import { siteFinding } from '../engine/finding.js';
import type { SiteContext, SiteRule, SiteRuleResult } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { discoveredTargets } from './site-index.js';

const descriptor = requireDescriptor('SEO-TECH-007');

export const seoTech007DuplicateUrls: SiteRule = {
  kind: 'site',
  descriptor,
  evaluateSite(ctx: SiteContext): SiteRuleResult {
    const groups = Object.entries(ctx.crawl.urlVariants).sort(([a], [b]) => a.localeCompare(b));
    const findings = groups.map(([normalized, variants]) =>
      siteFinding(descriptor, normalized, {
        evidenceType: 'http',
        evidence: findingMessage('seo-tech-007.evidence', {
          count: variants.length,
          url: normalized,
          variants: variants.join(', '),
        }),
        recommendation: findingMessage('seo-tech-007.recommendation', {}),
        parameter: normalized,
      }),
    );
    return {
      findings,
      applicableTargets: 1,
      affectedTargets: findings.length > 0 ? 1 : 0,
      // Варианты берутся из ссылок, найденных на загруженных HTML-страницах,
      // поэтому именно они — входы правила. Обход, увидевший меньше страниц,
      // теряет варианты без всякой починки, и закрывать по нему прошлую находку
      // нельзя (§14): политика Resolved сравнивает этот список со списком
      // прошлого прогона.
      checkedTargets: ctx.crawl.pages
        .filter((page) => isSuccessfulHtmlPage(page))
        .map((page) => page.normalizedUrl),
      // …но «страницы больше нет» и «страницу не обошли» — разные вещи.
      // Спрос правила — всё, что обход увидел; удалённая и никем не упомянутая
      // страница из него исчезает, и её отсутствие перестаёт навсегда
      // замораживать находку о дублях (§14, RuleEvaluation.requestedInputs).
      requestedInputs: discoveredTargets(ctx.crawl),
    };
  },
};
