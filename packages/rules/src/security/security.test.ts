// Фикстурные тесты Security-правил (D-025): SEC-PASSIVE-002/003/005.
// HSTS проверяется https-моками — fixture-сайт краулера живёт на http и
// в интеграции правило Not applicable (см. passive-modules.integration).

import { describe, expect, it } from 'vitest';

import type { IssueCandidate } from '../engine/run-module.js';
import { runModuleRules } from '../engine/run-module.js';
import { loadFixtureContext, runRule, siteContext } from '../testing/fixture-harness.js';

function single(candidates: readonly IssueCandidate[]): IssueCandidate {
  expect(candidates).toHaveLength(1);
  const first = candidates[0];
  if (first === undefined) {
    throw new Error('ожидался ровно один finding');
  }
  return first;
}

describe('SEC-PASSIVE-002 security headers', () => {
  it('positive: ответ без всех трёх заголовков → один finding с перечнем', () => {
    const finding = single(
      runRule(
        'Security',
        'SEC-PASSIVE-002',
        loadFixtureContext('fx-SEC-PASSIVE-002-positive.json'),
      ),
    );
    expect(finding.severity).toBe('Medium');
    expect(finding.evidenceType).toBe('http');
    expect(finding.normalizedResource).toBe('security-headers');
    expect(finding.normalizedSelector).toBe('');
    expect(finding.evidenceExcerpt).toBe(
      'The HTML response is missing security headers (3): X-Content-Type-Options: nosniff; ' +
        'X-Frame-Options / CSP frame-ancestors; Referrer-Policy',
    );
    expect(finding.evidenceExcerpt).toContain('X-Content-Type-Options: nosniff');
    expect(finding.evidenceExcerpt).toContain('X-Frame-Options / CSP frame-ancestors');
    expect(finding.evidenceExcerpt).toContain('Referrer-Policy');
  });

  it('negative: nosniff + CSP frame-ancestors + Referrer-Policy → пусто', () => {
    expect(
      runRule(
        'Security',
        'SEC-PASSIVE-002',
        loadFixtureContext('fx-SEC-PASSIVE-002-negative.json'),
      ),
    ).toEqual([]);
  });

  it('частичное покрытие: есть только nosniff → в excerpt два недостающих', () => {
    const ctx = siteContext({
      pages: [
        {
          path: '/page.html',
          html: '<!doctype html><html lang="en"><head><title>Partial headers page</title></head><body></body></html>',
          headers: { 'x-content-type-options': 'nosniff' },
        },
      ],
    });
    const finding = single(runRule('Security', 'SEC-PASSIVE-002', ctx));
    expect(finding.evidenceExcerpt).not.toContain('X-Content-Type-Options');
    expect(finding.evidenceExcerpt).toContain('X-Frame-Options / CSP frame-ancestors');
    expect(finding.evidenceExcerpt).toContain('Referrer-Policy');
  });
});

describe('SEC-PASSIVE-003 HSTS (https-моки)', () => {
  it('positive: https-homepage без Strict-Transport-Security → site-finding', () => {
    const finding = single(
      runRule(
        'Security',
        'SEC-PASSIVE-003',
        loadFixtureContext('fx-SEC-PASSIVE-003-positive.json'),
      ),
    );
    expect(finding.targetKind).toBe('site');
    expect(finding.normalizedUrl).toBe('');
    expect(finding.normalizedResource).toBe('strict-transport-security');
    expect(finding.applicableTargets).toBe(1);
    expect(finding.affectedTargets).toBe(1);
  });

  it('negative: HSTS с max-age=31536000 → пусто', () => {
    expect(
      runRule(
        'Security',
        'SEC-PASSIVE-003',
        loadFixtureContext('fx-SEC-PASSIVE-003-negative.json'),
      ),
    ).toEqual([]);
  });

  it('max-age=0 эквивалентен отсутствию HSTS → finding', () => {
    const ctx = siteContext({
      origin: 'https://fixture.test',
      pages: [
        {
          path: '/',
          html: '<!doctype html><html lang="en"><head><title>Zero max-age page</title></head><body></body></html>',
          headers: { 'strict-transport-security': 'max-age=0' },
        },
      ],
    });
    expect(single(runRule('Security', 'SEC-PASSIVE-003', ctx)).evidenceExcerpt).toBe(
      'Strict-Transport-Security has no positive max-age: max-age=0',
    );
  });

  it('http-origin → Not applicable: applicable=0, findings нет', () => {
    const ctx = siteContext({
      origin: 'http://fixture.test',
      pages: [
        {
          path: '/',
          html: '<!doctype html><html lang="en"><head><title>Http home page</title></head><body></body></html>',
        },
      ],
    });
    const run = runModuleRules('Security', ctx);
    const evaluation = run.evaluations.find((entry) => entry.ruleId === 'SEC-PASSIVE-003');
    expect(evaluation?.applicableTargets).toBe(0);
    expect(evaluation?.findings).toEqual([]);
  });
});

describe('SEC-PASSIVE-005 атрибуты cookie', () => {
  it('positive: кука без Secure/HttpOnly/SameSite → finding, parameter — имя', () => {
    const finding = single(
      runRule(
        'Security',
        'SEC-PASSIVE-005',
        loadFixtureContext('fx-SEC-PASSIVE-005-positive.json'),
      ),
    );
    expect(finding.normalizedParameter).toBe('session');
    expect(finding.evidenceExcerpt).toContain('Secure, HttpOnly, SameSite');
    // Значение куки — потенциальный секрет и в evidence не попадает.
    expect(finding.evidenceExcerpt).not.toContain('abc123');
  });

  it('negative: Secure + HttpOnly + SameSite → пусто', () => {
    expect(
      runRule(
        'Security',
        'SEC-PASSIVE-005',
        loadFixtureContext('fx-SEC-PASSIVE-005-negative.json'),
      ),
    ).toEqual([]);
  });

  it('склеенный заголовок: битая кука даёт finding, полная — нет', () => {
    const ctx = siteContext({
      pages: [
        {
          path: '/page.html',
          html: '<!doctype html><html lang="en"><head><title>Two cookies page</title></head><body></body></html>',
          headers: {
            'set-cookie': 'weak=1; Path=/, strong=2; Path=/; Secure; HttpOnly; SameSite=Strict',
          },
        },
      ],
    });
    const finding = single(runRule('Security', 'SEC-PASSIVE-005', ctx));
    expect(finding.normalizedParameter).toBe('weak');
  });

  it('запятая внутри Expires не режет куку на две', () => {
    const ctx = siteContext({
      pages: [
        {
          path: '/page.html',
          html: '<!doctype html><html lang="en"><head><title>Expires cookie page</title></head><body></body></html>',
          headers: {
            'set-cookie': 'legacy=9; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/',
          },
        },
      ],
    });
    const finding = single(runRule('Security', 'SEC-PASSIVE-005', ctx));
    expect(finding.normalizedParameter).toBe('legacy');
  });
});

describe('OWASP ASVS Public Security Profile', () => {
  it('reports missing CSP and Permissions-Policy on public HTML', () => {
    const ctx = loadFixtureContext('fx-SEC-PASSIVE-002-positive.json');
    expect(runRule('Security', 'SEC-ASVS-001', ctx)).toHaveLength(1);
    expect(runRule('Security', 'SEC-ASVS-002', ctx)).toHaveLength(1);
  });

  it('accepts non-empty CSP and Permissions-Policy', () => {
    const ctx = siteContext({
      pages: [
        {
          path: '/',
          html:
            '<!doctype html><html lang="en"><head><title>Secure page</title></head>' +
            '<body><main><h1>Secure</h1></main></body></html>',
          headers: {
            'content-security-policy': "default-src 'self'",
            'permissions-policy': 'camera=(), microphone=()',
          },
        },
      ],
    });
    expect(runRule('Security', 'SEC-ASVS-001', ctx)).toEqual([]);
    expect(runRule('Security', 'SEC-ASVS-002', ctx)).toEqual([]);
  });

  it('reports wildcard CORS combined with credentials only', () => {
    const bad = siteContext({
      pages: [
        {
          path: '/',
          html: '<!doctype html><html lang="en"><head><title>CORS</title></head><body></body></html>',
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-credentials': 'true',
          },
        },
      ],
    });
    expect(runRule('Security', 'SEC-ASVS-003', bad)).toHaveLength(1);
    const publicResource = siteContext({
      pages: [
        {
          path: '/',
          html: null,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
        },
      ],
    });
    expect(runRule('Security', 'SEC-ASVS-003', publicResource)).toEqual([]);
  });
});

describe('Security findings carry translatable message codes', () => {
  const htmlPage = (headers: Record<string, string>) =>
    siteContext({
      origin: 'https://fixture.test',
      pages: [
        {
          path: '/',
          html: '<!doctype html><html lang="en"><head><title>Messages page</title></head><body></body></html>',
          headers,
        },
      ],
    });

  it.each([
    {
      ruleId: 'SEC-PASSIVE-002',
      context: () => loadFixtureContext('fx-SEC-PASSIVE-002-positive.json'),
      evidence: 'sec-passive-002.evidence',
      recommendation: 'sec-passive-002.recommendation',
    },
    {
      ruleId: 'SEC-PASSIVE-003',
      context: () => loadFixtureContext('fx-SEC-PASSIVE-003-positive.json'),
      evidence: 'sec-passive-003.evidence.missing',
      recommendation: 'sec-passive-003.recommendation',
    },
    {
      ruleId: 'SEC-PASSIVE-003',
      context: () => htmlPage({ 'strict-transport-security': 'max-age=0' }),
      evidence: 'sec-passive-003.evidence.no-max-age',
      recommendation: 'sec-passive-003.recommendation',
    },
    {
      ruleId: 'SEC-PASSIVE-005',
      context: () => loadFixtureContext('fx-SEC-PASSIVE-005-positive.json'),
      evidence: 'sec-passive-005.evidence',
      recommendation: 'sec-passive-005.recommendation',
    },
    {
      ruleId: 'SEC-ASVS-001',
      context: () => loadFixtureContext('fx-SEC-PASSIVE-002-positive.json'),
      evidence: 'sec-asvs-001.evidence',
      recommendation: 'sec-asvs-001.recommendation',
    },
    {
      ruleId: 'SEC-ASVS-002',
      context: () => loadFixtureContext('fx-SEC-PASSIVE-002-positive.json'),
      evidence: 'sec-asvs-002.evidence',
      recommendation: 'sec-asvs-002.recommendation',
    },
    {
      ruleId: 'SEC-ASVS-003',
      context: () =>
        htmlPage({
          'access-control-allow-origin': '*',
          'access-control-allow-credentials': 'true',
        }),
      evidence: 'sec-asvs-003.evidence',
      recommendation: 'sec-asvs-003.recommendation',
    },
  ])('$ruleId → $evidence', ({ ruleId, context, evidence, recommendation }) => {
    const finding = single(runRule('Security', ruleId, context()));
    expect(finding.messages?.evidence.code).toBe(evidence);
    expect(finding.messages?.recommendation.code).toBe(recommendation);
  });

  it('keeps the cookie value out of the message values', () => {
    const finding = single(
      runRule(
        'Security',
        'SEC-PASSIVE-005',
        loadFixtureContext('fx-SEC-PASSIVE-005-positive.json'),
      ),
    );
    expect(finding.messages?.evidence.params).toEqual({
      cookie: 'session',
      attributes: 'Secure, HttpOnly, SameSite',
    });
  });
});
