import { signFastSpringWebhook } from './signature.ts';
import { CHECKOUT_REFERENCE_KEY } from './events.ts';

// Self-contained FastSpring payload fixtures. They mirror the shapes documented
// at developer.fastspring.com (order.completed / return.created /
// chargeback.created) so the suite needs no FastSpring account and no network.

export const TEST_FASTSPRING_SECRET = 'test-fastspring-webhook-secret';

export interface OrderOptions {
  readonly orderId: string;
  readonly reference: string | null;
  readonly productPath: string;
  readonly amount: number;
  readonly currency?: string;
  readonly live?: boolean;
  /** Put the reference only in item attributes, as a store without order tags would. */
  readonly referenceInAttributesOnly?: boolean;
  /** Omit the live flag entirely, as a store that does not send one would. */
  readonly omitLive?: boolean;
  /** Store payout currency and the order converted into it, when reported. */
  readonly payoutCurrency?: string;
  /** The CHARGED figure in the payout currency (`totalInPayoutCurrency`). */
  readonly amountInPayoutCurrency?: number;
  /** The BEFORE-TAX figure in the payout currency; defaults to the charged one. */
  readonly subtotalInPayoutCurrency?: number;
  /** Tax FastSpring calculated for this order. */
  readonly tax?: number;
  /**
   * Discount deducted from the list price, on the same tax-free basis FastSpring
   * reports `subtotal` on. `amount` stays the LIST price, exactly as
   * order.completed reports it: "Subtotal before discounts and tax".
   */
  readonly discount?: number;
  /** The discount converted into the payout currency, when the store reports it. */
  readonly discountInPayoutCurrency?: number;
  /**
   * Which side of the payload states the discount. A real store fills both; a
   * store that fills only one, or neither, must not be able to hide it.
   */
  readonly discountReporting?: 'both' | 'item' | 'order' | 'none';
  /** Drop the order-level `subtotal`, leaving only the item to state the list price. */
  readonly omitOrderSubtotal?: boolean;
  /**
   * How the store prices: true for a gross-priced store, where `amount` is what
   * the buyer pays and the tax is already inside it, false (default) for a
   * net-priced store, where the tax is added on top of `amount`.
   */
  readonly taxIncluded?: boolean;
}

/** Currency amounts are cents; the fixtures must not carry FP noise. */
function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function orderCompletedData(options: OrderOptions): Record<string, unknown> {
  const tags =
    options.reference !== null && options.referenceInAttributesOnly !== true
      ? { [CHECKOUT_REFERENCE_KEY]: options.reference }
      : {};
  const attributes =
    options.reference !== null && options.referenceInAttributesOnly === true
      ? { [CHECKOUT_REFERENCE_KEY]: options.reference }
      : {};
  // FastSpring reports `subtotal` before tax and `total` as what was charged.
  // Which of the two the catalogue price is depends on the store's pricing mode.
  const tax = options.tax ?? 0;
  const discount = options.discount ?? 0;
  const reporting = options.discountReporting ?? 'both';
  // `subtotal` is the list price before discounts and tax, and FastSpring's own
  // identity is total = subtotal - discount + tax on both pricing bases.
  const beforeTax = options.taxIncluded === true ? cents(options.amount - tax) : options.amount;
  const charged = cents(beforeTax - discount + tax);
  const chargedInPayoutCurrency = options.amountInPayoutCurrency;
  const beforeTaxInPayoutCurrency = options.subtotalInPayoutCurrency ?? chargedInPayoutCurrency;
  const orderDiscount = reporting === 'both' || reporting === 'order' ? { discount } : {};
  const itemDiscount = reporting === 'both' || reporting === 'item' ? { discount } : {};
  const payout =
    options.payoutCurrency === undefined
      ? {}
      : {
          payoutCurrency: options.payoutCurrency,
          totalInPayoutCurrency: chargedInPayoutCurrency ?? charged,
          ...(beforeTaxInPayoutCurrency === undefined
            ? {}
            : { subtotalInPayoutCurrency: beforeTaxInPayoutCurrency }),
          ...(options.discountInPayoutCurrency === undefined
            ? {}
            : { discountInPayoutCurrency: options.discountInPayoutCurrency }),
        };
  return {
    order: options.orderId,
    id: options.orderId,
    reference: 'FLX240101-1234-56789',
    ...(options.omitLive === true ? {} : { live: options.live ?? false }),
    currency: options.currency ?? 'USD',
    total: charged,
    ...(options.omitOrderSubtotal === true ? {} : { subtotal: beforeTax }),
    tax,
    ...orderDiscount,
    tags,
    account: { id: 'abCdE1FGH2Hij3KLMnOpqR' },
    customer: { first: 'Jane', last: 'Doe', email: 'jane.doe@example.com' },
    ...payout,
    items: [
      {
        product: options.productPath,
        quantity: 1,
        display: 'FluxRadar audit',
        subtotal: beforeTax,
        ...(beforeTaxInPayoutCurrency === undefined
          ? {}
          : { subtotalInPayoutCurrency: beforeTaxInPayoutCurrency }),
        ...itemDiscount,
        ...(options.discountInPayoutCurrency === undefined
          ? {}
          : { discountInPayoutCurrency: options.discountInPayoutCurrency }),
        attributes,
      },
    ],
  };
}

/**
 * `returnId` defaults to one return per order, which is what a single full return
 * looks like. Two partial returns of the same order carry two different ids, and
 * that id — not the delivery — is what makes counting them idempotent. `null`
 * omits it entirely, as a store that states no return id would.
 */
export function returnCreatedData(
  orderId: string,
  amount: number,
  currency = 'USD',
  returnId: string | null = `ret_${orderId}`,
): Record<string, unknown> {
  return {
    ...(returnId === null ? {} : { return: returnId }),
    reference: 'FLX240101-1234-56789',
    live: false,
    currency,
    totalReturn: amount,
    reason: 'Duplicate Order',
    original: { id: orderId, order: orderId, total: amount },
    items: [{ product: 'fluxradar-basic-scan', quantity: 1, refundType: 'Full Refund' }],
  };
}

export function chargebackCreatedData(orderId: string, amount: number): Record<string, unknown> {
  return {
    id: `cb_${orderId}`,
    order: orderId,
    live: false,
    reasonCode: '4837',
    reasonDescription: 'FRAUDULENT',
    chargebackAmount: amount,
    currency: 'USD',
    status: 'NEW',
  };
}

export interface EventInput {
  readonly id: string;
  readonly type: string;
  readonly data: Record<string, unknown>;
  readonly live?: boolean;
  /** Drop the envelope live flag, as an event from a store that omits it would. */
  readonly omitLive?: boolean;
}

/** Serialises a batch exactly as FastSpring posts it, plus its X-FS-Signature. */
export function signedDelivery(
  events: readonly EventInput[],
  secret = TEST_FASTSPRING_SECRET,
): { readonly rawBody: string; readonly signature: string } {
  const rawBody = JSON.stringify({
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      ...(event.omitLive === true ? {} : { live: event.live ?? false }),
      processed: false,
      created: 1767225600000,
      data: event.data,
    })),
  });
  return { rawBody, signature: signFastSpringWebhook(rawBody, secret) };
}
