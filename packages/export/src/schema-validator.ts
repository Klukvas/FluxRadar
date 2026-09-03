// Синтаксическая валидация №1 контракта EXPORT-001: ajv по дословной схеме §16
// (draft 2020-12). После успешной проверки record нормализуется к форме D-014:
// каждое поле data dictionary присутствует явно, absent-поля становятся
// explicit null. Сама схема допускает отсутствие полей, которые для данного
// record_type обязаны быть null (канонический пример §16 опускает AI-поля) —
// D-014 регулирует записи, которые FluxRadar производит, а не принимает.

import type { AiUsage, ExportRecord } from '@fluxradar/contracts';
// Named import: default-импорт CJS-модуля ajv под NodeNext типизируется как
// namespace без construct-сигнатуры; exports.Ajv2020 есть и в runtime, и в d.ts.
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { EXPORT_RECORD_FIELDS } from './fields.js';
import { EXPORT_RECORD_SCHEMA } from './schema.js';

export interface SchemaViolation {
  /** JSON Pointer внутри record ('' — сам record). */
  readonly path: string;
  readonly message: string;
}

export type SchemaValidationResult =
  | { readonly ok: true; readonly record: ExportRecord }
  | { readonly ok: false; readonly violations: readonly SchemaViolation[] };

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
// ajv-formats типизирован под основной класс Ajv; Ajv2020 наследует тот же
// AjvCore и в runtime полностью совместим — расхождение чисто номинальное
// (protected-члены двух подклассов), поэтому единственный обоснованный cast.
(addFormats as unknown as (instance: typeof ajv) => void)(ajv);

// Компиляция на загрузке модуля: сломанная схема падает при импорте, не в проде.
const validateRecord: ValidateFunction = ajv.compile(EXPORT_RECORD_SCHEMA);

/** Прогоняет значение через JSON Schema §16 и нормализует его к форме D-014. */
export function validateExportRecordSchema(value: unknown): SchemaValidationResult {
  if (validateRecord(value)) {
    return { ok: true, record: normalizeRecord(value as Record<string, unknown>) };
  }
  const violations = (validateRecord.errors ?? []).map(toViolation);
  return { ok: false, violations: violations.length > 0 ? violations : [UNKNOWN_VIOLATION] };
}

const UNKNOWN_VIOLATION: SchemaViolation = {
  path: '',
  message: 'схема отклонила record без деталей (ajv не вернул errors)',
};

function toViolation(error: ErrorObject): SchemaViolation {
  const branch =
    typeof error.parentSchema?.title === 'string' ? ` [${error.parentSchema.title}]` : '';
  return {
    path: error.instancePath,
    message: `${error.message ?? error.keyword}${branch}`,
  };
}

/**
 * Absent → explicit null по всем полям data dictionary (D-014). Поля, которые
 * могут отсутствовать, для своего record_type обязаны быть null по oneOf-ветке
 * схемы, поэтому подстановка null не меняет семантику записи.
 */
function normalizeRecord(value: Record<string, unknown>): ExportRecord {
  const entries = EXPORT_RECORD_FIELDS.map((field) => {
    const fieldValue = value[field] ?? null;
    return [
      field,
      field === 'usage' && fieldValue !== null ? normalizeUsage(fieldValue) : fieldValue,
    ];
  });
  // Cast обоснован: форма проверена ajv по схеме §16, набор ключей — EXPORT_RECORD_FIELDS.
  return Object.fromEntries(entries) as unknown as ExportRecord;
}

/** Опциональные unit-поля usage тоже становятся explicit null (D-014). */
function normalizeUsage(value: unknown): AiUsage {
  const usage = value as Record<string, number | null | undefined>;
  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    total_tokens: usage.total_tokens ?? 0,
    reasoning_units: usage.reasoning_units ?? null,
    search_units: usage.search_units ?? null,
    citation_units: usage.citation_units ?? null,
  };
}
