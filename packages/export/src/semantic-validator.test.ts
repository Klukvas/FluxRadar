// Semantic validator EXPORT-001: валидные наборы проходят, негативные пробы
// по каждому инварианту 1–9 (+usage-инварианты 10) отклоняются с адресным
// номером инварианта. Пробы строятся порчей одного поля валидного record —
// так тест доказывает, что срабатывает именно проверяемый инвариант.

import type { AiResponseRecord, ModuleRecord, SummaryRecord } from '@fluxradar/contracts';
import { computeFingerprint } from '@fluxradar/fingerprint';
import { describe, expect, it } from 'vitest';

import { validateExportSemantics } from './semantic-validator.js';
import { validateExportRecords } from './validate.js';
import {
  buildFixtureRecords,
  canonicalIssueWithRealFingerprint,
  fixtureSecurityIssue,
  fixtureSeoIssue,
} from './testing/fixtures.js';

function fixtureOfType<T>(recordType: string): T {
  const record = buildFixtureRecords().find((entry) => entry.record_type === recordType);
  if (record === undefined) {
    throw new Error(`фикстура без ${recordType} record`);
  }
  return record as T;
}

/** Порченый набор обязан отклоняться с указанным инвариантом. */
function expectViolation(records: readonly unknown[], invariant: string): void {
  const result = validateExportSemantics(records as Parameters<typeof validateExportSemantics>[0]);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(
    result.violations.map((violation) => violation.invariant),
    result.violations.map((violation) => violation.message).join('; '),
  ).toContain(invariant);
}

describe('validateExportSemantics', () => {
  it('полный валидный snapshot проходит без violations', () => {
    expect(validateExportSemantics(buildFixtureRecords())).toEqual({ ok: true });
  });

  it('канонический пример §16 (с настоящим fingerprint) проходит schema + semantic', () => {
    const result = validateExportRecords([canonicalIssueWithRealFingerprint()]);
    expect(result).toMatchObject({ ok: true });
  });

  it('инвариант 1: plan, отличный от Complete Scan, отклоняется', () => {
    const summary = fixtureOfType<SummaryRecord>('summary');
    expectViolation([{ ...summary, plan: 'Basic Scan' }], 'EXPORT-001/1');
  });

  it('инвариант 2: observed_at позже completed_at отклоняется', () => {
    const issue = fixtureSeoIssue('a');
    expectViolation([{ ...issue, observed_at: '2026-09-03T10:13:00Z' }], 'EXPORT-001/2');
  });

  it('инвариант 2: timestamp без суффикса Z отклоняется', () => {
    const issue = fixtureSeoIssue('a');
    expectViolation([{ ...issue, started_at: '2026-09-03T10:00:00+00:00' }], 'EXPORT-001/2');
  });

  it('инвариант 3: module Partial без status_reason отклоняется', () => {
    const module = fixtureOfType<ModuleRecord>('module');
    const partial = {
      ...module,
      module_status: 'Partial',
      completed_applicable_checks: 5,
      coverage: 0.5,
      status_reason: null,
    };
    expectViolation([partial], 'EXPORT-001/3');
  });

  it('инвариант 3: пробельный status_reason отклоняется и в полном pipeline (schema его пропускает)', () => {
    const module = fixtureOfType<ModuleRecord>('module');
    const partial = {
      ...module,
      module_status: 'Partial',
      completed_applicable_checks: 5,
      coverage: 0.5,
      status_reason: '   ',
    };
    const result = validateExportRecords([partial]);
    expect(result).toMatchObject({ ok: false, stage: 'semantic' });
  });

  it('инвариант 3: status_reason у issue record обязан быть null', () => {
    const issue = fixtureSeoIssue('a');
    expectViolation([{ ...issue, status_reason: 'причина не здесь' }], 'EXPORT-001/3');
  });

  it('инвариант 4: coverage != completed/applicable отклоняется', () => {
    const module = fixtureOfType<ModuleRecord>('module');
    expectViolation([{ ...module, coverage: 0.9 }], 'EXPORT-001/4');
  });

  it('инвариант 4: Not applicable с ненулевыми applicable_checks отклоняется', () => {
    const module = fixtureOfType<ModuleRecord>('module');
    const broken = {
      ...module,
      module_status: 'Not applicable',
      status_reason: 'модуль вне тарифа',
      score: null,
      coverage: 0,
      completed_applicable_checks: 0,
    };
    expectViolation([broken], 'EXPORT-001/4');
  });

  it('инвариант 5: score у Unavailable-модуля отклоняется', () => {
    const module = fixtureOfType<ModuleRecord>('module');
    const broken = {
      ...module,
      module_status: 'Unavailable',
      status_reason: 'источник недоступен',
      coverage: 0,
      completed_applicable_checks: 0,
      score: 42,
    };
    expectViolation([broken], 'EXPORT-001/5');
  });

  it('инвариант 5: summary score при weighted coverage < 0.50 отклоняется', () => {
    const summary = fixtureOfType<SummaryRecord>('summary');
    const broken = {
      ...summary,
      scan_status: 'Partial',
      status_reason: 'часть модулей не завершена',
      coverage: 0.4,
      score: 88,
    };
    expectViolation([broken], 'EXPORT-001/5');
  });

  it('инвариант 5 (cross-record): completed-but-unusable модуль с issue records отклоняется', () => {
    const [summary, seo, ...rest] = buildFixtureRecords();
    const unusableSeo = { ...(seo as ModuleRecord), score: null };
    expectViolation([summary, unusableSeo, ...rest], 'EXPORT-001/5');
  });

  it('инвариант 6: affected_targets > applicable_targets отклоняется', () => {
    const issue = fixtureSeoIssue('a');
    expectViolation([{ ...issue, affected_targets: 11 }], 'EXPORT-001/6');
  });

  it('инвариант 6: site-level targets != 1/1 отклоняется', () => {
    const issue = fixtureSecurityIssue();
    expectViolation([{ ...issue, applicable_targets: 2, affected_targets: 2 }], 'EXPORT-001/6');
  });

  it('D-019: site-level issue с непустым normalized_url отклоняется', () => {
    const issue = fixtureSecurityIssue();
    // Fingerprint пересчитывается под порченый URL, чтобы проба била адресно
    // в D-019, а не в несовпадение fingerprint (EXPORT-001/8).
    const normalizedUrl = 'https://example.com/';
    const broken = {
      ...issue,
      normalized_url: normalizedUrl,
      fingerprint: computeFingerprint({
        domain: issue.domain,
        ruleId: issue.rule_id,
        targetKind: issue.target_kind,
        normalizedUrl,
        normalizedResource: issue.normalized_resource,
        normalizedSelector: issue.normalized_selector,
        normalizedParameter: issue.normalized_parameter,
        ruleVariant: issue.rule_variant,
      }),
    };
    expectViolation([broken], 'D-019');
  });

  it('инвариант 7: score_delta != −rule_penalty отклоняется', () => {
    const issue = fixtureSeoIssue('a');
    expectViolation([{ ...issue, score_delta: -1.99 }], 'EXPORT-001/7');
  });

  it('инвариант 8: fingerprint, не совпадающий с пересчётом, отклоняется', () => {
    const issue = fixtureSeoIssue('a');
    const foreign = fixtureSeoIssue('b').fingerprint;
    expectViolation([{ ...issue, fingerprint: foreign }], 'EXPORT-001/8');
  });

  it('инвариант 9: дубликат fingerprint отклоняется (не считается дважды)', () => {
    const issue = fixtureSeoIssue('a');
    expectViolation([issue, { ...issue, issue_id: 'iss_dup' }], 'EXPORT-001/9');
  });

  it('инвариант 9: rule_penalty, не совпадающий с формулой §15, отклоняется', () => {
    const issue = fixtureSeoIssue('a');
    // High (10) × min(1, 2/10) = 2.00; проба заявляет 3.00 при согласованном score_delta.
    expectViolation([{ ...issue, rule_penalty: 3, score_delta: -3 }], 'EXPORT-001/9');
  });

  it('инвариант 9: расхождение агрегатов правила между records отклоняется (D-016)', () => {
    const a = fixtureSeoIssue('a');
    const b = { ...fixtureSeoIssue('b'), affected_targets: 3 };
    expectViolation([a, b], 'EXPORT-001/9');
  });

  it('инвариант 9: metric_key у non-performance issue отклоняется', () => {
    const issue = fixtureSeoIssue('a');
    expectViolation(
      [{ ...issue, metric_key: 'https://example.com/a|desktop|cold|LCP' }],
      'EXPORT-001/9',
    );
  });

  it('инвариант 9: performance issue без канонического metric_key отклоняется', () => {
    const performanceIssue = {
      ...fixtureSeoIssue('a'),
      rule_id: 'PERF-RULE-003',
      metric_key: 'малформат',
    };
    // fingerprint после смены rule_id заведомо не сойдётся — проверяем адресно metric-часть.
    expectViolation([performanceIssue], 'EXPORT-001/9');
  });

  it('инвариант 10: usage.total_tokens != input + output отклоняется', () => {
    const aiRecord = fixtureOfType<AiResponseRecord>('ai_response');
    const broken = { ...aiRecord, usage: { ...aiRecord.usage, total_tokens: 161 } };
    expectViolation([broken], 'EXPORT-001/10');
  });

  it('инвариант 10: usage_source=estimated без tokenizer_version отклоняется', () => {
    const aiRecord = fixtureOfType<AiResponseRecord>('ai_response');
    expectViolation([{ ...aiRecord, usage_source: 'estimated' }], 'EXPORT-001/10');
  });

  it('инвариант 13 (D-024): второй summary record в snapshot отклоняется', () => {
    const records = buildFixtureRecords();
    const summary = fixtureOfType<SummaryRecord>('summary');
    expectViolation([...records, summary], 'EXPORT-001/13');
  });

  it('инвариант 13: смешение scan_id в одном наборе отклоняется', () => {
    const [summary, ...rest] = buildFixtureRecords();
    expectViolation(
      [{ ...(summary as SummaryRecord), scan_id: 'scan_other' }, ...rest],
      'EXPORT-001/13',
    );
  });

  it('semantic-нарушение не проходит полный pipeline validateExportRecords', () => {
    const issue = fixtureSeoIssue('a');
    const result = validateExportRecords([{ ...issue, score_delta: -1 }]);
    expect(result).toMatchObject({ ok: false, stage: 'semantic' });
  });
});
