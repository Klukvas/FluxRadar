// Область обхода в правилах перелинковки: редирект за её пределы не делает чужую
// страницу страницей сайта, а пробелом в графе ссылок считается только адрес,
// который обход собирался читать. Сами правила — в internal-linking.test.ts.

import { describe, expect, it } from 'vitest';
import type { SiteContext } from '../engine/types.js';
import type { FixturePageInput } from '../testing/fixture-harness.js';
import { runSeoRule, siteContext } from '../testing/fixture-harness.js';
import { evaluation, page, paths, single, url } from '../testing/link-fixtures.js';
import { clickDepthsFromEntry } from './click-depth.js';
import { linkGraphGap } from './link-graph-gap.js';

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
    // наравне с остальными…
    expect(evaluation('SEO-TECH-011', inside).applicableTargets).toBe(2);
    expect(runSeoRule('SEO-TECH-011', inside)).toHaveLength(2);
    // …и называет её адресом, по которому она живёт.
    expect(
      runSeoRule('SEO-TECH-011', inside)
        .map((finding) => finding.normalizedUrl)
        .sort(),
    ).toEqual([blog, url('/team')]);
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
