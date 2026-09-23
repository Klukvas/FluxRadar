// DB-backed lifecycle of Resolved/Reopened between Complete scans (§14).
//
// The policy itself is pure and covered without a database in
// resolution-policy.test.ts; this file proves the wiring: that the run coverage
// really reaches the query, that the PREVIOUS scan's coverage is read from its
// own module rows, and that only the issues both together prove get updated.

import { scanScopeSchema } from '@fluxradar/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import {
  initialIssueStatuses,
  issueStatusesForModule,
  markResolvedAgainstPrevious,
} from './issue-sync.ts';
import type { RunCoverage } from './resolution-policy.ts';
import { crawlRequestContext, type RunRequestContext } from './run-context.ts';
import {
  loadScanCoverage,
  pruneCoverageProofs,
  serializeCoverageProof,
  type ModuleCoverage,
  type RuleCoverage,
} from './run-coverage.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedScan,
  type TestDb,
} from '../test-utils/test-db.ts';

const FINGERPRINT = 'fluxradar-fp-v1:issue-sync-fixture';
const ISSUE_URL = 'https://example.com/shop/item';
const HOME_URL = 'https://example.com/';
const PAGE_RULE = 'SEO-TECH-004';
const SITE_RULE = 'SEO-TECH-007';

/** Контекст, который пишет run-attempt для обхода всего сайта (run-context.ts). */
const DESKTOP: RunRequestContext = crawlRequestContext(
  scanScopeSchema.parse({ includeSubdomains: false }),
);

function checked(
  entries: Readonly<Record<string, readonly string[]>>,
  inputs: Readonly<Record<string, readonly string[]>> = {},
  requested: Readonly<Record<string, readonly string[]>> = {},
): RunCoverage['coverageByRule'] {
  return new Map(
    Object.entries(entries).map(([ruleId, targets]) => [
      ruleId,
      {
        checkedTargets: new Set(targets),
        inputTargets: new Set(inputs[ruleId] ?? []),
        // Не заданный спрос — «правило о нём не отчиталось», и тогда пропавший
        // вход находку не закрывает (run-coverage.ts).
        requestedInputs: requested[ruleId] === undefined ? null : new Set(requested[ruleId]),
        context: DESKTOP,
      },
    ]),
  );
}

function coverage(overrides: Partial<RunCoverage> = {}): RunCoverage {
  return {
    coverageByRule: checked({ [PAGE_RULE]: [ISSUE_URL] }),
    completedModules: new Set(['SEO']),
    rulesetVersion: 'rules-mvp-0.1',
    ...overrides,
  };
}

/** A completed module of the given scan, with the coverage proof it left behind. */
async function seedModuleCoverage(
  prisma: PrismaClient,
  scanId: string,
  module: string,
  rules: readonly RuleCoverage[],
  issueDependencies?: ReadonlyMap<string, readonly string[]>,
): Promise<void> {
  await prisma.scanModule.create({
    data: {
      scanId,
      module,
      runtimeStatus: 'Completed',
      coverage: 1,
      applicableChecks: 1,
      completedApplicableChecks: 1,
      usableOutput: true,
      metadataJson: '{}',
    },
  });
  const coverageProof: ModuleCoverage = {
    rules,
    context: DESKTOP,
    ...(issueDependencies === undefined ? {} : { issueDependencies }),
  };
  await prisma.ruleCoverageProof.create({
    data: { scanId, module, proof: serializeCoverageProof(coverageProof) },
  });
}

async function seedIssue(
  prisma: PrismaClient,
  scanId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  await prisma.issue.create({
    data: {
      scanId,
      ruleId: PAGE_RULE,
      module: 'SEO',
      fingerprint: FINGERPRINT,
      severity: 'High',
      category: 'Technical SEO',
      status: 'New',
      targetKind: 'page',
      normalizedUrl: ISSUE_URL,
      normalizedResource: '',
      normalizedSelector: '',
      normalizedParameter: '',
      ruleVariant: 'canonical-mismatch',
      targetUrl: ISSUE_URL,
      evidenceType: 'dom',
      evidenceRef: 'issue/fixture',
      evidenceExcerpt: 'canonical mismatch',
      recommendation: 'Fix canonical',
      confidence: 1,
      applicableTargets: 1,
      affectedTargets: 1,
      rulePenalty: 10,
      scoreDelta: -10,
      observedAt: new Date('2026-09-03T12:00:30.000Z'),
      ...overrides,
    },
  });
}

/**
 * The proof the scan that recorded the finding left behind.
 *
 * Without it there is nothing to compare — neither the inputs nor the request
 * configuration — and the policy keeps the finding open (a scan older than this
 * policy is exactly that case).
 */
async function seedPageRuleCoverage(
  prisma: PrismaClient,
  scanId: string,
  rules: readonly RuleCoverage[] = [{ ruleId: PAGE_RULE, checkedTargets: [ISSUE_URL] }],
  module = 'SEO',
): Promise<void> {
  await seedModuleCoverage(prisma, scanId, module, rules);
}

/** Two Complete scans of one profile, the first older than the second. */
async function seedScanPair(db: TestDb) {
  const account = await seedAccountWithProfile(db.prisma);
  const first = await seedScan(db.prisma, {
    account,
    plan: 'Complete',
    status: 'Completed',
    withPurchase: false,
  });
  const second = await seedScan(db.prisma, {
    account,
    plan: 'Complete',
    status: 'Completed',
    withPurchase: false,
  });
  await db.prisma.scan.update({
    where: { id: first.scan.id },
    data: { createdAt: new Date('2026-09-03T12:00:00.000Z') },
  });
  await db.prisma.scan.update({
    where: { id: second.scan.id },
    data: { createdAt: new Date('2026-09-03T12:01:00.000Z') },
  });
  return { account, first, second };
}

describe('Complete issue lifecycle by fingerprint', () => {
  let db: TestDb | undefined;

  afterEach(async () => {
    await db?.cleanup();
    db = undefined;
  });

  it('marks a re-checked finding Resolved and reopens it when it returns', async () => {
    db = await createTestDb();
    const { account, first, second } = await seedScanPair(db);
    await seedIssue(db.prisma, first.scan.id);
    await seedPageRuleCoverage(db.prisma, first.scan.id);

    expect(await markResolvedAgainstPrevious(db.prisma, second.scan, coverage())).toBe(1);
    const resolved = await db.prisma.issue.findFirstOrThrow({ where: { scanId: first.scan.id } });
    expect(resolved.status).toBe('Resolved');

    const third = await seedScan(db.prisma, {
      account,
      plan: 'Complete',
      status: 'Pending',
      withPurchase: false,
    });
    const statuses = await initialIssueStatuses(db.prisma, third.scan, [FINGERPRINT]);
    expect(statuses.get(FINGERPRINT)).toBe('Reopened');
  });

  it('a scan narrowed to other pages resolves nothing', async () => {
    db = await createTestDb();
    const { first, second } = await seedScanPair(db);
    await seedIssue(db.prisma, first.scan.id);

    const blogOnly = coverage({
      coverageByRule: checked({ [PAGE_RULE]: ['https://example.com/blog/post'] }),
    });
    expect(await markResolvedAgainstPrevious(db.prisma, second.scan, blogOnly)).toBe(0);
    const untouched = await db.prisma.issue.findFirstOrThrow({ where: { scanId: first.scan.id } });
    expect(untouched.status).toBe('New');
    // The prior evidence is left exactly as it was — nothing about that scan changed.
    expect(untouched.evidenceExcerpt).toBe('canonical mismatch');
  });

  it('a page that now answers 404 resolves nothing: the DOM check never ran on it', async () => {
    db = await createTestDb();
    const { first, second } = await seedScanPair(db);
    await seedIssue(db.prisma, first.scan.id);

    // The crawl fetched the URL, but a page rule only looks at successful HTML,
    // so the rule's proof does not name it.
    const pageDied = coverage({ coverageByRule: checked({ [PAGE_RULE]: [HOME_URL] }) });
    expect(await markResolvedAgainstPrevious(db.prisma, second.scan, pageDied)).toBe(0);
    const untouched = await db.prisma.issue.findFirstOrThrow({ where: { scanId: first.scan.id } });
    expect(untouched.status).toBe('New');
  });

  it('a module that did not complete this run resolves nothing', async () => {
    db = await createTestDb();
    const { first, second } = await seedScanPair(db);
    await seedIssue(db.prisma, first.scan.id, {
      module: 'Analytics',
      ruleId: 'ANALYTICS-GA-002',
      normalizedUrl: ISSUE_URL,
    });
    await seedPageRuleCoverage(
      db.prisma,
      first.scan.id,
      [{ ruleId: 'ANALYTICS-GA-002', checkedTargets: [ISSUE_URL] }],
      'Analytics',
    );

    const analytics = checked({ 'ANALYTICS-GA-002': [ISSUE_URL] });
    expect(
      await markResolvedAgainstPrevious(
        db.prisma,
        second.scan,
        coverage({ coverageByRule: analytics }),
      ),
    ).toBe(0);
    const untouched = await db.prisma.issue.findFirstOrThrow({ where: { scanId: first.scan.id } });
    expect(untouched.status).toBe('New');

    const withAnalytics = coverage({
      coverageByRule: analytics,
      completedModules: new Set(['SEO', 'Analytics']),
    });
    expect(await markResolvedAgainstPrevious(db.prisma, second.scan, withAnalytics)).toBe(1);
  });

  it('a different ruleset version resolves nothing', async () => {
    db = await createTestDb();
    const { first, second } = await seedScanPair(db);
    await seedIssue(db.prisma, first.scan.id);

    const newRuleset = coverage({ rulesetVersion: 'rules-mvp-9.9' });
    expect(await markResolvedAgainstPrevious(db.prisma, second.scan, newRuleset)).toBe(0);
  });

  it('a broken-link finding is not resolved by a run that lost the link target', async () => {
    // SEO-TECH-006 judges the source page but reads the snapshot of the page the
    // link points at. The source page is still crawled and still fine; the
    // target simply fell out of the crawl, and nothing was fixed.
    db = await createTestDb();
    const { first, second } = await seedScanPair(db);
    const gone = 'https://example.com/gone.html';
    await seedIssue(db.prisma, first.scan.id, {
      ruleId: 'SEO-TECH-006',
      fingerprint: 'fluxradar-fp-v1:broken-link',
      normalizedUrl: HOME_URL,
      normalizedResource: gone,
      evidenceType: 'http',
    });
    await seedModuleCoverage(
      db.prisma,
      first.scan.id,
      'SEO',
      [
        {
          ruleId: 'SEO-TECH-006',
          checkedTargets: [HOME_URL],
          inputTargets: [HOME_URL, gone],
          requestedInputs: [HOME_URL, gone],
        },
      ],
      new Map([['fluxradar-fp-v1:broken-link', [gone]]]),
    );

    // The link is still on the page (the target is still requested) and this run
    // got no snapshot of it: unknown, not fixed.
    const lostTarget = coverage({
      coverageByRule: checked(
        { 'SEO-TECH-006': [HOME_URL] },
        { 'SEO-TECH-006': [HOME_URL] },
        { 'SEO-TECH-006': [HOME_URL, gone] },
      ),
    });
    expect(await markResolvedAgainstPrevious(db.prisma, second.scan, lostTarget)).toBe(0);

    const sawTarget = coverage({
      coverageByRule: checked(
        { 'SEO-TECH-006': [HOME_URL] },
        { 'SEO-TECH-006': [HOME_URL, gone] },
        { 'SEO-TECH-006': [HOME_URL, gone] },
      ),
    });
    expect(await markResolvedAgainstPrevious(db.prisma, second.scan, sawTarget)).toBe(1);
  });

  it('removing the broken link itself resolves the finding it caused', async () => {
    // The fix the report recommends. The target has no snapshot in this run
    // either — but nothing on the site asks about it any more, and that is the
    // difference between "fixed" and "not checked".
    db = await createTestDb();
    const { first, second } = await seedScanPair(db);
    const gone = 'https://example.com/gone.html';
    const unrelated = 'https://example.com/old.html';
    await seedIssue(db.prisma, first.scan.id, {
      ruleId: 'SEO-TECH-006',
      fingerprint: 'fluxradar-fp-v1:broken-link',
      normalizedUrl: HOME_URL,
      normalizedResource: gone,
      evidenceType: 'http',
    });
    await seedModuleCoverage(
      db.prisma,
      first.scan.id,
      'SEO',
      [
        {
          ruleId: 'SEO-TECH-006',
          checkedTargets: [HOME_URL],
          inputTargets: [HOME_URL, gone, unrelated],
          requestedInputs: [HOME_URL, gone, unrelated],
        },
      ],
      new Map([['fluxradar-fp-v1:broken-link', [gone]]]),
    );

    // The link is gone, and so is an unrelated page — neither blocks the proof.
    const linkRemoved = coverage({
      coverageByRule: checked(
        { 'SEO-TECH-006': [HOME_URL] },
        { 'SEO-TECH-006': [HOME_URL] },
        { 'SEO-TECH-006': [HOME_URL] },
      ),
    });
    expect(await markResolvedAgainstPrevious(db.prisma, second.scan, linkRemoved)).toBe(1);
    const resolved = await db.prisma.issue.findFirstOrThrow({ where: { scanId: first.scan.id } });
    expect(resolved.status).toBe('Resolved');
  });

  it('a mobile run does not resolve a desktop run’s finding', async () => {
    db = await createTestDb();
    const { first, second } = await seedScanPair(db);
    await seedIssue(db.prisma, first.scan.id);
    await seedPageRuleCoverage(db.prisma, first.scan.id);

    const mobile = coverage({
      coverageByRule: new Map([
        [
          PAGE_RULE,
          {
            checkedTargets: new Set([ISSUE_URL]),
            inputTargets: new Set<string>(),
            requestedInputs: null,
            context: { ...DESKTOP, userAgent: 'mobile' },
          },
        ],
      ]),
    });
    expect(await markResolvedAgainstPrevious(db.prisma, second.scan, mobile)).toBe(0);
  });

  it('an acknowledged finding that provably disappeared is resolved, and its decision carries on', async () => {
    db = await createTestDb();
    const { account, first, second } = await seedScanPair(db);
    await seedIssue(db.prisma, first.scan.id, { status: 'Acknowledged' });
    await seedPageRuleCoverage(db.prisma, first.scan.id);

    expect(await markResolvedAgainstPrevious(db.prisma, second.scan, coverage())).toBe(1);
    // §14: the row of the scan that no longer finds it becomes Resolved; the
    // owner's decision travels to the next scan's rows, not backwards.
    const resolved = await db.prisma.issue.findFirstOrThrow({ where: { scanId: first.scan.id } });
    expect(resolved.status).toBe('Resolved');

    // The same finding as seen by the newer scan, where the owner acknowledged it.
    await seedIssue(db.prisma, second.scan.id, {
      status: 'Acknowledged',
      observedAt: new Date('2026-09-03T12:01:30.000Z'),
    });
    const third = await seedScan(db.prisma, {
      account,
      plan: 'Complete',
      status: 'Pending',
      withPurchase: false,
    });
    const statuses = await initialIssueStatuses(db.prisma, third.scan, [FINGERPRINT]);
    expect(statuses.get(FINGERPRINT)).toBe('Acknowledged');
  });

  describe('site-level findings read the previous scan’s own coverage', () => {
    const SITE_FINGERPRINT = 'fluxradar-fp-v1:duplicate-urls';

    async function seedSiteIssue(prisma: PrismaClient, scanId: string): Promise<void> {
      await seedIssue(prisma, scanId, {
        ruleId: SITE_RULE,
        fingerprint: SITE_FINGERPRINT,
        targetKind: 'site',
        // D-019: a site-level finding carries no URL.
        normalizedUrl: '',
        evidenceType: 'http',
      });
    }

    it('resolves when this run read at least the pages the previous one read', async () => {
      db = await createTestDb();
      const { first, second } = await seedScanPair(db);
      await seedSiteIssue(db.prisma, first.scan.id);
      await seedModuleCoverage(db.prisma, first.scan.id, 'SEO', [
        { ruleId: SITE_RULE, checkedTargets: [HOME_URL, ISSUE_URL] },
      ]);

      const wider = coverage({
        coverageByRule: checked({
          [SITE_RULE]: [HOME_URL, ISSUE_URL, 'https://example.com/blog/post'],
        }),
      });
      expect(await markResolvedAgainstPrevious(db.prisma, second.scan, wider)).toBe(1);
    });

    it('resolves nothing when this run read fewer pages than the previous one', async () => {
      db = await createTestDb();
      const { first, second } = await seedScanPair(db);
      await seedSiteIssue(db.prisma, first.scan.id);
      await seedModuleCoverage(db.prisma, first.scan.id, 'SEO', [
        { ruleId: SITE_RULE, checkedTargets: [HOME_URL, ISSUE_URL] },
      ]);

      const narrowed = coverage({
        coverageByRule: checked({ [SITE_RULE]: [HOME_URL] }),
      });
      expect(await markResolvedAgainstPrevious(db.prisma, second.scan, narrowed)).toBe(0);
      const untouched = await db.prisma.issue.findFirstOrThrow({
        where: { scanId: first.scan.id },
      });
      expect(untouched.status).toBe('New');
    });

    it('resolves nothing when the previous scan stored no coverage at all', async () => {
      db = await createTestDb();
      const { first, second } = await seedScanPair(db);
      await seedSiteIssue(db.prisma, first.scan.id);

      const sameRun = coverage({
        coverageByRule: checked({ [SITE_RULE]: [HOME_URL, ISSUE_URL] }),
      });
      expect(await markResolvedAgainstPrevious(db.prisma, second.scan, sameRun)).toBe(0);
    });

    it('reports an unreadable proof instead of trusting it', async () => {
      db = await createTestDb();
      const { first, second } = await seedScanPair(db);
      await seedSiteIssue(db.prisma, first.scan.id);
      await db.prisma.scanModule.create({
        data: {
          scanId: first.scan.id,
          module: 'SEO',
          runtimeStatus: 'Completed',
          usableOutput: true,
          metadataJson: '{}',
        },
      });
      await db.prisma.ruleCoverageProof.create({
        data: { scanId: first.scan.id, module: 'SEO', proof: Buffer.from('not a gzipped proof') },
      });

      const problems: string[] = [];
      const resolved = await markResolvedAgainstPrevious(
        db.prisma,
        second.scan,
        coverage({ coverageByRule: checked({ [SITE_RULE]: [HOME_URL] }) }),
        { onUnreadableCoverage: ({ module, problem }) => problems.push(`${module}: ${problem}`) },
      );
      expect(resolved).toBe(0);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('SEO');
    });
  });

  describe('statuses of the rows a module is rewriting right now', () => {
    it('keeps the owner’s decision on this scan across a module retry', async () => {
      // A module retry deletes and recreates its own issue rows. A status the
      // owner set on THIS scan would be lost with them, and the retried section
      // would show a finding they had already ignored as new again.
      db = await createTestDb();
      const { second } = await seedScanPair(db);
      await seedIssue(db.prisma, second.scan.id, { status: 'Ignored' });

      const statuses = await issueStatusesForModule(db.prisma, second.scan, 'SEO', [FINGERPRINT]);
      expect(statuses.get(FINGERPRINT)).toBe('Ignored');
    });

    it('does not carry a status from another module of the same scan', async () => {
      db = await createTestDb();
      const { second } = await seedScanPair(db);
      await seedIssue(db.prisma, second.scan.id, { status: 'Ignored', module: 'Privacy' });

      const statuses = await issueStatusesForModule(db.prisma, second.scan, 'SEO', [FINGERPRINT]);
      expect(statuses.get(FINGERPRINT)).toBeUndefined();
    });

    it('a system status is recomputed rather than carried', async () => {
      // Reopened/New describe the run, not a decision: the new run decides them
      // again from the previous scans (initialIssueStatuses).
      db = await createTestDb();
      const { first, second } = await seedScanPair(db);
      await seedIssue(db.prisma, first.scan.id, { status: 'Resolved' });
      await seedIssue(db.prisma, second.scan.id, { status: 'New' });

      const statuses = await issueStatusesForModule(db.prisma, second.scan, 'SEO', [FINGERPRINT]);
      expect(statuses.get(FINGERPRINT)).toBe('Reopened');
    });
  });

  describe('storage of the proof itself', () => {
    it('reads a scan’s proof out of its own table, module by module', async () => {
      db = await createTestDb();
      const { first } = await seedScanPair(db);
      await seedModuleCoverage(db.prisma, first.scan.id, 'SEO', [
        { ruleId: PAGE_RULE, checkedTargets: [ISSUE_URL], requestedInputs: [ISSUE_URL] },
      ]);
      await seedModuleCoverage(
        db.prisma,
        first.scan.id,
        'Content Quality',
        [{ ruleId: 'CONTENT-004', checkedTargets: [HOME_URL], inputTargets: [HOME_URL] }],
        new Map([['fp-media', ['https://example.com/img/x.png']]]),
      );

      const loaded = await loadScanCoverage(db.prisma, first.scan.id);
      expect([...loaded.byRule.keys()].toSorted()).toEqual(['CONTENT-004', PAGE_RULE]);
      expect(loaded.byRule.get(PAGE_RULE)?.requestedInputs).toEqual(new Set([ISSUE_URL]));
      expect(loaded.issueDependencies.get('fp-media')).toEqual(['https://example.com/img/x.png']);
    });

    it('keeps the proofs the policy can still read and deletes the rest', async () => {
      // The policy compares a scan with exactly one predecessor, so the two most
      // recent Complete scans are everything it will ever open. Keeping more is
      // the unbounded pile this table must not become.
      db = await createTestDb();
      const { account, first, second } = await seedScanPair(db);
      const third = await seedScan(db.prisma, {
        account,
        plan: 'Complete',
        status: 'Completed',
        withPurchase: false,
      });
      for (const scanId of [first.scan.id, second.scan.id, third.scan.id]) {
        await seedModuleCoverage(db.prisma, scanId, 'SEO', [
          { ruleId: PAGE_RULE, checkedTargets: [ISSUE_URL] },
        ]);
      }

      const removed = await pruneCoverageProofs(db.prisma, third.scan);
      expect(removed).toBe(1);
      expect(await db.prisma.ruleCoverageProof.count({ where: { scanId: first.scan.id } })).toBe(0);
      expect(await db.prisma.ruleCoverageProof.count({ where: { scanId: second.scan.id } })).toBe(
        1,
      );
      expect(await db.prisma.ruleCoverageProof.count({ where: { scanId: third.scan.id } })).toBe(1);
      // The module rows and findings of the pruned scan are untouched: only the
      // internal proof expires, never the report the owner paid for.
      expect(await db.prisma.scanModule.count({ where: { scanId: first.scan.id } })).toBe(1);
    });

    it('a scan that has not completed does not occupy a slot in the history', async () => {
      // The policy looks for the previous COMPLETED Complete scan, so counting
      // every Complete scan would let two queued ones evict the only proof the
      // next comparison can read — and every fixed finding would stay New.
      db = await createTestDb();
      const { account, first, second } = await seedScanPair(db);
      for (const scanId of [first.scan.id, second.scan.id]) {
        await seedModuleCoverage(db.prisma, scanId, 'SEO', [
          { ruleId: PAGE_RULE, checkedTargets: [ISSUE_URL] },
        ]);
      }
      for (const status of ['Queued', 'Running'] as const) {
        await seedScan(db.prisma, { account, plan: 'Complete', status, withPurchase: false });
      }

      expect(await pruneCoverageProofs(db.prisma, second.scan)).toBe(0);
      expect(await db.prisma.ruleCoverageProof.count({ where: { scanId: first.scan.id } })).toBe(1);
      expect(await db.prisma.ruleCoverageProof.count({ where: { scanId: second.scan.id } })).toBe(
        1,
      );
    });

    it('never deletes the proof of the scan that has just written it', async () => {
      // Pruning runs at the end of the scan's own run. Two newer completed
      // scans (a concurrent worker) would otherwise fill the history and the
      // finishing scan would delete the proof it wrote seconds earlier.
      db = await createTestDb();
      const { account, first, second } = await seedScanPair(db);
      const newer = [
        await seedScan(db.prisma, {
          account,
          plan: 'Complete',
          status: 'Completed',
          withPurchase: false,
        }),
        await seedScan(db.prisma, {
          account,
          plan: 'Complete',
          status: 'Completed',
          withPurchase: false,
        }),
      ];
      for (const scanId of [first.scan.id, second.scan.id, ...newer.map((one) => one.scan.id)]) {
        await seedModuleCoverage(db.prisma, scanId, 'SEO', [
          { ruleId: PAGE_RULE, checkedTargets: [ISSUE_URL] },
        ]);
      }

      // Both newer scans are more recent than `second`, so only the pin keeps
      // its proof; `first` is the one that genuinely expires.
      expect(await pruneCoverageProofs(db.prisma, second.scan)).toBe(1);
      expect(await db.prisma.ruleCoverageProof.count({ where: { scanId: second.scan.id } })).toBe(
        1,
      );
      expect(await db.prisma.ruleCoverageProof.count({ where: { scanId: first.scan.id } })).toBe(0);
      for (const one of newer) {
        expect(await db.prisma.ruleCoverageProof.count({ where: { scanId: one.scan.id } })).toBe(1);
      }
    });
  });
});
