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
import { findingMessage } from '../messages/index.js';

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
    };
  },
};
