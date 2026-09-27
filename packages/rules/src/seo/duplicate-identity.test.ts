// Один документ под двумя адресами — не дубль самого себя, и находка о нём
// называется одним и тем же именем от прогона к прогону (§14). Здесь же —
// граница с SEO-TECH-007: группа дублей URL к дублю содержимого привести не
// может. Сами правила — в duplicate-metadata.test.ts и
// content/duplicate-content.test.ts.

import { describe, expect, it } from 'vitest';

import { runModuleRules } from '../engine/run-module.js';
import type { IssueCandidate } from '../engine/run-module.js';
import type { RuleEvaluation, SiteContext } from '../engine/types.js';
import type { FixturePageInput } from '../testing/fixture-harness.js';
import { runRule, runSeoRule, siteContext } from '../testing/fixture-harness.js';
import { paths, single, url } from '../testing/link-fixtures.js';

const SHARED_TITLE = 'One story published under two addresses';
const SHARED_TEXT =
  'Word for word the same article, reachable at more than one address of the same site, ' +
  'which is exactly what the cross-page duplicate rules are asked to notice and report.';

/** Страница с общим title/description/текстом: дубль по всем трём видам значения. */
function sharedPage(path: string, extra: Partial<FixturePageInput> = {}): FixturePageInput {
  return {
    path,
    html:
      `<!doctype html><html lang="en"><head><title>${SHARED_TITLE}</title>` +
      '<meta name="description" content="One description under two addresses."></head>' +
      `<body><p>${SHARED_TEXT}</p></body></html>`,
    ...extra,
  };
}

/** Страница, не делящая ни одного значения: она лишь делает правило применимым. */
function ownPage(path: string): FixturePageInput {
  return {
    path,
    html:
      `<!doctype html><html lang="en"><head><title>Its own title, ${path}</title>` +
      `<meta name="description" content="Its own description, ${path}."></head>` +
      `<body><p>Body text that belongs to ${path} and to no other page of the site.</p></body></html>`,
  };
}

/** Тот же документ, отданный по `path` и уехавший редиректом на `finalPath`. */
function sharedRedirect(path: string, finalPath: string): FixturePageInput {
  return sharedPage(path, {
    finalPath,
    redirectChain: [{ url: url(path), status: 301, location: url(finalPath) }],
  });
}

const DUPLICATE_RULES = [
  { module: 'SEO', ruleId: 'SEO-ONPAGE-004' },
  { module: 'SEO', ruleId: 'SEO-ONPAGE-006' },
  { module: 'Content Quality', ruleId: 'CONTENT-001' },
] as const;

function findings(ruleId: string, ctx: SiteContext): readonly IssueCandidate[] {
  const rule = DUPLICATE_RULES.find((entry) => entry.ruleId === ruleId);
  if (rule === undefined) {
    throw new Error(`правило ${ruleId} не из правил дублей`);
  }
  return runRule(rule.module, rule.ruleId, ctx);
}

function evaluationOf(ruleId: string, ctx: SiteContext): RuleEvaluation {
  const rule = DUPLICATE_RULES.find((entry) => entry.ruleId === ruleId);
  if (rule === undefined) {
    throw new Error(`правило ${ruleId} не из правил дублей`);
  }
  const found = runModuleRules(rule.module, ctx).evaluations.find(
    (entry) => entry.ruleId === ruleId,
  );
  if (found === undefined) {
    throw new Error(`правило ${ruleId} не прогонялось`);
  }
  return found;
}

describe.each(DUPLICATE_RULES)('$ruleId: документ под двумя адресами', ({ ruleId }) => {
  it('снимок редиректа и снимок назначения дублями друг друга не бывают', () => {
    // Обычный сайт, а не редкость: sitemap перечисляет `/p/`, навигация ссылается
    // на `/p`. Обход получает два снимка одного документа — и если бы правило
    // судило снимки, каждый такой сайт получал бы дубль, который нечем починить.
    // Третья страница здесь не для сравнения, а чтобы правило вообще было
    // применимо: с одним документом сравнивать не с чем, и вердикт был бы
    // 'no-candidates' независимо от псевдонима.
    const ctx = siteContext({
      sitemapUrls: [url('/p/')],
      pages: [sharedRedirect('/p', '/p/'), sharedPage('/p/'), ownPage('/other.html')],
    });
    expect(findings(ruleId, ctx)).toEqual([]);
    const evaluation = evaluationOf(ruleId, ctx);
    expect(evaluation.applicableTargets).toBe(2);
    expect(evaluation.notApplicableReason).toBeUndefined();
    // Два снимка одного документа — одна проверенная страница, а не две.
    expect([...evaluation.checkedTargets].toSorted()).toEqual([url('/other.html'), url('/p/')]);
  });

  it('два адреса, ведущие на одну непрочитанную страницу, дают один вердикт', () => {
    const ctx = siteContext({
      pages: [
        sharedRedirect('/p', '/p/'),
        sharedRedirect('/p.html', '/p/'),
        ownPage('/other.html'),
      ],
    });
    expect(findings(ruleId, ctx)).toEqual([]);
    expect([...evaluationOf(ruleId, ctx).checkedTargets].toSorted()).toEqual([
      url('/other.html'),
      url('/p/'),
    ]);
  });

  it('находка названа адресом документа, а не адресом снимка', () => {
    // Своего снимка у `/about/` не будет никогда (markFinalUrlSeen): единственный
    // снимок судится под адресом назначения и называется им же.
    const ctx = siteContext({
      pages: [sharedRedirect('/about', '/about/'), sharedPage('/copy.html')],
    });
    const about = single(
      findings(ruleId, ctx).filter((candidate) => candidate.normalizedUrl === url('/about/')),
    );
    expect(about.targetUrl).toBe(url('/about/'));
    expect(about.evidenceExcerpt).toContain(url('/copy.html'));
    expect([...evaluationOf(ruleId, ctx).checkedTargets].toSorted()).toEqual([
      url('/about/'),
      url('/copy.html'),
    ]);
  });

  it('fingerprint не зависит от того, получил ли обход снимок-псевдоним', () => {
    // Есть ли у `/about/` свой снимок, решает порядок очереди обхода, а не сайт.
    // Находка, названная адресом снимка, меняла бы личность между прогонами:
    // новый прогон открывал бы вторую issue о той же странице и не мог закрыть
    // первую.
    const withoutAlias = siteContext({
      pages: [sharedPage('/about/'), sharedPage('/copy.html')],
    });
    const withAlias = siteContext({
      pages: [sharedRedirect('/about', '/about/'), sharedPage('/about/'), sharedPage('/copy.html')],
    });
    const fingerprintAt = (ctx: SiteContext, address: string): string =>
      single(findings(ruleId, ctx).filter((candidate) => candidate.normalizedUrl === address))
        .fingerprint;

    expect(fingerprintAt(withAlias, url('/about/'))).toBe(
      fingerprintAt(withoutAlias, url('/about/')),
    );
    // И количество страниц в отчёте одно и то же: снимков три, документов два.
    expect(paths(findings(ruleId, withAlias))).toEqual(paths(findings(ruleId, withoutAlias)));
  });

  it('fingerprint не несёт ни счёта партнёров, ни их адресов', () => {
    // Группа из двух и та же группа, выросшая до трёх: это та же проблема той же
    // страницы, и прошлую issue новый прогон обязан узнать.
    const pair = siteContext({ pages: [sharedPage('/a.html'), sharedPage('/b.html')] });
    const trio = siteContext({
      pages: [sharedPage('/a.html'), sharedPage('/b.html'), sharedPage('/c.html')],
    });
    const fingerprintAt = (ctx: SiteContext): string =>
      single(
        findings(ruleId, ctx).filter((candidate) => candidate.normalizedUrl === url('/a.html')),
      ).fingerprint;

    expect(fingerprintAt(trio)).toBe(fingerprintAt(pair));
  });

  it('группа дублей URL остаётся одной страницей, а не дублем себя', () => {
    // SEO-TECH-007 группирует ОДИН normalizedUrl, найденный в нескольких
    // raw-формах. Обход читает такой адрес один раз, поэтому на всю группу 007
    // приходится один снимок и один судящий адрес — двух членов группы дублей из
    // неё получиться не может, и фильтровать 007 отдельно не нужно.
    const ctx = siteContext({
      urlVariants: {
        [url('/p.html')]: [url('/p.html'), `${url('/p.html')}?utm_source=x`],
      },
      pages: [sharedPage('/p.html')],
    });
    expect(runSeoRule('SEO-TECH-007', ctx)).toHaveLength(1);
    expect(findings(ruleId, ctx)).toEqual([]);
    expect(evaluationOf(ruleId, ctx).applicableTargets).toBe(0);
    expect(evaluationOf(ruleId, ctx).notApplicableReason).toBe('no-candidates');
  });

  it('снимок, уехавший за область обхода, в группу не входит', () => {
    const ctx = siteContext({
      pages: [
        sharedPage('/a.html'),
        sharedPage('/go', {
          finalPath: 'https://partner.example/landing',
          redirectChain: [
            { url: url('/go'), status: 302, location: 'https://partner.example/landing' },
          ],
        }),
        ownPage('/other.html'),
      ],
    });
    // «У этой страницы неуникальный заголовок» о чужом сайте было бы утверждением
    // не о сайте владельца — и партнёра у /a.html не остаётся вовсе.
    expect(findings(ruleId, ctx)).toEqual([]);
    expect([...evaluationOf(ruleId, ctx).checkedTargets].toSorted()).toEqual([
      url('/a.html'),
      url('/other.html'),
    ]);
  });
});

describe('три правила дублей на одном сайте', () => {
  it('каждое судит своё значение и даёт свой fingerprint', () => {
    const ctx = siteContext({ pages: [sharedPage('/a.html'), sharedPage('/b.html')] });
    const all = [
      ...runSeoRule('SEO-ONPAGE-004', ctx),
      ...runSeoRule('SEO-ONPAGE-006', ctx),
      ...runRule('Content Quality', 'CONTENT-001', ctx),
    ];
    expect(paths(all)).toEqual(['/a.html', '/a.html', '/a.html', '/b.html', '/b.html', '/b.html']);
    const fingerprints = all.map((candidate) => candidate.fingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });
});
