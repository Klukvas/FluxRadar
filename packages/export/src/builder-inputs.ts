// Входные контракты record-билдеров (T-11): доменные данные скана в терминах
// contracts/scoring/ai, из которых собираются канонические records §16.
// T-12 orchestrator маппит сюда результаты computeCoverage/computeModuleScore,
// RuleFinding/GeoFinding и NormalizedAiResponse.

import type {
  AiFinishReason,
  EvidenceType,
  IssueStatus,
  ModuleExportStatus,
  ModuleName,
  RequestIdSource,
  ScanExportStatus,
  Severity,
  TargetKind,
  UsageSource,
} from '@fluxradar/contracts';

/** Общая идентичность скана — одинакова для всех records одного snapshot-а (D-024). */
export interface ScanExportContext {
  readonly scanId: string;
  /** Normalized public origin (§16); он же поле domain fingerprint-а (D-019). */
  readonly domain: string;
  /** RFC3339 UTC c суффиксом Z — как и остальные timestamp-поля. */
  readonly startedAt: string;
  readonly completedAt: string;
  readonly rulesetVersion: string;
}

export interface SummaryRecordInput {
  readonly scanStatus: ScanExportStatus;
  /** Обязателен (непустой) для Partial/Failed/Cancelled; null для Completed (§16). */
  readonly statusReason: string | null;
  /** Точный weighted coverage 0..1 из computeOverallScore (§15). */
  readonly coverage: number;
  /** null — Insufficient data / NoUsableOutput (§15/§16). */
  readonly score: number | null;
  readonly observedAt?: string;
}

export interface ModuleRecordInput {
  readonly module: ModuleName;
  readonly moduleStatus: ModuleExportStatus;
  /** Точное значение из computeCoverage (§15 coverage contract). */
  readonly coverage: number;
  readonly applicableChecks: number;
  readonly completedApplicableChecks: number;
  /** null — Unavailable / Not applicable / completed-but-unusable (§15). */
  readonly score: number | null;
  readonly statusReason: string | null;
  readonly observedAt?: string;
}

export interface IssueRecordInput {
  readonly issueId: string;
  readonly module: ModuleName;
  /** Issue-записи существуют только у модулей Completed/Partial (§16). */
  readonly moduleStatus: 'Completed' | 'Partial';
  readonly ruleId: string;
  readonly targetKind: TargetKind;
  /** D-019: для site/environment-целей — пустая строка. */
  readonly normalizedUrl: string;
  readonly normalizedResource: string;
  readonly normalizedSelector: string;
  readonly normalizedParameter: string;
  readonly ruleVariant: string;
  /** Только performance metric findings/regressions; иначе null (§16). */
  readonly metricKey?: string | null;
  readonly evidenceGroupId?: string | null;
  readonly category: string;
  readonly severity: Severity;
  readonly confidence: number;
  readonly status: IssueStatus;
  readonly targetUrl: string;
  readonly evidenceType: EvidenceType;
  readonly evidenceRef: string;
  readonly evidenceExcerpt: string | null;
  readonly recommendation: string;
  readonly applicableTargets: number;
  readonly affectedTargets: number;
  /** Агрегатный penalty правила из scoring (D-016); score_delta выводится как −penalty. */
  readonly rulePenalty: number;
  /** Fingerprint из БД для сверки с пересчётом; рассинхрон — ошибка сборки. */
  readonly expectedFingerprint?: string;
  readonly observedAt?: string;
}

export interface AiResponseRecordInput {
  readonly moduleStatus: 'Completed' | 'Partial';
  readonly statusReason: string | null;
  readonly provider: string;
  readonly apiVersion: string;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly requestId: string;
  readonly requestIdSource: RequestIdSource;
  readonly aiRequestKey: string;
  readonly rawText: string;
  readonly providerCreatedAt: string | null;
  readonly citations: readonly string[];
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly reasoningUnits?: number | null;
    readonly searchUnits?: number | null;
    readonly citationUnits?: number | null;
  };
  readonly usageSource: UsageSource;
  /** Обязателен при usageSource='estimated' (§5/§16). */
  readonly tokenizerVersion?: string | null;
  readonly finishReason: AiFinishReason | null;
  readonly deletionEvidenceRef: string;
  readonly observedAt?: string;
}
