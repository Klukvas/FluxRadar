// SEO-TECH-008 — index/noindex (page-level; severity из реестра contracts).
//
// Оракул: noindex-сигнал — <meta name="robots"> с токеном noindex/none либо
// заголовок X-Robots-Tag с noindex — даёт finding ТОЛЬКО при противоречии:
// страница одновременно присутствует в sitemap ИЛИ на неё ведут внутренние
// ссылки с других страниц. Просто noindex без противоречия — осознанное
// намерение владельца, НЕ finding (D-153). Self-ссылки страницы на саму
// себя противоречием не считаются. При обоих сигналах evidence — meta (dom).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding, SiteContext } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { findingMessage, type CataloguedFindingMessage } from '../messages/index.js';
import { metaContent, parsePage } from './dom.js';
import { internalLinkSources, sitemapNormalizedUrls } from './site-index.js';

const descriptor = requireDescriptor('SEO-TECH-008');
const NOINDEX_TOKENS: ReadonlySet<string> = new Set(['noindex', 'none']);

/** Что противоречит noindex: страница в sitemap или внутренние ссылки на неё. */
type Contradiction =
  { readonly kind: 'sitemap' } | { readonly kind: 'internal-links'; readonly sources: number };

export const seoTech008Noindex: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot, ctx: SiteContext): readonly RuleFinding[] {
    const metaRobots = metaContent(parsePage(page), 'robots');
    const metaNoindex = metaRobots !== null && hasNoindexToken(metaRobots);
    const headerRobots = headerValue(page.headers, 'x-robots-tag');
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
  const sources = internalLinkSources(ctx.crawl).get(page.normalizedUrl);
  const externalSources = [...(sources ?? [])].filter((source) => source !== page.normalizedUrl);
  if (externalSources.length > 0) {
    return { kind: 'internal-links', sources: externalSources.length };
  }
  return null;
}

/** Токены noindex/none в comma/colon-separated значении (case-insensitive). */
function hasNoindexToken(value: string): boolean {
  return value
    .toLowerCase()
    .split(/[,:;]/)
    .map((token) => token.trim())
    .some((token) => NOINDEX_TOKENS.has(token));
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | null {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return entry?.[1] ?? null;
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
