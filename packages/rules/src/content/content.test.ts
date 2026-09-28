// Фикстурные тесты Content Quality-правил (D-025): CONTENT-003 (порог 200
// видимых символов, boundary 199/200) и CONTENT-004 (битые media по снимкам
// обхода + внутренние media без снимка, D-165).

import { computeModuleScore } from '@fluxradar/scoring';
import { describe, expect, it } from 'vitest';

import type { IssueCandidate } from '../engine/run-module.js';
import { runModuleRules } from '../engine/run-module.js';
import {
  findingMessage,
  RENDER_ONLY_MESSAGE_CODES,
  renderFindingMessage,
} from '../messages/index.js';
import {
  htmlContext,
  loadFixtureContext,
  runRule,
  siteContext,
} from '../testing/fixture-harness.js';

// >= MIN_PROSE_SENTENCES (5) and >= MIN_PROSE_WORDS (100): short of either and
// content-005.ts calls the page too-little-prose to measure rather than
// scoring it (H4 in the T9 review — a one- or three-sentence page is not
// enough text for Flesch's own calibration, regardless of its score).
const EASY_ENGLISH_PARAGRAPH =
  'The cat sat on the mat. The dog ran to the park. Kids play in the sun. ' +
  'Birds sing in the trees. The sky is blue and clear. We eat lunch at noon. ' +
  'Mom reads a book. Dad cooks a meal. The day is warm and nice. We go for a walk. ' +
  'The park has a big pond. Ducks swim near the shore. A boy throws a ball. ' +
  'His dog runs to get it. We sit on a bench. The wind feels cool and soft. ' +
  'Soon the sun goes down. We walk back home. Dad turns on the lights. We eat a snack and rest.';

const HARD_ENGLISH_PARAGRAPH =
  'Notwithstanding the aforementioned multifaceted considerations, the interdisciplinary ' +
  'implementation methodology necessitates comprehensive institutional collaboration among ' +
  'heterogeneous organizational stakeholders possessing substantially divergent operational ' +
  'prerequisites, thereby precipitating extraordinarily convoluted procedural ramifications ' +
  "that further complicate the already labyrinthine administrative infrastructure characterizing this jurisdiction's " +
  'entire regulatory environment. ' +
  'Notwithstanding this jurisdictional regulatory environment, the aforementioned institutional ' +
  'stakeholders necessitate an extraordinarily comprehensive reevaluation of their organizational ' +
  'prerequisites. Furthermore, the interdisciplinary methodology underlying this administrative ' +
  'infrastructure precipitates substantially divergent procedural ramifications across heterogeneous ' +
  'operational jurisdictions. Consequently, the aforementioned convoluted collaboration necessitates ' +
  'an unprecedented degree of institutional reevaluation and organizational restructuring. The labyrinthine ' +
  'ramifications thereof further complicate an already multifaceted regulatory undertaking.';

function single(candidates: readonly IssueCandidate[]): IssueCandidate {
  expect(candidates).toHaveLength(1);
  const first = candidates[0];
  if (first === undefined) {
    throw new Error('ожидался ровно один finding');
  }
  return first;
}

describe('CONTENT-003 малосодержательные страницы', () => {
  it('positive: короткий текст → finding, script-текст не считается', () => {
    const finding = single(
      runRule('Content Quality', 'CONTENT-003', loadFixtureContext('fx-CONTENT-003-positive.html')),
    );
    expect(finding.severity).toBe('Medium');
    expect(finding.evidenceType).toBe('dom');
    expect(finding.evidenceExcerpt).toContain('Visible text length is 20,');
    expect(finding.messages?.evidence).toMatchObject({
      code: 'content-003.evidence',
      params: { length: 20, minimum: 200 },
    });
    expect(finding.messages?.recommendation.code).toBe('content-003.recommendation');
  });

  it('negative: текст длиннее порога → пусто', () => {
    expect(
      runRule('Content Quality', 'CONTENT-003', loadFixtureContext('fx-CONTENT-003-negative.html')),
    ).toEqual([]);
  });

  it('boundary: ровно 200 — норма, 199 — finding', () => {
    const findings = runRule(
      'Content Quality',
      'CONTENT-003',
      loadFixtureContext('fx-CONTENT-003-boundary.json'),
    );
    const finding = single(findings);
    expect(finding.normalizedUrl).toBe('https://fixture.test/below-threshold.html');
    expect(finding.evidenceExcerpt).toContain('Visible text length is 199,');
  });

  it('длина считается по раскрытому тексту, а не по разметке сущностей', () => {
    // `&amp;` — один видимый символ, а не пять: порог 200 меряет то, что видит
    // читатель. Иначе страница из одних сущностей дотягивала бы до порога
    // разметкой, а CONTENT-001 считал бы две одинаковые страницы разными
    // (visible-text.ts — общий текст обоих правил).
    const decoded = 'Salt & Pepper — «menu»';
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Entity heavy page</title></head>' +
        '<body><p>Salt &amp; Pepper &mdash; &laquo;menu&raquo;</p></body></html>',
    );
    const finding = single(runRule('Content Quality', 'CONTENT-003', ctx));
    expect(finding.evidenceExcerpt).toContain(`Visible text length is ${[...decoded].length},`);
    expect(finding.evidenceExcerpt).toContain(decoded);
    expect(finding.evidenceExcerpt).not.toContain('&amp;');
  });

  it('whitespace схлопывается до подсчёта', () => {
    const padded = `  ${'word '.repeat(10)}  `;
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Whitespace heavy page</title></head>' +
        `<body><p>${padded}</p><p>\n\t${padded}</p></body></html>`,
    );
    // 2 × 49 видимых символов + разделитель — далеко до 200 → finding.
    expect(single(runRule('Content Quality', 'CONTENT-003', ctx)).evidenceExcerpt) //
      .toContain('Visible text length is 99,');
  });
});

describe('CONTENT-004 битые media', () => {
  it('positive: img на снимок 404 → finding c confidence 1', () => {
    const finding = single(
      runRule('Content Quality', 'CONTENT-004', loadFixtureContext('fx-CONTENT-004-positive.json')),
    );
    expect(finding.normalizedSelector).toBe('img[src="/img/broken.png"]');
    // One failure kind reads as one sentence, not four clauses with three "—".
    expect(finding.evidenceExcerpt).toBe(
      'Media that returns an HTTP error (1): img[src="/img/broken.png"] (HTTP 404)',
    );
    expect(finding.confidence).toBe(1);
    expect(finding.messages?.evidence).toEqual({
      code: 'content-004.evidence.http-error',
      params: { count: 1, items: 'img[src="/img/broken.png"] (HTTP 404)' },
    });
    expect(finding.messages?.recommendation.code).toBe('content-004.recommendation');
  });

  it('negative: снимок 200 image/png и внешняя картинка без снимка → пусто', () => {
    expect(
      runRule('Content Quality', 'CONTENT-004', loadFixtureContext('fx-CONTENT-004-negative.json')),
    ).toEqual([]);
  });

  it('проба media 404 → подтверждённая находка, хотя страницы-снимка нет', () => {
    const finding = single(
      runRule(
        'Content Quality',
        'CONTENT-004',
        siteContext({
          pages: [
            {
              path: '/page.html',
              html:
                '<!doctype html><html lang="en"><head><title>Probed media page</title></head>' +
                '<body><img src="/img/gone.png" alt="Gone" /></body></html>',
            },
          ],
          resources: [{ path: '/img/gone.png', status: 404, contentType: 'text/html' }],
        }),
      ),
    );
    expect(finding.confidence).toBe(1);
    expect(finding.evidenceExcerpt).toBe(
      'Media that returns an HTTP error (1): img[src="/img/gone.png"] (HTTP 404)',
    );
  });

  it('проба media 200 → находки нет', () => {
    expect(
      runRule(
        'Content Quality',
        'CONTENT-004',
        siteContext({
          pages: [
            {
              path: '/page.html',
              html:
                '<!doctype html><html lang="en"><head><title>Working media page</title></head>' +
                '<body><img src="/img/ok.png" alt="Fine" /></body></html>',
            },
          ],
          resources: [{ path: '/img/ok.png', status: 200, contentType: 'image/png' }],
        }),
      ),
    ).toEqual([]);
  });

  it('непроверенная проба (robots/бюджет) не становится подтверждённой поломкой', () => {
    for (const unverifiedReason of [
      'RobotsDisallowed',
      'BudgetExhausted',
      'RequestFailed',
    ] as const) {
      expect(
        runRule(
          'Content Quality',
          'CONTENT-004',
          siteContext({
            pages: [
              {
                path: '/page.html',
                html:
                  '<!doctype html><html lang="en"><head><title>Unchecked media page</title></head>' +
                  '<body><img src="/img/unchecked.png" alt="Unchecked" /></body></html>',
              },
            ],
            resources: [{ path: '/img/unchecked.png', unverifiedReason }],
          }),
        ),
      ).toEqual([]);
    }
  });

  it('внутренняя media без снимка и без пробы → пусто: обход её не проверял', () => {
    // The finding this replaces: "Internal media the crawl could not confirm",
    // Medium severity and a score penalty, on a file the crawler never fetched.
    // Checked by hand on 2026-09-21, every such file answered 200.
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Unverified media page</title></head>' +
        '<body><img src="/img/unknown.png" alt="Unknown picture" /></body></html>',
    );
    expect(runRule('Content Quality', 'CONTENT-004', ctx)).toEqual([]);
  });

  it('здоровая страница без снимков media сохраняет score 100', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Healthy content page</title></head>' +
        // Simple, varied sentences: real content that also reads easily, so this
        // fixture keeps testing CONTENT-004 alone rather than tripping CONTENT-005.
        `<body><p>${EASY_ENGLISH_PARAGRAPH}</p>` +
        '<img src="/healthy-logo.png" alt="Logo" /></body></html>',
    );
    const result = runModuleRules('Content Quality', ctx);
    expect(result.findings.filter((finding) => finding.ruleId === 'CONTENT-004')).toEqual([]);
    // Unknown media availability may not cost the page a single point.
    expect(computeModuleScore(result.findings).score).toBe(100);
  });

  it('media на HTML-страницу (2xx) — битая: img не может отдавать text/html', () => {
    const ctx = siteContext({
      pages: [
        {
          path: '/page.html',
          html:
            '<!doctype html><html lang="en"><head><title>Html media page</title></head>' +
            '<body><img src="/other.html" alt="Wrong target" /></body></html>',
        },
        {
          path: '/other.html',
          html: '<!doctype html><html lang="en"><head><title>Other page</title></head><body><p>Other</p></body></html>',
        },
      ],
    });
    const findings = runRule('Content Quality', 'CONTENT-004', ctx);
    const finding = findings.find((entry) => entry.normalizedUrl.endsWith('/page.html'));
    expect(finding?.evidenceExcerpt).toBe(
      'Media links that return an HTML page instead of a file (1): img[src="/other.html"]',
    );
  });

  it('media, битые по разным причинам, → полная разбивка по причинам', () => {
    const ctx = siteContext({
      pages: [
        {
          path: '/page.html',
          html:
            '<!doctype html><html lang="en"><head><title>Mixed media page</title></head>' +
            '<body><img src="/other.html" alt="Wrong target" />' +
            '<img src="/img/missing.png" alt="Missing picture" />' +
            '<img src="/img/unknown.png" alt="Never asked about" /></body></html>',
        },
        {
          path: '/other.html',
          html: '<!doctype html><html lang="en"><head><title>Other page</title></head><body><p>Other</p></body></html>',
        },
        { path: '/img/missing.png', status: 404, html: null, contentType: 'image/png' },
      ],
    });
    const finding = runRule('Content Quality', 'CONTENT-004', ctx).find((entry) =>
      entry.normalizedUrl.endsWith('/page.html'),
    );
    // The three-kind breakdown is its own code: `content-004.evidence.mixed`
    // still names a fourth kind and renders the findings stored with it.
    // Two verified failures are named. The third image was never requested, so
    // it appears nowhere: the breakdown lists what was checked, not what was
    // referenced.
    expect(finding?.messages?.evidence.code).toBe('content-004.evidence.mixed-v2');
    expect(RENDER_ONLY_MESSAGE_CODES).not.toContain(finding?.messages?.evidence.code);
    expect(finding?.evidenceExcerpt).toBe(
      'Broken media: 2. Unreachable: —. HTTP error: img[src="/img/missing.png"] (HTTP 404). ' +
        'Returns an HTML page instead of media: img[src="/other.html"].',
    );
  });

  it('ни одна комбинация причин не выдаёт исторический код', () => {
    // Исторические коды остаются в каталоге ради уже сохранённых находок; новая
    // находка обязана ссылаться только на текущие.
    const ctx = siteContext({
      pages: [
        {
          path: '/page.html',
          html:
            '<!doctype html><html lang="en"><head><title>Every kind page</title></head>' +
            '<body><img src="/other.html" alt="Wrong target" />' +
            '<img src="/img/missing.png" alt="Missing picture" />' +
            '<img src="/img/offline.png" alt="Offline picture" /></body></html>',
        },
        {
          path: '/other.html',
          html: '<!doctype html><html lang="en"><head><title>Other page</title></head><body><p>Other</p></body></html>',
        },
        { path: '/img/missing.png', status: 404, html: null, contentType: 'image/png' },
        { path: '/img/offline.png', fetchError: 'connection refused' },
      ],
    });
    const codes = runRule('Content Quality', 'CONTENT-004', ctx).map(
      (finding) => finding.messages?.evidence.code,
    );
    expect(codes).not.toEqual([]);
    for (const code of codes) {
      expect(RENDER_ONLY_MESSAGE_CODES).not.toContain(code);
    }
  });

  it('внешняя media без снимка не оценивается, подтверждённая поломка — оценивается', () => {
    const ctx = siteContext({
      pages: [
        {
          path: '/page.html',
          html:
            '<!doctype html><html lang="en"><head><title>External media page</title></head>' +
            '<body><img src="https://cdn.example.net/remote.png" alt="Remote" />' +
            '<img src="/img/gone.png" alt="Gone" /></body></html>',
        },
        { path: '/img/gone.png', status: 500, html: null, contentType: 'image/png' },
      ],
    });
    const finding = runRule('Content Quality', 'CONTENT-004', ctx).find((entry) =>
      entry.normalizedUrl.endsWith('/page.html'),
    );
    expect(finding?.confidence).toBe(1);
    expect(finding?.evidenceExcerpt).toBe(
      'Media that returns an HTTP error (1): img[src="/img/gone.png"] (HTTP 500)',
    );
  });
});

describe('CONTENT-005 низька читабельність', () => {
  it('positive: складний англомовний текст → finding, Low severity', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Dense page</title></head>' +
        `<body><p>${HARD_ENGLISH_PARAGRAPH}</p></body></html>`,
    );
    const finding = single(runRule('Content Quality', 'CONTENT-005', ctx));
    expect(finding.severity).toBe('Low');
    expect(finding.evidenceType).toBe('dom');
    expect(finding.messages?.evidence.code).toBe('content-005.evidence.en-scale');
    expect(finding.messages?.evidence.params.minimum).toBe(30);
    expect(finding.messages?.recommendation.code).toBe('content-005.recommendation');
  });

  it('negative: простий англомовний текст → пусто', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Easy page</title></head>' +
        `<body><p>${EASY_ENGLISH_PARAGRAPH}</p></body></html>`,
    );
    expect(runRule('Content Quality', 'CONTENT-005', ctx)).toEqual([]);
  });

  it('надто короткий текст (< 200 символів) → правило не застосовне', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Short</title></head>' +
        `<body><p>${HARD_ENGLISH_PARAGRAPH.slice(0, 100)}</p></body></html>`,
    );
    const result = runModuleRules('Content Quality', ctx);
    const evaluation = result.evaluations.find((entry) => entry.ruleId === 'CONTENT-005');
    expect(evaluation?.applicableTargets).toBe(0);
    expect(evaluation?.notApplicableReason).toBe('no-candidates');
    expect(result.findings.filter((finding) => finding.ruleId === 'CONTENT-005')).toEqual([]);
  });

  it('надто мало речень і слів (>= 200 символів, але не проза) → too-little-prose', () => {
    // 16 short list labels: well over 200 characters (VISIBLE_TEXT_MIN_CHARS),
    // and now over MIN_PROSE_SENTENCES too — L7 (T9 second review) counts each
    // <li> boundary as a sentence end — but still under MIN_PROSE_WORDS at
    // 5 words each. The H4 case from the T9 review (a nav/list page, not
    // prose) stays too-little-prose on the word count, not the sentence count.
    const listItems = Array.from(
      { length: 16 },
      (_, index) => `<li><a href="/p${index}">Product update ${index} for teams</a></li>`,
    ).join('');
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Updates</title></head>' +
        `<body><h1>Updates</h1><ul>${listItems}</ul></body></html>`,
    );
    const result = runModuleRules('Content Quality', ctx);
    const evaluation = result.evaluations.find((entry) => entry.ruleId === 'CONTENT-005');
    expect(evaluation?.applicableTargets).toBe(0);
    expect(evaluation?.notApplicableReason).toBe('too-little-prose');
    expect(result.findings.filter((finding) => finding.ruleId === 'CONTENT-005')).toEqual([]);
  });

  it('непідтримувана мова (наприклад, французька) → правило не застосовне, а не «проблем немає»', () => {
    const french =
      'Nonobstant les considérations susmentionnées, la méthodologie de mise en œuvre ' +
      'interdisciplinaire nécessite une collaboration institutionnelle exhaustive entre ' +
      'des parties prenantes organisationnelles hétérogènes.'.repeat(2);
    const ctx = htmlContext(
      '<!doctype html><html lang="fr"><head><title>Page française</title></head>' +
        `<body><p>${french}</p></body></html>`,
    );
    const result = runModuleRules('Content Quality', ctx);
    const evaluation = result.evaluations.find((entry) => entry.ruleId === 'CONTENT-005');
    expect(evaluation?.applicableTargets).toBe(0);
    expect(evaluation?.notApplicableReason).toBe('unsupported-language');
  });

  it('французька сторінка БЕЗ lang → not applicable, а не англійська шкала (H1)', () => {
    const french =
      'Nonobstant les considérations susmentionnées, la méthodologie de mise en œuvre ' +
      'interdisciplinaire nécessite une collaboration institutionnelle exhaustive entre ' +
      'des parties prenantes organisationnelles hétérogènes.'.repeat(2);
    const ctx = htmlContext(
      '<!doctype html><html><head><title>Page française</title></head>' +
        `<body><p>${french}</p></body></html>`,
    );
    const result = runModuleRules('Content Quality', ctx);
    const evaluation = result.evaluations.find((entry) => entry.ruleId === 'CONTENT-005');
    expect(evaluation?.applicableTargets).toBe(0);
    expect(evaluation?.notApplicableReason).toBe('no-declared-language');
    expect(result.findings.filter((finding) => finding.ruleId === 'CONTENT-005')).toEqual([]);
  });

  it('lang="en" над українським текстом → script-mismatch, а не завищений бал (H2)', () => {
    const ukrainianText = (
      'Незважаючи на згадані вище багатогранні міркування, міждисциплінарна методологія ' +
      'впровадження потребує всебічної інституційної співпраці між різнорідними ' +
      'організаційними зацікавленими сторонами. '
    ).repeat(3);
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Mislabeled</title></head>' +
        `<body><p>${ukrainianText}</p></body></html>`,
    );
    const result = runModuleRules('Content Quality', ctx);
    const evaluation = result.evaluations.find((entry) => entry.ruleId === 'CONTENT-005');
    expect(evaluation?.applicableTargets).toBe(0);
    expect(evaluation?.notApplicableReason).toBe('script-mismatch');
  });

  it('українська мова вимірюється своєю шкалою (не англійською)', () => {
    const easyUkrainian = (
      'Кіт спить. Пес біжить. День теплий. Сонце світить. Діти грають. ' +
      'Ми йдемо гуляти. Мама читає книгу. Тато варить обід. Небо синє. Пташки співають. '
    ).repeat(5);
    const ctx = htmlContext(
      '<!doctype html><html lang="uk"><head><title>Проста сторінка</title></head>' +
        `<body><p>${easyUkrainian}</p></body></html>`,
    );
    const findings = runRule('Content Quality', 'CONTENT-005', ctx);
    expect(findings).toEqual([]);
  });

  it('відсутній атрибут lang → правило не застосовне (ніколи не падає на англійську)', () => {
    const ctx = htmlContext(
      '<!doctype html><html><head><title>No lang attribute</title></head>' +
        `<body><p>${HARD_ENGLISH_PARAGRAPH}</p></body></html>`,
    );
    const result = runModuleRules('Content Quality', ctx);
    const evaluation = result.evaluations.find((entry) => entry.ruleId === 'CONTENT-005');
    expect(evaluation?.applicableTargets).toBe(0);
    expect(evaluation?.notApplicableReason).toBe('no-declared-language');
    expect(result.findings.filter((finding) => finding.ruleId === 'CONTENT-005')).toEqual([]);
  });

  it('оцінка обмежена 0..100: дуже складний текст показує 0, а не від’ємне число (H3)', () => {
    const veryHard =
      HARD_ENGLISH_PARAGRAPH +
      ' Notwithstanding the aforementioned extraordinarily multifaceted institutional ' +
      'considerations, the interdisciplinary implementation methodology necessitates an ' +
      'unprecedentedly comprehensive organizational reevaluation.'.repeat(4);
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Very dense</title></head>' +
        `<body><p>${veryHard}</p></body></html>`,
    );
    const finding = single(runRule('Content Quality', 'CONTENT-005', ctx));
    expect(finding.messages?.evidence.params.score).toBe(0);
    expect(renderFindingMessage(finding.messages!.evidence, 'en')).toContain('score is 0 ');
  });

  // L8 (T9 second review): only content-005.evidence.en-scale was pinned — no
  // test anywhere produced a uk-scale finding or rendered its honest scale name.
  it('складний український текст → finding на uk-scale, з чесною назвою шкали в обох мовах', () => {
    const clause =
      'вищезгадані багатогранні інституційні міркування, міждисциплінарна методологія ' +
      'впровадження, всебічна організаційна співпраця, різнорідні операційні передумови, ' +
      'надзвичайно заплутані процедурні наслідки, лабіринтоподібна адміністративна ' +
      'інфраструктура, безпрецедентне переоцінювання, суттєво розбіжні юрисдикційні обставини';
    const sentence = `${clause}, ${clause}, ${clause}.`;
    const hardUkrainian = Array.from({ length: 5 }, () => sentence).join(' ');
    const ctx = htmlContext(
      '<!doctype html><html lang="uk"><head><title>Складна сторінка</title></head>' +
        `<body><p>${hardUkrainian}</p></body></html>`,
    );
    const finding = single(runRule('Content Quality', 'CONTENT-005', ctx));
    expect(finding.messages?.evidence.code).toBe('content-005.evidence.uk-scale');
    const message = finding.messages!.evidence;
    expect(renderFindingMessage(message, 'uk')).toContain('читабельність за Оборнєвою');
    expect(renderFindingMessage(message, 'en')).toContain('Oborneva readability');
  });

  it('uk-scale message renders the honest human scale name directly from the catalog (L8)', () => {
    const message = findingMessage('content-005.evidence.uk-scale', {
      score: 12,
      minimum: 30,
      sentences: 8,
      words: 122,
    });
    expect(renderFindingMessage(message, 'uk')).toContain(
      'читабельність за Оборнєвою — адаптація формули Флеша, відкалібрована на російських текстах',
    );
    expect(renderFindingMessage(message, 'en')).toContain(
      'Oborneva readability, a Flesch adaptation calibrated on Russian',
    );
  });
});

// M4 (T9 second review): aggregateNotApplicableReason names the *most common*
// reason among the crawl's pages, not a reason every page shares — the two
// probe cases from the review, pinned so the plurality tie-break stays honest.
describe('aggregateNotApplicableReason (M4)', () => {
  const filler = 'word '.repeat(50);
  const pageWithLang = (path: string, lang: string | null) => ({
    path,
    html:
      `<!doctype html><html${lang === null ? '' : ` lang="${lang}"`}>` +
      `<head><title>${path}</title></head><body><p>${filler}</p></body></html>`,
  });

  it('unsupported-language wins 2 of 3 (fr, de, no lang)', () => {
    const ctx = siteContext({
      pages: [
        pageWithLang('/a.html', 'fr'),
        pageWithLang('/b.html', 'de'),
        pageWithLang('/c.html', null),
      ],
    });
    const result = runModuleRules('Content Quality', ctx);
    const evaluation = result.evaluations.find((entry) => entry.ruleId === 'CONTENT-005');
    expect(evaluation?.notApplicableReason).toBe('unsupported-language');
  });

  it('no-declared-language wins 2 of 3 (no lang, no lang, fr)', () => {
    const ctx = siteContext({
      pages: [
        pageWithLang('/a.html', null),
        pageWithLang('/b.html', null),
        pageWithLang('/c.html', 'fr'),
      ],
    });
    const result = runModuleRules('Content Quality', ctx);
    const evaluation = result.evaluations.find((entry) => entry.ruleId === 'CONTENT-005');
    expect(evaluation?.notApplicableReason).toBe('no-declared-language');
  });
});
