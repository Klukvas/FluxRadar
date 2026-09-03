import type {
  AiFinishReason,
  EvidenceType,
  IssueStatus,
  ModuleExportStatus,
  ModuleName,
  RecordType,
  RequestIdSource,
  ScanExportStatus,
  Severity,
  TargetKind,
  UsageSource,
} from './enums.js';

export const EXPORT_SCHEMA_VERSION = '1.0';

/** §16 export records exist only for the Complete plan. */
export type ExportPlanLabel = 'Complete Scan';

export interface AiUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  /** Normalized contract §5: always input_tokens + output_tokens. */
  readonly total_tokens: number;
  readonly reasoning_units: number | null;
  readonly search_units: number | null;
  readonly citation_units: number | null;
}

/**
 * D-014: every field of the data dictionary is always present on every record;
 * absent keys are forbidden, inapplicable fields carry an explicit null.
 * Narrowed record types below pin the per-record_type nullability of §16.
 */
export interface ExportRecordBase {
  readonly schema_version: typeof EXPORT_SCHEMA_VERSION;
  readonly record_type: RecordType;
  readonly scan_id: string;
  /** Normalized public origin. */
  readonly domain: string;
  readonly plan: ExportPlanLabel;
  readonly started_at: string;
  readonly completed_at: string;
  readonly observed_at: string;
  readonly ruleset_version: string;
  readonly module: ModuleName | null;
  readonly module_status: ModuleExportStatus | null;
  readonly scan_status: ScanExportStatus | null;
  readonly request_id_source: RequestIdSource | null;
  readonly usage_source: UsageSource | null;
  readonly tokenizer_version: string | null;
  readonly coverage: number | null;
  readonly applicable_checks: number | null;
  readonly completed_applicable_checks: number | null;
  readonly score: number | null;
  readonly applicable_targets: number | null;
  readonly affected_targets: number | null;
  readonly rule_penalty: number | null;
  readonly score_delta: number | null;
  readonly issue_id: string | null;
  readonly fingerprint: string | null;
  readonly rule_id: string | null;
  readonly target_kind: TargetKind | null;
  readonly normalized_url: string | null;
  readonly normalized_resource: string | null;
  readonly normalized_selector: string | null;
  readonly normalized_parameter: string | null;
  readonly rule_variant: string | null;
  readonly metric_key: string | null;
  readonly evidence_group_id: string | null;
  readonly category: string | null;
  readonly severity: Severity | null;
  readonly confidence: number | null;
  readonly status: IssueStatus | null;
  readonly target_url: string | null;
  readonly evidence_type: EvidenceType | null;
  readonly evidence_ref: string | null;
  readonly evidence_excerpt: string | null;
  readonly recommendation: string | null;
  readonly status_reason: string | null;
  readonly provider: string | null;
  readonly api_version: string | null;
  readonly model_id: string | null;
  readonly prompt_version: string | null;
  readonly request_id: string | null;
  readonly ai_request_key: string | null;
  readonly raw_text: string | null;
  readonly provider_created_at: string | null;
  readonly finish_reason: AiFinishReason | null;
  readonly citations: readonly string[] | null;
  readonly usage: AiUsage | null;
  readonly deletion_evidence_ref: string | null;
}

type IssueLevelModuleStatus = Extract<ModuleExportStatus, 'Completed' | 'Partial'>;

interface WithNullIssueFields {
  readonly applicable_targets: null;
  readonly affected_targets: null;
  readonly rule_penalty: null;
  readonly score_delta: null;
  readonly issue_id: null;
  readonly fingerprint: null;
  readonly rule_id: null;
  readonly target_kind: null;
  readonly normalized_url: null;
  readonly normalized_resource: null;
  readonly normalized_selector: null;
  readonly normalized_parameter: null;
  readonly rule_variant: null;
  readonly metric_key: null;
  readonly evidence_group_id: null;
  readonly category: null;
  readonly severity: null;
  readonly confidence: null;
  readonly status: null;
  readonly target_url: null;
  readonly evidence_type: null;
  readonly evidence_ref: null;
  readonly evidence_excerpt: null;
  readonly recommendation: null;
}

interface WithNullAiFields {
  readonly request_id_source: null;
  readonly usage_source: null;
  readonly tokenizer_version: null;
  readonly provider: null;
  readonly api_version: null;
  readonly model_id: null;
  readonly prompt_version: null;
  readonly request_id: null;
  readonly ai_request_key: null;
  readonly raw_text: null;
  readonly provider_created_at: null;
  readonly finish_reason: null;
  readonly citations: null;
  readonly usage: null;
  readonly deletion_evidence_ref: null;
}

// Narrowed record types are intersections: interface-extends would require
// redeclaring every conflicting field, an intersection resolves them to the
// narrower type (e.g. (number | null) & null = null).
export type SummaryRecord = ExportRecordBase &
  WithNullIssueFields &
  WithNullAiFields & {
    readonly record_type: 'summary';
    readonly module: null;
    readonly module_status: null;
    readonly scan_status: ScanExportStatus;
    readonly coverage: number;
    readonly applicable_checks: null;
    readonly completed_applicable_checks: null;
    /** null when the scan resolves to Insufficient data / NoUsableOutput. */
    readonly score: number | null;
    /** Required non-empty for Partial/Failed/Cancelled; null for ordinary Completed. */
    readonly status_reason: string | null;
  };

export type ModuleRecord = ExportRecordBase &
  WithNullIssueFields &
  WithNullAiFields & {
    readonly record_type: 'module';
    readonly module: ModuleName;
    readonly module_status: ModuleExportStatus;
    readonly scan_status: null;
    readonly coverage: number;
    readonly applicable_checks: number;
    readonly completed_applicable_checks: number;
    /** null for Unavailable/Not applicable and for completed-but-unusable modules. */
    readonly score: number | null;
    /** Required non-empty for Partial/Unavailable/Not applicable; null for Completed. */
    readonly status_reason: string | null;
  };

export type AiResponseRecord = ExportRecordBase &
  WithNullIssueFields & {
    readonly record_type: 'ai_response';
    readonly module: 'AI SEO / GEO';
    /** Record exists only after a normalized provider response (§16). */
    readonly module_status: IssueLevelModuleStatus;
    readonly scan_status: null;
    readonly coverage: null;
    readonly applicable_checks: null;
    readonly completed_applicable_checks: null;
    readonly score: null;
    readonly request_id_source: RequestIdSource;
    readonly usage_source: UsageSource;
    /** Required when usage_source = 'estimated'. */
    readonly tokenizer_version: string | null;
    readonly provider: string;
    readonly api_version: string;
    readonly model_id: string;
    readonly prompt_version: string;
    readonly request_id: string;
    readonly ai_request_key: string;
    readonly raw_text: string;
    readonly provider_created_at: string | null;
    readonly finish_reason: AiFinishReason | null;
    readonly citations: readonly string[];
    readonly usage: AiUsage;
    readonly deletion_evidence_ref: string;
    /** Required non-empty for Partial; null for Completed. */
    readonly status_reason: string | null;
  };

export type IssueRecord = ExportRecordBase &
  WithNullAiFields & {
    readonly record_type: 'issue';
    readonly module: ModuleName;
    readonly module_status: IssueLevelModuleStatus;
    readonly scan_status: null;
    readonly coverage: null;
    readonly applicable_checks: null;
    readonly completed_applicable_checks: null;
    readonly score: null;
    readonly applicable_targets: number;
    readonly affected_targets: number;
    /** D-016: aggregate rule penalty, identical across records of one rule_id. */
    readonly rule_penalty: number;
    /** Always -rule_penalty (EXPORT-001 invariant 7). */
    readonly score_delta: number;
    readonly issue_id: string;
    readonly fingerprint: string;
    readonly rule_id: string;
    readonly target_kind: TargetKind;
    /** D-019: empty string for site/environment-level issues (serialized as '0:'). */
    readonly normalized_url: string;
    readonly normalized_resource: string;
    readonly normalized_selector: string;
    readonly normalized_parameter: string;
    readonly rule_variant: string;
    /** Non-null only for performance metric findings/regressions. */
    readonly metric_key: string | null;
    readonly evidence_group_id: string | null;
    readonly category: string;
    readonly severity: Severity;
    readonly confidence: number;
    readonly status: IssueStatus;
    readonly target_url: string;
    readonly evidence_type: EvidenceType;
    readonly evidence_ref: string;
    readonly evidence_excerpt: string | null;
    readonly recommendation: string;
    /** Always null: the reason lives in the module/ai_response record (§16). */
    readonly status_reason: null;
  };

export type ExportRecord = SummaryRecord | ModuleRecord | AiResponseRecord | IssueRecord;
