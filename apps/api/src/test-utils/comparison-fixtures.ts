// Builders for the scan-comparison suites: two finished scans of one site, each
// with the module rows, findings and re-check proof a real run leaves behind.
//
// The scans themselves are bought through production code (`purchaseScan`), so
// the plan gate, the stored scope and the entitlement are real. What these
// helpers add is the state a worker would have written: a terminal status, the
// crawl summary the report reads, module rows with scores, `Issue` rows, and the
// `RuleCoverageProof` that is the only durable record of which pages a finished
// crawl read.

import { RULESET_VERSION, severityRank, type CrawlSummary } from '@fluxradar/contracts';
import type { PrismaClient } from '@prisma/client';

import { serializeCoverageProof, type RuleCoverage } from '../orchestrator/run-coverage.ts';
import { crawlRequestContext } from '../orchestrator/run-context.ts';
import { scanScopeOf } from '../orchestrator/run-context.ts';

export const COMPARISON_NOW = new Date('2026-09-20T12:00:00.000Z');

/** A crawl that read the whole site it found, unless a test says otherwise. */
export function crawlSummary(overrides: Partial<CrawlSummary> = {}): CrawlSummary {
  const pagesRead = overrides.pagesRead ?? 10;
  return {
    reach: 'reachable',
    startStatus: 200,
    accessControlSignals: [],
    pagesRead,
    pagesFetched: pagesRead,
    urlsDiscovered: pagesRead,
    urlsOverLimit: 0,
    urlsBlockedByRobots: 0,
    limitedBy: null,
    maxPages: 500,
    ...overrides,
  };
}

export interface SeedModule {
  readonly module: string;
  readonly score?: number | null;
  readonly runtimeStatus?: string;
  readonly usableOutput?: boolean;
  readonly coverage?: number;
}

export interface SeedFinding {
  readonly fingerprint: string;
  readonly ruleId?: string;
  readonly module?: string;
  readonly severity?: string;
  readonly status?: string;
  readonly normalizedUrl?: string;
}

export interface FinishScanParams {
  readonly status?: string;
  readonly statusReason?: string | null;
  readonly completedAt?: Date;
  /**
   * When the scan was bought, when a test needs it to differ from its order.
   *
   * A Partial run retried later completes AFTER scans created after it, and
   * every read of "the previous scan" orders by completion for exactly that case
   * (scans/previous-scan.ts). A fixture that leaves creation to the insertion
   * order cannot tell the two orders apart.
   */
  readonly createdAt?: Date;
  /** Null writes no crawl summary at all — a scan older than the column. */
  readonly summary?: CrawlSummary | null;
  readonly modules?: readonly SeedModule[];
  readonly findings?: readonly SeedFinding[];
  /** Per module, what its rules judged — the page census of this scan. */
  readonly proofs?: Readonly<Record<string, readonly RuleCoverage[]>>;
}

/**
 * The modules a Complete scan's overall score is weighted over (§15).
 *
 * All of them, because the score engine reports `insufficient_data` — and no
 * score at all — below 50% of the tariff's weight. A fixture with two modules
 * therefore has no overall score to compare, which is correct behaviour and a
 * useless default for a suite about score deltas.
 */
export const WEIGHTED_MODULES: readonly string[] = [
  'SEO',
  'AI SEO / GEO',
  'Security',
  'Performance',
  'Accessibility',
  'Reliability',
  'Content Quality',
  'Privacy',
];

/** Every weighted module at one score, so the overall score is that number. */
export function allModules(score: number): readonly SeedModule[] {
  return WEIGHTED_MODULES.map((module) => ({ module, score }));
}

export const DEFAULT_MODULES: readonly SeedModule[] = allModules(70);

/**
 * Brings a purchased scan to the state a finished run leaves behind.
 *
 * The proof is written with the scan's OWN stored scope in its context, exactly
 * as `run-attempt` writes it: the Resolved policy compares that context, and a
 * fixture that invented a different one would be testing a scan no worker
 * produces.
 */
export async function finishScan(
  prisma: PrismaClient,
  scanId: string,
  params: FinishScanParams = {},
): Promise<void> {
  const scan = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
  const summary = params.summary === undefined ? crawlSummary() : params.summary;
  await prisma.scan.update({
    where: { id: scanId },
    data: {
      status: params.status ?? 'Completed',
      statusReason: params.statusReason ?? null,
      ...(params.createdAt === undefined ? {} : { createdAt: params.createdAt }),
      startedAt: COMPARISON_NOW,
      completedAt: params.completedAt ?? COMPARISON_NOW,
      crawlSummaryJson: summary === null ? null : JSON.stringify(summary),
      rulesetVersion: RULESET_VERSION,
      scannedUrlCount: summary?.pagesRead ?? 0,
      discoveredUrlCount: summary?.urlsDiscovered ?? 0,
    },
  });
  for (const module of params.modules ?? DEFAULT_MODULES) {
    await prisma.scanModule.upsert({
      where: { scanId_module: { scanId, module: module.module } },
      create: moduleRow(scanId, module),
      update: moduleRow(scanId, module),
    });
  }
  const findings = params.findings ?? [];
  if (findings.length > 0) {
    await prisma.issue.createMany({
      data: findings.map((finding) => findingRow(scan.domain, scanId, finding)),
    });
  }
  const context = crawlRequestContext(scanScopeOf(scan));
  for (const [module, rules] of Object.entries(params.proofs ?? {})) {
    await prisma.ruleCoverageProof.upsert({
      where: { scanId_module: { scanId, module } },
      create: { scanId, module, proof: serializeCoverageProof({ rules, context }) },
      update: { proof: serializeCoverageProof({ rules, context }) },
    });
  }
}

function moduleRow(scanId: string, module: SeedModule) {
  const score = module.score === undefined ? 70 : module.score;
  return {
    scanId,
    module: module.module,
    runtimeStatus: module.runtimeStatus ?? 'Completed',
    coverage: module.coverage ?? 1,
    score,
    applicableChecks: 4,
    completedApplicableChecks: 4,
    usableOutput: module.usableOutput ?? score !== null,
    metadataJson: '{}',
  };
}

function findingRow(domain: string, scanId: string, finding: SeedFinding) {
  const severity = finding.severity ?? 'High';
  const url = finding.normalizedUrl ?? `${domain}/${finding.fingerprint}`;
  return {
    scanId,
    ruleId: finding.ruleId ?? 'SEO-ONPAGE-001',
    module: finding.module ?? 'SEO',
    fingerprint: finding.fingerprint,
    severity,
    severityRank: severityRank(severity),
    category: 'on-page',
    status: finding.status ?? 'New',
    targetKind: 'page',
    normalizedUrl: url,
    normalizedResource: '',
    normalizedSelector: '',
    normalizedParameter: '',
    ruleVariant: 'v1',
    targetUrl: url,
    evidenceType: 'dom',
    recommendation: 'Fix it',
    confidence: 1,
    applicableTargets: 1,
    affectedTargets: 1,
    rulePenalty: 0,
    scoreDelta: 0,
    observedAt: COMPARISON_NOW,
  };
}

/** A page rule that judged these addresses under their own crawl address. */
export function pageRuleCoverage(targets: readonly string[]): RuleCoverage {
  return { ruleId: 'SEO-ONPAGE-001', checkedTargets: targets };
}

/**
 * A rule that judges pages by the document address the site's redirects name.
 *
 * `SEO-ONPAGE-004` is one of the rules that declare `judgedAddress`
 * (@fluxradar/rules CANONICAL_PAGE_RULE_IDS), so its targets are the canonical
 * census: one entry per document, aliases collapsed.
 */
export function canonicalRuleCoverage(targets: readonly string[]): RuleCoverage {
  return { ruleId: 'SEO-ONPAGE-004', checkedTargets: targets };
}

/** Rewrites the scope the scan records, the way the launch screen would have. */
export async function rewriteScope(
  prisma: PrismaClient,
  scanId: string,
  changes: Readonly<Record<string, unknown>>,
): Promise<void> {
  const scan = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
  const config = JSON.parse(scan.executionConfigJson ?? '{}') as {
    scope?: Record<string, unknown>;
  };
  const scope = { ...(config.scope ?? {}), ...changes };
  await prisma.scan.update({
    where: { id: scanId },
    data: {
      executionConfigJson: JSON.stringify({ ...config, scope }),
      scopeJson: JSON.stringify(scope),
    },
  });
}
