import { describe, expect, it } from 'vitest';
import {
  htmlContext,
  siteContext,
  runRule,
  runSeoRule,
  loadFixtureContext,
} from './testing/fixture-harness.js';
import type { MailDnsSnapshot } from './engine/types.js';

const viewport = (content: string) => `<meta name="viewport" content="${content}">`;
describe('mobile viewport and zoom', () => {
  it.each([
    ['', 1],
    [viewport('width=1024'), 1],
    [viewport('width=device-width, initial-scale=1'), 0],
    [viewport(' WIDTH = DEVICE-WIDTH , initial-scale = 1'), 0],
    [viewport('width=device-width') + viewport('width=1024'), 1],
  ] as const)('viewport %s', (html, count) =>
    expect(runSeoRule('SEO-ONPAGE-007', htmlContext(html))).toHaveLength(count),
  );
  it.each([
    ['maximum-scale=1', 1],
    ['maximum-scale=2', 0],
    ['maximum-scale=5', 0],
    ['user-scalable=no', 1],
    ['user-scalable=0', 1],
    ['user-scalable=yes', 0],
    ['maximum-scale=invalid', 0],
    ['maximum-scale=', 0],
  ] as const)('zoom %s', (content, count) =>
    expect(
      runRule(
        'Accessibility',
        'A11Y-012',
        htmlContext(`<html><head>${viewport(content)}</head><body><main>Test</main></body></html>`),
      ),
    ).toHaveLength(count),
  );
});
describe('robots search engine access', () => {
  it.each([
    ['User-agent: *\nDisallow: /', 1],
    ['User-agent: Googlebot-Image\nDisallow: /', 0],
    ['User-agent: *\nDisallow: /\nAllow: /', 0],
    ['User-agent: *\nDisallow:', 0],
    ['User-agent: *\nDisallow: /*', 1],
    ['User-agent: *\nDisallow: /\nUser-agent: Googlebot\nAllow: /', 1],
  ] as const)('%s', (robotsTxt, count) =>
    expect(runSeoRule('SEO-TECH-015', siteContext({ pages: [], robotsTxt }))).toHaveLength(count),
  );
  it('lists only blocked engines, sorted', () =>
    expect(
      runSeoRule(
        'SEO-TECH-015',
        siteContext({
          pages: [],
          robotsTxt: 'User-agent: *\nDisallow: /\nUser-agent: Googlebot\nAllow: /',
        }),
      )[0]?.normalizedParameter,
    ).toBe('Bingbot'));
  it('does not judge unavailable robots', () =>
    expect(runSeoRule('SEO-TECH-015', siteContext({ pages: [] }))).toEqual([]));
});
describe('render resources', () => {
  it('finds checked failed CSS and JS once per URL, but excludes unverified resources', () => {
    const ctx = siteContext({
      pages: [
        {
          path: '/page.html',
          html: '<link rel="stylesheet" href="/bad.css"><script src="/bad.js"></script><script src="/bad.js"></script><link rel="preload" as="font" href="/unknown.woff2">',
        },
      ],
      resources: [
        { path: '/bad.css', status: 404 },
        { path: '/bad.js', status: 500 },
        { path: '/unknown.woff2', status: 0, unverifiedReason: 'BudgetExhausted' },
      ],
    });
    expect(runSeoRule('SEO-TECH-016', ctx).map((finding) => finding.normalizedSelector)).toEqual([
      '/bad.css',
      '/bad.js',
    ]);
  });
});
describe('published placeholders', () => {
  it.each([
    'Lorem ipsum dolor sit amet',
    'Just another WordPress site',
    'Просто ще один сайт на WordPress',
    'Ещё один сайт на WordPress',
    '<h1>Зразок сторінки</h1>',
    '<title>Пример страницы</title>',
    '<h1>Привіт, світ!</h1>',
    '<title>Привет, мир!</title>',
    '<h1>Sample Page</h1>',
    '<title>Hello world!</title>',
    '<title>Lorem ipsum</title>',
  ])('detects %s', (text) =>
    expect(runRule('Content Quality', 'CONTENT-011', htmlContext(text))).toHaveLength(1),
  );
  it.each([
    '<p>The term lorem ipsum describes placeholder text.</p>',
    '<p>Hello world!</p>',
    '<code>lorem ipsum dolor</code>',
    '<h1><code>Hello world!</code></h1>',
    '<pre>Just another WordPress site</pre>',
    '<textarea>lorem ipsum dolor</textarea>',
  ])('ignores %s', (text) =>
    expect(runRule('Content Quality', 'CONTENT-011', htmlContext(text))).toEqual([]),
  );
});
describe('TLS certificate facts', () => {
  const observedAt = '2026-10-19T00:00:00.000Z';
  const ctx = (days: number, overrides = {}) => ({
    ...siteContext({ pages: [] }),
    tls: [
      {
        hostname: 'fixture.test',
        observedAt,
        status: 'checked' as const,
        authorized: true,
        validTo: new Date(Date.parse(observedAt) + days * 86400000).toISOString(),
        issuer: 'Test CA',
        ...overrides,
      },
    ],
  });
  it.each([
    [13, 1],
    [14, 0],
    [15, 0],
    [-1, 1],
  ] as const)('%i days', (days, count) =>
    expect(runRule('Security', 'SEC-PASSIVE-001', ctx(days))).toHaveLength(count),
  );
  it.each([
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'CERT_NOT_YET_VALID',
  ])('invalid %s', (authorizationError) =>
    expect(
      runRule('Security', 'SEC-PASSIVE-001', ctx(15, { authorized: false, authorizationError })),
    ).toHaveLength(1),
  );
  it('skips unverified/missing snapshots', () => {
    expect(runRule('Security', 'SEC-PASSIVE-001', siteContext({ pages: [] }))).toEqual([]);
    expect(runRule('Security', 'SEC-PASSIVE-001', ctx(13, { status: 'unverified' }))).toEqual([]);
  });
});
describe('mail DNS facts', () => {
  const evaluate = (
    spf: readonly string[],
    dmarc: readonly string[],
    status: 'checked' | 'unverified' = 'checked',
  ) =>
    runRule('Security', 'SEC-PASSIVE-007', {
      ...siteContext({ pages: [] }),
      mailDns: {
        domain: 'fixture.test',
        observedAt: '2026-10-19T00:00:00Z',
        spf: { status, records: spf },
        dmarc: { status, records: dmarc },
      } satisfies MailDnsSnapshot,
    });
  it('missing SPF and DMARC', () => expect(evaluate([], [])).toHaveLength(2));
  it('multiple SPF records', () =>
    expect(evaluate(['v=spf1 -all', 'v=spf1 ~all'], ['v=DMARC1; p=reject'])).toHaveLength(1));
  it('SPF +all', () => expect(evaluate(['V=SPF1 +all'], ['v=DMARC1; p=reject'])).toHaveLength(1));
  it('p=none is not a finding', () =>
    expect(evaluate(['v=spf1 -all'], ['V=DMARC1; p=none'])).toEqual([]));
  it('unverified is not missing', () => expect(evaluate([], [], 'unverified')).toEqual([]));
});

it.each([
  ['SEO', 'SEO-TECH-015', 'json'],
  ['SEO', 'SEO-TECH-016', 'json'],
  ['SEO', 'SEO-ONPAGE-007', 'html'],
  ['Accessibility', 'A11Y-012', 'html'],
  ['Content Quality', 'CONTENT-011', 'html'],
  ['Security', 'SEC-PASSIVE-001', 'json'],
  ['Security', 'SEC-PASSIVE-007', 'json'],
] as const)('fixture contract %s %s', (module, id, extension) => {
  expect(
    runRule(module, id, loadFixtureContext(`fx-${id}-positive.${extension}`)).length,
  ).toBeGreaterThan(0);
  expect(runRule(module, id, loadFixtureContext(`fx-${id}-negative.${extension}`))).toEqual([]);
  expect(runRule(module, id, loadFixtureContext(`fx-${id}-boundary.${extension}`)).length).toBe(
    id === 'CONTENT-011' ? 1 : 0,
  );
});
