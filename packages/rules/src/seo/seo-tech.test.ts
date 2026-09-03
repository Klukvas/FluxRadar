// Фикстурные тесты технических SEO-правил (D-025): positive → ровно один
// ожидаемый finding (severity из реестра), negative → пусто, boundary — для
// TECH-005 (порог 2 hop-а). Literal fingerprints фиксируют контракт v1.

import { describe, expect, it } from 'vitest';

import type { IssueCandidate } from '../engine/run-module.js';
import {
  htmlContext,
  loadFixtureContext,
  runSeoRule,
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

describe('SEO-TECH-001 robots.txt', () => {
  it('positive: robots.txt отсутствует → site-finding со стабильным fingerprint', () => {
    const finding = single(
      runSeoRule('SEO-TECH-001', loadFixtureContext('fx-SEO-TECH-001-positive.json')),
    );
    expect(finding.targetKind).toBe('site');
    expect(finding.severity).toBe('Medium');
    expect(finding.evidenceType).toBe('http');
    expect(finding.normalizedUrl).toBe('');
    expect(finding.targetUrl).toBe('https://fixture.test/robots.txt');
    expect(finding.fingerprint).toBe(
      'fluxradar-fp-v1:ec33b78b5e3c4a4c508dd640bcca9d1369aae214d4e4c8ae137e5effdba57af6',
    );
  });

  it('negative: robots.txt получен → пусто', () => {
    expect(runSeoRule('SEO-TECH-001', loadFixtureContext('fx-SEO-TECH-001-negative.json'))) //
      .toEqual([]);
  });
});

describe('SEO-TECH-002 sitemap.xml', () => {
  it('positive: sitemap не дал ни одного URL → site-finding (Low)', () => {
    const finding = single(
      runSeoRule('SEO-TECH-002', loadFixtureContext('fx-SEO-TECH-002-positive.json')),
    );
    expect(finding.targetKind).toBe('site');
    expect(finding.severity).toBe('Low');
    expect(finding.evidenceType).toBe('http');
  });

  it('negative: sitemap-URL-ы найдены → пусто', () => {
    expect(runSeoRule('SEO-TECH-002', loadFixtureContext('fx-SEO-TECH-002-negative.json'))) //
      .toEqual([]);
  });
});

describe('SEO-TECH-003 HTTP status', () => {
  it('positive: страница с финальным 404 → finding с http-evidence', () => {
    const finding = single(
      runSeoRule('SEO-TECH-003', loadFixtureContext('fx-SEO-TECH-003-positive.json')),
    );
    expect(finding.targetKind).toBe('page');
    expect(finding.severity).toBe('Medium');
    expect(finding.evidenceType).toBe('http');
    expect(finding.normalizedUrl).toBe('https://fixture.test/gone.html');
    expect(finding.evidenceExcerpt).toContain('HTTP 404');
  });

  it('negative: 200-страница → пусто', () => {
    expect(runSeoRule('SEO-TECH-003', loadFixtureContext('fx-SEO-TECH-003-negative.json'))) //
      .toEqual([]);
  });
});

describe('SEO-TECH-004 canonical', () => {
  it('positive: canonical на чужой host → finding (High)', () => {
    const finding = single(
      runSeoRule('SEO-TECH-004', loadFixtureContext('fx-SEO-TECH-004-positive.html')),
    );
    expect(finding.severity).toBe('High');
    expect(finding.evidenceType).toBe('dom');
    expect(finding.normalizedSelector).toBe('link[rel="canonical"]');
    expect(finding.evidenceExcerpt).toContain('another-domain.example');
  });

  it('negative: точный self-canonical → пусто', () => {
    expect(runSeoRule('SEO-TECH-004', loadFixtureContext('fx-SEO-TECH-004-negative.html'))) //
      .toEqual([]);
  });

  it('canonical отсутствует → finding', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>No canonical here</title></head>' +
        '<body><h1>Page</h1></body></html>',
    );
    expect(single(runSeoRule('SEO-TECH-004', ctx)).evidenceExcerpt).toContain('отсутствует');
  });

  it('относительный self-canonical разрешается против finalUrl → пусто', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Relative canonical page</title>' +
        '<link rel="canonical" href="page.html"></head><body><h1>Page</h1></body></html>',
    );
    expect(runSeoRule('SEO-TECH-004', ctx)).toEqual([]);
  });

  it('www-вариант того же домена — другой host → finding (D-151)', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Www canonical page</title>' +
        '<link rel="canonical" href="https://www.fixture.test/page.html"></head>' +
        '<body><h1>Page</h1></body></html>',
    );
    expect(single(runSeoRule('SEO-TECH-004', ctx)).evidenceExcerpt).toContain('www.fixture.test');
  });
});

describe('SEO-TECH-005 redirect chains/cycles', () => {
  it('positive: цепочка из 3 hop-ов → finding (Medium)', () => {
    const finding = single(
      runSeoRule('SEO-TECH-005', loadFixtureContext('fx-SEO-TECH-005-positive.json')),
    );
    expect(finding.severity).toBe('Medium');
    expect(finding.evidenceType).toBe('http');
    expect(finding.evidenceExcerpt).toContain('3 redirect');
    expect(finding.targetUnreachable).toBeUndefined();
  });

  it('negative: одиночный redirect → пусто', () => {
    expect(runSeoRule('SEO-TECH-005', loadFixtureContext('fx-SEO-TECH-005-negative.json'))) //
      .toEqual([]);
  });

  it('boundary: ровно 2 hop-а — уже finding', () => {
    const finding = single(
      runSeoRule('SEO-TECH-005', loadFixtureContext('fx-SEO-TECH-005-boundary.json')),
    );
    expect(finding.normalizedUrl).toBe('https://fixture.test/hop-start');
  });

  it('цикл (RedirectLimitError из safe-fetch) → finding с targetUnreachable', () => {
    const ctx = siteContext({
      pages: [{ path: '/loop', fetchError: 'safe-fetch: redirect limit of 5 exceeded' }],
    });
    const finding = single(runSeoRule('SEO-TECH-005', ctx));
    expect(finding.targetUnreachable).toBe(true);
    expect(finding.evidenceExcerpt).toContain('redirect limit');
  });
});

describe('SEO-TECH-006 внутренние ссылки на 4xx/5xx', () => {
  it('positive: ссылка на 404 → finding на странице-источнике, selector = href', () => {
    const finding = single(
      runSeoRule('SEO-TECH-006', loadFixtureContext('fx-SEO-TECH-006-positive.json')),
    );
    expect(finding.severity).toBe('High');
    expect(finding.normalizedUrl).toBe('https://fixture.test/source.html');
    expect(finding.normalizedSelector).toBe('/broken.html');
    expect(finding.normalizedResource).toBe('https://fixture.test/broken.html');
    expect(finding.evidenceExcerpt).toContain('HTTP 404');
  });

  it('negative: все ссылки ведут на 200 → пусто', () => {
    expect(runSeoRule('SEO-TECH-006', loadFixtureContext('fx-SEO-TECH-006-negative.json'))) //
      .toEqual([]);
  });
});

describe('SEO-TECH-007 дубли URL', () => {
  it('positive: группа из 2 raw-вариантов → site-finding с parameter = normalizedUrl', () => {
    const finding = single(
      runSeoRule('SEO-TECH-007', loadFixtureContext('fx-SEO-TECH-007-positive.json')),
    );
    expect(finding.targetKind).toBe('site');
    expect(finding.severity).toBe('Medium');
    expect(finding.normalizedUrl).toBe('');
    expect(finding.normalizedParameter).toBe('https://fixture.test/page.html');
    expect(finding.evidenceExcerpt).toContain('utm_source=news');
  });

  it('negative: без групп дублей → пусто', () => {
    expect(runSeoRule('SEO-TECH-007', loadFixtureContext('fx-SEO-TECH-007-negative.json'))) //
      .toEqual([]);
  });
});

describe('SEO-TECH-008 index/noindex', () => {
  it('positive: noindex при странице в sitemap → finding (High, dom)', () => {
    const finding = single(
      runSeoRule('SEO-TECH-008', loadFixtureContext('fx-SEO-TECH-008-positive.json')),
    );
    expect(finding.severity).toBe('High');
    expect(finding.evidenceType).toBe('dom');
    expect(finding.normalizedSelector).toBe('meta[name="robots"]');
    expect(finding.evidenceExcerpt).toContain('sitemap');
  });

  it('negative (оракул D-153): noindex без противоречия — НЕ finding', () => {
    expect(runSeoRule('SEO-TECH-008', loadFixtureContext('fx-SEO-TECH-008-negative.json'))) //
      .toEqual([]);
  });

  it('noindex + внутренняя ссылка с другой страницы → finding', () => {
    const ctx = siteContext({
      pages: [
        {
          path: '/linker.html',
          html:
            '<!doctype html><html lang="en"><head><title>Linking fixture page</title></head>' +
            '<body><h1>Linker</h1><a href="/hidden.html">hidden</a></body></html>',
        },
        {
          path: '/hidden.html',
          html:
            '<!doctype html><html lang="en"><head><title>Hidden fixture page</title>' +
            '<meta name="robots" content="noindex"></head><body><h1>Hidden</h1></body></html>',
        },
      ],
    });
    const finding = single(runSeoRule('SEO-TECH-008', ctx));
    expect(finding.normalizedUrl).toBe('https://fixture.test/hidden.html');
    expect(finding.evidenceExcerpt).toContain('внутренние ссылки');
  });

  it('X-Robots-Tag: noindex + sitemap → finding с http-evidence', () => {
    const ctx = siteContext({
      sitemapUrls: ['https://fixture.test/hidden.html'],
      pages: [
        {
          path: '/hidden.html',
          headers: { 'x-robots-tag': 'noindex, nofollow' },
          html:
            '<!doctype html><html lang="en"><head><title>Hidden fixture page</title></head>' +
            '<body><h1>Hidden</h1></body></html>',
        },
      ],
    });
    const finding = single(runSeoRule('SEO-TECH-008', ctx));
    expect(finding.evidenceType).toBe('http');
    expect(finding.evidenceExcerpt).toContain('X-Robots-Tag');
  });
});

describe('SEO-TECH-013 HTTPS/mixed content', () => {
  it('positive: http-ресурс на https-странице → finding со стабильным fingerprint', () => {
    const finding = single(
      runSeoRule('SEO-TECH-013', loadFixtureContext('fx-SEO-TECH-013-positive.html')),
    );
    expect(finding.severity).toBe('High');
    expect(finding.evidenceType).toBe('dom');
    expect(finding.normalizedSelector).toBe('img[src="http://insecure.example/pic.png"]');
    expect(finding.fingerprint).toBe(
      'fluxradar-fp-v1:7502174c25e9d8ed199aee502a3579cbb8e02206f04a0b7b3e660e5ade106a81',
    );
  });

  it('negative: https/relative ресурсы и не-resource rel (canonical) → пусто', () => {
    expect(runSeoRule('SEO-TECH-013', loadFixtureContext('fx-SEO-TECH-013-negative.html'))) //
      .toEqual([]);
  });

  it('http-страница: внешний http-ресурс → finding; same-host и protocol-relative — нет (D-154/D-157)', () => {
    const ctx = siteContext({
      origin: 'http://plain.fixture.test',
      pages: [
        {
          path: '/page.html',
          html:
            '<!doctype html><html lang="en"><head><title>Plain http fixture page</title></head>' +
            '<body><h1>Page</h1>' +
            '<img src="http://plain.fixture.test/local.png" alt="Local picture" />' +
            '<img src="//cdn.example/upgradeable.png" alt="Protocol-relative picture" />' +
            '<img src="http://outside.example/pic.png" alt="External picture" />' +
            '</body></html>',
        },
      ],
    });
    const finding = single(runSeoRule('SEO-TECH-013', ctx));
    expect(finding.normalizedSelector).toContain('outside.example');
  });
});
