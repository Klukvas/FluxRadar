// Writes the Performance module row from a real audit.
//
// The module used to be one PageSpeed call on the homepage, on one device,
// stored as a score. It is now a bounded audit — a few pages, both emulated
// devices, repeated runs, plus the field read — and this file is what turns the
// result into the row the report and the export read.
//
// Two things it is careful about, both of them billing-visible:
//
//   * COVERAGE. §18 terminalizes a scan as Partial when a module leaves an
//     applicable check unclosed, so the applicable checks here are the lab runs
//     the audit actually attempted and nothing else (see audit.ts `coverageOf`).
//   * SCORE. The row's score is Lighthouse's own, computed in the audit.
//     Findings and regressions are stored beside it and never subtract from it.

import type { Prisma, PrismaClient, Scan } from '@prisma/client';

import {
  compareWithPrevious,
  legacySnapshotOf,
  type DeviceStrategy,
  type PerformanceAudit,
  type PerformanceAuditRequest,
  type PerformanceRunner,
  type PreviousPerformance,
} from '../integrations/performance/index.ts';
import type { WorkerDeps } from './deps.ts';

export const PERFORMANCE_MODULE = 'Performance';

/** Reasons the module row carries; each names one thing a reader can act on. */
export const PERFORMANCE_STATUS_REASONS = {
  notConfigured: 'PerformanceIntegrationNotConfigured',
  providerUnavailable: 'PerformanceProviderUnavailable',
  partialCoverage: 'PerformanceSamplesIncomplete',
  scoreUnavailable: 'PerformanceScoreUnavailable',
} as const;

interface ModuleRow {
  readonly runtimeStatus: string;
  readonly statusReason: string | null;
  readonly coverage: number;
  readonly score: number | null;
  readonly applicableChecks: number;
  readonly completedApplicableChecks: number;
  readonly usableOutput: boolean;
  readonly metadataJson: string;
}

async function writeModule(
  prisma: PrismaClient,
  scanId: string,
  row: Partial<ModuleRow> & { readonly runtimeStatus: string },
): Promise<void> {
  const { runtimeStatus, ...rest } = row;
  await prisma.scanModule.upsert({
    where: { scanId_module: { scanId, module: PERFORMANCE_MODULE } },
    create: { scanId, module: PERFORMANCE_MODULE, runtimeStatus, ...rest },
    update: { runtimeStatus, ...rest },
  });
}

/**
 * The previous audit for this site profile, for the regression comparison.
 *
 * Only a scan that stored an audit of the current version is a candidate: an
 * older flat snapshot has no per-URL medians to compare against, and pretending
 * otherwise would compare one homepage run with a median of six.
 */
export async function loadPreviousPerformance(
  prisma: PrismaClient,
  scan: Scan,
): Promise<PreviousPerformance | null> {
  const previous = await prisma.scan.findFirst({
    where: {
      siteProfileId: scan.siteProfileId,
      accountId: scan.accountId,
      id: { not: scan.id },
      status: { in: ['Completed', 'Partial'] },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { modules: { where: { module: PERFORMANCE_MODULE } } },
  });
  const metadata = previous?.modules[0]?.metadataJson;
  if (previous === null || metadata === undefined) return null;
  const audit = parseAudit(metadata);
  return audit === null
    ? null
    : {
        scanId: previous.id,
        observedAt: (previous.completedAt ?? previous.createdAt).toISOString(),
        audit,
      };
}

/** The stored audit, or null when the row predates it or is unreadable. */
function parseAudit(metadataJson: string): PerformanceAudit | null {
  try {
    const parsed: unknown = JSON.parse(metadataJson);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const audit = (parsed as { audit?: unknown }).audit;
    if (typeof audit !== 'object' || audit === null) return null;
    return Array.isArray((audit as PerformanceAudit).urls) ? (audit as PerformanceAudit) : null;
  } catch {
    return null;
  }
}

function rowFor(audit: PerformanceAudit): ModuleRow {
  const { applicableChecks, completedApplicableChecks } = audit.coverage;
  const hasField = audit.field.metrics !== null;
  const usableOutput = completedApplicableChecks > 0 || hasField;
  const runtimeStatus =
    applicableChecks > 0 && completedApplicableChecks === applicableChecks
      ? 'Completed'
      : usableOutput
        ? 'Partial'
        : 'Unavailable';
  const statusReason =
    runtimeStatus === 'Unavailable'
      ? PERFORMANCE_STATUS_REASONS.providerUnavailable
      : runtimeStatus === 'Partial'
        ? PERFORMANCE_STATUS_REASONS.partialCoverage
        : // Every run the audit asked for closed, and Lighthouse still stated no
          // category score for any of them. The row is complete; the number is
          // not, and a section showing no score with no reason for it is the one
          // thing worse than showing the reason.
          audit.score === null
          ? PERFORMANCE_STATUS_REASONS.scoreUnavailable
          : null;
  return {
    runtimeStatus,
    statusReason,
    coverage: applicableChecks === 0 ? 0 : completedApplicableChecks / applicableChecks,
    score: runtimeStatus === 'Unavailable' ? null : audit.score,
    applicableChecks,
    completedApplicableChecks,
    usableOutput,
    // The flat snapshot stays at the top level, as every report before this
    // audit stored it; the audit itself sits beside it under `audit`.
    metadataJson: JSON.stringify({ ...legacySnapshotOf(audit), audit }),
  };
}

/**
 * The devices to measure, most wanted first, from the scan's own scope.
 *
 * ORDER, NOT CHOICE. A deployment with a PageSpeed API key measures every device
 * in the list, so the order only decides which one is measured first and which
 * survives the request budget. A deployment without a key measures the first one
 * and nothing else (`KEYLESS_AUDIT_LIMITS`), which is why the profile's own
 * preference has to lead: a desktop-only profile measured on mobile is a number
 * about a device its visitors do not use.
 *
 * The scan scope's `userAgent` defaults to `desktop` (packages/contracts), and an
 * older stored scope that states none is read the same way.
 */
export function devicePreferenceFor(
  userAgent: DeviceStrategy | undefined,
): readonly DeviceStrategy[] {
  return userAgent === 'mobile' ? ['mobile', 'desktop'] : ['desktop', 'mobile'];
}

export interface PerformanceModuleInput {
  readonly scan: Scan;
  readonly origin: string;
  readonly candidateUrls: readonly string[];
  /**
   * The devices to measure, most wanted first — `devicePreferenceFor` builds it
   * from the scan's scope. Omitted, the audit falls back to its own default
   * order, which is not the caller's preference.
   */
  readonly strategies?: PerformanceAuditRequest['strategies'];
}

/**
 * Runs the audit for one scan and writes its row. Never throws: external
 * performance data is optional, and a provider outage must be shown as
 * unavailable rather than fail an otherwise valid website scan.
 */
export async function runPerformanceModule(
  deps: WorkerDeps,
  input: PerformanceModuleInput,
): Promise<void> {
  const { prisma } = deps;
  const runner: PerformanceRunner | undefined = deps.createPerformanceRunner?.();
  if (runner === undefined) {
    await writeModule(prisma, input.scan.id, {
      runtimeStatus: 'Unavailable',
      statusReason: PERFORMANCE_STATUS_REASONS.notConfigured,
      coverage: 0,
      score: null,
      applicableChecks: 1,
      completedApplicableChecks: 0,
      usableOutput: false,
    });
    return;
  }
  try {
    const audit = await runner({
      origin: input.origin,
      candidateUrls: input.candidateUrls,
      ...(input.strategies === undefined ? {} : { strategies: input.strategies }),
    });
    const previous = await loadPreviousPerformance(prisma, input.scan);
    const compared = compareWithPrevious(audit, previous);
    const withComparison: PerformanceAudit = {
      ...audit,
      regressions: compared.regressions,
      comparison: compared.comparison,
    };
    await writeModule(prisma, input.scan.id, rowFor(withComparison));
  } catch (error) {
    deps.logger.warn('performance audit failed', {
      scanId: input.scan.id,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    await writeModule(prisma, input.scan.id, {
      runtimeStatus: 'Unavailable',
      statusReason: PERFORMANCE_STATUS_REASONS.providerUnavailable,
      coverage: 0,
      score: null,
      applicableChecks: 1,
      completedApplicableChecks: 0,
      usableOutput: false,
    });
  }
}

/** Prisma's create shape for the row, exported so tests can assert on it directly. */
export type PerformanceModuleRow = Prisma.ScanModuleUncheckedCreateInput;
