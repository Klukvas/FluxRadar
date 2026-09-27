// SEO-ONPAGE-004 (дубль title) и SEO-ONPAGE-006 (дубль meta description):
// находки, покрытие и текст evidence. Общая механика групп — в
// shared/duplicate-groups.test.ts, вопросы личности находки — в
// duplicate-identity.test.ts.

import { describe, expect, it } from 'vitest';

import type { RuleEvaluation, SiteContext } from '../engine/types.js';
import { runModuleRules } from '../engine/run-module.js';
import { renderFindingMessage } from '../messages/index.js';
import { siteContext, type FixturePageInput } from '../testing/fixture-harness.js';
import { runSeoRule } from '../testing/fixture-harness.js';
import { paths, single, url } from '../testing/link-fixtures.js';

/** Страница с заданными title/description и собственным текстом body. */
function metaPage(options: {
  readonly path: string;
  readonly title?: string;
  readonly description?: string;
  readonly canonical?: string;
}): FixturePageInput {
  const head = [
    options.title === undefined ? '' : `<title>${options.title}</title>`,
    options.description === undefined
      ? ''
      : `<meta name="description" content="${options.description}">`,
    options.canonical === undefined ? '' : `<link rel="canonical" href="${options.canonical}">`,
  ].join('');
  return {
    path: options.path,
    html:
      `<!doctype html><html lang="en"><head>${head}</head>` +
      `<body><h1>Heading</h1><p>Body text unique to ${options.path}</p></body></html>`,
  };
}

function evaluationOf(ruleId: string, ctx: SiteContext): RuleEvaluation {
  const found = runModuleRules('SEO', ctx).evaluations.find((entry) => entry.ruleId === ruleId);
  if (found === undefined) {
    throw new Error(`правило ${ruleId} не прогонялось`);
  }
  return found;
}

describe('SEO-ONPAGE-004 — дубль title', () => {
  it('обе страницы с одним заголовком получают находку', () => {
    const ctx = siteContext({
      pages: [
        metaPage({ path: '/a.html', title: 'Emergency dental care in Kyiv' }),
        metaPage({ path: '/b.html', title: 'Emergency dental care in Kyiv' }),
        metaPage({ path: '/c.html', title: 'Implants in Kyiv' }),
      ],
    });
    expect(paths(runSeoRule('SEO-ONPAGE-004', ctx))).toEqual(['/a.html', '/b.html']);
  });

  it('evidence называет заголовок, число партнёров и их адреса', () => {
    const ctx = siteContext({
      pages: [
        metaPage({ path: '/a.html', title: 'Shared title of two pages' }),
        metaPage({ path: '/b.html', title: 'Shared title of two pages' }),
      ],
    });
    const finding = single(
      runSeoRule('SEO-ONPAGE-004', ctx).filter(
        (candidate) => candidate.normalizedUrl === url('/a.html'),
      ),
    );
    expect(finding.evidenceExcerpt).toBe(
      `Other crawled pages with the same title: 1; at most three are listed here: ${url('/b.html')}. ` +
        'No <link rel="canonical"> ties this page to any of them, as crawled. ' +
        'Title: "Shared title of two pages"',
    );
    expect(finding.normalizedSelector).toBe('title');
    // Находка держится на снимке названной страницы: пропал он — и вердикт
    // больше ничем не подтверждён, а не починен (§14).
    expect(finding.dependencyTargets).toEqual([url('/b.html')]);
  });

  it('evidence большой группы называет три адреса и говорит, что их три', () => {
    // Счёт и список расходятся начиная с четвёртого партнёра, и текст обязан
    // это назвать: иначе читатель принял бы перечисление за полное и решил, что
    // отчёт противоречит сам себе.
    const ctx = siteContext({
      pages: ['/a.html', '/b.html', '/c.html', '/d.html', '/e.html'].map((path) =>
        metaPage({ path, title: 'One title for the whole catalogue' }),
      ),
    });
    const finding = single(
      runSeoRule('SEO-ONPAGE-004', ctx).filter(
        (candidate) => candidate.normalizedUrl === url('/a.html'),
      ),
    );
    expect(finding.evidenceExcerpt).toBe(
      'Other crawled pages with the same title: 4; at most three are listed here: ' +
        `${[url('/b.html'), url('/c.html'), url('/d.html')].join(', ')}. ` +
        'No <link rel="canonical"> ties this page to any of them, as crawled. ' +
        'Title: "One title for the whole catalogue"',
    );
    expect(finding.evidenceExcerpt).not.toContain(url('/e.html'));
    expect(finding.dependencyTargets).toHaveLength(3);
  });

  it('украинский текст тоже называет счёт, три адреса и границу вердикта', () => {
    const ctx = siteContext({
      pages: ['/a.html', '/b.html', '/c.html', '/d.html', '/e.html'].map((path) =>
        metaPage({ path, title: 'One title for the whole catalogue' }),
      ),
    });
    const finding = single(
      runSeoRule('SEO-ONPAGE-004', ctx).filter(
        (candidate) => candidate.normalizedUrl === url('/a.html'),
      ),
    );
    const evidence = finding.messages?.evidence;
    expect(evidence).toBeDefined();
    if (evidence === undefined) return;
    const ukrainian = renderFindingMessage(evidence, 'uk');
    expect(ukrainian).toContain('таким самим title: 4');
    expect(ukrainian).toContain('тут названо не більше трьох');
    expect(ukrainian).toContain('за тим, як їх прочитав обхід');
    expect(ukrainian).not.toContain(url('/e.html'));
  });

  it('петля canonical-ов: evidence не утверждает, что canonical-а нет', () => {
    // Обе страницы назвали каноничной друг друга: сайт сообщил, что настоящая
    // версия есть, и не сообщил какая. Предложение «canonical не связывает эту
    // страницу ни с одной из них» было бы здесь ложью о теге, который читатель
    // видит в исходнике первой же строкой head.
    const ctx = siteContext({
      pages: [
        metaPage({
          path: '/a.html',
          title: 'Shared title of two pages',
          canonical: url('/b.html'),
        }),
        metaPage({
          path: '/b.html',
          title: 'Shared title of two pages',
          canonical: url('/a.html'),
        }),
      ],
    });
    const finding = single(
      runSeoRule('SEO-ONPAGE-004', ctx).filter(
        (candidate) => candidate.normalizedUrl === url('/a.html'),
      ),
    );
    expect(finding.messages?.evidence.code).toBe('seo-onpage-004.evidence.unresolved-chain');
    expect(finding.evidenceExcerpt).toBe(
      `Other crawled pages with the same title: 1; at most three are listed here: ${url('/b.html')}. ` +
        'This page has a <link rel="canonical">, but the chain it starts leaves these pages or ' +
        'loops back and names no final version among them, as crawled. ' +
        'Title: "Shared title of two pages"',
    );
    const evidence = finding.messages?.evidence;
    expect(evidence).toBeDefined();
    if (evidence === undefined) return;
    expect(renderFindingMessage(evidence, 'uk')).toBe(
      'Інших прочитаних сторінок із таким самим title: 1; тут названо не більше трьох: ' +
        `${url('/b.html')}. У цієї сторінки є <link rel="canonical">, але ланцюжок, який вона ` +
        'починає, виходить за межі цих сторінок або замикається в петлю й не називає остаточної ' +
        'версії серед них — за тим, як їх прочитав обхід. Title: «Shared title of two pages»',
    );
  });

  it('цепочка, уходящая из группы: то же предложение — и о назвавшей, и о названной', () => {
    // /a назвала каноничной страницу с другим заголовком, /b назвала /a.
    // Настоящей версии среди двух совпавших не назвал никто, и находку получают
    // обе — с причиной, которая говорит именно это.
    const ctx = siteContext({
      pages: [
        metaPage({
          path: '/a.html',
          title: 'Shared title of two pages',
          canonical: url('/elsewhere.html'),
        }),
        metaPage({
          path: '/b.html',
          title: 'Shared title of two pages',
          canonical: url('/a.html'),
        }),
        metaPage({ path: '/elsewhere.html', title: 'A title of its own' }),
      ],
    });
    const leaving = single(
      runSeoRule('SEO-ONPAGE-004', ctx).filter(
        (candidate) => candidate.normalizedUrl === url('/a.html'),
      ),
    );
    expect(leaving.evidenceExcerpt).toBe(
      `Other crawled pages with the same title: 1; at most three are listed here: ${url('/b.html')}. ` +
        'This page has a <link rel="canonical">, but the chain it starts leaves these pages or ' +
        'loops back and names no final version among them, as crawled. ' +
        'Title: "Shared title of two pages"',
    );
    const evidence = leaving.messages?.evidence;
    expect(evidence).toBeDefined();
    if (evidence === undefined) return;
    expect(renderFindingMessage(evidence, 'uk')).toContain(
      'але ланцюжок, який вона починає, виходить за межі цих сторінок або замикається в петлю',
    );
    // И о странице, которая назвала каноничной /a, отчёт говорит то же самое:
    // её заявление тоже ничем не кончилось.
    const pointing = single(
      runSeoRule('SEO-ONPAGE-004', ctx).filter(
        (candidate) => candidate.normalizedUrl === url('/b.html'),
      ),
    );
    expect(pointing.messages?.evidence.code).toBe('seo-onpage-004.evidence.unresolved-chain');
    expect(pointing.evidenceExcerpt).toContain(
      'the chain it starts leaves these pages or loops back and names no final version among them',
    );
  });

  it('NFC: один и тот же заголовок в двух кодировках — один заголовок', () => {
    // Составное é из macOS и готовое é из CMS выглядят одинаково и в выдаче, и
    // у читателя: разными их делает только форма нормализации.
    const ctx = siteContext({
      pages: [
        metaPage({ path: '/a.html', title: 'Caf\u00e9 menu of the week' }),
        metaPage({ path: '/b.html', title: 'Cafe\u0301 menu of the week' }),
      ],
    });
    expect(paths(runSeoRule('SEO-ONPAGE-004', ctx))).toEqual(['/a.html', '/b.html']);
  });

  it('canonical на другую страницу группы снимает находку с обоих', () => {
    const ctx = siteContext({
      pages: [
        metaPage({ path: '/a.html', title: 'Shared title of two pages' }),
        metaPage({
          path: '/b.html',
          title: 'Shared title of two pages',
          canonical: url('/a.html'),
        }),
      ],
    });
    expect(runSeoRule('SEO-ONPAGE-004', ctx)).toEqual([]);
    // Проверка при этом прошла на обеих страницах, а не «не применялась».
    expect(evaluationOf('SEO-ONPAGE-004', ctx).applicableTargets).toBe(2);
  });

  it('canonical на себя внутри группы находку не снимает', () => {
    const ctx = siteContext({
      pages: [
        metaPage({
          path: '/a.html',
          title: 'Shared title of two pages',
          canonical: url('/a.html'),
        }),
        metaPage({
          path: '/b.html',
          title: 'Shared title of two pages',
          canonical: url('/b.html'),
        }),
      ],
    });
    expect(paths(runSeoRule('SEO-ONPAGE-004', ctx))).toEqual(['/a.html', '/b.html']);
  });

  it('страница без title находки не даёт — это SEO-ONPAGE-001', () => {
    const ctx = siteContext({
      pages: [metaPage({ path: '/a.html' }), metaPage({ path: '/b.html' })],
    });
    expect(runSeoRule('SEO-ONPAGE-004', ctx)).toEqual([]);
    expect(runSeoRule('SEO-ONPAGE-001', ctx)).toHaveLength(2);
  });

  it('checkedTargets — каждая судимая страница, даже без заголовка', () => {
    // Инвариант покрытия: страница, названная проверенной, действительно была
    // судима. Иначе прошлая находка о ней закрылась бы как исправленная (§14).
    const ctx = siteContext({
      pages: [
        metaPage({ path: '/a.html', title: 'Shared title of two pages' }),
        metaPage({ path: '/b.html', title: 'Shared title of two pages' }),
        metaPage({ path: '/c.html' }),
      ],
    });
    const evaluation = evaluationOf('SEO-ONPAGE-004', ctx);
    expect([...evaluation.checkedTargets].toSorted()).toEqual([
      url('/a.html'),
      url('/b.html'),
      url('/c.html'),
    ]);
    expect(evaluation.applicableTargets).toBe(3);
    expect(evaluation.affectedTargets).toBe(2);
    // Входы — те же страницы: вердикт о каждой выносят заголовки остальных.
    expect([...evaluation.inputTargets].toSorted()).toEqual([
      url('/a.html'),
      url('/b.html'),
      url('/c.html'),
    ]);
  });

  it('одна прочитанная страница → Not applicable с причиной no-candidates', () => {
    // Сравнивать не с чем — это не «дублей нет». Так выглядит free-проверка
    // главной и сайт из одной страницы.
    const ctx = siteContext({ pages: [metaPage({ path: '/only.html', title: 'The only page' })] });
    const evaluation = evaluationOf('SEO-ONPAGE-004', ctx);
    expect(evaluation.applicableTargets).toBe(0);
    expect(evaluation.notApplicableReason).toBe('no-candidates');
    expect(evaluation.findings).toEqual([]);
  });

  it('усечённый лимитом обход всё равно отвечает по существу', () => {
    // Граф ссылок неполон, но дубль двух прочитанных страниц от этого не
    // перестаёт быть дублем: правило не зависит от полноты графа (в отличие от
    // SEO-TECH-009/010/011).
    const ctx = siteContext({
      pages: [
        metaPage({ path: '/a.html', title: 'Shared title of two pages' }),
        metaPage({ path: '/b.html', title: 'Shared title of two pages' }),
      ],
      skippedOverLimit: [url('/over-limit.html')],
    });
    expect(paths(runSeoRule('SEO-ONPAGE-004', ctx))).toEqual(['/a.html', '/b.html']);
    expect(runSeoRule('SEO-TECH-011', ctx)).toEqual([]);
  });
});

describe('SEO-ONPAGE-006 — дубль meta description', () => {
  const shared = 'One description reused across the whole catalogue of pages.';

  it('страницы с одним описанием получают находку, разные — нет', () => {
    const ctx = siteContext({
      pages: [
        metaPage({ path: '/a.html', title: 'Page A', description: shared }),
        metaPage({ path: '/b.html', title: 'Page B', description: shared }),
        metaPage({ path: '/c.html', title: 'Page C', description: 'Something else entirely.' }),
      ],
    });
    expect(paths(runSeoRule('SEO-ONPAGE-006', ctx))).toEqual(['/a.html', '/b.html']);
  });

  it('evidence называет описание, счёт и селектор тега', () => {
    const ctx = siteContext({
      pages: [
        metaPage({ path: '/a.html', title: 'Page A', description: shared }),
        metaPage({ path: '/b.html', title: 'Page B', description: shared }),
      ],
    });
    const finding = single(
      runSeoRule('SEO-ONPAGE-006', ctx).filter(
        (candidate) => candidate.normalizedUrl === url('/a.html'),
      ),
    );
    expect(finding.evidenceExcerpt).toBe(
      'Other crawled pages with the same meta description: 1; ' +
        `at most three are listed here: ${url('/b.html')}. ` +
        'No <link rel="canonical"> ties this page to any of them, as crawled. ' +
        `Description: "${shared}"`,
    );
    expect(finding.normalizedSelector).toBe('meta[name="description"]');
  });

  it('петля canonical-ов: у описания то же второе предложение, что у заголовка', () => {
    // Средняя фраза у трёх правил дублей общая: причина одна и та же, и
    // читатель не должен разбирать её заново в каждом разделе отчёта.
    const ctx = siteContext({
      pages: [
        metaPage({
          path: '/a.html',
          title: 'Page A',
          description: shared,
          canonical: url('/b.html'),
        }),
        metaPage({
          path: '/b.html',
          title: 'Page B',
          description: shared,
          canonical: url('/a.html'),
        }),
      ],
    });
    const finding = single(
      runSeoRule('SEO-ONPAGE-006', ctx).filter(
        (candidate) => candidate.normalizedUrl === url('/a.html'),
      ),
    );
    expect(finding.messages?.evidence.code).toBe('seo-onpage-006.evidence.unresolved-chain');
    expect(finding.evidenceExcerpt).toBe(
      'Other crawled pages with the same meta description: 1; at most three are listed here: ' +
        `${url('/b.html')}. This page has a <link rel="canonical">, but the chain it starts ` +
        'leaves these pages or loops back and names no final version among them, as crawled. ' +
        `Description: "${shared}"`,
    );
    const evidence = finding.messages?.evidence;
    expect(evidence).toBeDefined();
    if (evidence === undefined) return;
    expect(renderFindingMessage(evidence, 'uk')).toContain(
      'але ланцюжок, який вона починає, виходить за межі цих сторінок або замикається в петлю',
    );
  });

  it('первый тег description и есть значение страницы', () => {
    // Два description на странице — её собственная проблема (SEO-ONPAGE-002), а
    // не совпадение с чужой: правило читает первый, как и 002.
    const ctx = siteContext({
      pages: [
        {
          path: '/a.html',
          html:
            '<!doctype html><html lang="en"><head><title>Page A</title>' +
            `<meta name="description" content="${shared}">` +
            '<meta name="description" content="A second, different description tag.">' +
            '</head><body><h1>A</h1><p>Body of A</p></body></html>',
        },
        metaPage({ path: '/b.html', title: 'Page B', description: shared }),
      ],
    });
    expect(paths(runSeoRule('SEO-ONPAGE-006', ctx))).toEqual(['/a.html', '/b.html']);
  });

  it('страница без description находки не даёт — это SEO-ONPAGE-002', () => {
    const ctx = siteContext({
      pages: [
        metaPage({ path: '/a.html', title: 'Page A' }),
        metaPage({ path: '/b.html', title: 'Page B' }),
      ],
    });
    expect(runSeoRule('SEO-ONPAGE-006', ctx)).toEqual([]);
    expect(runSeoRule('SEO-ONPAGE-002', ctx)).toHaveLength(2);
  });

  it('canonical на другую страницу группы снимает находку', () => {
    const ctx = siteContext({
      pages: [
        metaPage({ path: '/a.html', title: 'Page A', description: shared }),
        metaPage({
          path: '/b.html',
          title: 'Page B',
          description: shared,
          canonical: url('/a.html'),
        }),
      ],
    });
    expect(runSeoRule('SEO-ONPAGE-006', ctx)).toEqual([]);
  });

  it('одна прочитанная страница → Not applicable с причиной no-candidates', () => {
    const ctx = siteContext({
      pages: [metaPage({ path: '/only.html', title: 'The only page', description: shared })],
    });
    expect(evaluationOf('SEO-ONPAGE-006', ctx).notApplicableReason).toBe('no-candidates');
  });
});
