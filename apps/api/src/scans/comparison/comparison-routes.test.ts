// GET /scans/:scanId/comparison — the endpoint, its gate, and every way it
// refuses to state a difference.
//
// The scans are bought through production code and then brought to the state a
// finished run leaves behind (test-utils/comparison-fixtures.ts), so the plan
// gate, the stored scope and the entitlement are the real ones. What each test
// asserts is the product rule: a comparison either stands behind its numbers or
// names the reason it has none.

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMPARISON_SAMPLE_LIMIT, scanComparisonSchema } from '@fluxradar/contracts';

import { createApp } from '../../index.ts';
import { silentLogger } from '../../http/logger.ts';
import {
  COMPARISON_NOW,
  allModules,
  canonicalRuleCoverage,
  crawlSummary,
  finishScan,
  pageRuleCoverage,
  rewriteScope,
} from '../../test-utils/comparison-fixtures.ts';
import { purchaseScan } from '../../test-utils/purchase-scan.ts';
import { createTestDb, type TestDb } from '../../test-utils/test-db.ts';

const SCOPE = { maxPages: 500 } as const;

describe('comparing a report with the previous scan', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  function makeApp() {
    return createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
      now: () => COMPARISON_NOW,
    });
  }

  async function signUp(app: ReturnType<typeof makeApp>, email: string) {
    const agent = request.agent(app);
    const registered = await agent
      .post('/auth/register')
      .send({ email, password: 'correct-horse-1' });
    expect(registered.status).toBe(201);
    const cookie = registered.headers['set-cookie']?.[0]?.split(';', 1)[0];
    if (cookie === undefined) throw new Error('registration did not set a session cookie');
    const profile = await agent
      .post('/profiles')
      .set('Cookie', cookie)
      .send({ name: 'Fixture Site', domain: `https://${email.split('@')[0]}.example.com` });
    expect(profile.status).toBe(201);
    return { agent, cookie, profileId: profile.body.data.id as string };
  }

  async function buy(profileId: string, plan: 'Basic' | 'Complete' | 'WebsiteAudit' = 'Complete') {
    const { scanId } = await purchaseScan(db.prisma, {
      siteProfileId: profileId,
      plan,
      scope: SCOPE,
    });
    return scanId;
  }

  async function comparison(owner: Awaited<ReturnType<typeof signUp>>, scanId: string) {
    const response = await owner.agent
      .get(`/scans/${scanId}/comparison`)
      .set('Cookie', owner.cookie);
    return response;
  }

  it('refuses the comparison on a plan that carries no finding history', async () => {
    // Basic buys no Resolved/Reopened lifecycle, so it has no previous scan to be
    // compared with either. The refusal is the same shape the export gate uses.
    const app = makeApp();
    const owner = await signUp(app, 'basic-gate@example.com');
    const scanId = await buy(owner.profileId, 'Basic');
    await finishScan(db.prisma, scanId);

    const response = await comparison(owner, scanId);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('COMPARISON_NOT_IN_PLAN');
  });

  it('answers the contract shape, and says the first report has nothing to compare', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'first-report@example.com');
    const scanId = await buy(owner.profileId);
    await finishScan(db.prisma, scanId);

    const response = await comparison(owner, scanId);

    expect(response.status).toBe(200);
    // Parsed rather than eyeballed: the route validates its own payload, and this
    // proves the client contract is what actually left the server.
    const parsed = scanComparisonSchema.parse(response.body.data);
    expect(parsed.previous).toBeNull();
    expect(parsed.comparable).toEqual({ ok: false, reason: 'no-previous-scan' });
    expect(parsed.overall.delta).toBeNull();
    expect(parsed.issues.new).toBe(0);
    expect(parsed.pages.comparable).toEqual({ ok: false, reason: 'scans-not-comparable' });
    expect(parsed.current.scope.maxPages).toBe(500);
  });

  it('names the other plan when every earlier scan of the site ran on one', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'other-plan@example.com');
    const earlier = await buy(owner.profileId, 'WebsiteAudit');
    await finishScan(db.prisma, earlier, { modules: [{ module: 'Security', score: 60 }] });
    const current = await buy(owner.profileId, 'Complete');
    await finishScan(db.prisma, current);

    const parsed = scanComparisonSchema.parse((await comparison(owner, current)).body.data);

    expect(parsed.comparable).toEqual({ ok: false, reason: 'previous-plan-differs' });
    expect(parsed.previous).toBeNull();
  });

  /** Two finished Complete scans of one site, the second compared with the first. */
  async function twoScans(
    owner: Awaited<ReturnType<typeof signUp>>,
    first: Parameters<typeof finishScan>[2] = {},
    second: Parameters<typeof finishScan>[2] = {},
  ) {
    const firstId = await buy(owner.profileId);
    await finishScan(db.prisma, firstId, first);
    const secondId = await buy(owner.profileId);
    await finishScan(db.prisma, secondId, second);
    return { firstId, secondId };
  }

  it('picks the most recent earlier scan of the same plan, skipping the unfinished ones', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'selection@example.com');
    const oldest = await buy(owner.profileId);
    await finishScan(db.prisma, oldest, { modules: allModules(10) });
    const cancelled = await buy(owner.profileId);
    await finishScan(db.prisma, cancelled, { status: 'Cancelled' });
    const middle = await buy(owner.profileId);
    await finishScan(db.prisma, middle, { modules: allModules(50) });
    const current = await buy(owner.profileId);
    await finishScan(db.prisma, current, { modules: allModules(60) });

    const parsed = scanComparisonSchema.parse((await comparison(owner, current)).body.data);

    // The middle one: later than `oldest`, and `cancelled` never finished.
    expect(parsed.previous?.id).toBe(middle);
    expect(parsed.comparable).toEqual({ ok: true });
    expect(parsed.overall.previousScore).toBe(50);
    expect(parsed.overall.currentScore).toBe(60);
    expect(parsed.overall.delta).toBe(10);
  });

  it('reports a previous scan with no usable output instead of comparing against it', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'not-usable@example.com');
    const { secondId } = await twoScans(owner, {
      modules: [{ module: 'SEO', score: null, usableOutput: false, runtimeStatus: 'Completed' }],
    });

    const parsed = scanComparisonSchema.parse((await comparison(owner, secondId)).body.data);

    expect(parsed.comparable).toEqual({ ok: false, reason: 'previous-not-usable' });
    // The previous scan is still named: the reader is being told about a specific
    // earlier report, not about a gap.
    expect(parsed.previous).not.toBeNull();
  });

  it.each([
    ['current-stopped-early', { status: 'Partial', statusReason: 'ExternalModuleFailure' }, {}],
    [
      'previous-stopped-early',
      {},
      {
        modules: [
          ...allModules(70).slice(1),
          { module: 'SEO', score: 70, runtimeStatus: 'Partial' },
        ],
      },
    ],
  ] as const)(
    'refuses to compare a run that stopped early (%s)',
    async (reason, current, previous) => {
      const app = makeApp();
      const owner = await signUp(app, `stopped-${reason}@example.com`);
      const { secondId } = await twoScans(owner, previous, current);

      const parsed = scanComparisonSchema.parse((await comparison(owner, secondId)).body.data);

      expect(parsed.comparable).toEqual({ ok: false, reason });
    },
  );

  it.each([
    ['current-crawl-truncated', {}, { summary: crawlSummary({ urlsOverLimit: 40 }) }],
    ['previous-crawl-truncated', { summary: crawlSummary({ urlsOverLimit: 40 }) }, {}],
  ] as const)(
    'refuses to compare a crawl cut short by its page limit (%s)',
    async (reason, previous, current) => {
      // A page the crawl never reached is missing, not removed, and a finding it
      // never re-checked is not fixed.
      const app = makeApp();
      const owner = await signUp(app, `truncated-${reason}@example.com`);
      const { secondId } = await twoScans(owner, previous, current);

      const parsed = scanComparisonSchema.parse((await comparison(owner, secondId)).body.data);

      expect(parsed.comparable).toEqual({ ok: false, reason });
    },
  );

  it('refuses to compare when one of the two recorded no crawl at all', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'no-crawl@example.com');
    const { secondId } = await twoScans(owner, { summary: null });

    const parsed = scanComparisonSchema.parse((await comparison(owner, secondId)).body.data);

    expect(parsed.comparable).toEqual({ ok: false, reason: 'crawl-not-recorded' });
    expect(parsed.previous?.pagesRead).toBeNull();
  });

  it('refuses to compare two crawls that were asked for different pages', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'scope-changed@example.com');
    const { firstId, secondId } = await twoScans(owner);
    // The owner narrowed the crawl between the two runs. Every address the
    // smaller crawl never reached would otherwise read as a page they removed.
    await rewriteScope(db.prisma, firstId, { maxPages: 50 });

    const parsed = scanComparisonSchema.parse((await comparison(owner, secondId)).body.data);

    expect(parsed.comparable).toEqual({ ok: false, reason: 'scope-changed' });
    expect(parsed.previous?.scope.maxPages).toBe(50);
    expect(parsed.current.scope.maxPages).toBe(500);
  });

  it('refuses to compare crawls pointed at different patterns, even at the same page limit', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'scope-patterns@example.com');
    const { firstId, secondId } = await twoScans(owner);
    await rewriteScope(db.prisma, firstId, { excludePatterns: ['/blog'] });

    const parsed = scanComparisonSchema.parse((await comparison(owner, secondId)).body.data);

    expect(parsed.comparable).toEqual({ ok: false, reason: 'scope-changed' });
    expect(parsed.previous?.scope.excludePatterns).toEqual(['/blog']);
  });

  it('counts findings as new, resolved, reopened and still open, by section and severity', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'findings@example.com');
    const { secondId } = await twoScans(
      owner,
      {
        findings: [
          { fingerprint: 'kept', severity: 'Medium' },
          // Marked Resolved by the §14 pass when the second scan finished, which
          // is the only way a row on the previous scan carries that status.
          { fingerprint: 'closed-1', severity: 'Critical', status: 'Resolved' },
          {
            fingerprint: 'closed-2',
            severity: 'Critical',
            status: 'Resolved',
            module: 'Security',
            ruleId: 'SEC-ASVS-001',
          },
          // Absent now, but this run never proved it re-checked: it stays open on
          // the previous scan and must not be counted as resolved.
          { fingerprint: 'unproven', severity: 'Low' },
        ],
      },
      {
        findings: [
          { fingerprint: 'kept', severity: 'Medium' },
          { fingerprint: 'fresh', severity: 'High' },
          { fingerprint: 'back-again', severity: 'High', status: 'Reopened' },
        ],
      },
    );

    const parsed = scanComparisonSchema.parse((await comparison(owner, secondId)).body.data);

    expect(parsed.comparable).toEqual({ ok: true });
    expect(parsed.issues.new).toBe(2);
    expect(parsed.issues.resolved).toBe(2);
    expect(parsed.issues.reopened).toBe(1);
    expect(parsed.issues.stillOpen).toBe(1);
    // Sections in the tariff table's order, not alphabetically: SEO is the first
    // section of a Complete report and reads as the first row of this table too.
    expect(parsed.issues.byModule).toEqual([
      { module: 'SEO', new: 2, resolved: 1, reopened: 1, stillOpen: 1 },
      { module: 'Security', new: 0, resolved: 1, reopened: 0, stillOpen: 0 },
    ]);
    expect(parsed.issues.bySeverity).toEqual([
      { severity: 'Critical', new: 0, resolved: 2, reopened: 0, stillOpen: 0 },
      { severity: 'High', new: 2, resolved: 0, reopened: 1, stillOpen: 0 },
      { severity: 'Medium', new: 0, resolved: 0, reopened: 0, stillOpen: 1 },
    ]);
    expect(parsed.issues.newSample.map((issue) => issue.fingerprint)).toEqual([
      'back-again',
      'fresh',
    ]);
    expect(parsed.issues.resolvedSample.map((issue) => issue.fingerprint)).toEqual([
      'closed-1',
      'closed-2',
    ]);
    expect(parsed.issues.newSample[0]).toMatchObject({ module: 'SEO', severity: 'High' });
  });

  it('never counts a finding as resolved while this scan still has it', async () => {
    // A Resolved row whose fingerprint is back can only come from data written by
    // hand or by an older release, and reporting it would tell the owner they
    // fixed something the same report lists as open.
    const app = makeApp();
    const owner = await signUp(app, 'resolved-back@example.com');
    const { secondId } = await twoScans(
      owner,
      { findings: [{ fingerprint: 'still-here', status: 'Resolved' }] },
      { findings: [{ fingerprint: 'still-here' }] },
    );

    const parsed = scanComparisonSchema.parse((await comparison(owner, secondId)).body.data);

    expect(parsed.issues.resolved).toBe(0);
    expect(parsed.issues.stillOpen).toBe(1);
  });

  it('bounds both samples at twenty, whatever the counts are', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'samples@example.com');
    const many = (prefix: string, count: number) =>
      Array.from({ length: count }, (_unused, index) => ({
        fingerprint: `${prefix}-${String(index).padStart(3, '0')}`,
      }));
    const { secondId } = await twoScans(
      owner,
      { findings: many('closed', 25).map((finding) => ({ ...finding, status: 'Resolved' })) },
      { findings: many('fresh', 30) },
    );

    const parsed = scanComparisonSchema.parse((await comparison(owner, secondId)).body.data);

    expect(parsed.issues.new).toBe(30);
    expect(parsed.issues.resolved).toBe(25);
    expect(parsed.issues.newSample).toHaveLength(COMPARISON_SAMPLE_LIMIT);
    expect(parsed.issues.resolvedSample).toHaveLength(COMPARISON_SAMPLE_LIMIT);
    // Sorted, so the sample is the same twenty on every read.
    expect(parsed.issues.newSample[0]?.fingerprint).toBe('fresh-000');
    expect(parsed.issues.resolvedSample[0]?.fingerprint).toBe('closed-000');
  });

  it('reports a module that ran in only one of the two scans as not comparable', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'module-delta@example.com');
    const { secondId } = await twoScans(
      owner,
      { modules: [{ module: 'SEO', score: 40 }] },
      {
        modules: [
          { module: 'SEO', score: 55.5 },
          { module: 'Security', score: 90 },
          {
            module: 'Analytics',
            score: null,
            usableOutput: false,
            runtimeStatus: 'Not applicable',
          },
        ],
      },
    );

    const parsed = scanComparisonSchema.parse((await comparison(owner, secondId)).body.data);

    expect(parsed.modules).toEqual([
      {
        module: 'SEO',
        previousScore: 40,
        currentScore: 55.5,
        delta: 15.5,
        comparable: { ok: true },
      },
      {
        module: 'Security',
        previousScore: null,
        currentScore: 90,
        delta: null,
        comparable: { ok: false, reason: 'module-absent-previously' },
      },
      {
        module: 'Analytics',
        previousScore: null,
        currentScore: null,
        delta: null,
        comparable: { ok: false, reason: 'module-absent-previously' },
      },
    ]);
  });

  it('compares the pages two scans read, and says which name it compared them under', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'pages@example.com');
    const site = 'https://pages.example.com';
    const { secondId } = await twoScans(
      owner,
      {
        proofs: {
          SEO: [
            pageRuleCoverage([`${site}/`, `${site}/gone`, `${site}/kept`]),
            canonicalRuleCoverage([`${site}/`, `${site}/gone`, `${site}/kept`]),
          ],
        },
      },
      {
        proofs: {
          SEO: [
            pageRuleCoverage([`${site}/`, `${site}/kept`, `${site}/new`]),
            canonicalRuleCoverage([`${site}/`, `${site}/kept`, `${site}/new`]),
          ],
        },
      },
    );

    const parsed = scanComparisonSchema.parse((await comparison(owner, secondId)).body.data);

    expect(parsed.pages.comparable).toEqual({ ok: true });
    expect(parsed.pages.identity).toBe('canonical-document');
    expect(parsed.pages).toMatchObject({ added: 1, removed: 1, kept: 2 });
    expect(parsed.pages.addedSample).toEqual([`${site}/new`]);
    expect(parsed.pages.removedSample).toEqual([`${site}/gone`]);
    expect(parsed.pages.currentTotal).toBe(3);
    expect(parsed.pages.previousTotal).toBe(3);
  });

  it('says the pages are not compared when one scan kept no page evidence', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'no-page-evidence@example.com');
    const site = 'https://no-page-evidence.example.com';
    const { secondId } = await twoScans(owner, {}, { proofs: { SEO: [pageRuleCoverage([site])] } });

    const parsed = scanComparisonSchema.parse((await comparison(owner, secondId)).body.data);

    // The findings still compare — those rows are durable — and the pages say why
    // they do not, instead of reporting a site whose every page disappeared.
    expect(parsed.comparable).toEqual({ ok: true });
    expect(parsed.pages.comparable).toEqual({ ok: false, reason: 'page-evidence-missing' });
    expect(parsed.pages.added).toBe(0);
    expect(parsed.pages.removed).toBe(0);
  });

  it('does not hand one account another account’s comparison', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'owner@example.com');
    const stranger = await signUp(app, 'stranger@example.com');
    const { secondId } = await twoScans(owner);

    const response = await stranger.agent
      .get(`/scans/${secondId}/comparison`)
      .set('Cookie', stranger.cookie);

    expect(response.status).toBe(404);
  });

  it('requires a session', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'anon@example.com');
    const { secondId } = await twoScans(owner);

    const response = await request(app).get(`/scans/${secondId}/comparison`);

    expect(response.status).toBe(401);
  });
});
