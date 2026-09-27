// The client for GET /scans/:scanId/comparison, and the check that the answer
// really is one.
//
// It mirrors `scanComparisonSchema` in @fluxradar/contracts rather than
// importing it, for the same reason the plan matrix is mirrored: this app has no
// dependency on the contracts package. What replaces the import is
// `isScanComparison` below — the response is validated field by field before any
// of it is rendered, INCLUDING every closed list the UI indexes copy by. A
// reason string the panel has no sentence for would otherwise render as an empty
// status paragraph: a report that says nothing where it promised to say why.
//
// Its own file rather than a section of api.ts: the comparison is one screen's
// contract, and api.ts is read by every screen.

import { apiRequest, isNullableString, isRecord, isStringArray } from './api';

export const COMPARISON_INCOMPARABLE_REASONS = [
  'no-previous-scan',
  'previous-plan-differs',
  'previous-not-usable',
  'scope-changed',
  'current-crawl-truncated',
  'previous-crawl-truncated',
  'current-stopped-early',
  'previous-stopped-early',
  'crawl-not-recorded',
] as const;
export type ComparisonIncomparableReason = (typeof COMPARISON_INCOMPARABLE_REASONS)[number];

export const MODULE_COMPARISON_REASONS = [
  'module-absent-previously',
  'module-absent-now',
  'module-not-scored-previously',
  'module-not-scored-now',
] as const;
export type ModuleComparisonReason = (typeof MODULE_COMPARISON_REASONS)[number];

export const PAGE_COMPARISON_REASONS = [
  'page-evidence-missing',
  'page-evidence-unreadable',
  'page-evidence-empty',
  'page-identity-mismatch',
  'scans-not-comparable',
] as const;
export type PageComparisonReason = (typeof PAGE_COMPARISON_REASONS)[number];

export const PAGE_IDENTITY_KINDS = ['canonical-document', 'crawl-address'] as const;
export type PageIdentityKind = (typeof PAGE_IDENTITY_KINDS)[number];

/** A verdict: comparable, or a named reason why not. */
export type Comparability<Reason extends string> =
  { readonly ok: true } | { readonly ok: false; readonly reason: Reason };

export interface CrawlScopeFacts {
  readonly entryUrl: string;
  readonly maxPages: number | null;
  readonly maxDepth: number | null;
  readonly includeSubdomains: boolean;
  readonly queryPolicy: 'include' | 'ignore';
  readonly urlPatterns: readonly string[];
  readonly excludePatterns: readonly string[];
  readonly seedUrls: readonly string[];
  readonly renderJs: boolean;
  readonly respectRobots: boolean;
  readonly userAgent: string;
  readonly egressLocation: string | null;
  readonly scopeKey: string;
}

export interface ComparedScan {
  readonly id: string;
  readonly plan: string;
  readonly status: string;
  readonly completedAt: string | null;
  readonly pagesRead: number | null;
  readonly urlsDiscovered: number | null;
  readonly urlsOverLimit: number | null;
  readonly scope: CrawlScopeFacts;
  /** Whether this report is still the account's to open; see the panel's link. */
  readonly readable: boolean;
}

export interface ModuleScoreDelta {
  readonly module: string;
  readonly previousScore: number | null;
  readonly currentScore: number | null;
  readonly delta: number | null;
  readonly comparable: Comparability<ModuleComparisonReason>;
}

export interface PageComparison {
  readonly comparable: Comparability<PageComparisonReason>;
  readonly identity: PageIdentityKind | null;
  readonly added: number;
  readonly removed: number;
  readonly kept: number;
  readonly currentTotal: number;
  readonly previousTotal: number;
  readonly addedSample: readonly string[];
  readonly removedSample: readonly string[];
}

export interface IssueCounts {
  readonly new: number;
  readonly resolved: number;
  readonly reopened: number;
  readonly stillOpen: number;
  readonly settled: number;
}

export interface IssueSample {
  readonly fingerprint: string;
  readonly ruleId: string;
  readonly module: string;
  readonly severity: string;
  readonly normalizedUrl: string;
}

/** Findings under rules that ran here and not in the previous scan. */
export interface FirstCheckedFindings {
  readonly count: number;
  readonly byModule: readonly { readonly module: string; readonly count: number }[];
  readonly bySeverity: readonly { readonly severity: string; readonly count: number }[];
  readonly ruleIds: readonly string[];
  readonly sample: readonly IssueSample[];
}

export interface IssueComparison extends IssueCounts {
  readonly byModule: readonly (IssueCounts & { readonly module: string })[];
  readonly bySeverity: readonly (IssueCounts & { readonly severity: string })[];
  readonly newSample: readonly IssueSample[];
  readonly resolvedSample: readonly IssueSample[];
  readonly firstChecked: FirstCheckedFindings;
  readonly noLongerChecked: readonly string[];
}

/** What this report changed against the previous scan of the same site and plan. */
export interface ScanComparison {
  readonly current: ComparedScan;
  readonly previous: ComparedScan | null;
  readonly comparable: Comparability<ComparisonIncomparableReason>;
  readonly overall: {
    readonly previousScore: number | null;
    readonly currentScore: number | null;
    readonly delta: number | null;
  };
  readonly modules: readonly ModuleScoreDelta[];
  readonly pages: PageComparison;
  readonly issues: IssueComparison;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

/**
 * A verdict, with its reason checked against the list the panel has copy for.
 *
 * Not `typeof reason === 'string'`: the panel indexes its sentences by the
 * reason, so an unrecognised one renders as a blank paragraph where the
 * explanation should be. Rejecting it here turns that into the "unavailable"
 * line, which at least tells the reader the comparison is not being shown.
 */
function isComparability(value: unknown, reasons: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  if (value.ok === true) return true;
  return value.ok === false && typeof value.reason === 'string' && reasons.includes(value.reason);
}

function isCrawlScopeFacts(value: unknown): value is CrawlScopeFacts {
  if (!isRecord(value)) return false;
  return (
    typeof value.entryUrl === 'string' &&
    isNullableNumber(value.maxPages) &&
    isNullableNumber(value.maxDepth) &&
    typeof value.includeSubdomains === 'boolean' &&
    (value.queryPolicy === 'include' || value.queryPolicy === 'ignore') &&
    isStringArray(value.urlPatterns) &&
    isStringArray(value.excludePatterns) &&
    isStringArray(value.seedUrls) &&
    typeof value.renderJs === 'boolean' &&
    typeof value.respectRobots === 'boolean' &&
    typeof value.userAgent === 'string' &&
    isNullableString(value.egressLocation) &&
    typeof value.scopeKey === 'string'
  );
}

function isComparedScan(value: unknown): value is ComparedScan {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.plan === 'string' &&
    typeof value.status === 'string' &&
    isNullableString(value.completedAt) &&
    isNullableNumber(value.pagesRead) &&
    isNullableNumber(value.urlsDiscovered) &&
    isNullableNumber(value.urlsOverLimit) &&
    typeof value.readable === 'boolean' &&
    isCrawlScopeFacts(value.scope)
  );
}

function isModuleScoreDelta(value: unknown): value is ModuleScoreDelta {
  if (!isRecord(value)) return false;
  return (
    typeof value.module === 'string' &&
    isNullableNumber(value.previousScore) &&
    isNullableNumber(value.currentScore) &&
    isNullableNumber(value.delta) &&
    isComparability(value.comparable, MODULE_COMPARISON_REASONS)
  );
}

function isPageComparison(value: unknown): value is PageComparison {
  if (!isRecord(value)) return false;
  return (
    isComparability(value.comparable, PAGE_COMPARISON_REASONS) &&
    (value.identity === null ||
      (typeof value.identity === 'string' &&
        (PAGE_IDENTITY_KINDS as readonly string[]).includes(value.identity))) &&
    typeof value.added === 'number' &&
    typeof value.removed === 'number' &&
    typeof value.kept === 'number' &&
    typeof value.currentTotal === 'number' &&
    typeof value.previousTotal === 'number' &&
    isStringArray(value.addedSample) &&
    isStringArray(value.removedSample)
  );
}

function hasIssueCounts(value: Readonly<Record<string, unknown>>): boolean {
  return (
    typeof value.new === 'number' &&
    typeof value.resolved === 'number' &&
    typeof value.reopened === 'number' &&
    typeof value.stillOpen === 'number' &&
    typeof value.settled === 'number'
  );
}

function isIssueSample(value: unknown): value is IssueSample {
  if (!isRecord(value)) return false;
  return (
    typeof value.fingerprint === 'string' &&
    typeof value.ruleId === 'string' &&
    typeof value.module === 'string' &&
    typeof value.severity === 'string' &&
    typeof value.normalizedUrl === 'string'
  );
}

function isNamedCount(value: unknown, field: 'module' | 'severity'): boolean {
  return isRecord(value) && typeof value[field] === 'string' && typeof value.count === 'number';
}

function isFirstChecked(value: unknown): value is FirstCheckedFindings {
  if (!isRecord(value)) return false;
  return (
    typeof value.count === 'number' &&
    Array.isArray(value.byModule) &&
    value.byModule.every((entry) => isNamedCount(entry, 'module')) &&
    Array.isArray(value.bySeverity) &&
    value.bySeverity.every((entry) => isNamedCount(entry, 'severity')) &&
    isStringArray(value.ruleIds) &&
    Array.isArray(value.sample) &&
    value.sample.every(isIssueSample)
  );
}

function isIssueComparison(value: unknown): value is IssueComparison {
  if (!isRecord(value) || !hasIssueCounts(value)) return false;
  return (
    Array.isArray(value.byModule) &&
    value.byModule.every(
      (entry) => isRecord(entry) && typeof entry.module === 'string' && hasIssueCounts(entry),
    ) &&
    Array.isArray(value.bySeverity) &&
    value.bySeverity.every(
      (entry) => isRecord(entry) && typeof entry.severity === 'string' && hasIssueCounts(entry),
    ) &&
    Array.isArray(value.newSample) &&
    value.newSample.every(isIssueSample) &&
    Array.isArray(value.resolvedSample) &&
    value.resolvedSample.every(isIssueSample) &&
    isFirstChecked(value.firstChecked) &&
    isStringArray(value.noLongerChecked)
  );
}

/**
 * Whether a response really is a scan comparison.
 *
 * The report tests answer any `/scans/...` path with a scan or a dashboard, and
 * so can a deployment that predates this endpoint. A mismatch has to mean
 * "unavailable" — the panel says so — because the alternative is a page of
 * deltas rendered from whatever the object happened to contain. Every field is
 * checked, including inside the samples: a comparison is read as a statement
 * about the customer's site, and half-validating it would move the failure into
 * the renderer.
 */
export function isScanComparison(value: unknown): value is ScanComparison {
  if (!isRecord(value)) return false;
  if (!isComparedScan(value.current)) return false;
  if (value.previous !== null && !isComparedScan(value.previous)) return false;
  if (!isComparability(value.comparable, COMPARISON_INCOMPARABLE_REASONS)) return false;
  if (
    !isRecord(value.overall) ||
    !isNullableNumber(value.overall.previousScore) ||
    !isNullableNumber(value.overall.currentScore) ||
    !isNullableNumber(value.overall.delta)
  ) {
    return false;
  }
  if (!Array.isArray(value.modules) || !value.modules.every(isModuleScoreDelta)) return false;
  return isPageComparison(value.pages) && isIssueComparison(value.issues);
}

/**
 * The comparison, or null when there is none to show.
 *
 * Null covers every "cannot": the plan does not include it (403), the endpoint
 * is not deployed, the network failed, or the answer was not a comparison. The
 * panel renders one "unavailable" line for all of them rather than an error the
 * reader cannot act on — what the report is actually about is above it.
 */
export async function fetchScanComparison(scanId: string): Promise<ScanComparison | null> {
  try {
    const value = await apiRequest<unknown>(`/scans/${encodeURIComponent(scanId)}/comparison`);
    return isScanComparison(value) ? value : null;
  } catch {
    return null;
  }
}
