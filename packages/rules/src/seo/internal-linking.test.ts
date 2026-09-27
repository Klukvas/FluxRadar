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
import { clickDepthsFromEntry } from './click-depth.js';
import { linkGraphGap } from './link-graph-gap.js';

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

/** Тот же снимок, отданный по адресу `path` и уехавший редиректом на `finalPath`. */
function redirected(
  path: string,
  finalPath: string,
  links: readonly string[] = [],
  depth = 1,
): FixturePageInput {
  return {
    ...page(path, links, depth),
    finalPath,
    redirectChain: [{ url: url(path), status: 301, location: url(finalPath) }],
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
    // Адрес прошёл все фильтры области (свой хост, без шаблонов, без maxDepth),
    // но снимка, лимита, robots.txt или ошибки под ним нет: обход обещал его
    // прочитать и не прочитал, а его ссылки могли вести на «orphan»-страницу.
    const ctx = siteWithOrphan(['/linked.html', '/unaccounted.html']);
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

  it('ссылка через редирект засчитывается странице назначения', () => {
    // Навигация ссылается на /about, сервер уводит на /about/: страница живёт по
    // адресу назначения, и ссылка ведёт именно на неё.
    const ctx = siteContext({
      sitemapUrls: [url('/about/')],
      pages: [
        page('/', ['/about']),
        {
          ...page('/about', [], 1),
          finalPath: '/about/',
          redirectChain: [{ url: url('/about'), status: 301, location: url('/about/') }],
        },
        page('/about/', ['/'], 1),
      ],
    });
    expect(runSeoRule('SEO-TECH-009', ctx)).toEqual([]);
    expect(evaluation('SEO-TECH-009', ctx).checkedTargets).toEqual([url('/about/')]);
  });

  it('точка входа, уводящая редиректом, исключена и под адресом назначения', () => {
    // https://fixture.test/ отвечает 301 на /en/, sitemap перечисляет /en/, а вся
    // навигация ссылается на `/`. Главная — это /en/, и orphan-ом она не бывает.
    const ctx = siteContext({
      sitemapUrls: [url('/en/'), url('/en/pricing.html')],
      pages: [
        {
          ...page('/', ['/en/pricing.html'], 0),
          finalPath: '/en/',
          redirectChain: [{ url: url('/'), status: 301, location: url('/en/') }],
        },
        page('/en/', ['/en/pricing.html'], 1),
        page('/en/pricing.html', ['/'], 2),
      ],
    });
    expect(runSeoRule('SEO-TECH-009', ctx)).toEqual([]);
    expect(evaluation('SEO-TECH-009', ctx).checkedTargets).toEqual([url('/en/pricing.html')]);
  });

  it('ссылка со страницы 404 источником не считается: это и есть orphan', () => {
    // 404 отдаёт HTML, и в нём бывают ссылки, но страницы, на которой они
    // «лежат», у сайта нет — навигацией такая ссылка не является.
    const ctx = siteContext({
      sitemapUrls: [url('/orphan.html')],
      pages: [
        page('/', ['/gone.html']),
        { ...page('/gone.html', ['/orphan.html'], 1), status: 404 },
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
  /**
   * Цепочка из `hops` переходов от точки входа: / → /step-1.html → … → /deep.html.
   *
   * `snapshotDepths` подменяет глубину снимков, не меняя ссылок: так выглядит
   * страница, которую обход нашёл seed-ом из sitemap, а не переходами.
   */
  function chain(hops: number, snapshotDepths: Readonly<Record<number, number>> = {}) {
    const pathAt = (step: number): string =>
      step === 0 ? '/' : step === hops ? '/deep.html' : `/step-${step}.html`;
    return Array.from({ length: hops + 1 }, (unused, step) =>
      page(pathAt(step), step === hops ? [] : [pathAt(step + 1)], snapshotDepths[step] ?? step),
    );
  }

  const deepSite = (hops: number): SiteContext => siteContext({ pages: chain(hops) });

  it('positive: страница на пороговой глубине → finding (Low) с глубиной и точкой входа', () => {
    const finding = single(runSeoRule('SEO-TECH-010', deepSite(DEEP_PAGE_MIN_DEPTH)));
    expect(finding.targetKind).toBe('page');
    expect(finding.severity).toBe('Low');
    expect(finding.evidenceType).toBe('http');
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
    const deeper = single(
      runSeoRule('SEO-TECH-010', deepSite(DEEP_PAGE_MIN_DEPTH + 3)).filter((candidate) =>
        candidate.normalizedUrl.endsWith('/deep.html'),
      ),
    );
    expect(deeper.fingerprint).toBe(atThreshold.fingerprint);
    expect(deeper.evidenceExcerpt).toContain('7 link hops');
  });

  it('глубина считается от точки входа, а не от ближайшего seed-а обхода', () => {
    // /step-5.html обход нашёл в sitemap и записал ему depth 1, но ссылками от
    // точки входа до /deep.html шесть переходов — о них и говорит evidence.
    const ctx = siteContext({
      sitemapUrls: [url('/step-5.html')],
      pages: chain(6, { 5: 1 }),
    });
    const finding = single(
      runSeoRule('SEO-TECH-010', ctx).filter((candidate) =>
        candidate.normalizedUrl.endsWith('/deep.html'),
      ),
    );
    expect(finding.evidenceExcerpt).toContain('6 link hops');
  });

  it('страница, до которой ссылками не дойти, глубины не получает', () => {
    // /alone.html есть только в sitemap: «в N переходах» о ней сказать нельзя,
    // и это предмет TECH-009, а не TECH-010.
    const ctx = siteContext({
      sitemapUrls: [url('/alone.html')],
      pages: [...chain(DEEP_PAGE_MIN_DEPTH), page('/alone.html', [], 1)],
    });
    expect(paths(runSeoRule('SEO-TECH-010', ctx))).toEqual(['/deep.html']);
  });

  it('недочитанная страница могла скрыть короткий путь → Not applicable', () => {
    // /hub.html не отдал тела: на самом деле /deep.html может быть в двух
    // переходах от точки входа, а по прочитанным ссылкам их четыре. Правило
    // обязано сказать «не применялось», а не назвать число, которого не знает.
    const ctx = siteContext({
      pages: [
        ...chain(DEEP_PAGE_MIN_DEPTH),
        { path: '/hub.html', fetchError: 'socket hang up', depth: 1 },
      ],
    });
    expect(linkGraphGap(ctx)).toBe('unread-page');
    const run = evaluation('SEO-TECH-010', ctx);
    expect(run.applicableTargets).toBe(0);
    expect(run.findings).toEqual([]);
  });

  it('обход, усечённый лимитом тарифа, тоже гасит правило', () => {
    const ctx = withCrawl(deepSite(DEEP_PAGE_MIN_DEPTH), {
      skippedOverLimit: [url('/over-limit.html')],
    });
    expect(evaluation('SEO-TECH-010', ctx).applicableTargets).toBe(0);
  });

  it('судит каждую прочитанную HTML-страницу, а входы — ссылки всех страниц', () => {
    const run = evaluation('SEO-TECH-010', deepSite(DEEP_PAGE_MIN_DEPTH));
    expect(run.applicableTargets).toBe(DEEP_PAGE_MIN_DEPTH + 1);
    expect(run.affectedTargets).toBe(1);
    expect(run.inputTargets).toHaveLength(DEEP_PAGE_MIN_DEPTH + 1);
    expect(run.requestedInputs).toContain(url('/deep.html'));
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

  it('адрес, уводящий редиректом, кандидатом не бывает, а его ссылки идут цели', () => {
    // Подвал ссылается на /about один раз, навигация трёх страниц — на /about/.
    // Страница одна, ссылок на неё четыре: «держит одна ссылка» не про неё, а
    // сам /about судить нельзя — это редирект, а не страница.
    const ctx = siteContext({
      pages: [
        page('/', ['/about', '/hub-a.html', '/hub-b.html']),
        {
          ...page('/about', [], 1),
          finalPath: '/about/',
          redirectChain: [{ url: url('/about'), status: 301, location: url('/about/') }],
        },
        page('/about/', ['/'], 1),
        page('/hub-a.html', ['/about/', '/hub-b.html'], 1),
        page('/hub-b.html', ['/about/', '/hub-a.html'], 1),
      ],
    });
    expect(paths(runSeoRule('SEO-TECH-011', ctx))).toEqual([]);
    // Кандидатами были три настоящие страницы, /about среди них нет.
    expect(evaluation('SEO-TECH-011', ctx).checkedTargets).toEqual([
      url('/about/'),
      url('/hub-a.html'),
      url('/hub-b.html'),
    ]);
  });

  it('единственная ссылающаяся страница — 404: не «слабая связь», а ноль ссылок', () => {
    const ctx = siteContext({
      pages: [
        page('/', ['/gone.html']),
        { ...page('/gone.html', ['/weak.html'], 1), status: 404 },
        page('/weak.html', [], 1),
      ],
    });
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

describe('документ под двумя адресами — одна страница, а не две', () => {
  // Так выглядит обычный сайт, а не редкость: sitemap перечисляет `/p/`,
  // навигация ссылается на `/p`. В `seen` краулера лежит только адрес из
  // sitemap, поэтому ссылку он ставит в очередь и получает через 301 второй
  // снимок той же страницы.

  it('ссылка с обоих адресов одного документа — один источник, а не два', () => {
    const ctx = siteContext({
      sitemapUrls: [url('/p/'), url('/q')],
      pages: [
        page('/', ['/p']),
        redirected('/p', '/p/', ['/q']),
        page('/p/', ['/q'], 1),
        page('/q', [], 2),
      ],
    });
    expect(linkGraphGap(ctx)).toBeNull();
    // /q держит ровно одна страница — та, что обход прочитал дважды.
    expect(paths(runSeoRule('SEO-TECH-011', ctx))).toEqual(['/p/', '/q']);
    const weak = single(
      runSeoRule('SEO-TECH-011', ctx).filter((candidate) => candidate.normalizedUrl === url('/q')),
    );
    expect(weak.evidenceExcerpt).toBe(`Only one crawled page links to this one: ${url('/p/')}`);
    // Источник назван адресом, по которому страница живёт, — и находка держится
    // на нём же (§14).
    expect(weak.dependencyTargets).toEqual([url('/p/')]);
  });

  it('ссылка страницы на саму себя вторым своим адресом источником не становится', () => {
    // /p/ ссылается только на /p, который 301 ведёт назад на /p/. Ссылок на эту
    // страницу нет ни одной: это orphan, а не «страница с одной ссылкой».
    const ctx = siteContext({
      sitemapUrls: [url('/p/')],
      pages: [
        page('/', ['/other']),
        page('/other', [], 1),
        page('/p/', ['/p'], 1),
        redirected('/p', '/p/', ['/p'], 2),
      ],
    });
    expect(linkGraphGap(ctx)).toBeNull();
    expect(paths(runSeoRule('SEO-TECH-009', ctx))).toEqual(['/p/']);
    expect(paths(runSeoRule('SEO-TECH-011', ctx))).toEqual(['/other']);
  });

  it('страница, на которую ссылаются только редиректящим адресом, всё равно судится', () => {
    // Sitemap-а нет, вся навигация написана как /about, сервер уводит на
    // /about/. Своего снимка у /about/ не будет никогда (markFinalUrlSeen),
    // поэтому единственный снимок судится под адресом назначения.
    const ctx = siteContext({
      pages: [page('/', ['/about']), redirected('/about', '/about/', ['/'])],
    });
    const finding = single(runSeoRule('SEO-TECH-011', ctx));
    expect(finding.normalizedUrl).toBe(url('/about'));
    expect(finding.targetUrl).toBe(url('/about/'));
    expect(finding.evidenceExcerpt).toBe(`Only one crawled page links to this one: ${url('/')}`);
  });

  it('два адреса, ведущие на одну непрочитанную страницу, дают один вердикт', () => {
    const ctx = siteContext({
      pages: [
        page('/', ['/about', '/about.html']),
        redirected('/about', '/about/'),
        redirected('/about.html', '/about/'),
      ],
    });
    expect(paths(runSeoRule('SEO-TECH-011', ctx))).toEqual(['/about']);
    expect(evaluation('SEO-TECH-011', ctx).applicableTargets).toBe(1);
  });

  it('когда у адреса назначения есть свой снимок, судит он, а не адрес редиректа', () => {
    const ctx = siteContext({
      pages: [
        page('/', ['/about', '/about/']),
        redirected('/about', '/about/'),
        page('/about/', ['/'], 1),
      ],
    });
    expect(paths(runSeoRule('SEO-TECH-011', ctx))).toEqual(['/about/']);
    expect(evaluation('SEO-TECH-011', ctx).checkedTargets).toEqual([url('/about/')]);
  });
});

describe('Not applicable называет свою причину, а не общую фразу', () => {
  it('обход из одной страницы: судить некого, а не «обход не дочитал»', () => {
    const ctx = siteContext({ pages: [page('/', [])] });
    expect(linkGraphGap(ctx)).toBeNull();
    const weak = evaluation('SEO-TECH-011', ctx);
    expect(weak.applicableTargets).toBe(0);
    expect(weak.notApplicableReason).toBe('no-candidates');
    // Sitemap-а этот обход не читал вовсе — у TECH-009 причина другая.
    expect(evaluation('SEO-TECH-009', ctx).notApplicableReason).toBe('no-sitemap');
    // А глубина клика на одной странице считается: точка входа — это глубина 0.
    expect(evaluation('SEO-TECH-010', ctx).applicableTargets).toBe(1);
  });

  it('sitemap перечисляет одну точку входа: кандидатов нет, но sitemap прочитан', () => {
    const ctx = siteContext({ sitemapUrls: [url('/')], pages: [page('/', [])] });
    const run = evaluation('SEO-TECH-009', ctx);
    expect(run.applicableTargets).toBe(0);
    expect(run.notApplicableReason).toBe('no-candidates');
  });

  it('неполный граф: все три правила называют именно пробел', () => {
    const ctx = withCrawl(siteWithOrphan(), { skippedOverLimit: [url('/over-limit.html')] });
    for (const ruleId of ['SEO-TECH-009', 'SEO-TECH-010', 'SEO-TECH-011']) {
      expect(evaluation(ruleId, ctx).notApplicableReason).toBe('link-graph-gap');
    }
  });

  it('у правила с непустым знаменателем причины нет вовсе', () => {
    expect(evaluation('SEO-TECH-011', siteWithOrphan()).notApplicableReason).toBeUndefined();
  });
});

describe('редирект за область обхода не делает чужую страницу страницей сайта', () => {
  const PARTNER = 'https://partner.example/landing';

  /** Снимок, уехавший редиректом на адрес за областью обхода. */
  function redirectedOutside(
    path: string,
    finalUrl: string,
    links: readonly string[] = [],
    depth = 1,
  ): FixturePageInput {
    return {
      ...page(path, links, depth),
      finalPath: finalUrl,
      redirectChain: [{ url: url(path), status: 302, location: finalUrl }],
    };
  }

  it('снимок чужой страницы кандидатом не бывает и глубины не получает', () => {
    // /go отвечает 302 на чужой хост, и там лежит 200 HTML. Краулер снимок
    // сохраняет (redirectChain — evidence TECH-005), но «эту страницу держит
    // одна ссылка» о ней было бы утверждением о чужом сайте.
    const ctx = siteContext({
      sitemapUrls: [url('/team')],
      pages: [
        page('/', ['/go', '/team']),
        redirectedOutside('/go', PARTNER),
        page('/team', ['/'], 1),
      ],
    });
    expect(linkGraphGap(ctx)).toBeNull();

    expect(paths(runSeoRule('SEO-TECH-011', ctx))).toEqual(['/team']);
    const weak = evaluation('SEO-TECH-011', ctx);
    expect(weak.checkedTargets).toEqual([url('/team')]);
    expect(weak.applicableTargets).toBe(1);
    // И TECH-010 не даёт ей глубины: судить о навигации владельца по чужой
    // странице нельзя, поэтому её нет ни в знаменателе, ни в карте глубин.
    expect(evaluation('SEO-TECH-010', ctx).checkedTargets).toEqual([url('/'), url('/team')]);
    expect([...clickDepthsFromEntry(ctx).keys()]).toEqual([url('/'), url('/team')]);
  });

  it('ссылки чужой страницы — не ссылки сайта и не пробел в его графе', () => {
    // Чужая страница ссылается на адрес сайта, которого обход не видел, и на
    // /team. Краулер её ссылок не извлекает вовсе (mayUseAsLinkSource): считать
    // их значило бы и погасить все три правила ложным пробелом, и объявить
    // /team связанным чужой навигацией.
    const ctx = siteContext({
      pages: [
        page('/', ['/go', '/team']),
        redirectedOutside('/go', PARTNER, [url('/secret.html'), url('/team')]),
        page('/team', ['/'], 1),
      ],
    });
    expect(linkGraphGap(ctx)).toBeNull();
    const weak = single(runSeoRule('SEO-TECH-011', ctx));
    expect(weak.normalizedUrl).toBe(url('/team'));
    expect(weak.evidenceExcerpt).toBe(`Only one crawled page links to this one: ${url('/')}`);
  });

  it('свой поддомен — «чужой» ровно тогда, когда обход по поддоменам не ходит', () => {
    const blog = 'https://blog.fixture.test/';
    const site = (includeSubdomains: boolean): SiteContext =>
      siteContext({
        scope: { includeSubdomains },
        pages: [
          page('/', ['/blog', '/team']),
          redirectedOutside('/blog', blog),
          page('/team', ['/'], 1),
        ],
      });

    // Профиль по умолчанию — includeSubdomains false, и это самая частая форма
    // ухода за область: /blog → https://blog.example.com/.
    const outside = site(false);
    expect(linkGraphGap(outside)).toBeNull();
    expect(paths(runSeoRule('SEO-TECH-011', outside))).toEqual(['/team']);

    // Обход, которому поддомены разрешены, читает ту же страницу как свою — и
    // судит её под адресом, по которому она живёт.
    const inside = site(true);
    expect(linkGraphGap(inside)).toBeNull();
    // Та же страница — своя: обход по поддоменам ходит, и правило её судит
    // наравне с остальными.
    expect(evaluation('SEO-TECH-011', inside).applicableTargets).toBe(2);
    expect(runSeoRule('SEO-TECH-011', inside)).toHaveLength(2);
  });
});

describe('пробел в графе ссылок меряется областью самого обхода', () => {
  type FixtureScope = Parameters<typeof siteContext>[0]['scope'];

  /** Сайт из трёх страниц с одной дополнительной ссылкой с главной. */
  function siteLinking(href: string, scope: FixtureScope = {}): SiteContext {
    return siteContext({
      scope,
      sitemapUrls: [url('/'), url('/orphan.html')],
      pages: [
        page('/', ['/linked.html', href]),
        page('/linked.html', ['/'], 1),
        page('/orphan.html', [], 1),
      ],
    });
  }

  it('queryPolicy ignore: ссылка с query ведёт на прочитанную страницу без query', () => {
    // Профиль по умолчанию — queryPolicy 'ignore', и обход прочитал /linked.html
    // один раз. Правило, нормализующее href по-своему, увидело бы здесь адрес, о
    // котором обход не отчитался, и замолчало бы на каждом сайте с ?page=2.
    const ctx = siteLinking('/linked.html?page=2');
    expect(linkGraphGap(ctx)).toBeNull();
    expect(paths(runSeoRule('SEO-TECH-009', ctx))).toEqual(['/orphan.html']);
  });

  it('queryPolicy ignore: ссылка с query — это ссылка на страницу без query', () => {
    // Единственная ссылка на /products.html написана с ?page=2. Обход дедупит её
    // к /products.html, поэтому страница связана, а не orphan.
    const ctx = siteContext({
      sitemapUrls: [url('/products.html')],
      pages: [page('/', ['/products.html?page=2']), page('/products.html', ['/'], 1)],
    });
    expect(runSeoRule('SEO-TECH-009', ctx)).toEqual([]);
    expect(evaluation('SEO-TECH-009', ctx).applicableTargets).toBe(1);
  });

  it('queryPolicy include: тот же адрес — отдельная страница, о которой обход молчит', () => {
    const ctx = siteLinking('/linked.html?page=2', { queryPolicy: 'include' });
    expect(linkGraphGap(ctx)).toBe('unreached-url');
    expect(evaluation('SEO-TECH-009', ctx).applicableTargets).toBe(0);
  });

  it('ссылка глубже maxDepth пробелом не считается: её и не собирались читать', () => {
    // Ссылка с главной — это глубина 1, а обходу разрешили только глубину 0.
    const ctx = siteLinking('/deeper.html', { maxDepth: 0 });
    expect(linkGraphGap(ctx)).toBeNull();
    expect(paths(runSeoRule('SEO-TECH-009', ctx))).toEqual(['/orphan.html']);
    // Без ограничения глубины тот же адрес — настоящий пробел: обход обещал его
    // прочитать и не прочитал.
    expect(linkGraphGap(siteLinking('/deeper.html'))).toBe('unreached-url');
  });

  it('ссылка, отброшенная шаблонами scope, пробелом не считается', () => {
    const excluded = siteLinking('/private/secret.html', { excludePatterns: ['/private/*'] });
    expect(linkGraphGap(excluded)).toBeNull();
    expect(paths(runSeoRule('SEO-TECH-009', excluded))).toEqual(['/orphan.html']);
  });

  it('поддомен: пробел ровно тогда, когда обход обещал по поддоменам ходить', () => {
    const subdomainLink = 'https://blog.fixture.test/post.html';
    expect(linkGraphGap(siteLinking(subdomainLink))).toBeNull();
    expect(linkGraphGap(siteLinking(subdomainLink, { includeSubdomains: true }))).toBe(
      'unreached-url',
    );
  });
});
