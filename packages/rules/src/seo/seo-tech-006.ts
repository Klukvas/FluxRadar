// SEO-TECH-006 — внутренние ссылки на 4xx/5xx (page-level; severity из
// реестра contracts).
//
// Оракул: на успешно загруженной HTML-странице каждый внутренний <a href>,
// чей target-снимок обхода имеет финальный статус ≥ 400, даёт finding на
// странице-ИСТОЧНИКЕ (selector = raw href, resource = нормализованный
// target). Ссылки без снимка (robots-blocked, за лимитом, вне scope) не
// оцениваются — статус неизвестен, evidence нет (D-152). Повторные href
// на одной странице схлопываются.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding, SiteContext } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { pageLinks, snapshotByNormalizedUrl } from './site-index.js';

const descriptor = requireDescriptor('SEO-TECH-006');

export const seoTech006BrokenLinks: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot, ctx: SiteContext): readonly RuleFinding[] {
    const snapshots = snapshotByNormalizedUrl(ctx.crawl);
    const reportedHrefs = new Set<string>();
    const findings: RuleFinding[] = [];
    for (const link of pageLinks(page)) {
      if (reportedHrefs.has(link.rawHref)) {
        continue;
      }
      const target = snapshots.get(link.normalizedTarget);
      if (target === undefined || target.fetchError !== undefined || target.status < 400) {
        continue;
      }
      reportedHrefs.add(link.rawHref);
      findings.push(brokenLinkFinding(page, link.rawHref, target));
    }
    return findings;
  },
};

function brokenLinkFinding(
  page: PageSnapshot,
  rawHref: string,
  target: PageSnapshot,
): RuleFinding {
  return pageFinding(descriptor, page, {
    evidenceType: 'http',
    evidence: `a[href="${rawHref}"] → HTTP ${target.status} (${target.finalUrl})`,
    recommendation:
      'Уберите или обновите ссылку: ведите на действующий URL либо восстановите ' +
      'целевую страницу.',
    selector: rawHref,
    resource: target.normalizedUrl,
  });
}
