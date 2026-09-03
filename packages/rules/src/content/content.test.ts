// Фикстурные тесты Content Quality-правил (D-025): CONTENT-003 (порог 200
// видимых символов, boundary 199/200) и CONTENT-004 (битые media по снимкам
// обхода + внутренние media без снимка, D-165).

import { describe, expect, it } from 'vitest';

import type { IssueCandidate } from '../engine/run-module.js';
import { htmlContext, loadFixtureContext, runRule, siteContext } from '../testing/fixture-harness.js';

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
    expect(finding.evidenceExcerpt).toContain('20 символов');
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
    expect(finding.evidenceExcerpt).toContain('199 символов');
  });

  it('whitespace схлопывается до подсчёта', () => {
    const padded = `  ${'word '.repeat(10)}  `;
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Whitespace heavy page</title></head>' +
        `<body><p>${padded}</p><p>\n\t${padded}</p></body></html>`,
    );
    // 2 × 49 видимых символов + разделитель — далеко до 200 → finding.
    expect(single(runRule('Content Quality', 'CONTENT-003', ctx)).evidenceExcerpt) //
      .toContain('99 символов');
  });
});

describe('CONTENT-004 битые media', () => {
  it('positive: img на снимок 404 → finding c confidence 1', () => {
    const finding = single(
      runRule('Content Quality', 'CONTENT-004', loadFixtureContext('fx-CONTENT-004-positive.json')),
    );
    expect(finding.normalizedSelector).toBe('img[src="/img/broken.png"]');
    expect(finding.evidenceExcerpt).toContain('HTTP 404');
    expect(finding.confidence).toBe(1);
  });

  it('negative: снимок 200 image/png и внешняя картинка без снимка → пусто', () => {
    expect(
      runRule('Content Quality', 'CONTENT-004', loadFixtureContext('fx-CONTENT-004-negative.json')),
    ).toEqual([]);
  });

  it('внутренняя media без снимка → finding со сниженным confidence (D-165)', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Unconfirmed media page</title></head>' +
        '<body><img src="/img/unknown.png" alt="Unknown picture" /></body></html>',
    );
    const finding = single(runRule('Content Quality', 'CONTENT-004', ctx));
    expect(finding.confidence).toBe(0.6);
    expect(finding.evidenceExcerpt).toContain('не подтверждён обходом');
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
    expect(finding?.evidenceExcerpt).toContain('HTML-страницей');
  });
});
