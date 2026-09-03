// Фикстурные тесты Reliability-правил (D-025): REL-URL-001/003/009 —
// вердикты по уже собранным снимкам обхода; REL-API-003/005 — expected-status
// precedence §9 и no-credentials policy (boundary критерия T-09:
// «ожидаемый 404 → pass», «неожиданный 404 → finding»).

import { describe, expect, it } from 'vitest';

import type { IssueCandidate } from '../engine/run-module.js';
import { runModuleRules } from '../engine/run-module.js';
import { loadFixtureContext, runRule } from '../testing/fixture-harness.js';

function single(candidates: readonly IssueCandidate[]): IssueCandidate {
  expect(candidates).toHaveLength(1);
  const first = candidates[0];
  if (first === undefined) {
    throw new Error('ожидался ровно один finding');
  }
  return first;
}

describe('REL-URL-001 доступность URL', () => {
  it('positive: fetchError → fail-finding с targetUnreachable (High)', () => {
    const finding = single(
      runRule('Reliability', 'REL-URL-001', loadFixtureContext('fx-REL-URL-001-positive.json')),
    );
    expect(finding.severity).toBe('High');
    expect(finding.targetUnreachable).toBe(true);
    expect(finding.evidenceExcerpt).toContain('DNS lookup failed');
  });

  it('negative: 200-страница → пусто', () => {
    expect(
      runRule('Reliability', 'REL-URL-001', loadFixtureContext('fx-REL-URL-001-negative.json')),
    ).toEqual([]);
  });

  it('недостижимый снимок — applicable и completed check (вердикт fail)', () => {
    const run = runModuleRules(
      'Reliability',
      loadFixtureContext('fx-REL-URL-001-positive.json'),
    );
    const evaluation = run.evaluations.find((entry) => entry.ruleId === 'REL-URL-001');
    expect(evaluation?.applicableTargets).toBe(1);
    expect(evaluation?.affectedTargets).toBe(1);
  });
});

describe('REL-URL-003 4xx/5xx verdict', () => {
  it('positive: финальный 503 → fail-finding', () => {
    const finding = single(
      runRule('Reliability', 'REL-URL-003', loadFixtureContext('fx-REL-URL-003-positive.json')),
    );
    expect(finding.severity).toBe('Medium');
    expect(finding.evidenceExcerpt).toContain('HTTP 503');
  });

  it('negative: 200 и 404 → пусто (4xx покрыт SEO-TECH-003, D-163)', () => {
    expect(
      runRule('Reliability', 'REL-URL-003', loadFixtureContext('fx-REL-URL-003-negative.json')),
    ).toEqual([]);
  });
});

describe('REL-URL-009 время ответа', () => {
  it('positive: 2500 ms > 1800 ms → finding', () => {
    const finding = single(
      runRule('Reliability', 'REL-URL-009', loadFixtureContext('fx-REL-URL-009-positive.json')),
    );
    expect(finding.evidenceExcerpt).toContain('2500 ms');
  });

  it('negative: 120 ms → пусто', () => {
    expect(
      runRule('Reliability', 'REL-URL-009', loadFixtureContext('fx-REL-URL-009-negative.json')),
    ).toEqual([]);
  });

  it('boundary: ровно 1800 — норма, 1801 — finding', () => {
    const findings = runRule(
      'Reliability',
      'REL-URL-009',
      loadFixtureContext('fx-REL-URL-009-boundary.json'),
    );
    expect(findings.map((finding) => finding.normalizedUrl)).toEqual([
      'https://fixture.test/over-threshold.html',
    ]);
  });
});

describe('REL-API-003 expected status', () => {
  it('positive: неожиданный 404 при expected [200] → finding', () => {
    const finding = single(
      runRule('Reliability', 'REL-API-003', loadFixtureContext('fx-REL-API-003-positive.json')),
    );
    expect(finding.targetKind).toBe('api');
    expect(finding.normalizedUrl).toBe('https://fixture.test/api/health');
    expect(finding.normalizedParameter).toBe('GET');
    expect(finding.evidenceExcerpt).toContain('HTTP 404');
  });

  it('negative: ожидаемый 404 и дефолтный 2xx → pass, пусто', () => {
    expect(
      runRule('Reliability', 'REL-API-003', loadFixtureContext('fx-REL-API-003-negative.json')),
    ).toEqual([]);
  });

  it('без apiChecks правило Not applicable: applicable=0', () => {
    const run = runModuleRules(
      'Reliability',
      loadFixtureContext('fx-REL-URL-001-negative.json'),
    );
    const evaluation = run.evaluations.find((entry) => entry.ruleId === 'REL-API-003');
    expect(evaluation?.applicableTargets).toBe(0);
    expect(evaluation?.findings).toEqual([]);
  });
});

describe('REL-API-005 no-credentials policy', () => {
  it('positive: Authorization в конфиге → High-finding, запрос не выполнялся', () => {
    const finding = single(
      runRule('Reliability', 'REL-API-005', loadFixtureContext('fx-REL-API-005-positive.json')),
    );
    expect(finding.severity).toBe('High');
    expect(finding.normalizedParameter).toBe('Authorization');
    expect(finding.evidenceExcerpt).toContain('не выполнялся');
    // В evidence попадают только имена заголовков — не значения секретов.
    expect(finding.evidenceExcerpt).not.toContain('secret-token-value');
    expect(finding.evidenceExcerpt).not.toContain('Bearer');
  });

  it('negative: чистые заголовки → пусто', () => {
    expect(
      runRule('Reliability', 'REL-API-005', loadFixtureContext('fx-REL-API-005-negative.json')),
    ).toEqual([]);
  });

  it('заблокированная проверка не applicable для REL-API-003', () => {
    const run = runModuleRules(
      'Reliability',
      loadFixtureContext('fx-REL-API-005-positive.json'),
    );
    const statusRule = run.evaluations.find((entry) => entry.ruleId === 'REL-API-003');
    const policyRule = run.evaluations.find((entry) => entry.ruleId === 'REL-API-005');
    expect(statusRule?.applicableTargets).toBe(0);
    expect(policyRule?.applicableTargets).toBe(1);
    expect(policyRule?.affectedTargets).toBe(1);
  });
});
