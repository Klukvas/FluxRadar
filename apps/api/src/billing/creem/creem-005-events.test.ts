import { describe, expect, it } from 'vitest';

import {
  CREEM_CHECKOUT_REFERENCE_KEY,
  CREEM_EVENT_TYPES,
  creemOrderIdOf,
  normalizeCreemEvent,
  parseCreemEnvelope,
  readCreemCheckoutReference,
  readCreemEventLiveFlag,
  type RawCreemEvent,
} from './events.ts';
import {
  checkoutCompletedObject,
  disputeCreatedObject,
  refundCreatedObject,
} from './test-payloads.ts';

// CREEM-005: payload normalisation.
//
// Creem posts one event per delivery, `{ id, eventType, created_at, object }`,
// and the object is the entity the event is about. Nested entities can be
// expanded objects or bare id strings, so the reader must accept both; the
// checkout reference travels as `request_id` AND in the metadata; every amount
// is integer cents and is left that way here.

const BASIC_PRODUCT = 'prod_basic';
const BASIC_CENTS = 5500;

function checkoutEvent(object: Record<string, unknown>, id = 'evt_checkout'): RawCreemEvent {
  return { id, eventType: CREEM_EVENT_TYPES.checkoutCompleted, created_at: 1, object };
}

describe('CREEM-005 payload normalisation', () => {
  it('parses a single event, a hand-replayed array, and nothing else', () => {
    const single = parseCreemEnvelope({
      id: 'evt_1',
      eventType: 'checkout.completed',
      created_at: 1767225600000,
      object: { id: 'ch_1' },
    });
    expect(single).toHaveLength(1);
    expect(single?.[0]?.id).toBe('evt_1');

    const batch = parseCreemEnvelope([
      { id: 'a', eventType: 'checkout.completed', object: {} },
      { id: 'b', eventType: 'refund.created' },
    ]);
    expect(batch).toHaveLength(2);
    expect(batch?.[1]?.object).toBeUndefined();

    expect(parseCreemEnvelope([])).toBeNull();
    expect(parseCreemEnvelope('nope')).toBeNull();
    expect(parseCreemEnvelope(null)).toBeNull();
    expect(parseCreemEnvelope({ hello: 'world' })).toBeNull();
    expect(parseCreemEnvelope({ id: '', eventType: 'checkout.completed' })).toBeNull();
    expect(parseCreemEnvelope({ id: 'evt', eventType: '' })).toBeNull();
    expect(parseCreemEnvelope({ id: 'evt', eventType: 'x', object: 'not-an-object' })).toBeNull();
    // One bad element spoils a replayed batch rather than being silently dropped.
    expect(parseCreemEnvelope([{ id: 'a', eventType: 'x' }, { id: 'b' }])).toBeNull();
  });

  it('reads the documented checkout.completed shape with its nested order and product', () => {
    const result = normalizeCreemEvent(
      checkoutEvent(
        checkoutCompletedObject({
          checkoutId: 'ch_doc',
          orderId: 'ord_doc',
          reference: 'frcs_doc',
          productId: BASIC_PRODUCT,
          amountCents: BASIC_CENTS,
          taxCents: 550,
          taxMode: 'exclusive',
          customerEmail: 'buyer@example.com',
        }),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.event.kind !== CREEM_EVENT_TYPES.checkoutCompleted) return;
    expect(result.event.checkoutId).toBe('ch_doc');
    expect(result.event.orderId).toBe('ord_doc');
    expect(result.event.requestId).toBe('frcs_doc');
    expect(result.event.metadataReference).toBeNull();
    expect(result.event.productId).toBe(BASIC_PRODUCT);
    expect(result.event.currency).toBe('USD');
    // Cents, untouched.
    expect(result.event.amount).toBe(5500);
    expect(result.event.subTotal).toBe(5500);
    expect(result.event.taxAmount).toBe(550);
    expect(result.event.amountDue).toBe(6050);
    expect(result.event.amountPaid).toBe(6050);
    expect(result.event.taxMode).toBe('exclusive');
    expect(result.event.hasDiscount).toBe(false);
    expect(result.event.orderStatus).toBe('paid');
    expect(result.event.customerEmail).toBe('buyer@example.com');
    expect(readCreemCheckoutReference(result.event)).toBe('frcs_doc');
    expect(creemOrderIdOf(result.event)).toBe('ord_doc');
  });

  it('reads an inclusive-tax product and a discounted checkout', () => {
    const result = normalizeCreemEvent(
      checkoutEvent(
        checkoutCompletedObject({
          checkoutId: 'ch_inc',
          orderId: 'ord_inc',
          reference: 'frcs_inc',
          productId: BASIC_PRODUCT,
          amountCents: BASIC_CENTS,
          taxCents: 530,
          taxMode: 'inclusive',
          discountCents: 500,
        }),
      ),
    );
    if (!result.ok || result.event.kind !== CREEM_EVENT_TYPES.checkoutCompleted) {
      throw new Error('expected a checkout.completed event');
    }
    expect(result.event.taxMode).toBe('inclusive');
    expect(result.event.hasDiscount).toBe(true);
    expect(result.event.subTotal).toBe(5000);
    expect(result.event.amountPaid).toBe(5000);
  });

  it('reads the order as a bare id and the product from the order when nothing is expanded', () => {
    const bare = normalizeCreemEvent(
      checkoutEvent({
        id: 'ch_bare',
        request_id: 'frcs_bare',
        order: 'ord_bare',
        product: BASIC_PRODUCT,
        customer: 'cust_bare',
        status: 'completed',
      }),
    );
    expect(bare.ok).toBe(true);
    if (!bare.ok || bare.event.kind !== CREEM_EVENT_TYPES.checkoutCompleted) return;
    expect(bare.event.orderId).toBe('ord_bare');
    expect(bare.event.productId).toBe(BASIC_PRODUCT);
    expect(bare.event.currency).toBeNull();
    expect(bare.event.amount).toBeNull();
    expect(bare.event.amountPaid).toBeNull();
    expect(bare.event.taxMode).toBeNull();
    expect(bare.event.customerEmail).toBeNull();

    const fromOrder = normalizeCreemEvent(
      checkoutEvent({
        id: 'ch_order_product',
        order: { id: 'ord_op', product: 'prod_from_order', amount: 5500, currency: 'usd' },
      }),
    );
    if (!fromOrder.ok || fromOrder.event.kind !== CREEM_EVENT_TYPES.checkoutCompleted) {
      throw new Error('expected a checkout.completed event');
    }
    expect(fromOrder.event.productId).toBe('prod_from_order');
    expect(fromOrder.event.currency).toBe('usd');
  });

  it('reports no product when neither the checkout nor the order names one', () => {
    const result = normalizeCreemEvent(
      checkoutEvent({ id: 'ch_no_product', order: { id: 'ord_np', amount: 5500 } }),
    );
    if (!result.ok || result.event.kind !== CREEM_EVENT_TYPES.checkoutCompleted) {
      throw new Error('expected a checkout.completed event');
    }
    expect(result.event.productId).toBeNull();
    // The product's currency is the fallback, never a made-up one.
    expect(result.event.currency).toBeNull();
  });

  it('finds the reference in the metadata when request_id is absent, and prefers request_id', () => {
    const metadataOnly = normalizeCreemEvent(
      checkoutEvent(
        checkoutCompletedObject({
          checkoutId: 'ch_meta',
          orderId: 'ord_meta',
          reference: 'frcs_meta',
          referenceInMetadataOnly: true,
          productId: BASIC_PRODUCT,
          amountCents: BASIC_CENTS,
        }),
      ),
    );
    if (!metadataOnly.ok || metadataOnly.event.kind !== CREEM_EVENT_TYPES.checkoutCompleted) {
      throw new Error('expected a checkout.completed event');
    }
    expect(metadataOnly.event.requestId).toBeNull();
    expect(metadataOnly.event.metadataReference).toBe('frcs_meta');
    expect(readCreemCheckoutReference(metadataOnly.event)).toBe('frcs_meta');

    const both = normalizeCreemEvent(
      checkoutEvent({
        id: 'ch_both',
        request_id: 'frcs_from_request',
        order: 'ord_both',
        metadata: { [CREEM_CHECKOUT_REFERENCE_KEY]: 'frcs_from_metadata' },
      }),
    );
    if (!both.ok || both.event.kind !== CREEM_EVENT_TYPES.checkoutCompleted) {
      throw new Error('expected a checkout.completed event');
    }
    expect(readCreemCheckoutReference(both.event)).toBe('frcs_from_request');

    const neither = normalizeCreemEvent(
      checkoutEvent({ id: 'ch_none', order: 'ord_none', metadata: { other: 'value' } }),
    );
    if (!neither.ok || neither.event.kind !== CREEM_EVENT_TYPES.checkoutCompleted) {
      throw new Error('expected a checkout.completed event');
    }
    expect(readCreemCheckoutReference(neither.event)).toBeNull();
    // Metadata that is not a flat string map carries no reference.
    const nested = normalizeCreemEvent(
      checkoutEvent({
        id: 'ch_nested',
        order: 'ord_nested',
        metadata: { [CREEM_CHECKOUT_REFERENCE_KEY]: { value: 'frcs_x' } },
      }),
    );
    if (!nested.ok || nested.event.kind !== CREEM_EVENT_TYPES.checkoutCompleted) {
      throw new Error('expected a checkout.completed event');
    }
    expect(nested.event.metadataReference).toBeNull();
  });

  it('refuses a checkout with no checkout id or no order id, and an unsupported type', () => {
    expect(normalizeCreemEvent(checkoutEvent({ order: 'ord_x' }))).toEqual({
      ok: false,
      reason: 'checkout.completed payload has no checkout id',
    });
    expect(normalizeCreemEvent(checkoutEvent({ id: 'ch_x', product: BASIC_PRODUCT }))).toEqual({
      ok: false,
      reason: 'checkout.completed payload has no order id',
    });
    expect(normalizeCreemEvent(checkoutEvent({ id: 'ch_x', order: { product: 'p' } }))).toEqual({
      ok: false,
      reason: 'checkout.completed payload has no order id',
    });
    expect(
      normalizeCreemEvent({ id: 'e', eventType: 'subscription.active', object: { id: 'sub_1' } }),
    ).toEqual({ ok: false, reason: 'unsupported event type subscription.active' });
    // An event with no object at all is read as an empty one, not a crash.
    expect(normalizeCreemEvent({ id: 'e', eventType: 'checkout.completed' }).ok).toBe(false);
  });

  // Creem money is integer cents: a fractional, negative or textual figure is no
  // figure, and a payload that states none is measured as stating none.
  it('ignores amounts that are not non-negative integers', () => {
    const result = normalizeCreemEvent(
      checkoutEvent({
        id: 'ch_amounts',
        order: {
          id: 'ord_amounts',
          amount: 55.5,
          sub_total: '5500',
          tax_amount: -1,
          amount_due: Number.NaN,
          amount_paid: 0,
        },
      }),
    );
    if (!result.ok || result.event.kind !== CREEM_EVENT_TYPES.checkoutCompleted) {
      throw new Error('expected a checkout.completed event');
    }
    expect(result.event.amount).toBeNull();
    expect(result.event.subTotal).toBeNull();
    expect(result.event.taxAmount).toBeNull();
    expect(result.event.amountDue).toBeNull();
    expect(result.event.amountPaid).toBe(0);
  });

  it('reads a refund.created with its order expanded, bare, or only on the transaction', () => {
    const documented = normalizeCreemEvent({
      id: 'evt_refund',
      eventType: CREEM_EVENT_TYPES.refundCreated,
      object: refundCreatedObject('ord_ref', 2750, 'USD', 'ref_1', 'succeeded'),
    });
    expect(documented.ok).toBe(true);
    if (!documented.ok || documented.event.kind !== CREEM_EVENT_TYPES.refundCreated) return;
    expect(documented.event.refundId).toBe('ref_1');
    expect(documented.event.orderId).toBe('ord_ref');
    expect(documented.event.transactionId).toBe('tran_ord_ref');
    expect(documented.event.refundAmount).toBe(2750);
    expect(documented.event.refundCurrency).toBe('USD');
    expect(documented.event.status).toBe('succeeded');
    expect(documented.event.reason).toBe('requested_by_customer');

    const bare = normalizeCreemEvent({
      id: 'evt_refund_bare',
      eventType: CREEM_EVENT_TYPES.refundCreated,
      object: { id: 'ref_bare', order: 'ord_bare', transaction: 'tran_bare', refund_amount: 5500 },
    });
    if (!bare.ok || bare.event.kind !== CREEM_EVENT_TYPES.refundCreated) {
      throw new Error('expected a refund.created event');
    }
    expect(bare.event.orderId).toBe('ord_bare');
    expect(bare.event.transactionId).toBe('tran_bare');
    expect(bare.event.refundCurrency).toBeNull();
    expect(bare.event.status).toBeNull();

    const viaTransaction = normalizeCreemEvent({
      id: 'evt_refund_tx',
      eventType: CREEM_EVENT_TYPES.refundCreated,
      object: { transaction: { id: 'tran_x', order: 'ord_via_tx' }, refund_amount: 5500 },
    });
    if (!viaTransaction.ok || viaTransaction.event.kind !== CREEM_EVENT_TYPES.refundCreated) {
      throw new Error('expected a refund.created event');
    }
    expect(viaTransaction.event.refundId).toBeNull();
    expect(viaTransaction.event.orderId).toBe('ord_via_tx');

    // A refund naming no order at all still normalises; the handler decides.
    const orphan = normalizeCreemEvent({
      id: 'evt_refund_orphan',
      eventType: CREEM_EVENT_TYPES.refundCreated,
      object: { id: 'ref_orphan', refund_amount: 5500 },
    });
    expect(
      orphan.ok && orphan.event.kind === CREEM_EVENT_TYPES.refundCreated && orphan.event.orderId,
    ).toBeNull();
  });

  it('reads a dispute.created and finds the order of the disputed charge', () => {
    const documented = normalizeCreemEvent({
      id: 'evt_dispute',
      eventType: CREEM_EVENT_TYPES.disputeCreated,
      object: disputeCreatedObject('ord_disp', 5500),
    });
    expect(documented.ok).toBe(true);
    if (!documented.ok || documented.event.kind !== CREEM_EVENT_TYPES.disputeCreated) return;
    expect(documented.event.disputeId).toBe('disp_ord_disp');
    expect(documented.event.orderId).toBe('ord_disp');
    expect(documented.event.amount).toBe(5500);
    expect(documented.event.currency).toBe('USD');

    const viaTransaction = normalizeCreemEvent({
      id: 'evt_dispute_tx',
      eventType: CREEM_EVENT_TYPES.disputeCreated,
      object: { id: 'disp_tx', transaction: { order: 'ord_tx_only' }, amount: 5500 },
    });
    expect(
      viaTransaction.ok &&
        viaTransaction.event.kind === CREEM_EVENT_TYPES.disputeCreated &&
        viaTransaction.event.orderId,
    ).toBe('ord_tx_only');
  });

  it('takes the live flag from the object mode and reports an unmarked event as unknown', () => {
    const withMode = (mode: string | null) =>
      readCreemEventLiveFlag(
        checkoutEvent(
          checkoutCompletedObject({
            checkoutId: 'ch_mode',
            orderId: 'ord_mode',
            reference: 'frcs_mode',
            productId: BASIC_PRODUCT,
            amountCents: BASIC_CENTS,
            mode,
          }),
        ),
      );
    expect(withMode('prod')).toBe(true);
    expect(withMode('test')).toBe(false);
    expect(withMode('sandbox')).toBe(false);
    expect(withMode('local')).toBe(false);
    // No mode is "unknown", never "test mode": collapsing it to false would make
    // a live deployment silently ignore a paid order.
    expect(withMode(null)).toBeNull();
    expect(readCreemEventLiveFlag({ id: 'e', eventType: 'checkout.completed' })).toBeNull();
    expect(
      readCreemEventLiveFlag({ id: 'e', eventType: 'checkout.completed', object: { mode: '' } }),
    ).toBeNull();
    // Only the object's own mode counts, not a nested entity's.
    expect(
      readCreemEventLiveFlag({
        id: 'e',
        eventType: 'refund.created',
        object: { order: { mode: 'prod' } },
      }),
    ).toBeNull();
  });
});
