import { z } from 'zod';

// Normalisation of the FastSpring webhook envelope.
//
// A single POST carries `{ "events": [ ... ] }` with one or more events, each
// `{ id, type, live, created, data }`. With webhook expansion enabled the same
// event nests full objects where the unexpanded form has bare ids, so every
// reader below accepts both shapes. Unknown fields are preserved by passthrough
// and ignored: FastSpring adds fields over time and an unexpected one must never
// turn a real payment into a rejected event.

/** Order tag / item attribute that carries our server-issued checkout reference. */
export const CHECKOUT_REFERENCE_KEY = 'fluxradarCheckoutRef';

export const FASTSPRING_EVENT_TYPES = {
  orderCompleted: 'order.completed',
  returnCreated: 'return.created',
  chargebackCreated: 'chargeback.created',
} as const;

export type FastSpringEventType =
  (typeof FASTSPRING_EVENT_TYPES)[keyof typeof FASTSPRING_EVENT_TYPES];

const stringMap = z.record(z.string(), z.string());

const rawEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  live: z.boolean().optional(),
  created: z.number().optional(),
  processed: z.boolean().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const fastSpringEnvelopeSchema = z.object({
  events: z.array(rawEventSchema).min(1),
});

export type RawFastSpringEvent = z.infer<typeof rawEventSchema>;

/**
 * FastSpring always posts `{ events: [...] }`. A manual replay of a single event
 * object is accepted too, so re-delivering a captured payload by hand still
 * exercises the production path.
 */
export function parseEnvelope(body: unknown): readonly RawFastSpringEvent[] | null {
  const envelope = fastSpringEnvelopeSchema.safeParse(body);
  if (envelope.success) {
    return envelope.data.events;
  }
  const single = rawEventSchema.safeParse(body);
  return single.success ? [single.data] : null;
}

export interface FastSpringOrderItem {
  readonly productPath: string;
  readonly quantity: number;
  /** FastSpring's `items.subtotal`: the line BEFORE discounts and tax. */
  readonly subtotal: number | null;
  /** Item subtotal expressed in the store's payout currency, when reported. */
  readonly subtotalInPayoutCurrency: number | null;
  /** `items.discount`: "Total discount applied to the item", same tax basis. */
  readonly discount: number | null;
  readonly discountInPayoutCurrency: number | null;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface OrderCompletedEvent {
  readonly kind: typeof FASTSPRING_EVENT_TYPES.orderCompleted;
  readonly orderId: string;
  readonly reference: string | null;
  /** Currency the buyer was charged in; FastSpring localises it per country. */
  readonly currency: string;
  /** What the buyer was charged, tax included (`subtotal` - `discount` + `tax`). */
  readonly total: number;
  /**
   * FastSpring's `subtotal`: "Subtotal before discounts and tax". Both halves of
   * that sentence matter. It is the LIST price of the order, so a discounted
   * order reports the undiscounted figure here and only `discount` and `total`
   * reveal what was actually paid; and it is stated before tax, so in a
   * gross-priced store it is smaller than what the buyer was charged while in a
   * net-priced store it is the price the tax was added to (developer.fastspring
   * .com — order.completed pricing fields, and "Gross and net pricing modes").
   */
  readonly subtotal: number | null;
  /**
   * `discount`: "Total discount applied", stated on the same tax-free basis as
   * `subtotal`. What the buyer paid before tax is therefore `subtotal -
   * discount`, and FastSpring's own identity across both pricing modes is
   * `total = subtotal - discount + tax`.
   */
  readonly discount: number | null;
  /** `tax`: what the order was taxed, in the currency the buyer was charged. */
  readonly tax: number | null;
  /**
   * Currency the store is paid out in, and the order converted into it. When the
   * payout currency is USD these are the only cross-currency figures that let the
   * amount be checked against the USD tariff. `total*` includes tax, `subtotal*`
   * does not — see the tax note on `subtotal` above.
   */
  readonly payoutCurrency: string | null;
  readonly totalInPayoutCurrency: number | null;
  readonly subtotalInPayoutCurrency: number | null;
  readonly discountInPayoutCurrency: number | null;
  readonly items: readonly FastSpringOrderItem[];
  readonly tags: Readonly<Record<string, string>>;
}

export interface ReturnCreatedEvent {
  readonly kind: typeof FASTSPRING_EVENT_TYPES.returnCreated;
  readonly returnId: string | null;
  readonly originalOrderId: string | null;
  readonly currency: string | null;
  readonly totalReturn: number | null;
  readonly payoutCurrency: string | null;
  readonly totalReturnInPayoutCurrency: number | null;
  readonly reason: string | null;
}

export interface ChargebackCreatedEvent {
  readonly kind: typeof FASTSPRING_EVENT_TYPES.chargebackCreated;
  readonly chargebackId: string | null;
  readonly orderId: string | null;
  readonly currency: string | null;
  readonly amount: number | null;
}

export type NormalizedFastSpringEvent =
  OrderCompletedEvent | ReturnCreatedEvent | ChargebackCreatedEvent;

export type NormalizationResult =
  | { readonly ok: true; readonly event: NormalizedFastSpringEvent }
  | { readonly ok: false; readonly reason: string };

export function normalizeEvent(raw: RawFastSpringEvent): NormalizationResult {
  const data = raw.data ?? {};
  switch (raw.type) {
    case FASTSPRING_EVENT_TYPES.orderCompleted:
      return normalizeOrderCompleted(data);
    case FASTSPRING_EVENT_TYPES.returnCreated:
      return { ok: true, event: normalizeReturnCreated(data) };
    case FASTSPRING_EVENT_TYPES.chargebackCreated:
      return { ok: true, event: normalizeChargebackCreated(data) };
    default:
      return { ok: false, reason: `unsupported event type ${raw.type}` };
  }
}

/**
 * Which FastSpring mode produced the event, or null when neither the envelope
 * nor the data object states one. The envelope value wins.
 *
 * Null is deliberately NOT collapsed to false: a live deployment that treated an
 * unflagged event as test-mode would silently ignore an order the buyer has
 * already paid for. The caller resolves the missing flag from the checkout
 * session it can find instead (see the webhook handler).
 */
export function readEventLiveFlag(raw: RawFastSpringEvent): boolean | null {
  if (typeof raw.live === 'boolean') {
    return raw.live;
  }
  const dataLive = (raw.data ?? {})['live'];
  return typeof dataLive === 'boolean' ? dataLive : null;
}

/** Order id an event points at, used to link refunds/chargebacks to a purchase. */
export function orderIdOf(event: NormalizedFastSpringEvent): string | null {
  if (event.kind === FASTSPRING_EVENT_TYPES.orderCompleted) return event.orderId;
  if (event.kind === FASTSPRING_EVENT_TYPES.returnCreated) return event.originalOrderId;
  return event.orderId;
}

/**
 * The checkout reference is written as an order tag when the session is created.
 * Item attributes carry the same value so the link survives a store that does
 * not return order tags on the webhook.
 */
export function readCheckoutReference(event: OrderCompletedEvent): string | null {
  const fromTags = event.tags[CHECKOUT_REFERENCE_KEY];
  if (typeof fromTags === 'string' && fromTags !== '') {
    return fromTags;
  }
  for (const item of event.items) {
    const fromAttributes = item.attributes[CHECKOUT_REFERENCE_KEY];
    if (typeof fromAttributes === 'string' && fromAttributes !== '') {
      return fromAttributes;
    }
  }
  return null;
}

function normalizeOrderCompleted(data: Record<string, unknown>): NormalizationResult {
  const orderId = readString(data['order']) ?? readString(data['id']);
  if (orderId === null) {
    return { ok: false, reason: 'order.completed payload has no order id' };
  }
  const currency = readString(data['currency']);
  if (currency === null) {
    return { ok: false, reason: 'order.completed payload has no currency' };
  }
  const total = readNumber(data['total']);
  if (total === null) {
    return { ok: false, reason: 'order.completed payload has no total' };
  }
  const items = readItems(data['items']);
  if (items.length === 0) {
    return { ok: false, reason: 'order.completed payload has no items' };
  }
  return {
    ok: true,
    event: {
      kind: FASTSPRING_EVENT_TYPES.orderCompleted,
      orderId,
      reference: readString(data['reference']),
      currency,
      total,
      subtotal: readNumber(data['subtotal']),
      discount: readNumber(data['discount']),
      tax: readNumber(data['tax']),
      payoutCurrency: readString(data['payoutCurrency']),
      totalInPayoutCurrency: readNumber(data['totalInPayoutCurrency']),
      subtotalInPayoutCurrency: readNumber(data['subtotalInPayoutCurrency']),
      discountInPayoutCurrency: readNumber(data['discountInPayoutCurrency']),
      items,
      // With expansion enabled the order can arrive nested under `order`.
      tags: { ...readStringMap(nested(data, 'order')?.['tags']), ...readStringMap(data['tags']) },
    },
  };
}

function normalizeReturnCreated(data: Record<string, unknown>): ReturnCreatedEvent {
  const original = nested(data, 'original');
  return {
    kind: FASTSPRING_EVENT_TYPES.returnCreated,
    returnId: readString(data['return']) ?? readString(data['id']),
    originalOrderId:
      readString(original?.['id']) ??
      readString(original?.['order']) ??
      readString(data['order']) ??
      readIdOf(data['order']),
    currency: readString(data['currency']),
    totalReturn: readNumber(data['totalReturn']) ?? readNumber(data['totalRefund']),
    payoutCurrency: readString(data['payoutCurrency']),
    totalReturnInPayoutCurrency:
      readNumber(data['totalReturnInPayoutCurrency']) ??
      readNumber(data['totalRefundInPayoutCurrency']),
    reason: readString(data['reason']),
  };
}

function normalizeChargebackCreated(data: Record<string, unknown>): ChargebackCreatedEvent {
  return {
    kind: FASTSPRING_EVENT_TYPES.chargebackCreated,
    chargebackId: readString(data['id']),
    orderId: readString(data['order']) ?? readIdOf(data['order']),
    currency: readString(data['currency']),
    amount: readNumber(data['chargebackAmount']) ?? readNumber(data['total']),
  };
}

function readItems(value: unknown): readonly FastSpringOrderItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): FastSpringOrderItem[] => {
    if (!isRecord(entry)) {
      return [];
    }
    // Unexpanded: "product": "path". Expanded: "product": { "product": "path", ... }.
    const productPath = readString(entry['product']) ?? readProductPath(entry['product']);
    if (productPath === null) {
      return [];
    }
    return [
      {
        productPath,
        quantity: readNumber(entry['quantity']) ?? 1,
        subtotal: readNumber(entry['subtotal']),
        subtotalInPayoutCurrency: readNumber(entry['subtotalInPayoutCurrency']),
        discount: readNumber(entry['discount']),
        discountInPayoutCurrency: readNumber(entry['discountInPayoutCurrency']),
        attributes: {
          ...readStringMap(nested(entry, 'product')?.['attributes']),
          ...readStringMap(entry['attributes']),
        },
      },
    ];
  });
}

function readProductPath(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  return readString(value['product']) ?? readString(value['path']) ?? readString(value['id']);
}

/** Expansion turns an id string into an object; both forms resolve to the id. */
function readIdOf(value: unknown): string | null {
  return isRecord(value) ? (readString(value['id']) ?? readString(value['order'])) : null;
}

function nested(data: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = data[key];
  return isRecord(value) ? value : null;
}

function readStringMap(value: unknown): Readonly<Record<string, string>> {
  const parsed = stringMap.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
