// Canonical string values follow the export schema §16 verbatim ('Not applicable',
// 'False Positive', 'AI SEO / GEO', ...) so that records never need re-mapping.

export const SCAN_RUNTIME_STATUSES = [
  'Pending',
  'Queued',
  'Running',
  'Partial',
  'Completed',
  'Failed',
  'Cancelled',
] as const;
export type ScanRuntimeStatus = (typeof SCAN_RUNTIME_STATUSES)[number];

// Pending/Queued/Running are never exported: export records are terminal snapshots only.
export const SCAN_EXPORT_STATUSES = ['Partial', 'Completed', 'Failed', 'Cancelled'] as const;
export type ScanExportStatus = (typeof SCAN_EXPORT_STATUSES)[number];

export const MODULE_RUNTIME_STATUSES = [
  'Pending',
  'Running',
  'Completed',
  'Partial',
  'Unavailable',
  'Not applicable',
] as const;
export type ModuleRuntimeStatus = (typeof MODULE_RUNTIME_STATUSES)[number];

export const MODULE_EXPORT_STATUSES = [
  'Completed',
  'Partial',
  'Unavailable',
  'Not applicable',
] as const;
export type ModuleExportStatus = (typeof MODULE_EXPORT_STATUSES)[number];

export const ISSUE_STATUSES = [
  'New',
  'Acknowledged',
  'Resolved',
  'Reopened',
  'Ignored',
  'False Positive',
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const PLANS = ['Free', 'Basic', 'Complete'] as const;
export type Plan = (typeof PLANS)[number];

export const RECORD_TYPES = ['summary', 'module', 'ai_response', 'issue'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const TARGET_KINDS = ['page', 'site', 'api', 'environment'] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export const EVIDENCE_TYPES = ['none', 'http', 'dom', 'screenshot', 'trace', 'mixed'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const REFUND_REASON_CODES = [
  'PRE_QUEUE_CANCEL',
  'PLATFORM_FAILURE_AFTER_RETRY',
  'EXTERNAL_NO_USABLE_OUTPUT',
  'LEGAL_SUPPORT',
] as const;
export type RefundReasonCode = (typeof REFUND_REASON_CODES)[number];

export const MODULE_NAMES = [
  'SEO',
  'AI SEO / GEO',
  'Security',
  'Performance',
  'Accessibility',
  'Reliability',
  'Content Quality',
  'Privacy',
  'UX/Conversion',
  'Analytics',
] as const;
export type ModuleName = (typeof MODULE_NAMES)[number];

export const AI_FINISH_REASONS = ['stop', 'length', 'safety', 'error'] as const;
export type AiFinishReason = (typeof AI_FINISH_REASONS)[number];

export const REQUEST_ID_SOURCES = ['provider', 'local'] as const;
export type RequestIdSource = (typeof REQUEST_ID_SOURCES)[number];

export const USAGE_SOURCES = ['provider', 'estimated'] as const;
export type UsageSource = (typeof USAGE_SOURCES)[number];
