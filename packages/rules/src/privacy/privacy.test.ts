// Фикстурные тесты Privacy-правил (D-025): PRIVACY-001 (инвентаризация
// cookies из Set-Cookie и document.cookie) и PRIVACY-003 (third-party
// скрипты; excerpt — домены).

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

describe('PRIVACY-001 cookies', () => {
  it('positive: Set-Cookie + document.cookie → mixed-finding с перечнем', () => {
    const finding = single(
      runRule('Privacy', 'PRIVACY-001', loadFixtureContext('fx-PRIVACY-001-positive.json')),
    );
    expect(finding.severity).toBe('Low');
    expect(finding.evidenceType).toBe('mixed');
    expect(finding.evidenceExcerpt).toContain('session (Set-Cookie)');
    expect(finding.evidenceExcerpt).toContain('visitor_id (document.cookie)');
    // Значения кук в evidence не попадают.
    expect(finding.evidenceExcerpt).not.toContain('abc123');
    expect(finding.evidenceExcerpt).toMatch(/^The page sets cookies \(\d+\): /);
    expect(finding.messages?.evidence.code).toBe('privacy-001.evidence');
    expect(finding.messages?.recommendation.code).toBe('privacy-001.recommendation');
  });

  it('negative: страница без кук (внешний script src — не кука) → пусто', () => {
    expect(
      runRule('Privacy', 'PRIVACY-001', loadFixtureContext('fx-PRIVACY-001-negative.json')),
    ).toEqual([]);
  });

  it('только Set-Cookie → http; только document.cookie → dom', () => {
    const headerOnly = siteContext({
      pages: [
        {
          path: '/page.html',
          html: '<!doctype html><html lang="en"><head><title>Header cookie page</title></head><body></body></html>',
          headers: { 'set-cookie': 'a=1; Path=/' },
        },
      ],
    });
    expect(single(runRule('Privacy', 'PRIVACY-001', headerOnly)).evidenceType).toBe('http');

    const scriptOnly = htmlContext(
      '<!doctype html><html lang="en"><head><title>Script cookie page</title></head>' +
        "<body><script>document.cookie = 'b=2; path=/';</script></body></html>",
    );
    expect(single(runRule('Privacy', 'PRIVACY-001', scriptOnly)).evidenceType).toBe('dom');
  });

  it('чтение/сравнение document.cookie без присваивания — не сигнал (D-170)', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Cookie read page</title></head>' +
        "<body><script>if (document.cookie === '') { showBanner(); }</script></body></html>",
    );
    expect(runRule('Privacy', 'PRIVACY-001', ctx)).toEqual([]);
  });
});

describe('PRIVACY-003 third-party скрипты', () => {
  it('positive: скрипты с чужих origin → finding (Low) с доменами в excerpt', () => {
    const finding = single(
      runRule('Privacy', 'PRIVACY-003', loadFixtureContext('fx-PRIVACY-003-positive.html')),
    );
    expect(finding.severity).toBe('Low');
    expect(finding.evidenceType).toBe('dom');
    expect(finding.evidenceExcerpt).toContain('cdn.example.net');
    expect(finding.evidenceExcerpt).toContain('stats.example.com');
    // Same-origin скрипт /app.js доменом в excerpt не становится.
    expect(finding.evidenceExcerpt).not.toContain('fixture.test');
    expect(finding.messages?.evidence.code).toBe('privacy-003.evidence');
    expect(finding.messages?.recommendation.code).toBe('privacy-003.recommendation');
  });

  it('negative: same-origin и inline скрипты → пусто', () => {
    expect(
      runRule('Privacy', 'PRIVACY-003', loadFixtureContext('fx-PRIVACY-003-negative.html')),
    ).toEqual([]);
  });

  it('поддомен собственного сайта — не third-party (D-170)', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Own subdomain page</title>' +
        '<script src="https://cdn.fixture.test/lib.js"></script>' +
        '<script src="https://stats.example.com/ga.js"></script></head>' +
        '<body><h1>Page</h1></body></html>',
    );
    const finding = single(runRule('Privacy', 'PRIVACY-003', ctx));
    expect(finding.evidenceExcerpt).toContain('stats.example.com');
    expect(finding.evidenceExcerpt).not.toContain('cdn.fixture.test');
  });

  it('дубли одного домена схлопываются в один пункт', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Duplicate scripts page</title>' +
        '<script src="https://stats.example.com/a.js"></script>' +
        '<script src="https://stats.example.com/b.js"></script></head>' +
        '<body><h1>Page</h1></body></html>',
    );
    expect(single(runRule('Privacy', 'PRIVACY-003', ctx)).evidenceExcerpt) //
      .toContain('Third-party scripts load from these domains (1): stats.example.com');
  });
});

describe('PRIVACY-002/004 consent and policy signals', () => {
  it('reports tracker code without a detectable consent marker', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Tracking</title>' +
        '<script src="https://www.googletagmanager.com/gtm.js"></script></head>' +
        '<body><main><h1>Tracking</h1></main></body></html>',
    );
    const finding = single(runRule('Privacy', 'PRIVACY-002', ctx));
    expect(finding.confidence).toBe(0.8);
    expect(finding.evidenceExcerpt).toContain('googletagmanager.com');
    expect(finding.messages?.evidence).toEqual({
      code: 'privacy-002.evidence',
      params: { trackers: 'googletagmanager.com' },
    });
    expect(finding.messages?.recommendation.code).toBe('privacy-002.recommendation');
  });

  it('does not report the consent signal when a banner marker exists', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Tracking</title>' +
        '<script src="https://www.googletagmanager.com/gtm.js"></script></head>' +
        '<body><div id="cookie-consent">Accept cookies</div></body></html>',
    );
    expect(runRule('Privacy', 'PRIVACY-002', ctx)).toEqual([]);
  });

  it('reports missing homepage policy link and accepts a same-site policy link', () => {
    const missing = siteContext({
      pages: [
        {
          path: '/',
          html:
            '<!doctype html><html lang="en"><head><title>Home</title></head>' +
            '<body><main><h1>Home</h1></main></body></html>',
        },
      ],
    });
    const missingFinding = single(runRule('Privacy', 'PRIVACY-004', missing));
    expect(missingFinding.evidenceExcerpt).toBe(
      'No link to a privacy or cookie policy was found on the homepage.',
    );
    expect(missingFinding.messages).toEqual({
      evidence: { code: 'privacy-004.evidence', params: {} },
      recommendation: { code: 'privacy-004.recommendation', params: {} },
    });
    const linked = siteContext({
      pages: [
        {
          path: '/',
          html:
            '<!doctype html><html lang="en"><head><title>Home</title></head>' +
            '<body><main><h1>Home</h1><a href="/privacy">Privacy policy</a></main></body></html>',
        },
      ],
    });
    expect(runRule('Privacy', 'PRIVACY-004', linked)).toEqual([]);
    const external = siteContext({
      pages: [
        {
          path: '/',
          html:
            '<!doctype html><html lang="en"><head><title>Home</title></head>' +
            '<body><main><h1>Home</h1><a href="https://privacy.example.net">Privacy policy</a></main></body></html>',
        },
      ],
    });
    expect(runRule('Privacy', 'PRIVACY-004', external)).toHaveLength(1);
  });

  function homepageWith(link: string) {
    return siteContext({
      pages: [
        {
          path: '/',
          html:
            '<!doctype html><html lang="uk"><head><title>Головна</title></head>' +
            `<body><main><h1>Головна</h1></main><footer>${link}</footer></body></html>`,
        },
      ],
    });
  }

  it.each([
    ['en text', '<a href="/legal">Privacy Policy</a>'],
    ['en cookie text', '<a href="/legal/2">Cookie Policy</a>'],
    ['en slug only', '<a href="/privacy">Read more</a>'],
    ['en confidentiality', '<a href="/legal">Confidentiality notice</a>'],
    ['uk конфіденційності', '<a href="/page/12">Політика конфіденційності</a>'],
    ['uk конфіденційність', '<a href="/page/12">Конфіденційність</a>'],
    ['uk конфіденційності та cookie', '<a href="/page/12">Політика конфіденційності та cookie</a>'],
    ['uk приватності', '<a href="/page/12">Політика приватності</a>'],
    ['uk приватність', '<a href="/page/12">Приватність</a>'],
    ['uk персональних даних', '<a href="/page/12">Захист персональних&nbsp;даних</a>'],
    ['uk кукі', '<a href="/page/12">Використання кукі</a>'],
    ['uk slug', '<a href="/polityka-konfidentsiinosti">Документ</a>'],
    ['uk short slug', '<a href="/konfidentsiinist/">Документ</a>'],
    ['uk pryvatnist slug', '<a href="/pryvatnist">Документ</a>'],
    [
      'uk percent-encoded slug',
      '<a href="/%D0%BF%D0%BE%D0%BB%D1%96%D1%82%D0%B8%D0%BA%D0%B0-%D0%BA%D0%BE%D0%BD%D1%84%D1%96%D0%B4%D0%B5%D0%BD%D1%86%D1%96%D0%B9%D0%BD%D0%BE%D1%81%D1%82%D1%96">Документ</a>',
    ],
    ['uk aria-label', '<a href="/page/12" aria-label="Політика конфіденційності">i</a>'],
    ['uk title', '<a href="/page/12" title="Політика конфіденційності">i</a>'],
    ['ru конфиденциальности', '<a href="/page/12">Политика конфиденциальности</a>'],
    ['ru персональных данных', '<a href="/page/12">Обработка персональных данных</a>'],
    ['ru slug', '<a href="/politika-konfidencialnosti">Документ</a>'],
    ['ru personal data slug', '<a href="/personalnye-dannye">Документ</a>'],
  ])('accepts a %s policy link', (_variant, link) => {
    expect(runRule('Privacy', 'PRIVACY-004', homepageWith(link))).toEqual([]);
  });

  it.each([
    ['uk refund policy', '<a href="/page/3">Політика повернення</a>'],
    ['ru refund policy', '<a href="/page/3">Политика возврата</a>'],
    ['ru company policy', '<a href="/politika">Политика компании</a>'],
    ['uk private lessons', '<a href="/page/4">Приватні уроки</a>'],
    ['uk confidential consultation', '<a href="/page/5">Конфіденційна консультація</a>'],
    ['uk terms', '<a href="/umovy">Умови використання</a>'],
    ['ru external policy', '<a href="https://example.net/privacy">Политика конфиденциальности</a>'],
  ])('still reports a homepage with only a %s link', (_variant, link) => {
    expect(runRule('Privacy', 'PRIVACY-004', homepageWith(link))).toHaveLength(1);
  });
});
