// POST /scans/:scanId/free-ai-preview end to end (D-236): a real Free check is
// launched with its AI box unticked, run to Completed, and then its owner adds
// the one AI answer from the finished report. AI providers are mocks that
// record every request reaching a transport; nothing leaves the machine. The
// failure paths live in late-free-preview-failures.test.ts.

import { describe, expect, it } from 'vitest';
import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from '@fluxradar/ai';

import { LATE_PREVIEW_STARTED_METADATA } from '../orchestrator/late-free-preview-job.ts';
import { processScan } from '../orchestrator/worker.ts';
import {
  CONSENT,
  GEO,
  useLateFreePreviewHarness,
  type TestAgent,
} from '../test-utils/late-free-preview-harness.ts';
import { describeDb, seedScan } from '../test-utils/test-db.ts';

describeDb('adding the AI answer to a finished Free report', () => {
  const h = useLateFreePreviewHarness();
  const { app, register, finishedUnconsentedFreeCheck, geoRow, workerDeps } = h;

  /** Everything the late answer must leave exactly as the check left it. */
  async function untouchedState(scanId: string, accountId: string) {
    const [scan, seo, issues, account, purchases] = await Promise.all([
      h.db().prisma.scan.findUniqueOrThrow({ where: { id: scanId } }),
      h.db().prisma.scanModule.findUniqueOrThrow({
        where: { scanId_module: { scanId, module: 'SEO' } },
      }),
      h.db().prisma.issue.findMany({ where: { scanId }, orderBy: { fingerprint: 'asc' } }),
      h.db().prisma.account.findUniqueOrThrow({ where: { id: accountId } }),
      h.db().prisma.purchase.count({ where: { accountId } }),
    ]);
    return {
      scan: {
        status: scan.status,
        statusReason: scan.statusReason,
        completedAt: scan.completedAt,
        crawlSummaryJson: scan.crawlSummaryJson,
        moduleRetryCount: scan.moduleRetryCount,
        platformRetryCount: scan.platformRetryCount,
      },
      seo,
      issues: issues.map((issue) => [issue.fingerprint, issue.status]),
      freeCheckUsedAt: account.freeCheckUsedAt,
      purchases,
      scans: await h.db().prisma.scan.count({ where: { accountId } }),
    };
  }

  it('records the consent, keeps the report readable, and runs the one question once', async () => {
    const agent = app();
    const owner = await finishedUnconsentedFreeCheck(agent);
    const before = await untouchedState(owner.scanId, owner.accountId);

    const added = await agent
      .post(`/scans/${owner.scanId}/free-ai-preview`)
      .set('Cookie', owner.cookie)
      .send(CONSENT);
    expect(added.status).toBe(202);
    expect(added.body.data).toEqual({
      scanId: owner.scanId,
      status: 'Completed',
      module: GEO,
    });
    expect(
      await h.db().prisma.aiConsent.findUniqueOrThrow({ where: { scanId: owner.scanId } }),
    ).toMatchObject({
      accountId: owner.accountId,
      providersJson: JSON.stringify(['anthropic']),
      noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
    });
    expect(
      await h.db().prisma.job.findUniqueOrThrow({ where: { scanId: owner.scanId } }),
    ).toMatchObject({ status: 'Pending', type: 'free-ai-preview' });

    // While it is queued: the report still opens, says the AI step is pending,
    // and the scan is not reported as a new, active scan.
    const dashboard = await agent
      .get(`/scans/${owner.scanId}/dashboard`)
      .set('Cookie', owner.cookie);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.scan).toMatchObject({ status: 'Completed', reportReady: true });
    expect(
      (dashboard.body.data.modules as { module: string }[]).find((row) => row.module === GEO),
    ).toMatchObject({ status: 'Pending', statusReason: null, metadata: { latePreview: true } });
    expect(
      (await agent.get(`/scans/${owner.scanId}/issues/summary`).set('Cookie', owner.cookie)).status,
    ).toBe(200);
    expect((await agent.get('/scans/active').set('Cookie', owner.cookie)).body.data).toBeNull();
    expect(h.sent()).toEqual([]);

    await processScan(workerDeps(), owner.scanId);

    // One closed-book question and one evaluation, both to Anthropic.
    expect(h.sent().map((aiRequest) => aiRequest.provider)).toEqual(['anthropic', 'anthropic']);
    expect(await geoRow(owner.scanId)).toMatchObject({
      runtimeStatus: 'Completed',
      usableOutput: true,
      score: null,
    });
    expect(await h.db().prisma.aiResponseRecord.count({ where: { scanId: owner.scanId } })).toBe(2);
    expect(
      await h.db().prisma.job.findUniqueOrThrow({ where: { scanId: owner.scanId } }),
    ).toMatchObject({ status: 'Done' });
    expect(await untouchedState(owner.scanId, owner.accountId)).toEqual(before);
    const after = await agent.get(`/scans/${owner.scanId}/dashboard`).set('Cookie', owner.cookie);
    expect(after.body.data.geoObservations).toHaveLength(1);
    expect(after.body.data.overall.score).toBe(dashboard.body.data.overall.score);

    // Pressing again, or another worker turn, sends nothing more.
    const again = await agent
      .post(`/scans/${owner.scanId}/free-ai-preview`)
      .set('Cookie', owner.cookie)
      .send(CONSENT);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('FREE_AI_PREVIEW_ALREADY_ADDED');
    await processScan(workerDeps(), owner.scanId);
    expect(h.sent()).toHaveLength(2);
  });

  it('honours one of two concurrent presses and asks the AI once', async () => {
    const agent = app();
    const owner = await finishedUnconsentedFreeCheck(agent);
    const post = () =>
      agent
        .post(`/scans/${owner.scanId}/free-ai-preview`)
        .set('Cookie', owner.cookie)
        .send(CONSENT);
    const answers = await Promise.all([post(), post(), post()]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([202, 409, 409]);
    for (const answer of answers.filter((candidate) => candidate.status === 409)) {
      expect(answer.body.error.code).toMatch(/^FREE_AI_PREVIEW_/);
    }
    expect(await h.db().prisma.aiConsent.count({ where: { scanId: owner.scanId } })).toBe(1);
    await Promise.all([
      processScan(workerDeps(), owner.scanId),
      processScan(workerDeps(), owner.scanId),
    ]);
    await processScan(workerDeps(), owner.scanId);
    expect(h.sent()).toHaveLength(2);
  });

  it('refuses a module retry while the late answer still holds the job', async () => {
    const agent = app();
    const owner = await finishedUnconsentedFreeCheck(agent);
    await agent
      .post(`/scans/${owner.scanId}/free-ai-preview`)
      .set('Cookie', owner.cookie)
      .send(CONSENT)
      .expect(202);
    // A Partial Free check with a retryable section, the one shape in which the
    // retry route would otherwise take the same Job row.
    await h.db().prisma.scan.update({ where: { id: owner.scanId }, data: { status: 'Partial' } });
    await h.db().prisma.scanModule.update({
      where: { scanId_module: { scanId: owner.scanId, module: 'SEO' } },
      data: { runtimeStatus: 'Unavailable' },
    });

    const retry = await agent
      .post(`/scans/${owner.scanId}/retry`)
      .set('Cookie', owner.cookie)
      .send({ module: 'SEO' });

    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('RETRY_NOT_ALLOWED');
    expect(
      await h.db().prisma.scan.findUniqueOrThrow({ where: { id: owner.scanId } }),
    ).toMatchObject({
      status: 'Partial',
      moduleRetryCount: 0,
    });
    expect(
      await h.db().prisma.job.findUniqueOrThrow({ where: { scanId: owner.scanId } }),
    ).toMatchObject({ type: 'free-ai-preview', status: 'Pending' });
  });

  it('after a crash past the provider step, the resumed job asks nothing', async () => {
    const agent = app();
    const owner = await finishedUnconsentedFreeCheck(agent);
    await agent
      .post(`/scans/${owner.scanId}/free-ai-preview`)
      .set('Cookie', owner.cookie)
      .send(CONSENT)
      .expect(202);
    // What a process that died right after its compare-and-set leaves behind:
    // exactly what startProviderStep writes (late-free-preview-state.ts).
    const queued = await geoRow(owner.scanId);
    await h.db().prisma.scanModule.update({
      where: { scanId_module: { scanId: owner.scanId, module: GEO } },
      data: {
        runtimeStatus: 'Running',
        metadataJson: JSON.stringify({
          ...(JSON.parse(queued.metadataJson) as Record<string, unknown>),
          ...LATE_PREVIEW_STARTED_METADATA,
        }),
      },
    });

    // Decided before any read: the site is not crawled again either.
    const crawled: string[] = [];
    await processScan(
      workerDeps({
        fetcher: (url) => {
          crawled.push(url);
          return Promise.reject(new Error('test: the refusal must not crawl'));
        },
      }),
      owner.scanId,
    );
    expect(crawled).toEqual([]);

    expect(h.sent()).toEqual([]);
    const refused = await geoRow(owner.scanId);
    expect(refused).toMatchObject({
      runtimeStatus: 'Not applicable',
      statusReason: 'FreePreviewAlreadyRequested',
    });
    // Rebuilt from the facts the claim kept: the readiness facts survive.
    expect(JSON.parse(refused.metadataJson)).toMatchObject({
      previewRequested: true,
      robots: expect.anything(),
      pages: expect.anything(),
    });
  });

  it('answers 404 for another account’s scan, as every scan route does', async () => {
    const owner = await finishedUnconsentedFreeCheck(app());
    // Its own agent: a shared one would also carry the owner's session cookie.
    const strangerAgent = app();
    const stranger = await register(strangerAgent, 'stranger@example.com');
    const response = await strangerAgent
      .post(`/scans/${owner.scanId}/free-ai-preview`)
      .set('Cookie', stranger.cookie)
      .send(CONSENT);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(await h.db().prisma.aiConsent.count()).toBe(0);
  });

  it('refuses an operator-allowlisted origin and records nothing', async () => {
    const owner = await finishedUnconsentedFreeCheck(app());
    const response = await app(new Set(['https://example.com']))
      .post(`/scans/${owner.scanId}/free-ai-preview`)
      .set('Cookie', owner.cookie)
      .send(CONSENT);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('FREE_AI_PREVIEW_ALLOWLISTED');
    expect(await h.db().prisma.aiConsent.count()).toBe(0);
    expect(await geoRow(owner.scanId)).toMatchObject({ statusReason: 'ConsentMissing' });
  });

  it.each([
    [{}],
    [
      {
        aiConsent: {
          providers: ['anthropic', 'openai'],
          noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
        },
      },
    ],
    [{ aiConsent: { providers: ['anthropic'], noticeVersion: 'core-ai-processing-notice-v1' } }],
    [{ ...CONSENT, extra: true }],
  ])('refuses a body that is not exactly the Free record (%o)', async (body) => {
    const agent = app();
    const owner = await finishedUnconsentedFreeCheck(agent);
    const response = await agent
      .post(`/scans/${owner.scanId}/free-ai-preview`)
      .set('Cookie', owner.cookie)
      .send(body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION');
    expect(await h.db().prisma.aiConsent.count()).toBe(0);
  });

  describe('scans that are not a finished, left-out Free check', () => {
    async function seeded(
      agent: TestAgent,
      shape: {
        readonly plan: 'Free' | 'Basic';
        readonly status: 'Completed' | 'Running';
        readonly geo: { readonly runtimeStatus: string; readonly statusReason: string | null };
        readonly consent?: boolean;
      },
    ) {
      const owner = await register(agent, `seeded-${shape.plan}-${shape.status}@example.com`);
      const profile = await h.db().prisma.siteProfile.create({
        data: { accountId: owner.accountId, name: 'Seeded', domain: 'https://seeded.example' },
      });
      const { scan } = await seedScan(h.db().prisma, {
        account: { accountId: owner.accountId, siteProfileId: profile.id, domain: profile.domain },
        status: shape.status,
        plan: shape.plan,
        withPurchase: shape.plan !== 'Free',
      });
      await h.db().prisma.job.create({
        data: {
          scanId: scan.id,
          type: 'scan',
          status: shape.status === 'Running' ? 'Claimed' : 'Done',
        },
      });
      await h.db().prisma.scanModule.create({
        data: { scanId: scan.id, module: GEO, usableOutput: false, ...shape.geo },
      });
      if (shape.consent === true) {
        await h.db().prisma.aiConsent.create({
          data: {
            accountId: owner.accountId,
            scanId: scan.id,
            providersJson: JSON.stringify(['anthropic']),
            noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
          },
        });
      }
      return agent
        .post(`/scans/${scan.id}/free-ai-preview`)
        .set('Cookie', owner.cookie)
        .send(CONSENT);
    }

    const LEFT_OUT = { runtimeStatus: 'Not applicable', statusReason: 'ConsentMissing' };

    it.each([
      [
        'a paid plan',
        { plan: 'Basic', status: 'Completed', geo: LEFT_OUT },
        'FREE_AI_PREVIEW_FREE_ONLY',
      ],
      [
        'a scan still running',
        { plan: 'Free', status: 'Running', geo: LEFT_OUT },
        'FREE_AI_PREVIEW_SCAN_NOT_FINISHED',
      ],
      [
        'a consent already on record',
        { plan: 'Free', status: 'Completed', geo: LEFT_OUT, consent: true },
        'FREE_AI_PREVIEW_ALREADY_ADDED',
      ],
      [
        'a GEO row that is not ConsentMissing',
        {
          plan: 'Free',
          status: 'Completed',
          geo: { runtimeStatus: 'Unavailable', statusReason: 'ProviderUnavailable' },
        },
        'FREE_AI_PREVIEW_NOT_SKIPPED',
      ],
    ] as const)('refuses %s with a typed 409', async (_name, shape, code) => {
      const response = await seeded(app(), shape);
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe(code);
      expect(await h.db().prisma.job.count({ where: { type: 'free-ai-preview' } })).toBe(0);
    });
  });
});
