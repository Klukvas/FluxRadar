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
      .toContain('с 1 доменов: stats.example.com');
  });
});
