// Правила перелинковки: orphan-страницы (TECH-009), глубина клика (TECH-010) и
// слабая связность (TECH-011). Positive → ровно ожидаемые findings, negative →
// пусто, отдельно — граница порога глубины и все виды неполного графа ссылок, при
// которых TECH-009/011 обязаны сообщить «не применимо», а не «проблем нет».

import type { CrawlResult } from '@fluxradar/crawler';
import { describe, expect, it } from 'vitest';

import type { IssueCandidate } from '../engine/run-module.js';
import { runModuleRules } from '../engine/run-module.js';
import type { RuleEvaluation, SiteContext } from '../engine/types.js';
import type { FixturePageInput } from '../testing/fixture-harness.js';
import { FIXTURE_ORIGIN, runSeoRule, siteContext } from '../testing/fixture-harness.js';
import { DEEP_PAGE_MIN_DEPTH } from './seo-tech-010.js';
import { linkGraphGap } from './site-index.js';

const url = (path: string): string => `${FIXTURE_ORIGIN}${path}`;

/** Страница с заголовком и списком внутренних ссылок. */
function page(path: string, links: readonly string[] = [], depth = 0): FixturePageInput {
  const anchors = links.map((href) => `<a href="${href}">${href}</a>`).join('');
  return {
    path,
    depth,
    html:
      `<!doctype html><html lang="en"><head><title>Page ${path}</title></head>` +
      `<body><h1>Page ${path}</h1>${anchors}</body></html>`,
  };
}

function evaluation(ruleId: string, ctx: SiteContext): RuleEvaluation {
  const found = runModuleRules('SEO', ctx).evaluations.find((entry) => entry.ruleId === ruleId);
  if (found === undefined) {
    throw new Error(`правило ${ruleId} не прогонялось`);
  }
  return found;
}

function single(candidates: readonly IssueCandidate[]): IssueCandidate {
  expect(candidates).toHaveLength(1);
  const first = candidates[0];
  if (first === undefined) {
    throw new Error('ожидался ровно один finding');
  }
  return first;
}

function paths(candidates: readonly IssueCandidate[]): readonly string[] {
  return candidates.map((candidate) => candidate.normalizedUrl.slice(FIXTURE_ORIGIN.length)).sort();
}

/** Тот же контекст с подменёнными полями обхода — для видов неполного графа. */
function withCrawl(ctx: SiteContext, overrides: Partial<CrawlResult>): SiteContext {
  return { ...ctx, crawl: { ...ctx.crawl, ...overrides } };
}

/** Сайт из трёх страниц: главная ссылается на /linked.html, /orphan.html — в sitemap. */
function siteWithOrphan(homeLinks: readonly string[] = ['/linked.html']): SiteContext {
  return siteContext({
    sitemapUrls: [url('/'), url('/linked.html'), url('/orphan.html')],
    pages: [page('/', homeLinks), page('/linked.html', ['/'], 1), page('/orphan.html', [], 1)],
  });
}

describe('SEO-TECH-009 orphan-страницы', () => {
  it('positive: страница из sitemap без входящих ссылок → finding со стабильным fingerprint', () => {
    const finding = single(runSeoRule('SEO-TECH-009', siteWithOrphan()));
    expect(finding.targetKind).toBe('page');
    expect(finding.severity).toBe('Medium');
    expect(finding.evidenceType).toBe('http');
    expect(finding.normalizedUrl).toBe(url('/orphan.html'));
    expect(finding.evidenceExcerpt).toBe(
      `The XML sitemap lists ${url('/orphan.html')}, yet none of the 3 crawled pages links to it`,
    );
    expect(finding.fingerprint).toBe(
      'fluxradar-fp-v1:e7589fe74979caa9742ca450ad3ffcfcb59be16ab4075a02d99ad85d36bf52d3',
    );
    // Один и тот же обход, прочитанный второй раз, даёт тот же fingerprint: в
    // него не входит ничего изменчивого (ни глубина, ни число источников).
    expect(single(runSeoRule('SEO-TECH-009', siteWithOrphan())).fingerprint).toBe(
      finding.fingerprint,
    );
  });

  it('negative: на страницу ведёт ссылка → пусто, но проверка применялась', () => {
    const ctx = siteWithOrphan(['/linked.html', '/orphan.html']);
    expect(runSeoRule('SEO-TECH-009', ctx)).toEqual([]);
    // Точка входа из кандидатов исключена: судимы /linked.html и /orphan.html.
    expect(evaluation('SEO-TECH-009', ctx).applicableTargets).toBe(2);
  });

  it('точка входа кандидатом не бывает, даже когда на неё не ведёт ни одна ссылка', () => {
    // Главная есть в sitemap и ссылок на себя не собрала — «orphan» о ней это
    // утверждение о навигации, а не о недоступности страницы.
    const ctx = siteContext({
      sitemapUrls: [url('/'), url('/linked.html')],
      pages: [page('/', ['/linked.html']), page('/linked.html', [], 1)],
    });
    expect(runSeoRule('SEO-TECH-009', ctx)).toEqual([]);
    expect(evaluation('SEO-TECH-009', ctx).checkedTargets).toEqual([url('/linked.html')]);
  });

  it('sitemap не прочитан → Not applicable, а не «orphan-страниц нет»', () => {
    const ctx = siteContext({ pages: [page('/', ['/linked.html']), page('/orphan.html', [], 1)] });
    const run = evaluation('SEO-TECH-009', ctx);
    expect(run.applicableTargets).toBe(0);
    expect(run.findings).toEqual([]);
    // Ни одной прочитанной цели → прошлую находку закрывать нечем (§14).
    expect(run.checkedTargets).toEqual([]);
  });

  it('URL из sitemap, отдавший 404, кандидатом не считается', () => {
    const ctx = siteContext({
      sitemapUrls: [url('/'), url('/gone.html'), url('/ok.html')],
      pages: [
        page('/', ['/gone.html', '/ok.html']),
        { path: '/gone.html', status: 404, html: null, depth: 1 },
        page('/ok.html', [], 1),
      ],
    });
    expect(runSeoRule('SEO-TECH-009', ctx)).toEqual([]);
    // Судило правило только о /ok.html: 404 — предмет SEO-TECH-003, а не разговора
    // о перелинковке.
    expect(evaluation('SEO-TECH-009', ctx).checkedTargets).toEqual([url('/ok.html')]);
  });

  it('URL из sitemap, уехавший редиректом, кандидатом не считается', () => {
    // Страница живёт по адресу назначения: «на /old.html никто не ссылается» —
    // это про содержимое sitemap (TECH-005), а не про доступность страницы.
    const ctx = siteContext({
      sitemapUrls: [url('/old.html')],
      pages: [
        page('/', ['/new.html']),
        {
          ...page('/old.html', [], 1),
          finalPath: '/new.html',
          redirectChain: [{ url: url('/old.html'), status: 301, location: url('/new.html') }],
        },
        page('/new.html', [], 1),
      ],
    });
    expect(runSeoRule('SEO-TECH-009', ctx)).toEqual([]);
    expect(evaluation('SEO-TECH-009', ctx).applicableTargets).toBe(0);
  });

  it.each([
    ['лимит тарифа', { skippedOverLimit: [url('/over-limit.html')] }, 'page-limit'],
    ['пауза обхода', { stoppedEarly: true }, 'stopped'],
    ['необработанная очередь', { pendingQueue: [{ url: url('/next.html'), depth: 1 }] }, 'stopped'],
    ['ошибка обхода', { errors: [{ url: url('/failed.html'), reason: 'timeout' }] }, 'unread-page'],
  ])('неполный граф (%s) → Not applicable, без ложной находки', (_name, overrides, gap) => {
    const ctx = withCrawl(siteWithOrphan(), overrides);
    expect(linkGraphGap(ctx)).toBe(gap);
    const run = evaluation('SEO-TECH-009', ctx);
    expect(run.applicableTargets).toBe(0);
    expect(run.findings).toEqual([]);
  });

  it('страница без тела обхода (transport-сбой) тоже закрывает правило', () => {
    const ctx = siteContext({
      sitemapUrls: [url('/orphan.html')],
      pages: [
        page('/', ['/linked.html']),
        { path: '/linked.html', fetchError: 'socket hang up', depth: 1 },
        page('/orphan.html', [], 1),
      ],
    });
    expect(linkGraphGap(ctx)).toBe('unread-page');
    expect(evaluation('SEO-TECH-009', ctx).applicableTargets).toBe(0);
  });

  it('ссылка на страницу того же хоста, о которой обход молчит, закрывает правило', () => {
    // Так выглядит усечение по scope: /excluded.html отброшен шаблонами и нигде
    // не отмечен, а его ссылки могли вести как раз на «orphan»-страницу.
    const ctx = siteWithOrphan(['/linked.html', '/excluded.html']);
    expect(linkGraphGap(ctx)).toBe('unreached-url');
    expect(evaluation('SEO-TECH-009', ctx).applicableTargets).toBe(0);
  });

  it('ссылка на чужой хост правило не закрывает', () => {
    const ctx = siteWithOrphan(['/linked.html', 'https://elsewhere.example/page.html']);
    expect(linkGraphGap(ctx)).toBeNull();
    expect(paths(runSeoRule('SEO-TECH-009', ctx))).toEqual(['/orphan.html']);
  });

  it('ссылка прямо на цель редиректа пробелом не считается', () => {
    const ctx = siteContext({
      sitemapUrls: [url('/orphan.html')],
      pages: [
        page('/', ['/redirect', '/final.html']),
        {
          ...page('/redirect', [], 1),
          finalPath: '/final.html',
          redirectChain: [{ url: url('/redirect'), status: 301, location: url('/final.html') }],
        },
        page('/orphan.html', [], 1),
      ],
    });
    expect(paths(runSeoRule('SEO-TECH-009', ctx))).toEqual(['/orphan.html']);
  });

  it('называет входами прочитанные ссылки и сам факт чтения sitemap', () => {
    const run = evaluation('SEO-TECH-009', siteWithOrphan());
    expect(run.inputTargets).toEqual([
      url('/'),
      url('/linked.html'),
      url('/orphan.html'),
      'sitemap:read',
    ]);
    expect(run.requestedInputs).toContain('sitemap:read');
  });
});

describe('SEO-TECH-010 глубина клика', () => {
  const deepSite = (depth: number): SiteContext =>
    siteContext({ pages: [page('/', ['/deep.html']), page('/deep.html', [], depth)] });

  it('positive: страница на пороговой глубине → finding (Low) с глубиной и точкой входа', () => {
    const finding = single(runSeoRule('SEO-TECH-010', deepSite(DEEP_PAGE_MIN_DEPTH)));
    expect(finding.targetKind).toBe('page');
    expect(finding.severity).toBe('Low');
    expect(finding.normalizedUrl).toBe(url('/deep.html'));
    expect(finding.evidenceExcerpt).toBe(
      `The page is 4 link hops away from the entry URL ${FIXTURE_ORIGIN} (threshold: 4)`,
    );
    expect(finding.fingerprint).toBe(
      'fluxradar-fp-v1:660038c1ce788461982a601ee7d82e233a33dd3208250dfce8620c5e465f3c64',
    );
  });

  it('boundary: на один переход выше порога → пусто', () => {
    expect(runSeoRule('SEO-TECH-010', deepSite(DEEP_PAGE_MIN_DEPTH - 1))).toEqual([]);
  });

  it('глубже порога — та же находка: fingerprint не зависит от самой глубины', () => {
    const atThreshold = single(runSeoRule('SEO-TECH-010', deepSite(DEEP_PAGE_MIN_DEPTH)));
    const deeper = single(runSeoRule('SEO-TECH-010', deepSite(DEEP_PAGE_MIN_DEPTH + 3)));
    expect(deeper.fingerprint).toBe(atThreshold.fingerprint);
    expect(deeper.evidenceExcerpt).toContain('7 link hops');
  });

  it('усечённый обход правило не глушит: глубина известна из самого снимка', () => {
    const ctx = withCrawl(deepSite(DEEP_PAGE_MIN_DEPTH), {
      skippedOverLimit: [url('/over-limit.html')],
    });
    expect(paths(runSeoRule('SEO-TECH-010', ctx))).toEqual(['/deep.html']);
  });

  it('судит каждую прочитанную HTML-страницу и своих входов не имеет', () => {
    const run = evaluation('SEO-TECH-010', deepSite(DEEP_PAGE_MIN_DEPTH));
    expect(run.applicableTargets).toBe(2);
    expect(run.affectedTargets).toBe(1);
    expect(run.inputTargets).toEqual([]);
  });
});

describe('SEO-TECH-011 слабо связанные страницы', () => {
  /** /weak.html держит одна ссылка с главной, /hub.html — две. */
  const linkedSite = (): SiteContext =>
    siteContext({
      pages: [
        page('/', ['/weak.html', '/hub.html'], 0),
        page('/weak.html', ['/hub.html'], 1),
        page('/hub.html', ['/'], 1),
      ],
    });

  it('positive: ровно одна входящая ссылка → finding (Low), evidence называет источник', () => {
    const finding = single(runSeoRule('SEO-TECH-011', linkedSite()));
    expect(finding.targetKind).toBe('page');
    expect(finding.severity).toBe('Low');
    expect(finding.normalizedUrl).toBe(url('/weak.html'));
    expect(finding.evidenceExcerpt).toBe(`Only one crawled page links to this one: ${url('/')}`);
    // Находка держится на снимке единственного источника (§14).
    expect(finding.dependencyTargets).toEqual([url('/')]);
    expect(finding.fingerprint).toBe(
      'fluxradar-fp-v1:36ebc8b585b4a6d157ee8344fef26935b2a5aa750b31d2c75587fae6a7927b94',
    );
  });

  it('точка входа исключена, даже когда на неё ведёт одна ссылка', () => {
    const ctx = siteContext({
      pages: [page('/', ['/hub.html']), page('/hub.html', ['/'], 1)],
    });
    // На / ведёт одна ссылка (с /hub.html) и на /hub.html — одна (с /); в
    // findings только /hub.html.
    expect(paths(runSeoRule('SEO-TECH-011', ctx))).toEqual(['/hub.html']);
    expect(evaluation('SEO-TECH-011', ctx).applicableTargets).toBe(1);
  });

  it('ссылка страницы на саму себя источником не считается', () => {
    const ctx = siteContext({
      pages: [
        page('/', ['/hub.html']),
        page('/hub.html', ['/hub.html', '/self.html'], 1),
        page('/self.html', ['/self.html'], 2),
      ],
    });
    // /self.html держит одна чужая ссылка (с /hub.html), собственная — нет.
    const finding = single(
      runSeoRule('SEO-TECH-011', ctx).filter((c) => c.normalizedUrl.endsWith('/self.html')),
    );
    expect(finding.evidenceExcerpt).toContain(url('/hub.html'));
  });

  it('повторные ссылки с одной страницы — один источник', () => {
    const ctx = siteContext({
      pages: [
        page('/', ['/weak.html', '/weak.html#section', '/weak.html']),
        page('/weak.html', [], 1),
      ],
    });
    expect(paths(runSeoRule('SEO-TECH-011', ctx))).toEqual(['/weak.html']);
  });

  it('ни одной входящей ссылки — не «слабая связь», а предмет TECH-009', () => {
    const ctx = siteContext({ pages: [page('/', []), page('/alone.html', [], 1)] });
    expect(runSeoRule('SEO-TECH-011', ctx)).toEqual([]);
  });

  it('неполный граф ссылок → Not applicable, без ложной находки', () => {
    const run = evaluation(
      'SEO-TECH-011',
      withCrawl(linkedSite(), { skippedOverLimit: [url('/over-limit.html')] }),
    );
    expect(run.applicableTargets).toBe(0);
    expect(run.findings).toEqual([]);
    expect(run.checkedTargets).toEqual([]);
  });

  it('входы правила — все прочитанные страницы обхода', () => {
    const run = evaluation('SEO-TECH-011', linkedSite());
    expect(run.inputTargets).toEqual([url('/'), url('/weak.html'), url('/hub.html')]);
    expect(run.applicableTargets).toBe(2);
    expect(run.affectedTargets).toBe(1);
  });
});
