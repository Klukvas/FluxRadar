// EXPORT-001, проверка №1: JSON Schema §16 через ajv. Канонический пример
// плана проходит дословно; негативные пробы формы отклоняются ещё до
// semantic-валидатора; успешный результат нормализован к форме D-014.

import { describe, expect, it } from 'vitest';

import { EXPORT_RECORD_FIELDS } from './fields.js';
import { validateExportRecordSchema } from './schema-validator.js';
import { CANONICAL_ISSUE_EXAMPLE, buildFixtureRecords } from './testing/fixtures.js';

describe('validateExportRecordSchema', () => {
  it('канонический пример из плана §16 проходит схему дословно', () => {
    const result = validateExportRecordSchema(CANONICAL_ISSUE_EXAMPLE);
    expect(result.ok).toBe(true);
  });

  it('нормализация D-014: absent-поля становятся explicit null, все 56 полей на месте', () => {
    const result = validateExportRecordSchema(CANONICAL_ISSUE_EXAMPLE);
    if (!result.ok) {
      throw new Error('канонический пример обязан проходить схему');
    }
    expect(Object.keys(result.record)).toEqual([...EXPORT_RECORD_FIELDS]);
    // В каноническом примере AI-поля отсутствуют — после нормализации они null.
    expect(result.record.provider).toBeNull();
    expect(result.record.usage).toBeNull();
    expect(result.record.deletion_evidence_ref).toBeNull();
  });

  it('все четыре типа records от билдеров проходят схему', () => {
    for (const record of buildFixtureRecords()) {
      const result = validateExportRecordSchema(record);
      expect(result, `${record.record_type} record`).toMatchObject({ ok: true });
    }
  });

  it('у ai_response record опциональные unit-поля usage нормализуются в null', () => {
    const aiRecord = buildFixtureRecords().find((record) => record.record_type === 'ai_response');
    const result = validateExportRecordSchema(aiRecord);
    if (!result.ok) {
      throw new Error('ai_response фикстура обязана проходить схему');
    }
    expect(result.record.usage).toEqual({
      input_tokens: 120,
      output_tokens: 40,
      total_tokens: 160,
      reasoning_units: null,
      search_units: null,
      citation_units: null,
    });
  });

  describe('негативные пробы формы', () => {
    it('plan, отличный от Complete Scan, отклоняется (Complete-only export)', () => {
      const result = validateExportRecordSchema({ ...CANONICAL_ISSUE_EXAMPLE, plan: 'Basic Scan' });
      expect(result.ok).toBe(false);
    });

    it('module Partial без status_reason отклоняется allOf-веткой схемы', () => {
      const moduleRecord = buildFixtureRecords().find((record) => record.record_type === 'module');
      const broken = {
        ...moduleRecord,
        module_status: 'Partial',
        completed_applicable_checks: 5,
        coverage: 0.5,
        status_reason: null,
      };
      expect(validateExportRecordSchema(broken).ok).toBe(false);
    });

    it('summary Completed с непустым status_reason отклоняется (const null)', () => {
      const summary = buildFixtureRecords().find((record) => record.record_type === 'summary');
      const broken = { ...summary, status_reason: 'лишняя причина' };
      expect(validateExportRecordSchema(broken).ok).toBe(false);
    });

    it('issue с fingerprint без префикса fluxradar-fp-v1: отклоняется', () => {
      const broken = { ...CANONICAL_ISSUE_EXAMPLE, fingerprint: 'sha256:deadbeef' };
      expect(validateExportRecordSchema(broken).ok).toBe(false);
    });

    it('неизвестное поле отклоняется (additionalProperties: false)', () => {
      const broken = { ...CANONICAL_ISSUE_EXAMPLE, extra_field: 'x' };
      expect(validateExportRecordSchema(broken).ok).toBe(false);
    });

    it('ai_response без usage отклоняется (required по ветке)', () => {
      const aiRecord = buildFixtureRecords().find((record) => record.record_type === 'ai_response');
      const withoutUsage = Object.fromEntries(
        Object.entries(aiRecord ?? {}).filter(([key]) => key !== 'usage'),
      );
      expect(validateExportRecordSchema(withoutUsage).ok).toBe(false);
    });

    it('timestamp без суффикса Z отклоняется (pattern Z$)', () => {
      const broken = { ...CANONICAL_ISSUE_EXAMPLE, observed_at: '2026-09-03T10:05:00+00:00' };
      expect(validateExportRecordSchema(broken).ok).toBe(false);
    });

    it('не-объект отклоняется с внятной причиной', () => {
      const result = validateExportRecordSchema('not a record');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });
});
