// Входы правил (RuleEvaluation.inputTargets): материал обхода, от которого
// вердикт зависит ПОМИМО самой цели.
//
// Три правила судят страницу по чужому снимку, и их находка исчезает вместе с
// этим снимком — без всякой починки. Прогон, потерявший вход, обязан сказать об
// этом, иначе политика Resolved закроет живую находку (§14). Здесь проверяется
// именно та пара прогонов, которой воспроизводился дефект: одинаковый сайт, но
// во втором прогоне цель ссылки (media) просто не обошли.

import { describe, expect, it } from 'vitest';

import { siteContext } from '../testing/fixture-harness.js';
import type { ModuleRunResult } from './run-module.js';
import { runModuleRules } from './run-module.js';

const ORIGIN = 'https://fixture.test';

function evaluationOf(result: ModuleRunResult, ruleId: string) {
  const evaluation = result.evaluations.find((entry) => entry.ruleId === ruleId);
  if (evaluation === undefined) {
    throw new Error(`правило ${ruleId} не прогонялось`);
  }
  return evaluation;
}

const SOURCE_HTML =
  '<!doctype html><html lang="en"><head><title>Source fixture page</title></head>' +
  '<body><h1>Source</h1><a href="/gone.html">gone</a></body></html>';

describe('SEO-TECH-006: снимки целей ссылок — входы, а не цели', () => {
  const withTarget = runModuleRules(
    'SEO',
    siteContext({
      pages: [
        { path: '/source.html', html: SOURCE_HTML },
        { path: '/gone.html', status: 404, html: '<html><body>gone</body></html>' },
      ],
    }),
  );
  const withoutTarget = runModuleRules(
    'SEO',
    siteContext({ pages: [{ path: '/source.html', html: SOURCE_HTML }] }),
  );

  it('находка есть только у прогона, который видел снимок цели', () => {
    expect(withTarget.findings.filter((finding) => finding.ruleId === 'SEO-TECH-006')).toHaveLength(
      1,
    );
    expect(
      withoutTarget.findings.filter((finding) => finding.ruleId === 'SEO-TECH-006'),
    ).toHaveLength(0);
  });

  it('оба прогона судили одну и ту же страницу — по целям они неразличимы', () => {
    // Ровно поэтому checkedTargets не может быть доказательством для этого
    // правила: находка пропала, а «проверенная» страница осталась той же.
    expect(evaluationOf(withTarget, 'SEO-TECH-006').checkedTargets).toEqual(
      evaluationOf(withoutTarget, 'SEO-TECH-006').checkedTargets,
    );
  });

  it('различает их список входов: пропавший снимок из него исчез', () => {
    expect([...evaluationOf(withTarget, 'SEO-TECH-006').inputTargets].toSorted()).toEqual([
      `${ORIGIN}/gone.html`,
      `${ORIGIN}/source.html`,
    ]);
    expect(evaluationOf(withoutTarget, 'SEO-TECH-006').inputTargets).toEqual([
      `${ORIGIN}/source.html`,
    ]);
  });

  it('цель, переставшая отвечать, входом не считается', () => {
    // Снимок есть, но это transport-сбой: статус цели правилу неизвестен ровно
    // так же, как если бы снимка не было (D-152) — и находка исчезает не
    // потому, что ссылку починили.
    const unreachableTarget = runModuleRules(
      'SEO',
      siteContext({
        pages: [
          { path: '/source.html', html: SOURCE_HTML },
          { path: '/gone.html', fetchError: 'ECONNRESET' },
        ],
      }),
    );
    expect(
      unreachableTarget.findings.filter((finding) => finding.ruleId === 'SEO-TECH-006'),
    ).toHaveLength(0);
    expect([...evaluationOf(unreachableTarget, 'SEO-TECH-006').inputTargets]).not.toContain(
      `${ORIGIN}/gone.html`,
    );
  });
});

describe('CONTENT-004: снимок media — вход правила', () => {
  const pageHtml =
    '<!doctype html><html lang="en"><head><title>Media fixture page</title></head>' +
    '<body><h1>Media</h1><img src="/img/x.png" alt="x"></body></html>';

  it('прогон без снимка media теряет находку, и его входы это показывают', () => {
    const withMedia = runModuleRules(
      'Content Quality',
      siteContext({
        pages: [
          { path: '/page.html', html: pageHtml },
          { path: '/img/x.png', status: 404, html: null, contentType: 'text/plain' },
        ],
      }),
    );
    const withoutMedia = runModuleRules(
      'Content Quality',
      siteContext({ pages: [{ path: '/page.html', html: pageHtml }] }),
    );
    expect(withMedia.findings.filter((finding) => finding.ruleId === 'CONTENT-004')).toHaveLength(
      1,
    );
    expect(
      withoutMedia.findings.filter((finding) => finding.ruleId === 'CONTENT-004'),
    ).toHaveLength(0);
    expect([...evaluationOf(withMedia, 'CONTENT-004').inputTargets]).toContain(
      `${ORIGIN}/img/x.png`,
    );
    expect([...evaluationOf(withoutMedia, 'CONTENT-004').inputTargets]).not.toContain(
      `${ORIGIN}/img/x.png`,
    );
  });
});

describe('SEO-TECH-008: граф ссылок обхода и sitemap — входы правила', () => {
  const hiddenHtml =
    '<!doctype html><html lang="en"><head><title>Hidden fixture page</title>' +
    '<meta name="robots" content="noindex"></head><body><h1>Hidden</h1></body></html>';
  const linkerHtml =
    '<!doctype html><html lang="en"><head><title>Linking fixture page</title></head>' +
    '<body><h1>Linker</h1><a href="/hidden.html">hidden</a></body></html>';

  it('страница-источник противоречия входит во входы правила', () => {
    const linked = runModuleRules(
      'SEO',
      siteContext({
        pages: [
          { path: '/linker.html', html: linkerHtml },
          { path: '/hidden.html', html: hiddenHtml },
        ],
      }),
    );
    expect(linked.findings.filter((finding) => finding.ruleId === 'SEO-TECH-008')).toHaveLength(1);
    expect([...evaluationOf(linked, 'SEO-TECH-008').inputTargets]).toContain(
      `${ORIGIN}/linker.html`,
    );

    // Тот же сайт без страницы-источника: находка пропала, вход — тоже.
    const alone = runModuleRules(
      'SEO',
      siteContext({ pages: [{ path: '/hidden.html', html: hiddenHtml }] }),
    );
    expect(alone.findings.filter((finding) => finding.ruleId === 'SEO-TECH-008')).toHaveLength(0);
    expect([...evaluationOf(alone, 'SEO-TECH-008').inputTargets]).not.toContain(
      `${ORIGIN}/linker.html`,
    );
  });

  it('прочитанный sitemap отмечается отдельным входом', () => {
    const withSitemap = runModuleRules(
      'SEO',
      siteContext({
        sitemapUrls: [`${ORIGIN}/hidden.html`],
        pages: [{ path: '/hidden.html', html: hiddenHtml }],
      }),
    );
    // Источник — сам факт прочитанного sitemap, а не его содержимое: страница,
    // убранная из sitemap, — это настоящая починка противоречия.
    expect([...evaluationOf(withSitemap, 'SEO-TECH-008').inputTargets]).toContain('sitemap:read');
    const withoutSitemap = runModuleRules(
      'SEO',
      siteContext({ pages: [{ path: '/hidden.html', html: hiddenHtml }] }),
    );
    expect([...evaluationOf(withoutSitemap, 'SEO-TECH-008').inputTargets]).not.toContain(
      'sitemap:read',
    );
  });
});

describe('правила без чужих входов', () => {
  it('обычное page-правило входов не объявляет', () => {
    // Пустой список — это утверждение «вердикт следует из снимка самой цели»,
    // и политика Resolved обязана отличать его от потерянного входа.
    const result = runModuleRules(
      'SEO',
      siteContext({
        pages: [{ path: '/page.html', html: '<html><head><title>T</title></head><body/></html>' }],
      }),
    );
    expect(evaluationOf(result, 'SEO-TECH-004').inputTargets).toEqual([]);
    // И спроса у него тоже нет: спрашивать не о чем, сравнивать нечего.
    expect(evaluationOf(result, 'SEO-TECH-004').requestedInputs).toBeUndefined();
  });
});

describe('спрос правила: о чём обход спрашивали, ответили или нет', () => {
  // Разница между «вход пропал» и «сайт о нём больше не спрашивает» — это
  // разница между неизвестностью и починкой, и рождается она здесь.
  it('SEO-TECH-006: цель ссылки в спросе, пока ссылка на странице', () => {
    const withLink = runModuleRules(
      'SEO',
      siteContext({ pages: [{ path: '/source.html', html: SOURCE_HTML }] }),
    );
    // Снимка цели нет (её не обошли), но ссылка на месте — значит спрашиваем.
    expect([...(evaluationOf(withLink, 'SEO-TECH-006').requestedInputs ?? [])]).toContain(
      `${ORIGIN}/gone.html`,
    );
    expect([...evaluationOf(withLink, 'SEO-TECH-006').inputTargets]).not.toContain(
      `${ORIGIN}/gone.html`,
    );

    // Владелец убрал ссылку: спрашивать больше не о чем.
    const withoutLink = runModuleRules(
      'SEO',
      siteContext({
        pages: [
          {
            path: '/source.html',
            html: '<!doctype html><html lang="en"><head><title>Source fixture page</title></head><body><h1>Source</h1></body></html>',
          },
        ],
      }),
    );
    expect([...(evaluationOf(withoutLink, 'SEO-TECH-006').requestedInputs ?? [])]).not.toContain(
      `${ORIGIN}/gone.html`,
    );
  });

  it('SEO-TECH-006: находка несёт свою зависимость — снимок цели ссылки', () => {
    const result = runModuleRules(
      'SEO',
      siteContext({
        pages: [
          { path: '/source.html', html: SOURCE_HTML },
          { path: '/gone.html', status: 404, html: '<html><body>gone</body></html>' },
        ],
      }),
    );
    const finding = result.findings.find((entry) => entry.ruleId === 'SEO-TECH-006');
    expect(finding?.dependencyTargets).toEqual([`${ORIGIN}/gone.html`]);
  });

  it('CONTENT-004: media в спросе всегда, а зависимость находки — только битая', () => {
    const html =
      '<!doctype html><html lang="en"><head><title>Media fixture page</title></head>' +
      '<body><h1>Media</h1><img src="/img/x.png" alt="x"><img src="/img/ok.png" alt="ok"></body></html>';
    const result = runModuleRules(
      'Content Quality',
      siteContext({
        pages: [
          { path: '/page.html', html },
          { path: '/img/x.png', status: 404, html: null, contentType: 'text/plain' },
        ],
      }),
    );
    const requested = [...(evaluationOf(result, 'CONTENT-004').requestedInputs ?? [])];
    // Краулер v0.1 media не фетчит, поэтому /img/ok.png остаётся без снимка —
    // но правило о нём спрашивало, и это не даёт признать его снятым.
    expect(requested).toContain(`${ORIGIN}/img/ok.png`);
    expect(requested).toContain(`${ORIGIN}/img/x.png`);
    const finding = result.findings.find((entry) => entry.ruleId === 'CONTENT-004');
    expect(finding?.dependencyTargets).toEqual([`${ORIGIN}/img/x.png`]);
  });

  it('SEO-TECH-008: страница, увиденная обходом, но не прочитанная, остаётся в спросе', () => {
    const hiddenHtml =
      '<!doctype html><html lang="en"><head><title>Hidden fixture page</title>' +
      '<meta name="robots" content="noindex"></head><body><h1>Hidden</h1></body></html>';
    const result = runModuleRules(
      'SEO',
      siteContext({
        pages: [{ path: '/hidden.html', html: hiddenHtml }],
        blockedByRobots: [`${ORIGIN}/linker.html`],
        skippedOverLimit: [`${ORIGIN}/over-limit.html`],
      }),
    );
    const requested = [...(evaluationOf(result, 'SEO-TECH-008').requestedInputs ?? [])];
    expect(requested).toContain(`${ORIGIN}/linker.html`);
    expect(requested).toContain(`${ORIGIN}/over-limit.html`);
    // Sitemap правило спрашивает всегда: прогон, не нашедший его, ничего о нём
    // не доказывает.
    expect(requested).toContain('sitemap:read');
  });

  it('SEO-TECH-007: спрос — всё, что обход увидел', () => {
    const result = runModuleRules(
      'SEO',
      siteContext({
        pages: [{ path: '/page.html', html: '<html><head><title>T</title></head><body/></html>' }],
        blockedByRobots: [`${ORIGIN}/blocked.html`],
      }),
    );
    const requested = [...(evaluationOf(result, 'SEO-TECH-007').requestedInputs ?? [])];
    expect(requested).toContain(`${ORIGIN}/page.html`);
    expect(requested).toContain(`${ORIGIN}/blocked.html`);
  });
});
