// Интеграция T-07 → T-08: полный прогон SEO-модуля на fixture-сайте краулера.
// Ожидания выведены из содержимого fixtures/site (T-07, D-145): точный набор
// {ruleId → normalizedUrl[]}; длины title/description пересчитаны по факту
// (десять страниц имеют meta description короче 50 символов — ONPAGE-002).
//
// Правила перелинковки (TECH-009/010/011) проверяются здесь на НАСТОЯЩЕМ обходе:
// глубину и граф ссылок собирает краулер, а не фикстура, и только так видно, что
// правило читает именно то, что обход записал.

import type { CrawlOptions, CrawlResult, FixtureSite } from '@fluxradar/crawler';
import { crawl, startFixtureSite } from '@fluxradar/crawler';
import { HostLimiter } from '@fluxradar/safe-fetch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ModuleRunResult } from '../engine/run-module.js';
import { runModuleRules } from '../engine/run-module.js';
import { createSiteContext } from '../engine/site-context.js';
import type { RuleEvaluation } from '../engine/types.js';
import { clickDepthsFromEntry } from './click-depth.js';

let site: FixtureSite;
let origin = '';
let crawlResult: CrawlResult;
let result: ModuleRunResult;

/** Быстрый loopback-обход: тот же транспорт для всех прогонов этого файла. */
function crawlOptions(): CrawlOptions {
  return {
    dangerouslyAllowLoopback: true,
    limiter: new HostLimiter({ rps: 1000, concurrency: 4 }),
    logger: { warn: () => undefined },
  };
}

beforeAll(async () => {
  site = await startFixtureSite();
  origin = site.origin;
  crawlResult = await crawl({ origin, includeSubdomains: false, maxPages: 50 }, crawlOptions());
  result = runModuleRules(
    'SEO',
    createSiteContext({ origin, crawl: crawlResult, plan: 'Complete' }),
  );
}, 30_000);

afterAll(async () => {
  await site.close();
});

/** ruleId → отсортированные пути findings ('' — site-level, D-019). */
function findingPathsByRule(): Readonly<Record<string, readonly string[]>> {
  const byRule = new Map<string, string[]>();
  for (const finding of result.findings) {
    const path = finding.normalizedUrl === '' ? '' : finding.normalizedUrl.slice(origin.length);
    const paths = byRule.get(finding.ruleId) ?? [];
    paths.push(path);
    byRule.set(finding.ruleId, paths);
  }
  return Object.fromEntries([...byRule].map(([ruleId, paths]) => [ruleId, [...paths].sort()]));
}

describe('SEO-модуль на fixture-сайте краулера', () => {
  it('даёт точный ожидаемый набор {ruleId → normalizedUrl[]}', () => {
    expect(findingPathsByRule()).toEqual({
      // robots.txt и sitemap.xml на fixture-сайте есть → TECH-001/002 молчат.
      'SEO-TECH-003': ['/missing'],
      'SEO-TECH-004': [
        '/broken-image.html',
        '/broken-link.html',
        '/deep/',
        '/deep/level2/page.html',
        '/dup-a.html',
        '/dup-b.html',
        '/empty.html',
        '/form.html',
        '/mixed-content.html',
        '/no-title.html',
        '/noindex.html',
        '/orphan.html',
        '/redirect-a',
        '/trackers.html',
        '/wrong-canonical.html',
      ],
      'SEO-TECH-005': ['/redirect-a'],
      'SEO-TECH-006': ['/broken-link.html'],
      'SEO-TECH-007': [''],
      'SEO-TECH-008': ['/noindex.html'],
      // Единственная страница sitemap без входящих ссылок (TECH-009); на /
      // и /no-title.html ссылки есть, и точка входа кандидатом не бывает.
      'SEO-TECH-009': ['/orphan.html'],
      // Fixture-сайт — «звезда» из главной: каждую страницу держит ровно одна
      // ссылка. /orphan.html здесь нет (нулю ссылок место в TECH-009), / — точка
      // входа, /missing — не 2xx, а /private/secret.html закрыт robots.txt.
      // /redirect-final.html в списке есть: своего снимка у него в обходе нет,
      // поэтому единственный снимок (/redirect-a, 301) судится под адресом
      // назначения — и называется им же, а не адресом редиректа. Его тоже держит
      // ровно одна ссылка с главной.
      'SEO-TECH-011': [
        '/broken-image.html',
        '/broken-link.html',
        '/deep/',
        '/deep/level2/page.html',
        '/dup-a.html',
        '/dup-b.html',
        '/empty.html',
        '/form.html',
        '/mixed-content.html',
        '/no-title.html',
        '/noindex.html',
        '/redirect-final.html',
        '/trackers.html',
        '/wrong-canonical.html',
      ],
      'SEO-TECH-013': ['/mixed-content.html'],
      'SEO-ONPAGE-001': ['/no-title.html'],
      'SEO-ONPAGE-002': [
        '/deep/level2/page.html',
        '/dup-a.html',
        '/dup-b.html',
        '/empty.html',
        '/form.html',
        '/mixed-content.html',
        '/no-title.html',
        '/noindex.html',
        '/orphan.html',
        '/redirect-a',
      ],
      // Единственная страница без h1 — почти пустой /empty.html.
      'SEO-ONPAGE-003': ['/empty.html'],
      'SEO-ONPAGE-005': ['/broken-image.html'],
      'SEO-SOCIAL-001': [
        '/',
        '/broken-image.html',
        '/broken-link.html',
        '/deep/',
        '/deep/level2/page.html',
        '/dup-a.html',
        '/dup-b.html',
        '/empty.html',
        '/form.html',
        '/mixed-content.html',
        '/no-title.html',
        '/noindex.html',
        '/orphan.html',
        '/redirect-a',
        '/trackers.html',
        '/wrong-canonical.html',
      ],
    });
  });

  it('дубль URL: группа dup-a с utm-вариантом, fingerprint-ы уникальны', () => {
    const duplicate = result.findings.find((finding) => finding.ruleId === 'SEO-TECH-007');
    expect(duplicate?.normalizedParameter).toBe(`${origin}/dup-a.html`);
    const fingerprints = result.findings.map((finding) => finding.fingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
    expect(result.findings).toHaveLength(65);
  });

  it('агрегаты и coverage: 17 снимков без fetchError → все checks завершены', () => {
    expect(crawlResult.pages).toHaveLength(17);
    // 12 default page-rules × 16 (2xx HTML) + TECH-003/005 × 17 + 3 site-rules +
    // TECH-009 × 2 (страницы sitemap, кроме точки входа: адрес редиректа среди
    // них не считается — это предмет TECH-005) + TECH-011 × 15 (2xx HTML без
    // точки входа). Граф ссылок полон, поэтому применимы все три правила
    // перелинковки, включая TECH-010 (в «12 page-rules»).
    expect(result.applicableChecks).toBe(246);
    expect(result.completedApplicableChecks).toBe(246);
    const canonical = result.evaluations.find((entry) => entry.ruleId === 'SEO-TECH-004');
    expect(canonical?.applicableTargets).toBe(16);
    expect(canonical?.affectedTargets).toBe(15);
  });

  it('severity Issue-кандидатов приходит из реестра contracts', () => {
    const byRule = new Map(result.findings.map((finding) => [finding.ruleId, finding.severity]));
    expect(byRule.get('SEO-TECH-006')).toBe('High');
    expect(byRule.get('SEO-TECH-013')).toBe('High');
    expect(byRule.get('SEO-ONPAGE-005')).toBe('Low');
  });
});

/** Пути findings одного правила в произвольном прогоне модуля. */
function rulePaths(run: ModuleRunResult, ruleId: string): readonly string[] {
  return run.findings
    .filter((finding) => finding.ruleId === ruleId)
    .map((finding) => finding.normalizedUrl.slice(origin.length))
    .sort();
}

function ruleRun(run: ModuleRunResult, ruleId: string): RuleEvaluation {
  const found = run.evaluations.find((entry) => entry.ruleId === ruleId);
  if (found === undefined) {
    throw new Error(`правило ${ruleId} не прогонялось`);
  }
  return found;
}

function seoRun(crawl: CrawlResult, entryUrl: string = origin): ModuleRunResult {
  return runModuleRules('SEO', createSiteContext({ origin: entryUrl, crawl, plan: 'Complete' }));
}

describe('перелинковка на настоящем обходе fixture-сайта', () => {
  it('глубина клика считается по ссылкам обхода, а не по глубине снимка', () => {
    const depthOf = (path: string): number | undefined =>
      crawlResult.pages.find((page) => page.normalizedUrl === `${origin}${path}`)?.depth;

    expect(depthOf('/')).toBe(0);
    expect(depthOf('/deep/')).toBe(1);
    expect(depthOf('/deep/level2/page.html')).toBe(2);
    // Страница из sitemap — seed обхода: снимок получает глубину 1 независимо от
    // того, сколько кликов до неё ведёт. Правило же считает переходы от точки
    // входа, и до /orphan.html их нет вовсе — это предмет TECH-009.
    expect(depthOf('/orphan.html')).toBe(1);
    const depths = clickDepthsFromEntry(
      createSiteContext({ origin, crawl: crawlResult, plan: 'Complete' }),
    );
    expect(depths.get(`${origin}/`)).toBe(0);
    expect(depths.get(`${origin}/deep/level2/page.html`)).toBe(2);
    expect(depths.has(`${origin}/orphan.html`)).toBe(false);
    // Самая глубокая страница сайта — на два перехода от главной, поэтому порог
    // TECH-010 на обходе по умолчанию не достигается вовсе.
    expect(Math.max(...depths.values())).toBe(2);
    expect(rulePaths(result, 'SEO-TECH-010')).toEqual([]);
  });

  it('цепочка /chain: страница в четырёх переходах от seed-а даёт TECH-010', async () => {
    // Цепочка не связана с остальным сайтом и нет её в sitemap, поэтому обход по
    // умолчанию её не видит (17 страниц остаются 17). Явный seed делает
    // /chain/1.html точкой входа: дальше глубины 1, 2, 3, 4 считает сам краулер.
    const chained = await crawl(
      {
        origin,
        includeSubdomains: false,
        maxPages: 50,
        seedUrls: [`${origin}/chain/1.html`],
      },
      crawlOptions(),
    );
    const chainDepths = Object.fromEntries(
      chained.pages
        .filter((page) => page.normalizedUrl.includes('/chain/'))
        .map((page) => [page.normalizedUrl.slice(origin.length), page.depth]),
    );
    expect(chainDepths).toEqual({
      '/chain/1.html': 0,
      '/chain/2.html': 1,
      '/chain/3.html': 2,
      '/chain/4.html': 3,
      '/chain/5.html': 4,
    });

    // Точка входа этого прогона — сама цепочка: правило считает переходы от неё,
    // и остальной сайт ссылками с /chain/1.html недостижим.
    const chainEntry = `${origin}/chain/1.html`;
    const chainedRun = seoRun(chained, chainEntry);
    // Ровно последняя страница цепочки: /chain/4.html на один переход ближе порога.
    expect(rulePaths(chainedRun, 'SEO-TECH-010')).toEqual(['/chain/5.html']);
    const deep = chainedRun.findings.find((finding) => finding.ruleId === 'SEO-TECH-010');
    expect(deep?.evidenceExcerpt).toBe(
      `The page is 4 link hops away from the entry URL ${chainEntry} (threshold: 4)`,
    );
    // Каждую страницу цепочки держит ровно одна ссылка с предыдущей; /chain/1.html
    // не держит ни одна — он seed.
    expect(rulePaths(chainedRun, 'SEO-TECH-011')).toContain('/chain/5.html');
    expect(rulePaths(chainedRun, 'SEO-TECH-011')).not.toContain('/chain/1.html');
  });

  it('sitemap не прочитан → TECH-009 Not applicable, orphan-находки нет', () => {
    // Тот же обход, но sitemap сайта не отдался: у правила не остаётся ни одной
    // заявленной владельцем страницы, и молчать оно обязано именно как «не
    // применимо», а не как «orphan-страниц нет».
    const withoutSitemap = seoRun({ ...crawlResult, sitemapUrls: [] });
    expect(rulePaths(withoutSitemap, 'SEO-TECH-009')).toEqual([]);
    expect(ruleRun(withoutSitemap, 'SEO-TECH-009').applicableTargets).toBe(0);
    // Слабая связность от sitemap не зависит и продолжает работать.
    expect(ruleRun(withoutSitemap, 'SEO-TECH-011').applicableTargets).toBe(15);
  });

  it('обход, усечённый лимитом страниц, не выдаёт ложных orphan и слабых связей', async () => {
    const truncated = await crawl(
      { origin, includeSubdomains: false, maxPages: 6 },
      crawlOptions(),
    );
    // /orphan.html — seed из sitemap, поэтому в усечённый обход он попал, а
    // страницы, которые могли бы на него ссылаться, — нет.
    expect(truncated.pages.map((page) => page.normalizedUrl)).toContain(`${origin}/orphan.html`);
    expect(truncated.skippedOverLimit.length).toBeGreaterThan(0);

    const truncatedRun = seoRun(truncated);
    for (const ruleId of ['SEO-TECH-009', 'SEO-TECH-010', 'SEO-TECH-011']) {
      expect({ ruleId, paths: rulePaths(truncatedRun, ruleId) }).toEqual({ ruleId, paths: [] });
      expect({ ruleId, applicable: ruleRun(truncatedRun, ruleId).applicableTargets }).toEqual({
        ruleId,
        applicable: 0,
      });
    }
  });

  it('queryPolicy ignore: ссылка с query засчитывается странице без query', async () => {
    // /query-links.html ни с чего не связан и в sitemap не указан, поэтому обход
    // по умолчанию его не видит; явный seed добавляет ровно одну страницу, и
    // единственная её ссылка написана как /dup-a.html?sort=asc (не utm — такой
    // параметр normalizeUrl не срезает).
    const withQueryLink = await crawl(
      {
        origin,
        includeSubdomains: false,
        maxPages: 50,
        queryPolicy: 'ignore',
        seedUrls: [`${origin}/query-links.html`],
      },
      crawlOptions(),
    );
    expect(withQueryLink.pages).toHaveLength(18);
    expect(withQueryLink.pages.map((page) => page.normalizedUrl)).toContain(
      `${origin}/query-links.html`,
    );
    // Отдельной страницы под ?sort=asc обход не завёл: это тот же /dup-a.html.
    expect(withQueryLink.pages.map((page) => page.normalizedUrl)).not.toContain(
      `${origin}/dup-a.html?sort=asc`,
    );

    const queryRun = seoRun(withQueryLink);
    // Граф ссылок полон: адрес с query — не пробел в обходе, а прочитанная страница.
    expect(ruleRun(queryRun, 'SEO-TECH-009').applicableTargets).toBeGreaterThan(0);
    expect(ruleRun(queryRun, 'SEO-TECH-011').applicableTargets).toBeGreaterThan(0);
    // И ссылка засчитана /dup-a.html: с главной и с /query-links.html — две
    // ссылки, поэтому в обходе по умолчанию слабо связанная страница, а здесь нет.
    expect(rulePaths(result, 'SEO-TECH-011')).toContain('/dup-a.html');
    expect(rulePaths(queryRun, 'SEO-TECH-011')).not.toContain('/dup-a.html');
  });

  it('обход, ограниченный глубиной, остаётся полным в пределах своей области', async () => {
    // maxDepth — решение владельца, а не потеря данных: ссылка на шаг глубже
    // нигде не отмечается, но обход прочитал всё, что собирался, и правила
    // перелинковки обязаны работать (иначе профиль по умолчанию с maxDepth 5
    // молча гасил бы их почти на каждом сайте).
    const shallow = await crawl(
      { origin, includeSubdomains: false, maxPages: 50, maxDepth: 1 },
      crawlOptions(),
    );
    const read = shallow.pages.map((page) => page.normalizedUrl);
    expect(read).toContain(`${origin}/deep/`);
    // Страница на глубине 2 в обход не попала и нигде не отмечена.
    expect(read).not.toContain(`${origin}/deep/level2/page.html`);
    expect(shallow.skippedOverLimit).toEqual([]);
    expect(shallow.pendingQueue).toEqual([]);

    const shallowRun = seoRun(shallow);
    expect(rulePaths(shallowRun, 'SEO-TECH-009')).toEqual(['/orphan.html']);
    expect(ruleRun(shallowRun, 'SEO-TECH-011').applicableTargets).toBeGreaterThan(0);
    expect(ruleRun(shallowRun, 'SEO-TECH-010').applicableTargets).toBeGreaterThan(0);
  });

  it('точка входа исключена из слабо связанных страниц', () => {
    // Тот же обход, прочитанный так, будто точка входа — /no-title.html: на неё
    // ведёт ровно одна ссылка (с главной), и без исключения точки входа она
    // попала бы в findings.
    const fromHome = ruleRun(result, 'SEO-TECH-011');
    expect(fromHome.checkedTargets).toContain(`${origin}/no-title.html`);
    expect(rulePaths(result, 'SEO-TECH-011')).toContain('/no-title.html');

    const fromNoTitle = seoRun(crawlResult, `${origin}/no-title.html`);
    expect(rulePaths(fromNoTitle, 'SEO-TECH-011')).not.toContain('/no-title.html');
    // …а главная, на которую ведут четыре ссылки, слабо связанной не становится.
    expect(rulePaths(fromNoTitle, 'SEO-TECH-011')).not.toContain('/');
    expect(ruleRun(fromNoTitle, 'SEO-TECH-011').checkedTargets).not.toContain(
      `${origin}/no-title.html`,
    );
  });
});
