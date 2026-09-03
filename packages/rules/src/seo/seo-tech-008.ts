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
import { metaContent, parsePage } from './dom.js';
import { internalLinkSources, sitemapNormalizedUrls } from './site-index.js';

const descriptor = requireDescriptor('SEO-TECH-008');
const NOINDEX_TOKENS: ReadonlySet<string> = new Set(['noindex', 'none']);

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
    return [noindexFinding(page, metaNoindex ? (metaRobots ?? '') : null, headerRobots, contradiction)];
  },
};

function findContradiction(page: PageSnapshot, ctx: SiteContext): string | null {
  if (sitemapNormalizedUrls(ctx.crawl).has(page.normalizedUrl)) {
    return 'страница присутствует в sitemap';
  }
  const sources = internalLinkSources(ctx.crawl).get(page.normalizedUrl);
  const externalSources = [...(sources ?? [])].filter((source) => source !== page.normalizedUrl);
  if (externalSources.length > 0) {
    return `на страницу ведут внутренние ссылки (${externalSources.length} источник(ов))`;
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
  contradiction: string,
): RuleFinding {
  if (metaRobots !== null) {
    return pageFinding(descriptor, page, {
      evidenceType: 'dom',
      evidence: `<meta name="robots" content="${metaRobots}">, при этом ${contradiction}`,
      recommendation: recommendationText(),
      selector: 'meta[name="robots"]',
    });
  }
  return pageFinding(descriptor, page, {
    evidenceType: 'http',
    evidence: `X-Robots-Tag: ${headerRobots ?? ''}, при этом ${contradiction}`,
    recommendation: recommendationText(),
  });
}

function recommendationText(): string {
  return (
    'Устраните противоречие сигналов индексации: либо уберите noindex, либо исключите ' +
    'страницу из sitemap и снимите внутренние ссылки на неё.'
  );
}
