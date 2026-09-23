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
import { findingMessage } from '../messages/index.js';
import {
  linkTargets,
  pageLinks,
  respondingTargets,
  snapshotByNormalizedUrl,
} from './site-index.js';

const descriptor = requireDescriptor('SEO-TECH-006');

export const seoTech006BrokenLinks: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  // Вердикт о ссылке выносит снимок ЕЁ цели, а не страница-источник: без этих
  // снимков «находки больше нет» означает «цель не обходили» ровно так же
  // часто, как «ссылку починили» (§14, RuleEvaluation.inputTargets). Цель без
  // HTTP-ответа сюда не входит — её статус правилу неизвестен (D-152).
  inputTargets: (ctx: SiteContext): readonly string[] => respondingTargets(ctx.crawl),
  // А спрашивало правило о целях ВСЕХ ссылок обхода. Цель, которой здесь
  // больше нет, со страниц сайта исчезла: прошлая находка о ней — про
  // удалённую ссылку, и это починка, а не потерянный снимок.
  requestedInputs: (ctx: SiteContext): readonly string[] => linkTargets(ctx.crawl),
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

function brokenLinkFinding(page: PageSnapshot, rawHref: string, target: PageSnapshot): RuleFinding {
  return pageFinding(descriptor, page, {
    evidenceType: 'http',
    evidence: findingMessage('seo-tech-006.evidence', {
      href: rawHref,
      status: target.status,
      url: target.finalUrl,
    }),
    recommendation: findingMessage('seo-tech-006.recommendation', {}),
    selector: rawHref,
    resource: target.normalizedUrl,
    // Находка держится на одном чужом снимке — статусе цели ссылки. Он и
    // решает её судьбу в следующем прогоне: снимок повторился (цель жива или
    // починена) либо ссылки на неё больше нет — находка закрыта; снимка нет,
    // а ссылка осталась — статус неизвестен (§14).
    dependencyTargets: [target.normalizedUrl],
  });
}
