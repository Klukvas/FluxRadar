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
import { EXPORT_PLAN_LABELS, TARIFFS, isModuleName, parsePlan } from '@fluxradar/contracts';
import type { ExportPlanLabel } from '@fluxradar/contracts';
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

/**
 * The §16 plan literal for a stored plan — the tariff's own label, refused when
 * that label is not an export label.
 *
 * The label used to be a constant reading 'Complete Scan' on every record, so an
 * export of any other plan would have described itself as a Complete scan.
 */
function exportPlanLabel(plan: string): ExportPlanLabel {
  const label = TARIFFS[parsePlan(plan)].label;
  if (!(EXPORT_PLAN_LABELS as readonly string[]).includes(label)) {
    throw conflict('EXPORT_PLAN_UNSUPPORTED', 'this plan has no export format');
  }
  return label as ExportPlanLabel;
}

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
    plan: exportPlanLabel(scan.plan),
    rulesetVersion: scan.rulesetVersion,
  } as const;
  const moduleByName = new Map(scan.modules.map((module) => [module.module, module]));
  const summaries = scan.modules.flatMap((module) => moduleSummary(module));
  const overall = computeOverallScore(parsePlan(scan.plan), summaries);
  const scanStatus = scan.status as ScanExportStatus;
  const statusReason =
    scanStatus === 'Completed' ? null : (scan.statusReason ?? `Scan${scanStatus}`);
  return [
    buildSummaryRecord(context, {
      scanStatus,
      statusReason,
      coverage: overall.weightedCoverage,
      score: overall.score,
      observedAt: completedAt,
    }),
    ...scan.modules.map((module) =>
      buildModuleRecord(context, {
        module: module.module as ModuleName,
        moduleStatus: module.runtimeStatus as ModuleExportStatus,
        coverage: module.coverage ?? 0,
        applicableChecks: module.applicableChecks ?? 0,
        completedApplicableChecks: module.completedApplicableChecks ?? 0,
        score: module.score,
        statusReason: module.statusReason,
        observedAt: completedAt,
      }),
    ),
    ...scan.aiResponses.map((response) => {
      if (response.module !== 'AI SEO / GEO' && response.module !== 'UX/Conversion') {
        throw conflict('EXPORT_INVALID', `AI response has unknown module ${response.module}`);
      }
      const responseModule = response.module;
      const geo = moduleByName.get(responseModule);
      const moduleStatus = geo?.runtimeStatus as 'Completed' | 'Partial' | undefined;
      if (moduleStatus !== 'Completed' && moduleStatus !== 'Partial') {
        throw conflict('EXPORT_INVALID', 'AI response exists without a usable AI module');
      }
      return buildAiResponseRecord(context, {
        module: responseModule,
        moduleStatus,
        statusReason: moduleStatus === 'Partial' ? (geo?.statusReason ?? 'Partial') : null,
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
        tokenizerVersion:
          response.usageSource === 'estimated' ? (response.tokenizerVersion ?? 'unknown-v1') : null,
        finishReason: response.finishReason as AiFinishReason,
        deletionEvidenceRef:
          response.deletionEvidenceRef ?? `ai-001/deletion/${response.aiRequestKey}`,
        observedAt: completedAt,
      });
    }),
    ...scan.issues.map((issue) => {
      const module = moduleByName.get(issue.module);
      const moduleStatus = module?.runtimeStatus as 'Completed' | 'Partial' | undefined;
      if (moduleStatus !== 'Completed' && moduleStatus !== 'Partial') {
        throw conflict(
          'EXPORT_INVALID',
          `issue ${issue.id} belongs to unavailable module ${issue.module}`,
        );
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
  return [
    {
      module: module.module,
      moduleStatus: module.runtimeStatus as
        'Completed' | 'Partial' | 'Unavailable' | 'Not applicable',
      coverage: module.coverage ?? 0,
      score: module.score,
      usableOutput: module.usableOutput,
    },
  ];
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
    const inputTokens = numberOrZero(parsed.inputTokens ?? parsed.input_tokens);
    const outputTokens = numberOrZero(parsed.outputTokens ?? parsed.output_tokens);
    return {
      inputTokens,
      outputTokens,
      totalTokens:
        numberOrZero(parsed.totalTokens ?? parsed.total_tokens) || inputTokens + outputTokens,
      reasoningUnits: numberOrNull(parsed.reasoningUnits ?? parsed.reasoning_units),
      searchUnits: numberOrNull(parsed.searchUnits ?? parsed.search_units),
      citationUnits: numberOrNull(parsed.citationUnits ?? parsed.citation_units),
    };
  } catch {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reasoningUnits: null,
      searchUnits: null,
      citationUnits: null,
    };
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
