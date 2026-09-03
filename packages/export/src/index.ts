// @fluxradar/export — канонические export records §16 (T-11): билдеры,
// JSON Schema + ajv, semantic validator EXPORT-001, CSV-writer, ECON-001.
// Чистый пакет без I/O (единственное исключение — bin-скрипт econ-cli).

export { EconInputError, ExportBuildError, ExportError } from './errors.js';

export { EXPORT_RECORD_FIELDS } from './fields.js';
export type { ExportRecordField } from './fields.js';

export { EXPORT_RECORD_SCHEMA } from './schema.js';

export { validateExportRecordSchema } from './schema-validator.js';
export type { SchemaValidationResult, SchemaViolation } from './schema-validator.js';

export {
  buildAiResponseRecord,
  buildIssueRecord,
  buildModuleRecord,
  buildSummaryRecord,
} from './builders.js';
export type {
  AiResponseRecordInput,
  IssueRecordInput,
  ModuleRecordInput,
  ScanExportContext,
  SummaryRecordInput,
} from './builder-inputs.js';

export { COVERAGE_EPSILON, validateExportSemantics } from './semantic-validator.js';
export type { SemanticValidationResult, SemanticViolation } from './semantic-validator.js';

export { validateExportRecords } from './validate.js';
export type { ExportValidationResult, RecordSchemaViolation } from './validate.js';

export { EXPORT_CSV_COLUMNS, sortRecordsForExport, writeExportCsv } from './csv.js';

export {
  ECON_OPERATIONAL_FLOOR_SCANS,
  PADDLE_FEE_FLAT_USD,
  PADDLE_FEE_RATE,
  SUPPORT_RESERVE_GROSS_SHARE,
  SUPPORT_RESERVE_MIN_USD,
  VARIABLE_COST_CEILING_USD,
  validateEconForecast,
} from './econ.js';
export type { EconFailure, EconForecastInput, EconReport, EconValidationResult } from './econ.js';

export { readForecastFile, runEconValidate } from './econ-cli.js';
export type { CliIo } from './econ-cli.js';
