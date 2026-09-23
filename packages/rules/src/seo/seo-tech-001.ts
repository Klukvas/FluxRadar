// SEO-TECH-001 — robots.txt (site-level; severity из реестра contracts).
//
// Оракул: robots.txt origin-а недоступен. Краулер кладёт crawl.robotsTxt
// только при HTTP 200 (D-141); явный ctx.robotsTxt имеет приоритет. Нет ни
// того ни другого → один site-level finding (evidence http). Наличие файла —
// даже пустого или невалидного — не finding: не-200 и сетевые ошибки для
// краулера значат «всё разрешено», а контент не валидируется в v0.1 (D-150).

import { requireDescriptor } from '../engine/descriptor.js';
import { siteFinding } from '../engine/finding.js';
import type { SiteContext, SiteRule, SiteRuleResult } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';

const descriptor = requireDescriptor('SEO-TECH-001');

export const seoTech001RobotsTxt: SiteRule = {
  kind: 'site',
  descriptor,
  evaluateSite(ctx: SiteContext): SiteRuleResult {
    const robotsTxt = ctx.robotsTxt ?? ctx.crawl.robotsTxt;
    // Вход правила один — попытка получить robots.txt origin-а, и обход делает её
    // всегда. Находка исчезает только тогда, когда файл теперь отдаётся: этого
    // достаточно, чтобы политика Resolved закрыла прошлую (§14).
    const checkedTargets = [`${ctx.domain}/robots.txt`];
    if (robotsTxt !== undefined) {
      return { findings: [], applicableTargets: 1, affectedTargets: 0, checkedTargets };
    }
    const targetUrl = `${ctx.domain}/robots.txt`;
    const finding = siteFinding(descriptor, targetUrl, {
      evidenceType: 'http',
      evidence: findingMessage('seo-tech-001.evidence', { url: targetUrl }),
      recommendation: findingMessage('seo-tech-001.recommendation', {}),
      resource: '/robots.txt',
    });
    return { findings: [finding], applicableTargets: 1, affectedTargets: 1, checkedTargets };
  },
};
