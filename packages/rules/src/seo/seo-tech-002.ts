// SEO-TECH-002 — sitemap.xml (site-level; severity из реестра contracts).
//
// Оракул: sitemap не найден — ни через директивы robots.txt, ни по
// стандартному /sitemap.xml. Сигнал v0.1 — crawl.sitemapUrls пуст:
// недоступный, невалидный и пустой sitemap на этом уровне неразличимы и
// трактуются одинаково как «sitemap не даёт ни одного URL» (D-150).

import { requireDescriptor } from '../engine/descriptor.js';
import { siteFinding } from '../engine/finding.js';
import type { SiteContext, SiteRule, SiteRuleResult } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';

const descriptor = requireDescriptor('SEO-TECH-002');

export const seoTech002Sitemap: SiteRule = {
  kind: 'site',
  descriptor,
  evaluateSite(ctx: SiteContext): SiteRuleResult {
    // Вход — поиск sitemap-а обходом (директивы robots.txt, затем стандартный
    // путь); обход выполняет его всегда. Находка исчезает лишь тогда, когда
    // sitemap отдал хотя бы один URL — доказательство для политики Resolved.
    const checkedTargets = [`${ctx.domain}/sitemap.xml`];
    if (ctx.crawl.sitemapUrls.length > 0) {
      return { findings: [], applicableTargets: 1, affectedTargets: 0, checkedTargets };
    }
    const targetUrl = `${ctx.domain}/sitemap.xml`;
    const finding = siteFinding(descriptor, targetUrl, {
      evidenceType: 'http',
      evidence: findingMessage('seo-tech-002.evidence', { url: targetUrl }),
      recommendation: findingMessage('seo-tech-002.recommendation', {}),
      resource: '/sitemap.xml',
    });
    return { findings: [finding], applicableTargets: 1, affectedTargets: 1, checkedTargets };
  },
};
