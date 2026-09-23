// The refund outbox against a real database.
//
// Every case here is a way a refund could go out twice, go out when it should
// not, or be recorded as settled when nobody watched the money move. The
// provider is always a fake adapter: a test that reached FastSpring's
// `POST /returns` would refund a real order, and nothing in this repository is
// allowed to do that.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient, RefundRecord } from '@prisma/client';

import { silentLogger } from '../../http/logger.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedScan,
  type SeededAccount,
  type TestDb,
} from '../../test-utils/test-db.ts';
import { PURCHASE_STATUSES, REFUND_STATUSES, refundIdempotencyKey } from '../constants.ts';
import { requestRefund } from '../refund.ts';
import { FASTSPRING_PROVIDER } from '../fastspring/config.ts';
import {
  TEST_FASTSPRING_SECRET,
  orderCompletedData,
  returnCreatedData,
  signedDelivery,
} from '../fastspring/test-payloads.ts';
import { handleFastSpringWebhook } from '../fastspring/webhook-handler.ts';
import { REFUND_DISPATCH_ACK_ENV, REFUND_DISPATCH_ENV } from './config.ts';
import { dispatchPendingRefunds } from './dispatcher.ts';
import {
  notePartialProviderRefund,
  reconcileDispatchFromProviderRefund,
  resolveRefundDispatch,
} from './outbox.ts';
import type { RefundProviderAdapter, RefundSubmissionOutcome } from './provider.ts';
import { REFUND_DISPATCH_STATES } from './states.ts';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const BASIC_PRODUCT = 'fluxradar-basic-scan';
const BASIC_PRICE = 55;
const ACTIVE_ENV = {
  [REFUND_DISPATCH_ENV]: 'auto',
  [REFUND_DISPATCH_ACK_ENV]: 'fastspring',
} as const;

/** An adapter that records its calls and answers what the test told it to. */
function fakeAdapter(outcome: RefundSubmissionOutcome, provider = 'fastspring') {
  const submit = vi.fn<RefundProviderAdapter['submit']>().mockResolvedValue(outcome);
  return { adapter: { provider, submit } satisfies RefundProviderAdapter, submit };
}

const SUBMITTED: RefundSubmissionOutcome = {
  outcome: 'submitted',
  providerRefundId: 'ret_abc123',
  providerReference: 'ABC1234567-8910-11121D',
  completedByProvider: true,
  providerReasonCode: 'PRODUCT_NOT_RECEIVED',
};

describe('the refund outbox', () => {
  let db: TestDb;
  let account: SeededAccount;

  beforeEach(async () => {
    db = await createTestDb();
    account = await seedAccountWithProfile(db.prisma);
  });

  afterEach(async () => {
    await db.cleanup();
    vi.unstubAllEnvs();
  });

  /**
   * A Failed scan with a paid FastSpring purchase: the EXTERNAL_NO_USABLE_OUTPUT
   * branch of the refund policy.
   *
   * The provider is set explicitly because it is what the dispatcher matches its
   * adapter on — a purchase taken through one provider must never be refunded
   * through another's API.
   */
  async function refundableScan(provider = 'fastspring'): Promise<{ purchaseId: string }> {
    const seeded = await seedScan(db.prisma, {
      account,
      status: 'Failed',
      statusReason: 'NoUsableOutput',
    });
    if (seeded.purchase === null) throw new Error('seedScan did not create a purchase');
    await db.prisma.purchase.update({
      where: { id: seeded.purchase.id },
      data: { provider, providerTransactionId: `fs_order_${seeded.purchase.id}` },
    });
    return { purchaseId: seeded.purchase.id };
  }

  async function record(purchaseId: string): Promise<RefundRecord> {
    return (await requestRefund(db.prisma, purchaseId, 'EXTERNAL_NO_USABLE_OUTPUT')).record;
  }

  function dispatchFor(purchaseId: string) {
    return db.prisma.refundDispatch.findUniqueOrThrow({ where: { purchaseId } });
  }

  /**
   * Reconciles a settlement while another writer changes the row in between.
   *
   * The interference runs after the state has been read and before the
   * compare-and-set is issued, which is the window the webhook actually loses in
   * production — the dispatcher claiming a row it found a moment earlier.
   */
  async function reconcileWithInterference(purchaseId: string, interfere: () => Promise<void>) {
    let interfered = false;
    const racing = {
      refundDispatch: {
        findUnique: async (args: Parameters<typeof db.prisma.refundDispatch.findUnique>[0]) => {
          const row = await db.prisma.refundDispatch.findUnique(args);
          if (!interfered) {
            interfered = true;
            await interfere();
          }
          return row;
        },
        updateMany: (args: Parameters<typeof db.prisma.refundDispatch.updateMany>[0]) =>
          db.prisma.refundDispatch.updateMany(args),
      },
    } as unknown as PrismaClient;
    return reconcileDispatchFromProviderRefund(racing, {
      purchaseId,
      providerRefundId: 'ret_race',
      now: NOW,
      reason: 'provider reported the full charge returned (ret_race)',
    });
  }

  function sweep(adapters: readonly RefundProviderAdapter[], env: NodeJS.ProcessEnv) {
    return dispatchPendingRefunds({
      prisma: db.prisma,
      logger: silentLogger,
      now: () => NOW,
      adapters,
      env,
    });
  }

  describe('recording the decision', () => {
    it('leaves the refund to an operator on a deployment that never switched sending on', async () => {
      const { purchaseId } = await refundableScan();
      await record(purchaseId);

      const dispatch = await dispatchFor(purchaseId);
      expect(dispatch.state).toBe(REFUND_DISPATCH_STATES.manual);
      expect(dispatch.stateReason).toContain('provider console');
      expect(dispatch.idempotencyKey).toBe(`refund-dispatch:${purchaseId}`);
      expect(dispatch.attempts).toBe(0);
    });

    it('queues it for the dispatcher only where sending is switched on', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);

      expect((await dispatchFor(purchaseId)).state).toBe(REFUND_DISPATCH_STATES.requested);
    });

    it('records one dispatch per purchase however often the refund is re-requested', async () => {
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      await record(purchaseId);
      await record(purchaseId);

      expect(await db.prisma.refundDispatch.count({ where: { purchaseId } })).toBe(1);
      expect(await db.prisma.refundRecord.count({ where: { purchaseId } })).toBe(1);
    });

    it('does not reset a dispatch that has already gone out', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      const { adapter } = fakeAdapter(SUBMITTED);
      await sweep([adapter], { ...ACTIVE_ENV });
      expect((await dispatchFor(purchaseId)).state).toBe(REFUND_DISPATCH_STATES.submitted);

      // A later re-evaluation of the same purchase must not put it back in the queue.
      await record(purchaseId);
      expect((await dispatchFor(purchaseId)).state).toBe(REFUND_DISPATCH_STATES.submitted);
    });
  });

  describe('the sweep', () => {
    it('sends nothing at all when outbound refunds are not switched on', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      const { adapter, submit } = fakeAdapter(SUBMITTED);

      // The row is queued, and this process is on the default policy.
      const summary = await sweep([adapter], {});

      expect(summary.mode).toBe('inactive');
      expect(submit).not.toHaveBeenCalled();
      expect((await dispatchFor(purchaseId)).state).toBe(REFUND_DISPATCH_STATES.requested);
    });

    it('sends nothing when the mode is on but no adapter is wired', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);

      const summary = await sweep([], { ...ACTIVE_ENV });
      expect(summary.submitted).toBe(0);
      expect((await dispatchFor(purchaseId)).state).toBe(REFUND_DISPATCH_STATES.requested);
    });

    it('submits once, records the provider’s id, and has nothing left to do', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      const { adapter, submit } = fakeAdapter(SUBMITTED);

      const first = await sweep([adapter], { ...ACTIVE_ENV });
      const second = await sweep([adapter], { ...ACTIVE_ENV });

      expect(first.submitted).toBe(1);
      expect(second.submitted).toBe(0);
      expect(submit).toHaveBeenCalledTimes(1);
      // FluxRadar's own reason code reaches the adapter, not the provider's.
      expect(submit.mock.calls[0]?.[0]).toMatchObject({
        reasonCode: 'EXTERNAL_NO_USABLE_OUTPUT',
        idempotencyKey: `refund-dispatch:${purchaseId}`,
      });
      const dispatch = await dispatchFor(purchaseId);
      expect(dispatch).toMatchObject({
        state: REFUND_DISPATCH_STATES.submitted,
        providerRefundId: 'ret_abc123',
        providerReasonCode: 'PRODUCT_NOT_RECEIVED',
        attempts: 1,
      });
      // Accepted is not settled: the money is confirmed by the provider's webhook.
      expect(dispatch.settledAt).toBeNull();
    });

    it('never retries a submission whose answer never arrived', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      const { adapter, submit } = fakeAdapter({
        outcome: 'uncertain',
        reason: 'FastSpring could not be reached, or did not answer in time',
      });

      await sweep([adapter], { ...ACTIVE_ENV });
      await sweep([adapter], { ...ACTIVE_ENV });
      await sweep([adapter], { ...ACTIVE_ENV });

      // One call, ever. There is no idempotency key at the provider, so a second
      // attempt could refund the buyer twice.
      expect(submit).toHaveBeenCalledTimes(1);
      const dispatch = await dispatchFor(purchaseId);
      expect(dispatch.state).toBe(REFUND_DISPATCH_STATES.uncertain);
      expect(dispatch.attempts).toBe(1);
    });

    it('records an outright refusal as failed, with the provider’s reason', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      const { adapter } = fakeAdapter({
        outcome: 'refused',
        reason: 'product: Product path is not found in the original order.',
      });

      await sweep([adapter], { ...ACTIVE_ENV });

      const dispatch = await dispatchFor(purchaseId);
      expect(dispatch.state).toBe(REFUND_DISPATCH_STATES.failed);
      expect(dispatch.stateReason).toContain('Product path is not found');
    });

    it('lets only one of two concurrent sweeps submit', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      const first = fakeAdapter(SUBMITTED);
      const second = fakeAdapter(SUBMITTED);

      const [a, b] = await Promise.all([
        sweep([first.adapter], { ...ACTIVE_ENV }),
        sweep([second.adapter], { ...ACTIVE_ENV }),
      ]);

      // Exactly one submission is the property under test. The loser either loses
      // the compare-and-set (`lost`) or never sees the row at all, depending on
      // which side of the claim its own read landed — both are correct, and
      // asserting one of them would be asserting the scheduler.
      expect(first.submit.mock.calls.length + second.submit.mock.calls.length).toBe(1);
      expect(a.submitted + b.submitted).toBe(1);
      expect((await dispatchFor(purchaseId)).attempts).toBe(1);
    });

    it('hands a purchase the provider already returned part of to an operator', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      await db.prisma.providerRefund.create({
        data: {
          purchaseId,
          provider: 'fastspring',
          providerRefundId: 'ret_earlier',
          eventType: 'return.created',
          amountCharged: 27.5,
          amountUsd: 27.5,
          currency: 'USD',
        },
      });
      const { adapter, submit } = fakeAdapter(SUBMITTED);

      const summary = await sweep([adapter], { ...ACTIVE_ENV });

      // A full return on top of a partial one is either refused or a double
      // refund; the remainder has to be stated per product, by a person.
      expect(submit).not.toHaveBeenCalled();
      expect(summary.handedToOperator).toBe(1);
      const dispatch = await dispatchFor(purchaseId);
      expect(dispatch.state).toBe(REFUND_DISPATCH_STATES.manual);
      expect(dispatch.stateReason).toContain('27.5 USD');
    });

    it('does not submit against a disputed purchase', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      await db.prisma.purchase.update({
        where: { id: purchaseId },
        data: { status: PURCHASE_STATUSES.disputed },
      });
      const { adapter, submit } = fakeAdapter(SUBMITTED);

      await sweep([adapter], { ...ACTIVE_ENV });

      expect(submit).not.toHaveBeenCalled();
      expect((await dispatchFor(purchaseId)).stateReason).toContain('disputed');
    });

    it('does not submit without a provider order id to address the return to', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      const stored = await record(purchaseId);
      await db.prisma.refundRecord.update({
        where: { id: stored.id },
        data: { providerTransactionId: null },
      });
      await db.prisma.refundDispatch.update({
        where: { purchaseId },
        data: { providerOrderId: null },
      });
      const { adapter, submit } = fakeAdapter(SUBMITTED);

      await sweep([adapter], { ...ACTIVE_ENV });

      expect(submit).not.toHaveBeenCalled();
      expect((await dispatchFor(purchaseId)).stateReason).toContain('no provider order id');
    });

    it('never submits a dispatch that belongs to another provider', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan('paddle');
      await record(purchaseId);
      const { adapter, submit } = fakeAdapter(SUBMITTED);

      await sweep([adapter], { ...ACTIVE_ENV });

      expect(submit).not.toHaveBeenCalled();
      expect((await dispatchFor(purchaseId)).state).toBe(REFUND_DISPATCH_STATES.requested);
    });
  });

  describe('reconciliation with what the provider reported', () => {
    it('settles a submitted dispatch when the provider reports the full charge back', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      const { adapter } = fakeAdapter(SUBMITTED);
      await sweep([adapter], { ...ACTIVE_ENV });

      const outcome = await reconcileDispatchFromProviderRefund(db.prisma, {
        purchaseId,
        providerRefundId: 'ret_abc123',
        now: NOW,
        reason: 'provider reported the full charge returned (ret_abc123)',
      });

      expect(outcome).toEqual({ outcome: 'settled' });
      const dispatch = await dispatchFor(purchaseId);
      expect(dispatch.state).toBe(REFUND_DISPATCH_STATES.settled);
      expect(dispatch.settledAt).toEqual(NOW);
    });

    it('settles a row another writer moved between the read and the write', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);

      // The dispatcher claims the row (requested -> submitting) while the
      // webhook is between its read and its compare-and-set. The old code
      // reported "already settled" here and dropped the provider's own
      // settlement, leaving the row in `submitting` for ever.
      const moveRowMidFlight = async () => {
        await db.prisma.refundDispatch.updateMany({
          where: { purchaseId, state: REFUND_DISPATCH_STATES.requested },
          data: { state: REFUND_DISPATCH_STATES.submitting, stateReason: 'claimed mid-flight' },
        });
      };
      const outcome = await reconcileWithInterference(purchaseId, moveRowMidFlight);

      expect(outcome).toEqual({ outcome: 'settled' });
      const dispatch = await dispatchFor(purchaseId);
      expect(dispatch.state).toBe(REFUND_DISPATCH_STATES.settled);
      expect(dispatch.providerRefundId).toBe('ret_race');
    });

    it('reports an unresolved dispatch truthfully instead of calling it settled', async () => {
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      // A state no release of this code knows. It must neither throw inside the
      // webhook transaction nor be reported as a settlement that never happened.
      await db.prisma.refundDispatch.updateMany({
        where: { purchaseId },
        data: { state: 'quantum-superposition' },
      });

      const outcome = await reconcileDispatchFromProviderRefund(db.prisma, {
        purchaseId,
        providerRefundId: 'ret_unknown',
        now: NOW,
        reason: 'provider reported the full charge returned',
      });

      expect(outcome).toEqual({
        outcome: 'unresolved',
        observedState: 'quantum-superposition',
        reason: 'transition-refused',
      });
      expect((await dispatchFor(purchaseId)).state).toBe('quantum-superposition');
    });

    it('reports a partial return it could not hand over, rather than claiming it did', async () => {
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      await db.prisma.refundDispatch.updateMany({
        where: { purchaseId },
        data: { state: 'quantum-superposition' },
      });

      expect(
        await notePartialProviderRefund(db.prisma, {
          purchaseId,
          reason: 'provider returned 27.5 of 55 USD',
          now: NOW,
        }),
      ).toEqual({
        outcome: 'unresolved',
        observedState: 'quantum-superposition',
        reason: 'transition-refused',
      });
    });

    it('closes an uncertain dispatch that did reach the provider after all', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      await sweep([fakeAdapter({ outcome: 'uncertain', reason: 'timeout' }).adapter], {
        ...ACTIVE_ENV,
      });

      await reconcileDispatchFromProviderRefund(db.prisma, {
        purchaseId,
        providerRefundId: 'ret_late',
        now: NOW,
        reason: 'provider reported the full charge returned (ret_late)',
      });

      const dispatch = await dispatchFor(purchaseId);
      expect(dispatch.state).toBe(REFUND_DISPATCH_STATES.settled);
      // The id the provider reported is the first identifier this refund has.
      expect(dispatch.providerRefundId).toBe('ret_late');
    });

    it('takes a queued dispatch off the queue when the refund was issued in the console', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);

      await reconcileDispatchFromProviderRefund(db.prisma, {
        purchaseId,
        providerRefundId: 'ret_by_hand',
        now: NOW,
        reason: 'provider reported the full charge returned (ret_by_hand)',
      });

      const { adapter, submit } = fakeAdapter(SUBMITTED);
      await sweep([adapter], { ...ACTIVE_ENV });

      // The sweep must not send a second refund on top of the one a person made.
      expect(submit).not.toHaveBeenCalled();
      expect((await dispatchFor(purchaseId)).state).toBe(REFUND_DISPATCH_STATES.settled);
    });

    it('hands a partial return to an operator instead of calling it settled', async () => {
      const { purchaseId } = await refundableScan();
      await record(purchaseId);

      const outcome = await notePartialProviderRefund(db.prisma, {
        purchaseId,
        reason: 'provider returned 27.5 of 55 USD; the remainder has to be issued by hand',
        now: NOW,
      });

      expect(outcome).toEqual({ outcome: 'handed-to-operator' });
      const dispatch = await dispatchFor(purchaseId);
      expect(dispatch.state).toBe(REFUND_DISPATCH_STATES.manual);
      expect(dispatch.stateReason).toContain('27.5 of 55 USD');
      expect(dispatch.settledAt).toBeNull();
    });

    it('never moves anything out of settled', async () => {
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      await reconcileDispatchFromProviderRefund(db.prisma, {
        purchaseId,
        providerRefundId: 'ret_1',
        now: NOW,
        reason: 'settled',
      });

      expect(
        await notePartialProviderRefund(db.prisma, {
          purchaseId,
          reason: 'a later partial return',
          now: NOW,
        }),
      ).toEqual({ outcome: 'already-settled' });
      expect(
        await reconcileDispatchFromProviderRefund(db.prisma, {
          purchaseId,
          providerRefundId: 'ret_2',
          now: NOW,
          reason: 'again',
        }),
      ).toEqual({ outcome: 'already-settled' });
      const dispatch = await dispatchFor(purchaseId);
      expect(dispatch.state).toBe(REFUND_DISPATCH_STATES.settled);
      expect(dispatch.providerRefundId).toBe('ret_1');
    });

    it('does nothing for a purchase that has no dispatch row', async () => {
      expect(
        await reconcileDispatchFromProviderRefund(db.prisma, {
          purchaseId: 'purchase-that-does-not-exist',
          providerRefundId: 'ret_x',
          now: NOW,
          reason: 'none',
        }),
      ).toEqual({ outcome: 'no-dispatch' });
    });
  });

  describe('a refund decision with no submission row', () => {
    it('writes both rows in one transaction, or neither', async () => {
      const { purchaseId } = await refundableScan();
      // The dispatch write fails; the decision must not survive it, because a
      // decision nothing can send is a refund nobody will ever issue.
      const failing = {
        purchase: { findUnique: db.prisma.purchase.findUnique.bind(db.prisma.purchase) },
        refundRecord: {
          findUnique: db.prisma.refundRecord.findUnique.bind(db.prisma.refundRecord),
        },
        // A real transaction, with the outbox write replaced inside it: the
        // decision row is really written and really has to be rolled back.
        $transaction: (run: (tx: unknown) => Promise<unknown>) =>
          db.prisma.$transaction(async (tx) =>
            run({
              refundRecord: tx.refundRecord,
              refundDispatch: {
                create: () => Promise.reject(new Error('outbox write failed')),
                findUnique: tx.refundDispatch.findUnique.bind(tx.refundDispatch),
              },
            }),
          ),
      } as unknown as PrismaClient;

      await expect(requestRefund(failing, purchaseId, 'EXTERNAL_NO_USABLE_OUTPUT')).rejects.toThrow(
        'outbox write failed',
      );

      expect(await db.prisma.refundRecord.count({ where: { purchaseId } })).toBe(0);
      expect(await db.prisma.refundDispatch.count({ where: { purchaseId } })).toBe(0);
    });

    it('adopts an orphaned decision on the next sweep, as a person’s job', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      // The shape a release without an outbox left behind: a decision, no row.
      await db.prisma.refundDispatch.deleteMany({ where: { purchaseId } });
      expect(await db.prisma.refundDispatch.count({ where: { purchaseId } })).toBe(0);

      const { adapter, submit } = fakeAdapter(SUBMITTED);
      const summary = await sweep([adapter], { ...ACTIVE_ENV });

      expect(summary.adopted).toBe(1);
      const dispatch = await dispatchFor(purchaseId);
      // `manual`, never `requested`: an old decision handed to the sweep would
      // be a money write for something that may have been refunded by hand
      // years ago. Nothing was sent in this pass either.
      expect(dispatch.state).toBe(REFUND_DISPATCH_STATES.manual);
      expect(dispatch.stateReason).toContain('provider console');
      expect(submit).not.toHaveBeenCalled();
    });

    it('adopts it at most once, however often the sweep runs', async () => {
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      await db.prisma.refundDispatch.deleteMany({ where: { purchaseId } });

      const first = await sweep([], {});
      const second = await sweep([], {});

      expect(first.adopted).toBe(1);
      expect(second.adopted).toBe(0);
      expect(await db.prisma.refundDispatch.count({ where: { purchaseId } })).toBe(1);
    });

    it('brings back a dispatch row deleted after the decision was made', async () => {
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      await db.prisma.refundDispatch.deleteMany({ where: { purchaseId } });

      // Re-requesting the same refund is one of the two repair paths; the sweep
      // is the other, and neither may create a second decision.
      await record(purchaseId);

      expect(await db.prisma.refundDispatch.count({ where: { purchaseId } })).toBe(1);
      expect(await db.prisma.refundRecord.count({ where: { purchaseId } })).toBe(1);
    });
  });

  describe('the inbound webhook', () => {
    /**
     * The full FastSpring path: an order is paid, a refund is decided, and then
     * the provider's own `return.created` arrives. This is the only writer of a
     * settled dispatch, so it is worth proving through the webhook handler rather
     * than by calling the helper directly.
     */
    async function payForBasicScan(orderId: string): Promise<void> {
      const session = await db.prisma.checkoutSession.create({
        data: {
          provider: FASTSPRING_PROVIDER,
          reference: `frcs_${Math.random().toString(36).slice(2)}`,
          accountId: account.accountId,
          siteProfileId: account.siteProfileId,
          plan: 'Basic',
          productPath: BASIC_PRODUCT,
          expectedAmountUsd: BASIC_PRICE,
          quotedAmount: BASIC_PRICE,
          quotedCurrency: 'USD',
          liveMode: false,
          scopeJson: JSON.stringify({ includeSubdomains: false }),
        },
      });
      const paid = signedDelivery([
        {
          id: `evt_order_${orderId}`,
          type: 'order.completed',
          data: orderCompletedData({
            orderId,
            reference: session.reference,
            productPath: BASIC_PRODUCT,
            amount: BASIC_PRICE,
          }),
        },
      ]);
      await handleFastSpringWebhook(db.prisma, paid.rawBody, paid.signature, {
        secret: TEST_FASTSPRING_SECRET,
        expectLive: false,
        currencyPolicy: 'strict',
      });
    }

    function deliverReturn(orderId: string, amount: number, returnId: string) {
      const delivery = signedDelivery([
        {
          id: `evt_return_${returnId}`,
          type: 'return.created',
          data: returnCreatedData(orderId, amount, 'USD', returnId),
        },
      ]);
      return handleFastSpringWebhook(db.prisma, delivery.rawBody, delivery.signature, {
        secret: TEST_FASTSPRING_SECRET,
        expectLive: false,
        currencyPolicy: 'strict',
      });
    }

    async function purchaseIdFor(orderId: string): Promise<string> {
      const purchase = await db.prisma.purchase.findUniqueOrThrow({
        where: {
          provider_providerTransactionId: {
            provider: FASTSPRING_PROVIDER,
            providerTransactionId: orderId,
          },
        },
      });
      return purchase.id;
    }

    it('settles the dispatch when the provider reports the whole charge returned', async () => {
      const orderId = 'order_full_return';
      await payForBasicScan(orderId);
      const purchaseId = await purchaseIdFor(orderId);
      await requestRefund(db.prisma, purchaseId, 'LEGAL_SUPPORT');

      await deliverReturn(orderId, BASIC_PRICE, 'ret_full');

      const dispatch = await dispatchFor(purchaseId);
      expect(dispatch.state).toBe(REFUND_DISPATCH_STATES.settled);
      expect(dispatch.providerRefundId).toBe('ret_full');
    });

    it('hands the dispatch to an operator when only part of the charge came back', async () => {
      const orderId = 'order_partial_return';
      await payForBasicScan(orderId);
      const purchaseId = await purchaseIdFor(orderId);
      await requestRefund(db.prisma, purchaseId, 'LEGAL_SUPPORT');

      await deliverReturn(orderId, BASIC_PRICE / 2, 'ret_half');

      const dispatch = await dispatchFor(purchaseId);
      expect(dispatch.state).toBe(REFUND_DISPATCH_STATES.manual);
      expect(dispatch.stateReason).toContain('remainder');
      expect(dispatch.settledAt).toBeNull();
    });

    it('settles once, and a redelivery of the same return changes nothing', async () => {
      const orderId = 'order_redelivered_return';
      await payForBasicScan(orderId);
      const purchaseId = await purchaseIdFor(orderId);
      await requestRefund(db.prisma, purchaseId, 'LEGAL_SUPPORT');

      await deliverReturn(orderId, BASIC_PRICE, 'ret_once');
      const first = await dispatchFor(purchaseId);
      await deliverReturn(orderId, BASIC_PRICE, 'ret_once');
      const second = await dispatchFor(purchaseId);

      expect(second.state).toBe(REFUND_DISPATCH_STATES.settled);
      expect(second.settledAt).toEqual(first.settledAt);
    });
  });

  describe('operator resolution', () => {
    it('records who settled an uncertain dispatch, and how', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      await sweep([fakeAdapter({ outcome: 'uncertain', reason: 'timeout' }).adapter], {
        ...ACTIVE_ENV,
      });

      const moved = await resolveRefundDispatch(db.prisma, {
        purchaseId,
        resolution: 'settled',
        resolvedBy: 'operator@fluxradar.net',
        note: 'found the return in the FastSpring console',
        now: NOW,
      });

      expect(moved).toBe(true);
      const dispatch = await dispatchFor(purchaseId);
      expect(dispatch.state).toBe(REFUND_DISPATCH_STATES.settled);
      expect(dispatch.resolvedBy).toBe('operator@fluxradar.net');
      expect(dispatch.stateReason).toContain('FastSpring console');
    });

    it('can re-queue a refusal, because no money moved on one', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      await sweep([fakeAdapter({ outcome: 'refused', reason: 'bad product path' }).adapter], {
        ...ACTIVE_ENV,
      });
      expect((await dispatchFor(purchaseId)).state).toBe(REFUND_DISPATCH_STATES.failed);

      await resolveRefundDispatch(db.prisma, {
        purchaseId,
        resolution: 'requested',
        resolvedBy: 'operator@fluxradar.net',
        note: 'product path corrected in the store',
        now: NOW,
      });

      expect((await dispatchFor(purchaseId)).state).toBe(REFUND_DISPATCH_STATES.requested);
    });

    it('refuses to move an uncertain dispatch back into the queue', async () => {
      vi.stubEnv(REFUND_DISPATCH_ENV, 'auto');
      vi.stubEnv(REFUND_DISPATCH_ACK_ENV, 'fastspring');
      const { purchaseId } = await refundableScan();
      await record(purchaseId);
      await sweep([fakeAdapter({ outcome: 'uncertain', reason: 'timeout' }).adapter], {
        ...ACTIVE_ENV,
      });

      // Not an operator's call to make: whether the buyer was refunded is unknown,
      // and re-queueing is a second money write. They settle it or keep it manual.
      await expect(
        resolveRefundDispatch(db.prisma, {
          purchaseId,
          resolution: 'requested',
          resolvedBy: 'operator@fluxradar.net',
          note: 'try again',
          now: NOW,
        }),
      ).rejects.toThrow(/may not move from uncertain to requested/);
    });
  });

  it('leaves the refund record itself exactly as the policy wrote it', async () => {
    const { purchaseId } = await refundableScan();
    const stored = await record(purchaseId);

    // The outbox is a second table for a reason: the decision (§18) and the
    // submission have different lifetimes, and recording one must not touch the other.
    expect(stored.status).toBe(REFUND_STATUSES.requested);
    expect(stored.idempotencyKey).toBe(refundIdempotencyKey(purchaseId));
    const reread = await db.prisma.refundRecord.findUniqueOrThrow({ where: { purchaseId } });
    expect(reread.status).toBe(REFUND_STATUSES.requested);
    expect(reread.processedAt).toBeNull();
  });
});
