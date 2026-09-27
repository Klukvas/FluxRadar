// Один документ под двумя адресами — одна страница, а не две: кто из двух его
// снимков судит, каким адресом названа находка и почему её личность не вправе
// зависеть от порядка очереди обхода (§14). Сами правила — в
// internal-linking.test.ts.

import { describe, expect, it } from 'vitest';
import type { SiteContext } from '../engine/types.js';
import type { FixturePageInput } from '../testing/fixture-harness.js';
import { runSeoRule, siteContext } from '../testing/fixture-harness.js';
import { evaluation, page, paths, redirected, single, url } from '../testing/link-fixtures.js';
import { linkGraphGap } from './link-graph-gap.js';

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
    // поэтому единственный снимок судится под адресом назначения — и называется
    // им же: адресом, по которому страница живёт.
    const ctx = siteContext({
      pages: [page('/', ['/about']), redirected('/about', '/about/', ['/'])],
    });
    const finding = single(runSeoRule('SEO-TECH-011', ctx));
    expect(finding.normalizedUrl).toBe(url('/about/'));
    expect(finding.targetUrl).toBe(url('/about/'));
    expect(finding.evidenceExcerpt).toBe(`Only one crawled page links to this one: ${url('/')}`);
    expect(evaluation('SEO-TECH-011', ctx).checkedTargets).toEqual([url('/about/')]);
  });

  it('два адреса, ведущие на одну непрочитанную страницу, дают один вердикт', () => {
    const ctx = siteContext({
      pages: [
        page('/', ['/about', '/about.html']),
        redirected('/about', '/about/'),
        redirected('/about.html', '/about/'),
      ],
    });
    expect(paths(runSeoRule('SEO-TECH-011', ctx))).toEqual(['/about/']);
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

describe('находка о странице названа адресом документа, а не порядком очереди обхода', () => {
  // Есть ли у /about/ свой снимок, решает порядок очереди краулера
  // (markFinalUrlSeen), а не сайт: прогон A ставит в очередь только /about,
  // прогон B — ещё и /about/. Находка, названная адресом снимка, меняла бы
  // личность между этими прогонами, и новый прогон открывал бы вторую issue о
  // той же странице, не закрыв первую (§14).
  const runA = (): SiteContext =>
    siteContext({ pages: [page('/', ['/about']), redirected('/about', '/about/', ['/'])] });
  const runB = (): SiteContext =>
    siteContext({
      pages: [
        page('/', ['/about', '/about/']),
        redirected('/about', '/about/', ['/']),
        page('/about/', ['/'], 1),
      ],
    });

  it('TECH-011: оба прогона дают одну личность, и второй вправе закрыть находку первого', () => {
    const first = single(runSeoRule('SEO-TECH-011', runA()));
    const second = single(runSeoRule('SEO-TECH-011', runB()));

    expect(first.normalizedUrl).toBe(url('/about/'));
    expect(second.normalizedUrl).toBe(first.normalizedUrl);
    expect(second.fingerprint).toBe(first.fingerprint);
    // Условие политики Resolved: цель прошлой находки названа среди
    // проверенных нового прогона (resolution-policy.ts provesRepeatCheck).
    expect(evaluation('SEO-TECH-011', runB()).checkedTargets).toContain(first.normalizedUrl);
  });

  it('TECH-010: та же личность и один вердикт на документ, а не два', () => {
    const chainTo = (deep: FixturePageInput, extra: readonly FixturePageInput[] = []) =>
      siteContext({
        pages: [
          page('/', ['/s1']),
          page('/s1', ['/s2'], 1),
          page('/s2', ['/s3'], 2),
          page('/s3', ['/deep', '/deep/'], 3),
          deep,
          ...extra,
        ],
      });
    const deepRunA = chainTo(redirected('/deep', '/deep/', ['/'], 4));
    const deepRunB = chainTo(redirected('/deep', '/deep/', ['/'], 4), [page('/deep/', ['/'], 4)]);

    const first = single(runSeoRule('SEO-TECH-010', deepRunA));
    const second = single(runSeoRule('SEO-TECH-010', deepRunB));
    expect(first.normalizedUrl).toBe(url('/deep/'));
    expect(second.normalizedUrl).toBe(first.normalizedUrl);
    expect(second.fingerprint).toBe(first.fingerprint);
    // Знаменатель считает документы: пять страниц в обоих прогонах, хотя во
    // втором снимков шесть.
    expect(evaluation('SEO-TECH-010', deepRunA).applicableTargets).toBe(5);
    expect(evaluation('SEO-TECH-010', deepRunB).applicableTargets).toBe(5);
    expect(evaluation('SEO-TECH-010', deepRunB).checkedTargets).toContain(first.normalizedUrl);
  });

  it('TECH-009 судит только собственные адреса, поэтому личность раздвоить нечем', () => {
    // Адрес из sitemap, уехавший редиректом, кандидатом не бывает вовсе
    // (sitemapPages → isOwnAddress): у кандидата TECH-009 адрес документа всегда
    // равен его собственному.
    const ctx = siteContext({
      sitemapUrls: [url('/about'), url('/orphan.html')],
      pages: [
        page('/', ['/linked.html']),
        page('/linked.html', ['/'], 1),
        redirected('/about', '/about/', ['/']),
        page('/orphan.html', [], 1),
      ],
    });
    const run = evaluation('SEO-TECH-009', ctx);
    expect(run.checkedTargets).toEqual([url('/orphan.html')]);
    expect(paths(runSeoRule('SEO-TECH-009', ctx))).toEqual(['/orphan.html']);
  });
});
