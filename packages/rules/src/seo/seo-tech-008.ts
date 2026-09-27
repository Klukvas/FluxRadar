// SEO-TECH-008 — index/noindex (page-level; severity из реестра contracts).
//
// Оракул: noindex-сигнал — <meta name="robots"> с токеном noindex/none либо
// заголовок X-Robots-Tag с noindex — даёт finding ТОЛЬКО при противоречии:
// страница одновременно присутствует в sitemap ИЛИ на неё ведут внутренние
// ссылки с других страниц. Просто noindex без противоречия — осознанное
// намерение владельца, НЕ finding (D-153). Self-ссылки страницы на саму
// себя противоречием не считаются — включая случай, когда страница ссылается на
// себя вторым своим адресом (`/p/` ссылается на `/p`, который 301 ведёт назад).
// При обоих сигналах evidence — meta (dom).
//
// Ссылки и sitemap читаются под ключом обхода (site-index.ts): под queryPolicy
// 'ignore' единственная ссылка `/p?page=2` ведёт на прочитанную страницу `/p`,
// а ссылка на `/about` — на страницу `/about/`, куда уводит её редирект. Обе
// раньше не считались противоречием — и обе им являются: сайт действительно
// ведёт на страницу, которую закрыл от индексации.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding, SiteContext } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { findingMessage, type CataloguedFindingMessage } from '../messages/index.js';
import { headerValue } from '../shared/headers.js';
import { metaContent, parsePage } from './dom.js';
import { hasNoindexToken } from './indexing.js';
import {
  discoveredTargets,
  inboundSources,
  SITEMAP_INPUT,
  sitemapNormalizedUrls,
} from './site-index.js';

const descriptor = requireDescriptor('SEO-TECH-008');

/** Что противоречит noindex: страница в sitemap или внутренние ссылки на неё. */
type Contradiction =
  { readonly kind: 'sitemap' } | { readonly kind: 'internal-links'; readonly sources: number };

export const seoTech008Noindex: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  // Противоречие живёт вне страницы: его создают ссылки ДРУГИХ страниц обхода
  // и sitemap. Обход, не дошедший до страницы-источника, теряет противоречие,
  // ничего не исправив, поэтому входы — прочитанные HTML-страницы и факт того,
  // что sitemap вообще был прочитан.
  //
  // Список — надмножество страниц, чьи ссылки правило и правда прочитало:
  // internalLinkSources берёт только страницы САЙТА (linkSourcePages), а здесь
  // назван и снимок, уехавший редиректом за область обхода. Лишний адрес тут
  // безвреден: страница, уехавшая за область, ссылок сайту больше не даёт, и
  // противоречия, которое держалось на её ссылке, у сайта действительно больше
  // нет.
  inputTargets: (ctx: SiteContext): readonly string[] => [
    ...ctx.crawl.pages.filter(isSuccessfulHtmlPage).map((page) => page.normalizedUrl),
    ...(sitemapNormalizedUrls(ctx.crawl).size > 0 ? [SITEMAP_INPUT] : []),
  ],
  // Спрос правила — все URL, которые обход вообще увидел. Страница, которой
  // сайт больше не упоминает нигде (ни ссылкой, ни sitemap-ом), противоречия
  // создать не может, и её исчезновение — не потеря данных. Sitemap остаётся
  // в спросе всегда: прогон, не нашедший его, ничего о нём не доказывает.
  requestedInputs: (ctx: SiteContext): readonly string[] => [
    ...discoveredTargets(ctx.crawl),
    SITEMAP_INPUT,
  ],
  evaluatePage(page: PageSnapshot, ctx: SiteContext): readonly RuleFinding[] {
    const metaRobots = metaContent(parsePage(page), 'robots');
    const metaNoindex = metaRobots !== null && hasNoindexToken(metaRobots);
    const headerRobots = headerValue(page, 'x-robots-tag');
    const headerNoindex = headerRobots !== null && hasNoindexToken(headerRobots);
    if (!metaNoindex && !headerNoindex) {
      return [];
    }
    const contradiction = findContradiction(page, ctx);
    if (contradiction === null) {
      return [];
    }
    return [
      noindexFinding(page, metaNoindex ? (metaRobots ?? '') : null, headerRobots, contradiction),
    ];
  },
};

function findContradiction(page: PageSnapshot, ctx: SiteContext): Contradiction | null {
  if (sitemapNormalizedUrls(ctx.crawl).has(page.normalizedUrl)) {
    return { kind: 'sitemap' };
  }
  // «Чужая страница» считается по документам, а не по адресам: страница,
  // ссылающаяся на себя вторым своим адресом (`/p/` → `/p`), противоречия не
  // создаёт, а две ссылки с одного документа под двумя его адресами — это одна
  // ссылка (inboundSources).
  const sources = inboundSources(ctx.crawl, page.normalizedUrl);
  if (sources.size > 0) {
    return { kind: 'internal-links', sources: sources.size };
  }
  return null;
}

function noindexFinding(
  page: PageSnapshot,
  metaRobots: string | null,
  headerRobots: string | null,
  contradiction: Contradiction,
): RuleFinding {
  const recommendation = findingMessage('seo-tech-008.recommendation', {});
  if (metaRobots !== null) {
    return pageFinding(descriptor, page, {
      evidenceType: 'dom',
      evidence: metaRobotsEvidence(metaRobots, contradiction),
      recommendation,
      selector: 'meta[name="robots"]',
    });
  }
  return pageFinding(descriptor, page, {
    evidenceType: 'http',
    evidence: robotsHeaderEvidence(headerRobots ?? '', contradiction),
    recommendation,
  });
}

function metaRobotsEvidence(
  content: string,
  contradiction: Contradiction,
): CataloguedFindingMessage {
  return contradiction.kind === 'sitemap'
    ? findingMessage('seo-tech-008.evidence.meta.sitemap', { content })
    : findingMessage('seo-tech-008.evidence.meta.internal-links', {
        content,
        sources: contradiction.sources,
      });
}

function robotsHeaderEvidence(
  value: string,
  contradiction: Contradiction,
): CataloguedFindingMessage {
  return contradiction.kind === 'sitemap'
    ? findingMessage('seo-tech-008.evidence.header.sitemap', { value })
    : findingMessage('seo-tech-008.evidence.header.internal-links', {
        value,
        sources: contradiction.sources,
      });
}
