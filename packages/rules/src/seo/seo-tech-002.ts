// SEO-TECH-002 — sitemap.xml (site-level; severity из реестра contracts).
//
// Оракул: sitemap не найден — ни через директивы robots.txt, ни по
// стандартному /sitemap.xml. Сигнал v0.1 — crawl.sitemapUrls пуст:
// недоступный, невалидный и пустой sitemap на этом уровне неразличимы и
// трактуются одинаково как «sitemap не даёт ни одного URL» (D-150).

import { requireDescriptor } from '../engine/descriptor.js';
import { siteFinding } from '../engine/finding.js';
import type { SiteContext, SiteRule, SiteRuleResult } from '../engine/types.js';

const descriptor = requireDescriptor('SEO-TECH-002');

export const seoTech002Sitemap: SiteRule = {
  kind: 'site',
  descriptor,
  evaluateSite(ctx: SiteContext): SiteRuleResult {
    if (ctx.crawl.sitemapUrls.length > 0) {
      return { findings: [], applicableTargets: 1, affectedTargets: 0 };
    }
    const targetUrl = `${ctx.domain}/sitemap.xml`;
    const finding = siteFinding(descriptor, targetUrl, {
      evidenceType: 'http',
      evidence:
        `Ни директивы Sitemap в robots.txt, ни GET ${targetUrl} ` +
        'не дали ни одного URL — sitemap отсутствует, недоступен или пуст',
      recommendation:
        'Опубликуйте sitemap.xml со списком индексируемых страниц и укажите его ' +
        'в robots.txt директивой Sitemap.',
      resource: '/sitemap.xml',
    });
    return { findings: [finding], applicableTargets: 1, affectedTargets: 1 };
  },
};
