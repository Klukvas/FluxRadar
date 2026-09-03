// Публичная поверхность пакета: T-12 (export API) и T-15 (integration)
// используют именно эти экспорты.

import { describe, expect, it } from 'vitest';

import {
  EXPORT_CSV_COLUMNS,
  EXPORT_RECORD_FIELDS,
  EXPORT_RECORD_SCHEMA,
  buildIssueRecord,
  buildSummaryRecord,
  runEconValidate,
  sortRecordsForExport,
  validateEconForecast,
  validateExportRecordSchema,
  validateExportRecords,
  validateExportSemantics,
  writeExportCsv,
} from './index.js';

describe('@fluxradar/export', () => {
  it('экспортирует билдеры, валидаторы, CSV-writer и ECON-001', () => {
    for (const exported of [
      buildSummaryRecord,
      buildIssueRecord,
      validateExportRecordSchema,
      validateExportSemantics,
      validateExportRecords,
      sortRecordsForExport,
      writeExportCsv,
      validateEconForecast,
      runEconValidate,
    ]) {
      expect(typeof exported).toBe('function');
    }
  });

  it('CSV-header — это порядок полей data dictionary, 56 колонок', () => {
    expect(EXPORT_CSV_COLUMNS).toBe(EXPORT_RECORD_FIELDS);
    expect(EXPORT_RECORD_FIELDS).toHaveLength(56);
  });

  it('схема — дословный §16: id, draft 2020-12, oneOf на 4 типа records', () => {
    expect(EXPORT_RECORD_SCHEMA.$id).toBe(
      'https://fluxradar.com/schemas/export/1.0/record.schema.json',
    );
    expect(EXPORT_RECORD_SCHEMA.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(EXPORT_RECORD_SCHEMA.oneOf).toHaveLength(4);
    expect(EXPORT_RECORD_SCHEMA.additionalProperties).toBe(false);
  });
});
