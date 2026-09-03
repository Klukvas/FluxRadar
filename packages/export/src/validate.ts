// Пайплайн EXPORT-001: JSON Schema → нормализация D-014 → semantic validator.
// §16: «в export не попадает record, который прошёл только синтаксическую
// schema-проверку» — CSV/PDF пишутся исключительно из результата ok: true.

import type { ExportRecord } from '@fluxradar/contracts';

import { validateExportRecordSchema } from './schema-validator.js';
import type { SemanticViolation } from './semantic-validator.js';
import { validateExportSemantics } from './semantic-validator.js';

export interface RecordSchemaViolation {
  readonly recordIndex: number;
  /** JSON Pointer внутри record ('' — сам record). */
  readonly path: string;
  readonly message: string;
}

export type ExportValidationResult =
  | { readonly ok: true; readonly records: readonly ExportRecord[] }
  | { readonly ok: false; readonly stage: 'schema'; readonly violations: readonly RecordSchemaViolation[] }
  | { readonly ok: false; readonly stage: 'semantic'; readonly violations: readonly SemanticViolation[] };

/** Полная проверка набора records перед записью CSV/JSON export. */
export function validateExportRecords(values: readonly unknown[]): ExportValidationResult {
  const schemaViolations: RecordSchemaViolation[] = [];
  const normalized: ExportRecord[] = [];
  values.forEach((value, recordIndex) => {
    const result = validateExportRecordSchema(value);
    if (result.ok) {
      normalized.push(result.record);
      return;
    }
    schemaViolations.push(
      ...result.violations.map(({ path, message }) => ({ recordIndex, path, message })),
    );
  });
  if (schemaViolations.length > 0) {
    return { ok: false, stage: 'schema', violations: schemaViolations };
  }
  const semantic = validateExportSemantics(normalized);
  if (!semantic.ok) {
    return { ok: false, stage: 'semantic', violations: semantic.violations };
  }
  return { ok: true, records: normalized };
}
