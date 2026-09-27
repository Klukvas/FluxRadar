// CONTENT-001 — дубль содержимого страницы: находки, покрытие, граница с
// CONTENT-003 (малосодержательные страницы) и evidence. Общая механика групп —
// в shared/duplicate-groups.test.ts.

import { describe, expect, it } from 'vitest';

import { runModuleRules } from '../engine/run-module.js';
import { renderFindingMessage } from '../messages/index.js';
import type { RuleEvaluation, SiteContext } from '../engine/types.js';
import type { FixturePageInput } from '../testing/fixture-harness.js';
import { runRule, siteContext } from '../testing/fixture-harness.js';
import { paths, single, url } from '../testing/link-fixtures.js';

/** Длинный текст: так страница не попадает ещё и под CONTENT-003. */
const LONG_TEXT =
  'We place dental implants and see emergency patients on the same day in central Kyiv. ' +
  'The clinic works seven days a week, and the first consultation includes a panoramic scan, ' +
  'a written treatment plan and a fixed price for every stage of the work described in it.';

function contentPage(options: {
  readonly path: string;
  readonly body?: string;
  readonly canonical?: string;
}): FixturePageInput {
  const canonical =
    options.canonical === undefined ? '' : `<link rel="canonical" href="${options.canonical}">`;
  return {
    path: options.path,
    html:
      `<!doctype html><html lang="en"><head><title>Page ${options.path}</title>${canonical}</head>` +
      `<body><p>${options.body ?? LONG_TEXT}</p></body></html>`,
  };
}

function evaluationOf(ctx: SiteContext): RuleEvaluation {
  const found = runModuleRules('Content Quality', ctx).evaluations.find(
    (entry) => entry.ruleId === 'CONTENT-001',
  );
  if (found === undefined) {
    throw new Error('правило CONTENT-001 не прогонялось');
  }
  return found;
}

const runContent001 = (ctx: SiteContext) => runRule('Content Quality', 'CONTENT-001', ctx);

describe('CONTENT-001 — дубль содержимого страницы', () => {
  it('страницы с одинаковым видимым текстом получают находку', () => {
    const ctx = siteContext({
      pages: [
        contentPage({ path: '/a.html' }),
        contentPage({ path: '/b.html' }),
        contentPage({ path: '/c.html', body: `${LONG_TEXT} And one more sentence only here.` }),
      ],
    });
    expect(paths(runContent001(ctx))).toEqual(['/a.html', '/b.html']);
  });

  it('разметка вокруг текста значения не меняет', () => {
    // Дубль — это одинаковый ТЕКСТ, а не одинаковый HTML: та же статья, обёрнутая
    // в другой шаблон, остаётся тем же содержимым.
    const ctx = siteContext({
      pages: [
        {
          path: '/plain.html',
          html:
            '<!doctype html><html lang="en"><head><title>Plain</title></head>' +
            `<body><p>${LONG_TEXT}</p></body></html>`,
        },
        {
          path: '/wrapped.html',
          html:
            '<!doctype html><html lang="en"><head><title>Wrapped</title></head>' +
            `<body><main><article><div>   ${LONG_TEXT}   </div></article></main></body></html>`,
        },
      ],
    });
    expect(paths(runContent001(ctx))).toEqual(['/plain.html', '/wrapped.html']);
  });

  it('сущности раскрыты: экранированная копия — тот же текст', () => {
    // Один и тот же абзац, набранный в двух редакторах: один экранировал `&`,
    // другой нет. Читатель видит одну страницу дважды, и правило обязано
    // видеть то же самое.
    const ctx = siteContext({
      pages: [
        contentPage({ path: '/a.html', body: `Tom &amp; Jerry. ${LONG_TEXT}` }),
        contentPage({ path: '/b.html', body: `Tom & Jerry. ${LONG_TEXT}` }),
      ],
    });
    expect(paths(runContent001(ctx))).toEqual(['/a.html', '/b.html']);
    const finding = single(
      runContent001(ctx).filter((candidate) => candidate.normalizedUrl === url('/a.html')),
    );
    // И в evidence текст показан раскрытым, а не разметкой.
    expect(finding.evidenceExcerpt).toContain('Tom & Jerry.');
    expect(finding.evidenceExcerpt).not.toContain('&amp;');
  });

  it('evidence называет счёт, адреса, длину текста и его начало', () => {
    const ctx = siteContext({
      pages: [contentPage({ path: '/a.html' }), contentPage({ path: '/b.html' })],
    });
    const finding = single(
      runContent001(ctx).filter((candidate) => candidate.normalizedUrl === url('/a.html')),
    );
    expect(finding.evidenceExcerpt).toBe(
      'Other crawled pages with the same visible text: 1; ' +
        `at most three are listed here: ${url('/b.html')}. ` +
        'No <link rel="canonical"> ties this page to any of them, as crawled. ' +
        `The text is ${[...LONG_TEXT].length} characters and begins: ` +
        `"${[...LONG_TEXT].slice(0, 120).join('')}"`,
    );
    expect(finding.dependencyTargets).toEqual([url('/b.html')]);
    // Всё изменчивое остаётся вне полей идентичности (§14).
    expect(finding.normalizedSelector).toBe('');
    expect(finding.normalizedParameter).toBe('');
  });

  it('несёт коды сообщений, а не готовый текст — отчёт читают на двух языках', () => {
    const ctx = siteContext({
      pages: [contentPage({ path: '/a.html' }), contentPage({ path: '/b.html' })],
    });
    const finding = single(
      runContent001(ctx).filter((candidate) => candidate.normalizedUrl === url('/a.html')),
    );
    expect(finding.messages?.evidence.code).toBe('content-001.evidence.no-canonical');
    expect(finding.messages?.recommendation.code).toBe('content-001.recommendation');
    const messages = finding.messages;
    if (messages === undefined) return;
    // Украинский рендер доказывает, что правило передало каждое значение, которое
    // называет перевод, — иначе читатель получил бы шаблон с дырой.
    expect(renderFindingMessage(messages.evidence, 'uk')).toContain(url('/b.html'));
    expect(renderFindingMessage(messages.recommendation, 'uk')).not.toBeNull();
  });

  it('петля canonical-ов: evidence называет причину, а не отсутствие canonical-а', () => {
    // Тот же второй абзац, что у дублей title и description: причина общая
    // (UnclaimedReason), и текст о ней у трёх правил совпадает дословно.
    const ctx = siteContext({
      pages: [
        contentPage({ path: '/a.html', canonical: url('/b.html') }),
        contentPage({ path: '/b.html', canonical: url('/a.html') }),
      ],
    });
    const finding = single(
      runContent001(ctx).filter((candidate) => candidate.normalizedUrl === url('/a.html')),
    );
    expect(finding.messages?.evidence.code).toBe('content-001.evidence.unresolved-chain');
    expect(finding.evidenceExcerpt).toBe(
      'Other crawled pages with the same visible text: 1; ' +
        `at most three are listed here: ${url('/b.html')}. ` +
        'This page has a <link rel="canonical">, but the chain it starts leaves these pages or ' +
        'loops back and names no final version among them, as crawled. ' +
        `The text is ${[...LONG_TEXT].length} characters and begins: ` +
        `"${[...LONG_TEXT].slice(0, 120).join('')}"`,
    );
    const evidence = finding.messages?.evidence;
    expect(evidence).toBeDefined();
    if (evidence === undefined) return;
    expect(renderFindingMessage(evidence, 'uk')).toContain(
      'але ланцюжок, який вона починає, виходить за межі цих сторінок або замикається в петлю',
    );
  });

  it('canonical на другую страницу группы снимает находку с обоих', () => {
    const ctx = siteContext({
      pages: [
        contentPage({ path: '/a.html' }),
        contentPage({ path: '/b.html', canonical: url('/a.html') }),
      ],
    });
    expect(runContent001(ctx)).toEqual([]);
    expect(evaluationOf(ctx).applicableTargets).toBe(2);
  });

  it('canonical на себя внутри группы находку не снимает', () => {
    const ctx = siteContext({
      pages: [
        contentPage({ path: '/a.html', canonical: url('/a.html') }),
        contentPage({ path: '/b.html', canonical: url('/b.html') }),
      ],
    });
    expect(paths(runContent001(ctx))).toEqual(['/a.html', '/b.html']);
  });

  it('пустые страницы дублями друг друга не бывают — это CONTENT-003', () => {
    const ctx = siteContext({
      pages: [
        {
          path: '/a.html',
          html: '<!doctype html><html lang="en"><head><title>A</title></head><body></body></html>',
        },
        {
          path: '/b.html',
          html: '<!doctype html><html lang="en"><head><title>B</title></head><body></body></html>',
        },
      ],
    });
    expect(runContent001(ctx)).toEqual([]);
    expect(paths(runRule('Content Quality', 'CONTENT-003', ctx))).toEqual(['/a.html', '/b.html']);
  });

  it('короткий одинаковый текст даёт находки обоих правил — это две проблемы', () => {
    // «Здесь нечего читать» (CONTENT-003) и «это уже есть по другому адресу»
    // (CONTENT-001) — разные вердикты, и подменять один другим правило не вправе.
    const ctx = siteContext({
      pages: [
        contentPage({ path: '/a.html', body: 'Coming soon.' }),
        contentPage({ path: '/b.html', body: 'Coming soon.' }),
      ],
    });
    expect(paths(runContent001(ctx))).toEqual(['/a.html', '/b.html']);
    expect(paths(runRule('Content Quality', 'CONTENT-003', ctx))).toEqual(['/a.html', '/b.html']);
  });

  it('checkedTargets — каждая судимая страница, включая пустую', () => {
    const ctx = siteContext({
      pages: [
        contentPage({ path: '/a.html' }),
        contentPage({ path: '/b.html' }),
        {
          path: '/empty.html',
          html: '<!doctype html><html lang="en"><head><title>Empty</title></head><body></body></html>',
        },
      ],
    });
    const evaluation = evaluationOf(ctx);
    expect([...evaluation.checkedTargets].toSorted()).toEqual([
      url('/a.html'),
      url('/b.html'),
      url('/empty.html'),
    ]);
    expect(evaluation.applicableTargets).toBe(3);
    expect(evaluation.affectedTargets).toBe(2);
  });

  it('одна прочитанная страница → Not applicable с причиной no-candidates', () => {
    const ctx = siteContext({ pages: [contentPage({ path: '/only.html' })] });
    const evaluation = evaluationOf(ctx);
    expect(evaluation.applicableTargets).toBe(0);
    expect(evaluation.notApplicableReason).toBe('no-candidates');
  });

  it('спрос правила — всё, что обход увидел, а входы — прочитанные страницы', () => {
    const ctx = siteContext({
      pages: [contentPage({ path: '/a.html' }), contentPage({ path: '/b.html' })],
      skippedOverLimit: [url('/over-limit.html')],
      blockedByRobots: [url('/blocked.html')],
    });
    const evaluation = evaluationOf(ctx);
    expect([...evaluation.inputTargets].toSorted()).toEqual([url('/a.html'), url('/b.html')]);
    const requested = [...(evaluation.requestedInputs ?? [])];
    expect(requested).toContain(url('/over-limit.html'));
    expect(requested).toContain(url('/blocked.html'));
    // Спрос обязан оставаться надмножеством входов: иначе прочитанная страница
    // выглядела бы снятой сайтом, и находка закрывалась бы без доказательства.
    for (const input of evaluation.inputTargets) {
      expect(requested).toContain(input);
    }
  });
});
