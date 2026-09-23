// Форма одной строки ScanModule, какой её пишет оркестратор. Тип живёт
// отдельно от run-attempt.ts, чтобы чистые билдеры строк (geo-module-row.ts)
// могли тестироваться без оркестратора и без базы.

export interface ModuleRowData {
  readonly runtimeStatus: string;
  readonly statusReason?: string | null;
  readonly coverage?: number | null;
  readonly score?: number | null;
  readonly applicableChecks?: number | null;
  readonly completedApplicableChecks?: number | null;
  readonly usableOutput?: boolean;
  readonly metadataJson?: string;
}
