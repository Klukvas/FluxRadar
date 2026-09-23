// Фикстурные тесты Content Quality-правил (D-025): CONTENT-003 (порог 200
// видимых символов, boundary 199/200) и CONTENT-004 (битые media по снимкам
// обхода + внутренние media без снимка, D-165).

import { computeModuleScore } from '@fluxradar/scoring';
import { describe, expect, it } from 'vitest';

import type { IssueCandidate } from '../engine/run-module.js';
import { runModuleRules } from '../engine/run-module.js';
import { RENDER_ONLY_MESSAGE_CODES } from '../messages/index.js';
import {
  htmlContext,
  loadFixtureContext,
  runRule,
  siteContext,
} from '../testing/fixture-harness.js';

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
        `<body><p>${'Real editorial content. '.repeat(20)}</p>` +
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
