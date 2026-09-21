// Фикстурные тесты Content Quality-правил (D-025): CONTENT-003 (порог 200
// видимых символов, boundary 199/200) и CONTENT-004 (битые media по снимкам
// обхода + внутренние media без снимка, D-165).

import { describe, expect, it } from 'vitest';

import type { IssueCandidate } from '../engine/run-module.js';
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

  it('внутренняя media, которую никто не запрашивал, → ничего', () => {
    // The finding this replaces: "Internal media the crawl could not confirm",
    // Medium severity and a score penalty, on a file the crawler never fetched.
    // Checked by hand on 2026-09-21, every such file answered 200.
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Unverified media page</title></head>' +
        '<body><img src="/img/unknown.png" alt="Unknown picture" /></body></html>',
    );

    expect(runRule('Content Quality', 'CONTENT-004', ctx)).toEqual([]);
  });

  it('media, проверенная HEAD-ом и ответившая 404, → finding c confidence 1', () => {
    const ctx = siteContext({
      pages: [
        {
          path: '/page.html',
          html:
            '<!doctype html><html lang="en"><head><title>Verified media page</title></head>' +
            '<body><img src="/img/gone.png" alt="Gone" /></body></html>',
        },
      ],
      // What the crawl's media pass records: the file was asked for, and said no.
      mediaChecks: [{ path: '/img/gone.png', status: 404, contentType: 'text/plain', html: '' }],
    });

    const finding = single(runRule('Content Quality', 'CONTENT-004', ctx));
    expect(finding.confidence).toBe(1);
    expect(finding.evidenceExcerpt).toBe(
      'Media that returns an HTTP error (1): img[src="/img/gone.png"] (HTTP 404)',
    );
  });

  it('media, проверенная HEAD-ом и ответившая 200, → ничего', () => {
    const ctx = siteContext({
      pages: [
        {
          path: '/page.html',
          html:
            '<!doctype html><html lang="en"><head><title>Working media page</title></head>' +
            '<body><img src="/img/logo.png" alt="Logo" /></body></html>',
        },
      ],
      mediaChecks: [{ path: '/img/logo.png', status: 200, contentType: 'image/png', html: '' }],
    });

    expect(runRule('Content Quality', 'CONTENT-004', ctx)).toEqual([]);
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
            '<img src="/img/gone.png" alt="Gone" />' +
            '<img src="/img/unknown.png" alt="Never asked about" /></body></html>',
        },
        {
          path: '/other.html',
          html: '<!doctype html><html lang="en"><head><title>Other page</title></head><body><p>Other</p></body></html>',
        },
      ],
      mediaChecks: [{ path: '/img/gone.png', status: 404, contentType: 'text/plain', html: '' }],
    });
    const finding = runRule('Content Quality', 'CONTENT-004', ctx).find((entry) =>
      entry.normalizedUrl.endsWith('/page.html'),
    );
    expect(finding?.messages?.evidence.code).toBe('content-004.evidence.mixed');
    // Two verified failures are named. The third image was never requested, so
    // it appears nowhere: the breakdown lists what was checked, not what was
    // referenced.
    expect(finding?.evidenceExcerpt).toBe(
      'Broken media: 2. Unreachable: —. HTTP error: img[src="/img/gone.png"] (HTTP 404). ' +
        'Returns an HTML page instead of media: img[src="/other.html"].',
    );
  });
});
