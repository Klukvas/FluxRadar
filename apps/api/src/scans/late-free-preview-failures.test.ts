// The late Free AI preview's failure paths (D-236), end to end on a database.
//
// Before its provider step a late attempt has sent nothing, so any failure
// there hands the claim back: the button returns and a later press may try
// again. After the step began, nothing is ever asked again, and the scan never
// costs more than the two Anthropic requests of one question and its check.

import { describe, expect, it } from 'vitest';
import type { CrawlFetcher } from '@fluxradar/crawler';
import type { SafeFetchResult } from '@fluxradar/safe-fetch';

import { SCAN_ACTION_LIMIT } from '../auth/rate-limit.ts';
import { deleteScanResult } from '../data-retention.ts';
import type { EgressHealth } from '../integrations/crawl-egress-health.ts';
import { LATE_PREVIEW_STARTED_METADATA } from '../orchestrator/late-free-preview-job.ts';
import { processScan } from '../orchestrator/worker.ts';
import {
  CONSENT,
  GEO,
  recordingProviders,
  useLateFreePreviewHarness,
  type Owner,
} from '../test-utils/late-free-preview-harness.ts';
import { describeDb } from '../test-utils/test-db.ts';
import type { FreeAiConsentInput } from './free-ai-consent.ts';
import { claimLateFreePreview } from './late-free-preview.ts';

function page(url: string, status: number, body: string): SafeFetchResult {
  return {
    finalUrl: url,
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body,
    redirectChain: [],
    timingMs: 2,
    truncated: false,
  };
}

/** A homepage that cannot be read now: every request answers 503. */
const unreachable: CrawlFetcher = (url) =>
  Promise.resolve(page(url, 503, '<html><body>Service unavailable</body></html>'));

/** A readable homepage that runs `during` while it is being read. */
function homepageWhile(during: () => Promise<void>): CrawlFetcher {
  let ran = false;
  return async (url) => {
    if (!ran) {
      ran = true;
      await during();
    }
    return new URL(url).pathname === '/'
      ? page(
          url,
          200,
          '<!doctype html><html lang="en"><head><title>Fixture Site</title></head>' +
            '<body><h1>Fixture Site</h1><p>We repair bicycles in Kyiv.</p></body></html>',
        )
      : page(url, 404, '<html><body>Not found</body></html>');
  };
}

/** What the paid pipeline's row says when the answer came back and its check did not. */
const EVALUATION_FAILED_STATUS = 'Partial';
const EVALUATION_FAILED_REASON = 'AnswerEvaluationUnavailable: 1 of 1 (ProviderUnavailable)';

const PROXY_DOWN: EgressHealth = {
  state: 'unreachable',
  observedIp: null,
  expectedIp: null,
  latencyMs: null,
  detail: 'test: proxy did not answer',
  checkedAt: new Date('2026-11-17T00:00:00.000Z'),
};

describeDb('a late Free AI answer that fails', () => {
  const h = useLateFreePreviewHarness();
  const { app, finishedUnconsentedFreeCheck, geoRow, press, workerDeps } = h;

  async function claimed(): Promise<{ agent: ReturnType<typeof app>; owner: Owner }> {
    const agent = app();
    const owner = await finishedUnconsentedFreeCheck(agent);
    await press(agent, owner).expect(202);
    return { agent, owner };
  }

  async function expectReleased(owner: Owner, reason: string): Promise<void> {
    const row = await geoRow(owner.scanId);
    expect(row).toMatchObject({ runtimeStatus: 'Not applicable', statusReason: 'ConsentMissing' });
    const metadata = JSON.parse(row.metadataJson) as Record<string, unknown>;
    expect(metadata.lateAttempt).toMatchObject({ started: false, reason });
    expect(metadata).toMatchObject({ freePreview: true, robots: expect.anything() });
    expect(metadata).not.toHaveProperty('previewRequested');
    const prisma = h.db().prisma;
    expect(await prisma.aiConsent.count({ where: { scanId: owner.scanId } })).toBe(0);
    expect(await prisma.job.findUniqueOrThrow({ where: { scanId: owner.scanId } })).toMatchObject({
      status: 'Done',
    });
    expect(h.sent()).toEqual([]);
  }

  /** The button works again, and that run completes with exactly two requests. */
  async function pressAgainAndComplete(agent: ReturnType<typeof app>, owner: Owner) {
    await press(agent, owner).expect(202);
    await processScan(workerDeps(), owner.scanId);
    expect(h.sent().map((aiRequest) => aiRequest.provider)).toEqual(['anthropic', 'anthropic']);
    expect(await geoRow(owner.scanId)).toMatchObject({ runtimeStatus: 'Completed' });
    expect(await h.db().prisma.aiConsent.count({ where: { scanId: owner.scanId } })).toBe(1);
  }

  describe('before anything is sent, it hands the claim back', () => {
    it('three times at most, then refuses a further press', async () => {
      const agent = app();
      const owner = await finishedUnconsentedFreeCheck(agent);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await press(agent, owner).expect(202);
        await processScan(workerDeps({ fetcher: unreachable }), owner.scanId);
        const metadata = JSON.parse((await geoRow(owner.scanId)).metadataJson) as {
          lateAttempt: unknown;
        };
        expect(metadata.lateAttempt).toMatchObject({
          count: attempt,
          remaining: 3 - attempt,
          final: attempt === 3,
        });
      }
      const refused = await press(agent, owner);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('FREE_AI_PREVIEW_ATTEMPTS_EXHAUSTED');
      expect(await h.db().prisma.aiConsent.count({ where: { scanId: owner.scanId } })).toBe(0);
      expect(h.sent()).toEqual([]);
    });

    it('the claim itself refuses a row already at the limit, inside its transaction', async () => {
      const owner = await finishedUnconsentedFreeCheck(app());
      const prisma = h.db().prisma;
      const skipped = await geoRow(owner.scanId);
      const atLimit = JSON.stringify({
        ...(JSON.parse(skipped.metadataJson) as Record<string, unknown>),
        lateAttempt: { started: false, reason: 'SiteUnreachable', count: 3, final: true },
      });
      await prisma.scanModule.update({
        where: { scanId_module: { scanId: owner.scanId, module: GEO } },
        data: { metadataJson: atLimit },
      });

      // Past the route's own check: the claim is called as a racing press would reach it.
      await expect(
        claimLateFreePreview(prisma, {
          accountId: owner.accountId,
          scanId: owner.scanId,
          consent: CONSENT.aiConsent as FreeAiConsentInput,
        }),
      ).rejects.toMatchObject({ status: 409, code: 'FREE_AI_PREVIEW_ATTEMPTS_EXHAUSTED' });

      expect(await geoRow(owner.scanId)).toMatchObject({
        runtimeStatus: 'Not applicable',
        statusReason: 'ConsentMissing',
        metadataJson: atLimit,
      });
      expect(await prisma.aiConsent.count({ where: { scanId: owner.scanId } })).toBe(0);
      expect(await prisma.job.findUniqueOrThrow({ where: { scanId: owner.scanId } })).toMatchObject(
        { status: 'Done', type: 'scan' },
      );
    });

    it('when the homepage cannot be read now', async () => {
      const { agent, owner } = await claimed();
      await processScan(workerDeps({ fetcher: unreachable }), owner.scanId);
      // A 503 to every request is how the scan's own reach check reads a denial.
      await expectReleased(owner, 'SiteDeniedAccess');
      await pressAgainAndComplete(agent, owner);
    });

    it('when the egress proxy is down', async () => {
      const { agent, owner } = await claimed();
      await processScan(
        workerDeps({ probeEgress: () => Promise.resolve(PROXY_DOWN) }),
        owner.scanId,
      );
      await expectReleased(owner, 'PlatformFailure');
      await pressAgainAndComplete(agent, owner);
    });

    it('when the platform throws', async () => {
      const { agent, owner } = await claimed();
      await processScan(
        workerDeps({ probeEgress: () => Promise.reject(new Error('test: probe crashed')) }),
        owner.scanId,
      );
      await expectReleased(owner, 'PlatformFailure');
      await pressAgainAndComplete(agent, owner);
    });
  });

  describe('after the provider step began, it never asks again', () => {
    it('records a thrown failure as unavailable and keeps the marker', async () => {
      const { agent, owner } = await claimed();
      const broken = workerDeps({
        createAiProvider: () => {
          throw new Error('test: provider factory failed');
        },
      });
      await processScan(broken, owner.scanId);

      const row = await geoRow(owner.scanId);
      expect(row).toMatchObject({ runtimeStatus: 'Unavailable', statusReason: 'PlatformFailure' });
      expect(JSON.parse(row.metadataJson)).toMatchObject({ previewRequested: true });
      const prisma = h.db().prisma;
      expect(await prisma.job.findUniqueOrThrow({ where: { scanId: owner.scanId } })).toMatchObject(
        { status: 'Done' },
      );
      expect(await prisma.aiConsent.count({ where: { scanId: owner.scanId } })).toBe(1);
      // No further run can be queued: the consent stays, so a press is refused.
      const again = await press(agent, owner);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('FREE_AI_PREVIEW_ALREADY_ADDED');
      expect(h.sent()).toEqual([]);
    });

    it('caps a run whose evaluation throws at two requests, then sends nothing', async () => {
      const { owner } = await claimed();
      let calls = 0;
      const sent = h.sent();
      const failing = workerDeps({
        createAiProvider: recordingProviders(sent, () => {
          calls += 1;
          if (calls === 2) throw new Error('test: evaluation transport failed');
        }),
      });
      await processScan(failing, owner.scanId);

      // The question, then the evaluation that failed on its way out.
      expect(sent.map((aiRequest) => aiRequest.provider)).toEqual(['anthropic', 'anthropic']);
      // Settled by the paid pipeline's own row: the answer kept, its check missing.
      const row = await geoRow(owner.scanId);
      expect(row).toMatchObject({ runtimeStatus: EVALUATION_FAILED_STATUS });
      expect(row.statusReason).toBe(EVALUATION_FAILED_REASON);
      expect(JSON.parse(row.metadataJson)).toMatchObject({ freePreview: true });
      expect(await h.db().prisma.aiConsent.count({ where: { scanId: owner.scanId } })).toBe(1);
      expect(
        await h.db().prisma.job.findUniqueOrThrow({ where: { scanId: owner.scanId } }),
      ).toMatchObject({ status: 'Done' });
    });

    it('the loser of the provider-step compare-and-set sends nothing', async () => {
      const { owner } = await claimed();
      const prisma = h.db().prisma;
      // Another attempt takes the step while this one is still reading.
      const takeStep = async (): Promise<void> => {
        await prisma.scanModule.update({
          where: { scanId_module: { scanId: owner.scanId, module: GEO } },
          data: { runtimeStatus: 'Running' },
        });
      };
      await processScan(workerDeps({ fetcher: homepageWhile(takeStep) }), owner.scanId);

      expect(h.sent()).toEqual([]);
      // The row and the job are the holder's: still Running, still Claimed.
      expect(await geoRow(owner.scanId)).toMatchObject({ runtimeStatus: 'Running' });
      expect(await prisma.job.findUniqueOrThrow({ where: { scanId: owner.scanId } })).toMatchObject(
        { status: 'Claimed' },
      );
    });

    it('a non-winner that throws leaves the holder’s row and job untouched', async () => {
      const { owner } = await claimed();
      const prisma = h.db().prisma;
      let held = '';
      // Another attempt wins the step; this one then fails before it could.
      const takeStepThenFail = async (): Promise<never> => {
        const queued = await geoRow(owner.scanId);
        held = JSON.stringify({
          ...(JSON.parse(queued.metadataJson) as Record<string, unknown>),
          ...LATE_PREVIEW_STARTED_METADATA,
        });
        await prisma.scanModule.update({
          where: { scanId_module: { scanId: owner.scanId, module: GEO } },
          data: { runtimeStatus: 'Running', metadataJson: held },
        });
        throw new Error('test: this attempt failed while another held the step');
      };
      await processScan(workerDeps({ probeEgress: takeStepThenFail }), owner.scanId);

      expect(h.sent()).toEqual([]);
      expect(await geoRow(owner.scanId)).toMatchObject({
        runtimeStatus: 'Running',
        statusReason: null,
        metadataJson: held,
      });
      expect(await prisma.job.findUniqueOrThrow({ where: { scanId: owner.scanId } })).toMatchObject(
        { status: 'Claimed' },
      );
      expect(await prisma.aiConsent.count({ where: { scanId: owner.scanId } })).toBe(1);
    });
  });

  it('a scan deleted mid-run ends quietly and asks nothing', async () => {
    const { owner } = await claimed();
    const prisma = h.db().prisma;
    const remove = async (): Promise<void> => {
      await deleteScanResult(prisma, owner.scanId);
    };
    const result = await processScan(workerDeps({ fetcher: homepageWhile(remove) }), owner.scanId);

    expect(result).toEqual({
      scanId: owner.scanId,
      status: null,
      outcome: 'Deleted',
      refundId: null,
    });
    expect(h.sent()).toEqual([]);
    expect(await prisma.scan.findUnique({ where: { id: owner.scanId } })).toBeNull();
    expect(await prisma.aiResponseRecord.count({ where: { scanId: owner.scanId } })).toBe(0);
  });

  it('is rate-limited like the other scan actions', async () => {
    const agent = app();
    const owner = await finishedUnconsentedFreeCheck(agent);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < SCAN_ACTION_LIMIT; attempt += 1) {
      statuses.push((await press(agent, owner)).status);
    }
    expect(statuses).toEqual([202, ...Array<number>(SCAN_ACTION_LIMIT - 1).fill(409)]);
    const limited = await press(agent, owner);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});
