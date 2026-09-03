// Фикстурные тесты on-page SEO-правил (D-025): positive/negative + boundary
// для ONPAGE-001 (10/70) и ONPAGE-002 (50/160); границы включительны.

import { describe, expect, it } from 'vitest';

import type { IssueCandidate } from '../engine/run-module.js';
import type { SiteContext } from '../engine/types.js';
import { htmlContext, loadFixtureContext, runSeoRule } from '../testing/fixture-harness.js';

function single(candidates: readonly IssueCandidate[]): IssueCandidate {
  expect(candidates).toHaveLength(1);
  const first = candidates[0];
  if (first === undefined) {
    throw new Error('ожидался ровно один finding');
  }
  return first;
}

function pageWithTitle(title: string): SiteContext {
  return htmlContext(
    `<!doctype html><html lang="en"><head><title>${title}</title></head>` +
      '<body><h1>Heading</h1></body></html>',
  );
}

function pageWithDescription(description: string): SiteContext {
  return htmlContext(
    '<!doctype html><html lang="en"><head><title>Description fixture page</title>' +
      `<meta name="description" content="${description}"></head>` +
      '<body><h1>Heading</h1></body></html>',
  );
}

describe('SEO-ONPAGE-001 title', () => {
  it('positive: <title> отсутствует → finding (High) со стабильным fingerprint', () => {
    const finding = single(
      runSeoRule('SEO-ONPAGE-001', loadFixtureContext('fx-SEO-ONPAGE-001-positive.html')),
    );
    expect(finding.targetKind).toBe('page');
    expect(finding.severity).toBe('High');
    expect(finding.evidenceType).toBe('dom');
    expect(finding.normalizedSelector).toBe('title');
    expect(finding.fingerprint).toBe(
      'fluxradar-fp-v1:3297cb1bd3b5283b52c7beca4357c8e2bc56b95ac16b4d3fdf573f60fc8404b4',
    );
  });

  it('negative: title в допустимом диапазоне → пусто', () => {
    expect(runSeoRule('SEO-ONPAGE-001', loadFixtureContext('fx-SEO-ONPAGE-001-negative.html'))) //
      .toEqual([]);
  });

  it('boundary: ровно 10 символов — нижняя граница включительно, не finding', () => {
    expect(runSeoRule('SEO-ONPAGE-001', loadFixtureContext('fx-SEO-ONPAGE-001-boundary.html'))) //
      .toEqual([]);
  });

  it('границы: 9 символов → finding; 70 → пусто; 71 → finding', () => {
    expect(single(runSeoRule('SEO-ONPAGE-001', pageWithTitle('A'.repeat(9)))).evidenceExcerpt) //
      .toContain('< 10');
    expect(runSeoRule('SEO-ONPAGE-001', pageWithTitle('A'.repeat(70)))).toEqual([]);
    expect(single(runSeoRule('SEO-ONPAGE-001', pageWithTitle('A'.repeat(71)))).evidenceExcerpt) //
      .toContain('> 70');
  });
});

describe('SEO-ONPAGE-002 meta description', () => {
  it('positive: meta description отсутствует → finding (Medium)', () => {
    const finding = single(
      runSeoRule('SEO-ONPAGE-002', loadFixtureContext('fx-SEO-ONPAGE-002-positive.html')),
    );
    expect(finding.severity).toBe('Medium');
    expect(finding.evidenceType).toBe('dom');
    expect(finding.normalizedSelector).toBe('meta[name="description"]');
  });

  it('negative: длина в диапазоне 50–160 → пусто', () => {
    expect(runSeoRule('SEO-ONPAGE-002', loadFixtureContext('fx-SEO-ONPAGE-002-negative.html'))) //
      .toEqual([]);
  });

  it('boundary: ровно 50 символов — нижняя граница включительно, не finding', () => {
    expect(runSeoRule('SEO-ONPAGE-002', loadFixtureContext('fx-SEO-ONPAGE-002-boundary.html'))) //
      .toEqual([]);
  });

  it('границы: 49 символов → finding; 160 → пусто; 161 → finding', () => {
    const short = single(runSeoRule('SEO-ONPAGE-002', pageWithDescription('D'.repeat(49))));
    expect(short.evidenceExcerpt).toContain('< 50');
    expect(runSeoRule('SEO-ONPAGE-002', pageWithDescription('D'.repeat(160)))).toEqual([]);
    const long = single(runSeoRule('SEO-ONPAGE-002', pageWithDescription('D'.repeat(161))));
    expect(long.evidenceExcerpt).toContain('> 160');
  });
});

describe('SEO-ONPAGE-003 структура H1–H6', () => {
  it('positive: переход h1 → h3 без h2 → finding (Medium)', () => {
    const finding = single(
      runSeoRule('SEO-ONPAGE-003', loadFixtureContext('fx-SEO-ONPAGE-003-positive.html')),
    );
    expect(finding.severity).toBe('Medium');
    expect(finding.normalizedSelector).toBe('h3');
    expect(finding.evidenceExcerpt).toContain('h1 → h3');
  });

  it('negative: один h1 и иерархия без пропусков → пусто', () => {
    expect(runSeoRule('SEO-ONPAGE-003', loadFixtureContext('fx-SEO-ONPAGE-003-negative.html'))) //
      .toEqual([]);
  });

  it('нет h1 → finding; два h1 → finding', () => {
    const noH1 = htmlContext(
      '<!doctype html><html lang="en"><head><title>No h1 fixture page</title></head>' +
        '<body><h2>Second level only</h2></body></html>',
    );
    expect(single(runSeoRule('SEO-ONPAGE-003', noH1)).evidenceExcerpt).toContain('нет h1');
    const twoH1 = htmlContext(
      '<!doctype html><html lang="en"><head><title>Two h1 fixture page</title></head>' +
        '<body><h1>First</h1><h1>Second</h1></body></html>',
    );
    expect(single(runSeoRule('SEO-ONPAGE-003', twoH1)).evidenceExcerpt).toContain('2 раз');
  });
});

describe('SEO-ONPAGE-005 alt у изображений', () => {
  it('positive: 2 из 4 <img> без alt → один finding на страницу с количеством', () => {
    const finding = single(
      runSeoRule('SEO-ONPAGE-005', loadFixtureContext('fx-SEO-ONPAGE-005-positive.html')),
    );
    expect(finding.severity).toBe('Low');
    expect(finding.normalizedSelector).toBe('img[src="/img/first.png"]');
    expect(finding.evidenceExcerpt).toContain('2 <img>');
  });

  it('negative: alt задан или пустой (декоративный) → пусто', () => {
    expect(runSeoRule('SEO-ONPAGE-005', loadFixtureContext('fx-SEO-ONPAGE-005-negative.html'))) //
      .toEqual([]);
  });
});
