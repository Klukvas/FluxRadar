// CSV contract v1 (§16): UTF-8 без BOM, LF, RFC 4180 quoting, фиксированный
// header в порядке data dictionary, null → пустое поле, числа score/penalty/
// delta — с двумя знаками после точки. Порядок строк: summary → module →
// ai_response (provider, request_id) → issue (severity Critical→Low, затем
// fingerprint лексикографически). Zero-issue export всё равно содержит
// summary-строку. Строковые значения с ведущими = + - @ получают префикс «'»
// (защита от формула-инъекции в табличных редакторах); числовые и
// JSON-сериализованные значения генерируются кодом и не экранируются.

import type { ExportRecord, ModuleName, RecordType, Severity } from '@fluxradar/contracts';
import { MODULE_NAMES, SEVERITIES } from '@fluxradar/contracts';

import type { ExportRecordField } from './fields.js';
import { EXPORT_RECORD_FIELDS } from './fields.js';

/** CSV header = порядок полей data dictionary v1 (§16). */
export const EXPORT_CSV_COLUMNS = EXPORT_RECORD_FIELDS;

const RECORD_TYPE_ORDER: Readonly<Record<RecordType, number>> = {
  summary: 0,
  module: 1,
  ai_response: 2,
  issue: 3,
};

/** score/penalty/delta — ровно два знака после точки (§16 CSV contract). */
const TWO_DECIMAL_FIELDS: readonly ExportRecordField[] = ['score', 'rule_penalty', 'score_delta'];

/** Символы, с которых табличные редакторы начинают исполняемую формулу. */
const FORMULA_LEAD_CHARS = /^[=+\-@]/;

/** Требуют RFC 4180 quoting: запятая, кавычка или перевод строки в значении. */
const NEEDS_QUOTING = /[",\n\r]/;

/**
 * Канонический порядок export records (§16): один порядок для CSV, PDF и
 * online report. Сортировка стабильна — равные ключи сохраняют входной порядок.
 */
export function sortRecordsForExport(records: readonly ExportRecord[]): readonly ExportRecord[] {
  return [...records].sort(compareRecords);
}

/** Строит полный CSV-документ; результат заканчивается LF без BOM. */
export function writeExportCsv(records: readonly ExportRecord[]): string {
  const header = EXPORT_CSV_COLUMNS.join(',');
  const rows = sortRecordsForExport(records).map(recordToRow);
  return [header, ...rows].map((line) => `${line}\n`).join('');
}

function compareRecords(a: ExportRecord, b: ExportRecord): number {
  const keyA = sortKey(a);
  const keyB = sortKey(b);
  return (
    keyA[0] - keyB[0] ||
    keyA[1] - keyB[1] ||
    compareStrings(keyA[2], keyB[2]) ||
    compareStrings(keyA[3], keyB[3])
  );
}

/** [ранг типа, числовой под-ранг, строковые под-ключи] — без межтиповых casts. */
function sortKey(record: ExportRecord): readonly [number, number, string, string] {
  const typeRank = RECORD_TYPE_ORDER[record.record_type];
  switch (record.record_type) {
    case 'summary':
      return [typeRank, 0, '', ''];
    case 'module':
      return [typeRank, moduleRank(record.module), '', ''];
    case 'ai_response':
      return [typeRank, 0, record.provider, record.request_id];
    case 'issue':
      return [typeRank, severityRank(record.severity), record.fingerprint, ''];
  }
}

/** Module records идут в каноническом порядке реестра модулей (D-108). */
function moduleRank(module: ModuleName | null): number {
  return module === null ? -1 : MODULE_NAMES.indexOf(module);
}

/** SEVERITIES объявлен в порядке Critical → Low — индекс и есть ранг (§16). */
function severityRank(severity: Severity | null): number {
  return severity === null ? SEVERITIES.length : SEVERITIES.indexOf(severity);
}

/** Лексикографическое сравнение; для ASCII-значений (fingerprint) = байтовому. */
function compareStrings(a: string | null, b: string | null): number {
  const left = a ?? '';
  const right = b ?? '';
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function recordToRow(record: ExportRecord): string {
  return EXPORT_CSV_COLUMNS.map((field) => serializeField(field, record[field])).join(',');
}

function serializeField(field: ExportRecordField, value: ExportRecord[ExportRecordField]): string {
  if (value === null) {
    return ''; // §16: null сериализуется пустым полем
  }
  if (typeof value === 'number') {
    return TWO_DECIMAL_FIELDS.includes(field) ? value.toFixed(2) : String(value);
  }
  if (typeof value === 'string') {
    return quoteRfc4180(escapeFormulaLead(value));
  }
  // citations (массив) и usage (объект) — детерминированный JSON; начинается
  // с [ или { и потому не требует формула-экранирования.
  return quoteRfc4180(JSON.stringify(value));
}

/** RFC 4180: поле в кавычках при наличии запятой/кавычки/перевода строки. */
function quoteRfc4180(value: string): string {
  if (!NEEDS_QUOTING.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

/** Формула-инъекция: ведущий = + - @ нейтрализуется префиксом «'» (OWASP). */
function escapeFormulaLead(value: string): string {
  return FORMULA_LEAD_CHARS.test(value) ? `'${value}` : value;
}
