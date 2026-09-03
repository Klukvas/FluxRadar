import type { PrismaClient, Scan, ScanModule } from '@prisma/client';
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
import { isModuleName } from '@fluxradar/contracts';
import { computeOverallScore } from '@fluxradar/scoring';
import {
  buildAiResponseRecord,
  buildIssueRecord,
  buildModuleRecord,
  buildSummaryRecord,
} from '@fluxradar/export';

import { conflict } from '../http/errors.ts';

export type ExportScan = Scan & {
  readonly modules: ScanModule[];
  readonly issues: Awaited<ReturnType<PrismaClient['issue']['findMany']>>;
  readonly aiResponses: Awaited<ReturnType<PrismaClient['aiResponseRecord']['findMany']>>;
};

/** Maps the persisted aggregate into the canonical export records. */
export function buildExportRecords(scan: ExportScan) {
  if (scan.startedAt === null || scan.completedAt === null) {
    throw conflict('EXPORT_NOT_READY', 'scan timestamps are incomplete');
  }
  const startedAt = scan.startedAt.toISOString();
  const completedAt = scan.completedAt.toISOString();
  const context = {
    scanId: scan.id,
    domain: scan.domain,
    startedAt,
    completedAt,
    rulesetVersion: scan.rulesetVersion,
  } as const;
  const moduleByName = new Map(scan.modules.map((module) => [module.module, module]));
  const summaries = scan.modules.flatMap((module) => moduleSummary(module));
  const overall = computeOverallScore(scan.plan as 'Complete', summaries);
  const scanStatus = scan.status as ScanExportStatus;
  const statusReason = scanStatus === 'Completed' ? null : scan.statusReason ?? `Scan${scanStatus}`;
  return [
    buildSummaryRecord(context, {
      scanStatus,
      statusReason,
      coverage: overall.weightedCoverage,
      score: overall.score,
      observedAt: completedAt,
    }),
    ...scan.modules.map((module) => buildModuleRecord(context, {
      module: module.module as ModuleName,
      moduleStatus: module.runtimeStatus as ModuleExportStatus,
      coverage: module.coverage ?? 0,
      applicableChecks: module.applicableChecks ?? 0,
      completedApplicableChecks: module.completedApplicableChecks ?? 0,
      score: module.score,
      statusReason: module.statusReason,
      observedAt: completedAt,
    })),
    ...scan.aiResponses.map((response) => {
      const geo = moduleByName.get('AI SEO / GEO');
      const moduleStatus = geo?.runtimeStatus as 'Completed' | 'Partial' | undefined;
      if (moduleStatus !== 'Completed' && moduleStatus !== 'Partial') {
        throw conflict('EXPORT_INVALID', 'AI response exists without a completed GEO module');
      }
      return buildAiResponseRecord(context, {
        moduleStatus,
        statusReason: moduleStatus === 'Partial' ? geo?.statusReason ?? 'Partial' : null,
        provider: response.provider,
        apiVersion: response.apiVersion,
        modelId: response.modelId,
        promptVersion: response.promptVersion,
        requestId: response.requestId,
        requestIdSource: response.requestIdSource as RequestIdSource,
        aiRequestKey: response.aiRequestKey,
        rawText: response.rawText,
        providerCreatedAt: response.createdAt.toISOString(),
        citations: parseStringArray(response.citationsJson),
        usage: parseUsage(response.usageJson),
        usageSource: response.usageSource as UsageSource,
        tokenizerVersion: response.usageSource === 'estimated' ? 'unknown-v1' : null,
        finishReason: response.finishReason as AiFinishReason,
        deletionEvidenceRef: response.deletionEvidenceRef ?? `ai-001/deletion/${response.aiRequestKey}`,
        observedAt: completedAt,
      });
    }),
    ...scan.issues.map((issue) => {
      const module = moduleByName.get(issue.module);
      const moduleStatus = module?.runtimeStatus as 'Completed' | 'Partial' | undefined;
      if (moduleStatus !== 'Completed' && moduleStatus !== 'Partial') {
        throw conflict('EXPORT_INVALID', `issue ${issue.id} belongs to unavailable module ${issue.module}`);
      }
      return buildIssueRecord(context, {
        issueId: issue.id,
        module: issue.module as ModuleName,
        moduleStatus,
        ruleId: issue.ruleId,
        targetKind: issue.targetKind as TargetKind,
        normalizedUrl: issue.normalizedUrl,
        normalizedResource: issue.normalizedResource,
        normalizedSelector: issue.normalizedSelector,
        normalizedParameter: issue.normalizedParameter,
        ruleVariant: issue.ruleVariant,
        category: issue.category,
        severity: issue.severity as Severity,
        confidence: issue.confidence,
        status: issue.status as IssueStatus,
        targetUrl: issue.targetUrl,
        evidenceType: issue.evidenceType as EvidenceType,
        evidenceRef: issue.evidenceRef ?? `issue/${issue.id}`,
        evidenceExcerpt: issue.evidenceExcerpt,
        recommendation: issue.recommendation,
        applicableTargets: issue.applicableTargets,
        affectedTargets: issue.affectedTargets,
        rulePenalty: issue.rulePenalty,
        expectedFingerprint: issue.fingerprint,
        evidenceGroupId: issue.evidenceGroupId,
        observedAt: issue.observedAt.toISOString(),
      });
    }),
  ];
}

function moduleSummary(module: ScanModule) {
  if (!isModuleName(module.module)) return [];
  return [{
    module: module.module,
    moduleStatus: module.runtimeStatus as 'Completed' | 'Partial' | 'Unavailable' | 'Not applicable',
    coverage: module.coverage ?? 0,
    score: module.score,
    usableOutput: module.usableOutput,
  }];
}

function parseStringArray(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

function parseUsage(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const inputTokens = numberOrZero(parsed.input_tokens);
    const outputTokens = numberOrZero(parsed.output_tokens);
    return {
      inputTokens,
      outputTokens,
      totalTokens: numberOrZero(parsed.total_tokens) || inputTokens + outputTokens,
      reasoningUnits: numberOrNull(parsed.reasoning_units),
      searchUnits: numberOrNull(parsed.search_units),
      citationUnits: numberOrNull(parsed.citation_units),
    };
  } catch {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningUnits: null, searchUnits: null, citationUnits: null };
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
