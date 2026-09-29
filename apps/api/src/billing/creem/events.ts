import { z } from 'zod';

import { CREEM_LIVE_MODE } from './client.ts';

// Normalisation of the Creem webhook envelope.
//
// One POST carries ONE event, `{ id, eventType, created_at, object }`, and the
// object is the entity the event is about: the checkout for checkout.completed
// (with its order, product and customer nested), the refund for refund.created,
// the dispute for dispute.created (docs.creem.io — Webhooks, "Event Types").
// Unknown fields are ignored: Creem adds fields over time and an unexpected one
// must never turn a real payment into a rejected event. Where a field has both
// an expanded (object) and a bare (id string) spelling, both are read.
//
// MONEY IS IN CENTS. Every Creem amount is an integer minor unit — 5500 is
// $55.00 — and is left that way here. `order-amount.ts` and `refund-line.ts`
// are where cents become the dollar figures the rest of billing works in.

/** Checkout metadata key that carries our server-issued checkout reference. */
export const CREEM_CHECKOUT_REFERENCE_KEY = 'fluxradarCheckoutRef';

export const CREEM_EVENT_TYPES = {
  checkoutCompleted: 'checkout.completed',
  refundCreated: 'refund.created',
  disputeCreated: 'dispute.created',
} as const;

export type CreemEventType = (typeof CREEM_EVENT_TYPES)[keyof typeof CREEM_EVENT_TYPES];

const rawEventSchema = z.object({
  id: z.string().min(1),
  eventType: z.string().min(1),
  created_at: z.number().optional(),
  object: z.record(z.string(), z.unknown()).optional(),
});

export type RawCreemEvent = z.infer<typeof rawEventSchema>;

/**
 * Creem posts one event object per delivery. A hand-replayed capture of several
 * is accepted as an array too, so re-delivering stored payloads still exercises
 * the production path.
 */
export function parseCreemEnvelope(body: unknown): readonly RawCreemEvent[] | null {
  const single = rawEventSchema.safeParse(body);
  if (single.success) {
    return [single.data];
  }
  const many = z.array(rawEventSchema).min(1).safeParse(body);
  return many.success ? many.data : null;
}

/** How the product this order sold is taxed, as the product itself states it. */
export type CreemTaxMode = 'inclusive' | 'exclusive';

export interface CreemCheckoutCompletedEvent {
  readonly kind: typeof CREEM_EVENT_TYPES.checkoutCompleted;
  readonly checkoutId: string;
  /** Our reference, as Creem echoes the `request_id` the checkout was opened with. */
  readonly requestId: string | null;
  /** The same reference from the checkout's metadata, the second carrier. */
  readonly metadataReference: string | null;
  readonly orderId: string;
  /** The order's product id, from the nested product or the order's own field. */
  readonly productId: string | null;
  /** Currency the buyer was charged in: the product's currency. */
  readonly currency: string | null;
  /** `order.amount`: the product's list price, in cents. */
  readonly amount: number | null;
  /** `order.sub_total`: the price after any discount, before tax, in cents. */
  readonly subTotal: number | null;
  /** `order.tax_amount`, in cents. */
  readonly taxAmount: number | null;
  /** `order.amount_due` / `order.amount_paid`: what the buyer was charged, in cents. */
  readonly amountDue: number | null;
  readonly amountPaid: number | null;
  readonly taxMode: CreemTaxMode | null;
  /** `order.discount_amount`: what a coupon took off the list price, in cents. */
  readonly discountAmount: number | null;
  /**
   * Whether anything on the payload says a discount was applied: a discount
   * object on the checkout, a discount id on the order, or a stated
   * `discount_amount`. The figures are read separately; this is the flag.
   */
  readonly hasDiscount: boolean;
  readonly orderStatus: string | null;
  readonly customerEmail: string | null;
}

export interface CreemRefundCreatedEvent {
  readonly kind: typeof CREEM_EVENT_TYPES.refundCreated;
  readonly refundId: string | null;
  readonly orderId: string | null;
  readonly transactionId: string | null;
  /** `refund_amount`, in cents. */
  readonly refundAmount: number | null;
  readonly refundCurrency: string | null;
  readonly status: string | null;
  readonly reason: string | null;
}

export interface CreemDisputeCreatedEvent {
  readonly kind: typeof CREEM_EVENT_TYPES.disputeCreated;
  readonly disputeId: string | null;
  readonly orderId: string | null;
  /** In cents. */
  readonly amount: number | null;
  readonly currency: string | null;
}

export type NormalizedCreemEvent =
  CreemCheckoutCompletedEvent | CreemRefundCreatedEvent | CreemDisputeCreatedEvent;

export type CreemNormalizationResult =
  | { readonly ok: true; readonly event: NormalizedCreemEvent }
  | { readonly ok: false; readonly reason: string };

export function normalizeCreemEvent(raw: RawCreemEvent): CreemNormalizationResult {
  const object = raw.object ?? {};
  switch (raw.eventType) {
    case CREEM_EVENT_TYPES.checkoutCompleted:
      return normalizeCheckoutCompleted(object);
    case CREEM_EVENT_TYPES.refundCreated:
      return { ok: true, event: normalizeRefundCreated(object) };
    case CREEM_EVENT_TYPES.disputeCreated:
      return { ok: true, event: normalizeDisputeCreated(object) };
    default:
      return { ok: false, reason: `unsupported event type ${raw.eventType}` };
  }
}

/**
 * Which Creem environment produced the event, or null when the object states
 * none. Creem marks every object with `mode`: `prod` for the live environment,
 * and `test`, `sandbox` or `local` otherwise.
 *
 * Null is deliberately NOT collapsed to false: a live deployment that treated an
 * unmarked event as test-mode would silently ignore an order the buyer has
 * already paid for. The caller resolves the missing flag from the checkout
 * session it can find instead (see the webhook handler).
 */
export function readCreemEventLiveFlag(raw: RawCreemEvent): boolean | null {
  const mode = readString((raw.object ?? {})['mode']);
  return mode === null ? null : mode === CREEM_LIVE_MODE;
}

/** Order id an event points at, used to link refunds/disputes to a purchase. */
export function creemOrderIdOf(event: NormalizedCreemEvent): string | null {
  return event.orderId;
}

/**
 * The checkout reference: the `request_id` the checkout was created with, or
 * the same value from the checkout's metadata, so the link survives a payload
 * that carries only one of the two.
 */
export function readCreemCheckoutReference(event: CreemCheckoutCompletedEvent): string | null {
  return event.requestId ?? event.metadataReference;
}

function normalizeCheckoutCompleted(object: Record<string, unknown>): CreemNormalizationResult {
  const checkoutId = readString(object['id']);
  if (checkoutId === null) {
    return { ok: false, reason: 'checkout.completed payload has no checkout id' };
  }
  const order = nested(object, 'order');
  const orderId = readString(order?.['id']) ?? readString(object['order']);
  if (orderId === null) {
    return { ok: false, reason: 'checkout.completed payload has no order id' };
  }
  const product = nested(object, 'product');
  const customer = nested(object, 'customer');
  const metadata = readStringMap(object['metadata']);
  const taxMode = readString(product?.['tax_mode']);
  const discountAmount = readInteger(order?.['discount_amount']);
  return {
    ok: true,
    event: {
      kind: CREEM_EVENT_TYPES.checkoutCompleted,
      checkoutId,
      requestId: readString(object['request_id']),
      metadataReference: readString(metadata[CREEM_CHECKOUT_REFERENCE_KEY]),
      orderId,
      productId:
        readString(product?.['id']) ??
        readString(order?.['product']) ??
        readString(object['product']),
      currency: readString(order?.['currency']) ?? readString(product?.['currency']),
      amount: readInteger(order?.['amount']),
      subTotal: readInteger(order?.['sub_total']),
      taxAmount: readInteger(order?.['tax_amount']),
      amountDue: readInteger(order?.['amount_due']),
      amountPaid: readInteger(order?.['amount_paid']),
      taxMode: taxMode === 'inclusive' || taxMode === 'exclusive' ? taxMode : null,
      discountAmount,
      hasDiscount:
        isRecord(object['discount']) ||
        readString(order?.['discount']) !== null ||
        (discountAmount !== null && discountAmount > 0),
      orderStatus: readString(order?.['status']),
      customerEmail: readString(customer?.['email']),
    },
  };
}

function normalizeRefundCreated(object: Record<string, unknown>): CreemRefundCreatedEvent {
  const order = nested(object, 'order');
  const transaction = nested(object, 'transaction');
  return {
    kind: CREEM_EVENT_TYPES.refundCreated,
    refundId: readString(object['id']),
    orderId:
      readString(order?.['id']) ??
      readString(object['order']) ??
      readString(transaction?.['order']),
    transactionId: readString(transaction?.['id']) ?? readString(object['transaction']),
    refundAmount: readInteger(object['refund_amount']),
    refundCurrency: readString(object['refund_currency']),
    status: readString(object['status']),
    reason: readString(object['reason']),
  };
}

function normalizeDisputeCreated(object: Record<string, unknown>): CreemDisputeCreatedEvent {
  const order = nested(object, 'order');
  const transaction = nested(object, 'transaction');
  return {
    kind: CREEM_EVENT_TYPES.disputeCreated,
    disputeId: readString(object['id']),
    orderId:
      readString(order?.['id']) ??
      readString(object['order']) ??
      readString(transaction?.['order']),
    amount: readInteger(object['amount']),
    currency: readString(object['currency']),
  };
}

function nested(data: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = data[key];
  return isRecord(value) ? value : null;
}

const stringMap = z.record(z.string(), z.string());

function readStringMap(value: unknown): Readonly<Record<string, string>> {
  const parsed = stringMap.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Creem money is integer cents; a fractional or non-finite figure is no figure. */
function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
