import type { Scan, ScanModule } from '@prisma/client';
import { parseCrawlSummary, scanScopeSchema } from '@fluxradar/contracts';

import { egressLocationView } from '../integrations/crawl-egress-locations.ts';
import { recordedEgressLocation, storedExecutionConfig } from '../profiles/execution-config.ts';
import { LEGACY_COVERAGE_PROOF_KEY } from '../orchestrator/run-coverage.ts';
import { isReportSnapshotReady } from './report-readiness.ts';

const TERMINAL_MODULE_STATUSES = new Set(['Completed', 'Partial', 'Unavailable', 'Not applicable']);

export function toScanDto(
  scan: Scan & { readonly job?: { readonly status: string } | null },
  modules: readonly ScanModule[],
): Record<string, unknown> {
  const terminal = modules.filter((module) =>
    TERMINAL_MODULE_STATUSES.has(module.runtimeStatus),
  ).length;
  return {
    id: scan.id,
    profileId: scan.siteProfileId,
    plan: scan.plan,
    domain: scan.domain,
    status: scan.status,
    reportReady: isReportSnapshotReady(scan, scan.job),
    statusReason: scan.statusReason,
    scope: parseScope(scan.scopeJson),
    crawlSummary: parseCrawlSummary(scan.crawlSummaryJson),
    profileConfigVersion: scan.profileConfigVersion,
    executionConfig: storedExecutionConfig(scan.executionConfigJson),
    egressLocation: egressLocationView(recordedEgressLocation(scan)),
    rulesetVersion: scan.rulesetVersion,
    retry: { platform: scan.platformRetryCount, module: scan.moduleRetryCount },
    progress: {
      completedModules: terminal,
      totalModules: modules.length,
      scannedUrls: scan.scannedUrlCount,
      discoveredUrls: scan.discoveredUrlCount,
    },
    pauseRequestedAt: scan.pauseRequestedAt?.toISOString() ?? null,
    startedAt: scan.startedAt?.toISOString() ?? null,
    completedAt: scan.completedAt?.toISOString() ?? null,
    createdAt: scan.createdAt.toISOString(),
    modules: modules.map(toModuleDto),
  };
}

export function toModuleDto(module: ScanModule): Record<string, unknown> {
  return {
    module: module.module,
    status: module.runtimeStatus,
    statusReason: module.statusReason,
    coverage: module.coverage,
    score: module.score,
    applicableChecks: module.applicableChecks,
    completedApplicableChecks: module.completedApplicableChecks,
    usableOutput: module.usableOutput,
    metadata: reportMetadata(module.metadataJson),
  };
}

function parseScope(value: string): unknown {
  try {
    const parsed = scanScopeSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : scanScopeSchema.parse({ includeSubdomains: false });
  } catch {
    return scanScopeSchema.parse({ includeSubdomains: false });
  }
}

function reportMetadata(value: string): unknown {
  try {
    const metadata: unknown = JSON.parse(value);
    if (typeof metadata !== 'object' || metadata === null) return metadata;
    return Object.fromEntries(
      Object.entries(metadata as Record<string, unknown>).filter(
        ([key]) => key !== LEGACY_COVERAGE_PROOF_KEY,
      ),
    );
  } catch {
    return {};
  }
}
