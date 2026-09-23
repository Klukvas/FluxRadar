// The fixtures the PDF suites render against: an in-memory finding store, a scan
// with its module rows, and the stored shapes the document reads out of them.
//
// They live here rather than inside one suite because two suites use the same
// scan: `render.test.ts` covers the document's structure — pagination, the footer
// band, evidence longer than a page — and `render.localization.test.ts` covers
// what it says, and in which language.
//
// Nothing here touches a database or a provider: the Prisma double answers the
// four calls the renderer makes, and every provider snapshot is a literal.

import type { Issue, PrismaClient, Scan, ScanModule } from '@prisma/client';

import { renderReportPdf } from '../export/pdf/render.ts';

export const SCAN_ID = 'scan-pdf-1';

export function issueAt(index: number, overrides: Partial<Issue> = {}): Issue {
  const severity = ['Critical', 'High', 'Medium', 'Low'][index % 4] ?? 'Low';
  return {
    id: `issue-${String(index).padStart(5, '0')}`,
    scanId: SCAN_ID,
    ruleId: `SEO-${(index % 17) + 1}`,
    module: 'SEO',
    fingerprint: `fp-${String(index).padStart(5, '0')}`,
    severity,
    severityRank: index % 4,
    category: 'content',
    status: 'New',
    targetKind: 'page',
    normalizedUrl: `https://example.com/page-${index}`,
    normalizedResource: '',
    normalizedSelector: '',
    normalizedParameter: '',
    ruleVariant: 'default',
    targetUrl: `https://example.com/page-${index}`,
    evidenceType: 'html',
    evidenceRef: null,
    evidenceExcerpt: `<title>Page ${index}</title>`,
    evidenceGroupId: null,
    recommendation: 'Give the page a title that describes it.',
    messagesJson: null,
    confidence: 1,
    applicableTargets: 1,
    affectedTargets: 1,
    rulePenalty: 1,
    scoreDelta: -1,
    observedAt: new Date('2026-09-22T10:00:00.000Z'),
    ...overrides,
  };
}

export function scanWithModules(modules: readonly Partial<ScanModule>[] = []): Scan & {
  modules: ScanModule[];
} {
  const scan = {
    id: SCAN_ID,
    purchaseId: 'purchase-1',
    accountId: 'account-1',
    siteProfileId: 'profile-1',
    plan: 'Complete',
    domain: 'https://example.com',
    status: 'Completed',
    statusReason: null,
    scopeJson: '{}',
    profileConfigVersion: 1,
    executionConfigJson: null,
    rulesetVersion: 'ruleset-1',
    platformRetryCount: 0,
    moduleRetryCount: 0,
    startedAt: new Date('2026-09-22T09:00:00.000Z'),
    completedAt: new Date('2026-09-22T09:30:00.000Z'),
    createdAt: new Date('2026-09-22T08:00:00.000Z'),
  } as Scan;
  return {
    ...scan,
    modules: modules.map(
      (module, index) =>
        ({
          id: `module-${index}`,
          scanId: SCAN_ID,
          module: 'SEO',
          runtimeStatus: 'Completed',
          exportStatus: null,
          statusReason: null,
          coverage: 1,
          score: 82,
          applicableChecks: 10,
          completedApplicableChecks: 10,
          metadataJson: '{}',
          usableOutput: true,
          ...module,
        }) as ScanModule,
    ),
  };
}

export interface QueryLog {
  readonly pageSizes: number[];
  readonly returnedIds: string[];
}

/**
 * A Prisma double over a fixed list of findings. It implements exactly the four
 * calls the renderer makes, and it honours the keyset cursor rather than
 * ignoring it, so a cursor bug shows up as repeated or missing findings.
 */
export function fakePrisma(issues: readonly Issue[]): { prisma: PrismaClient; log: QueryLog } {
  const ordered = [...issues].sort(
    (left, right) =>
      left.severityRank - right.severityRank ||
      left.fingerprint.localeCompare(right.fingerprint) ||
      left.id.localeCompare(right.id),
  );
  const log: QueryLog = { pageSizes: [], returnedIds: [] };
  const after = (issue: Issue, where: Record<string, unknown>): boolean => {
    const or = where.OR;
    if (!Array.isArray(or)) return true;
    const [byRank, byRest] = or as [
      { severityRank: { gt: number } },
      {
        severityRank: number;
        OR: [{ fingerprint: { gt: string } }, { fingerprint: string; id: { gt: string } }];
      },
    ];
    if (issue.severityRank > byRank.severityRank.gt) return true;
    if (issue.severityRank !== byRest.severityRank) return false;
    const [byFingerprint, byId] = byRest.OR;
    if (issue.fingerprint > byFingerprint.fingerprint.gt) return true;
    return issue.fingerprint === byId.fingerprint && issue.id > byId.id.gt;
  };
  const prisma = {
    issue: {
      count: async ({ where }: { where: { status?: { in: string[] } } }) =>
        where.status === undefined
          ? ordered.length
          : ordered.filter((issue) => where.status?.in.includes(issue.status) === true).length,
      groupBy: async ({ by }: { by: readonly string[] }) => {
        const key = by[0] === 'severity' ? 'severity' : 'ruleId';
        const counts = new Map<string, number>();
        for (const issue of ordered) {
          const value = key === 'severity' ? issue.severity : issue.ruleId;
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        return [...counts.entries()].map(([value, count]) =>
          key === 'severity'
            ? { severity: value, _count: { _all: count } }
            : { ruleId: value, _count: { _all: count } },
        );
      },
      findMany: async ({ where, take }: { where: Record<string, unknown>; take: number }) => {
        const page = ordered.filter((issue) => after(issue, where)).slice(0, take);
        log.pageSizes.push(page.length);
        log.returnedIds.push(...page.map((issue) => issue.id));
        return page;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, log };
}

/** The moment every fixture render is dated, so two runs produce one document. */
export const RENDERED_AT = new Date('2026-09-22T12:00:00.000Z');

/** One English report over these findings and module rows, with the query log. */
export async function render(
  issues: readonly Issue[],
  modules: readonly Partial<ScanModule>[] = [],
) {
  const { prisma, log } = fakePrisma(issues);
  const result = await renderReportPdf({
    prisma,
    scan: scanWithModules(modules),
    language: 'en',
    now: RENDERED_AT,
  });
  return { ...result, log };
}

export function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** The footer line of one page, as `n / m`, or null when the page has none. */
export function footerCounter(
  page: string,
): { readonly index: number; readonly total: number } | null {
  const match = /(\d+) \/ (\d+)/.exec(page);
  return match === null ? null : { index: Number(match[1]), total: Number(match[2]) };
}

/** What a page says once its footer lines are taken away. */
export function withoutFooter(page: string, footerNote: string): string {
  return page
    .split('\n')
    .filter(
      (line) => !line.startsWith(footerNote.slice(0, 20)) && !/^\d+ \/ \d+$/.test(line.trim()),
    )
    .join('\n')
    .trim();
}

/** A stored Performance audit, as performance-module.ts writes it. */
export function performanceAudit() {
  return {
    version: 'performance-audit-v1',
    origin: 'https://example.com/',
    fetchedAt: '2026-09-22T11:00:00.000Z',
    providers: [{ name: 'pagespeed', version: '12.0.0', requests: 2, failures: 0 }],
    urls: [
      {
        url: 'https://example.com/',
        primary: true,
        devices: [
          {
            strategy: 'mobile',
            requestedSamples: 2,
            usableSamples: 2,
            metrics: {
              performanceScore: { median: 62, samples: [60, 64], instability: 0.06 },
              lcpMs: { median: 3_400, samples: [2_400, 4_400], instability: 0.59 },
              ttfbMs: { median: 900, samples: [880, 920], instability: 0.04 },
              tbtMs: { median: 420, samples: [400, 440], instability: 0.1 },
            },
            failures: [],
          },
        ],
      },
    ],
    field: { state: 'no_data', scope: 'origin', detail: 'no record', metrics: null },
    requestBudget: { cap: 14, used: 2, capped: false },
    findings: [
      {
        ruleId: 'PERF-LAB-TTFB',
        severity: 'high',
        url: 'https://example.com/',
        strategy: 'mobile',
        summary: 'Time to First Byte is 900 ms on mobile.',
        recommendation: 'Cache the HTML response.',
        evidence: { median: 900 },
      },
    ],
    regressions: [
      {
        url: 'https://example.com/',
        strategy: 'mobile',
        metric: 'lcpMs',
        previous: 2_000,
        current: 3_400,
        changeRatio: 0.7,
        previousScanId: 'scan-0',
        previousObservedAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    comparison: {
      previousScanId: 'scan-0',
      previousObservedAt: '2026-09-01T00:00:00.000Z',
      incomparableReason: null,
    },
    coverage: { applicableChecks: 1, completedApplicableChecks: 1, implementedRuleIds: [] },
    score: 62,
  };
}

/**
 * Findings as the audit stores them: one lab verdict with the evidence its
 * sentence is rebuilt from, and the field read's absence, which is informational.
 */
export function performanceFindings() {
  return [
    {
      ruleId: 'PERF-LAB-TTFB',
      severity: 'high',
      url: 'https://example.com/',
      strategy: 'mobile',
      summary: 'Time to First Byte is 1.9 s on mobile (good is under 800 ms).',
      recommendation:
        'The server spends this long before it sends the first byte. Cache the HTML response.',
      evidence: {
        median: 1_900,
        samples: 2,
        instability: 0.1,
        good: 800,
        poor: 1_800,
        url: 'https://example.com/',
        strategy: 'mobile',
        source: 'pagespeed-lab',
      },
    },
    {
      ruleId: 'PERF-FIELD-INP',
      severity: 'info',
      url: 'https://example.com/',
      strategy: null,
      summary: 'Interaction to Next Paint could not be measured for this site.',
      recommendation: 'The Chrome UX Report has no record for this origin.',
      evidence: { fieldState: 'no_data', scope: 'origin', source: 'crux' },
    },
  ];
}

/**
 * A Google snapshot with neither service connected — the most ordinary
 * configuration there is, and the one whose English `detail` sentences used to be
 * printed inside the Ukrainian document.
 */
export function googleMetadata(state = 'not_connected') {
  return {
    source: 'google',
    readOnly: true,
    fetchedAt: '2026-09-22T11:00:00.000Z',
    dateRange: { startDate: '2026-08-26', endDate: '2026-09-22' },
    searchConsole: {
      state,
      detail: 'Google is not connected for this workspace.',
      data: null,
    },
    analytics: {
      state,
      detail: 'No Analytics 4 property is linked to this profile yet.',
      data: null,
    },
  };
}

/** A stored Analytics row carrying a Bing section, as the module writes it. */
export function analyticsMetadata(
  siteUrl = 'https://example.com/',
  findings: readonly Readonly<Record<string, unknown>>[] = [],
) {
  return {
    bing: {
      snapshot: {
        source: 'bing',
        readOnly: true,
        fetchedAt: '2026-09-22T11:00:00.000Z',
        dateRange: { startDate: '2026-08-26', endDate: '2026-09-22' },
        webmaster: {
          state: 'connected',
          detail: 'Connected.',
          data: {
            siteUrl,
            totals: { clicks: 140, impressions: 5_200, ctr: 0.0269, days: 19 },
            previousTotals: null,
            topQueries: [
              {
                query: 'приклад запиту',
                clicks: 90,
                impressions: 1_200,
                ctr: 0.075,
                avgImpressionPosition: 4.2,
                avgClickPosition: 2.1,
                days: 12,
              },
            ],
            dailyTraffic: [],
            unavailableReads: [],
          },
        },
      },
      findings,
    },
  };
}

/** The Bing notes as `bingFindings` stores them: code, sentence and evidence. */
export function bingFinding(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    code: 'BING-TRAFFIC-DROP',
    severity: 'attention',
    summary: 'Bing clicks fell 45.0% against the previous period.',
    recommendation: 'Check Bing Webmaster Tools for crawl or indexing changes.',
    evidence: { clicks: 55, previousClicks: 100, changeRatio: -0.45 },
    ...overrides,
  };
}

/**
 * A ready action plan in the projection shape the seam documents. Its keys are
 * asserted on directly: the absence of a prompt field is the guarantee.
 */
export function actionPlan() {
  return {
    overview: 'Three things first.',
    // What the scan could not see when the plan was written. The web report
    // states these above the plan, and the document has to say the same thing.
    caveats: ['Analytics did not run: no Google account is connected.'],
    actions: [
      {
        title: 'Add page titles',
        why: 'Six pages have none, so search results show the URL instead.',
        steps: ['Write a title for each page listed below.', 'Keep it under 60 characters.'],
        effort: 'small' as const,
        ruleIds: ['SEO-1'],
        openIssues: 4,
        totalIssues: 6,
        settled: false,
      },
    ],
    reach: { share: 0.4, addressedOpenIssues: 4, totalOpenIssues: 10, rules: 1 },
    metadata: {
      modelId: 'claude-test',
      promptVersion: 'action-plan-v1',
      noticeVersion: 'notice-v1',
      generatedAt: '2026-09-22T11:30:00.000Z',
    },
  };
}
