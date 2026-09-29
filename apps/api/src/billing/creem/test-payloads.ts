import { CREEM_CHECKOUT_REFERENCE_KEY } from './events.ts';
import { signCreemWebhook } from './signature.ts';

// Self-contained Creem payload fixtures. They mirror the shapes documented at
// docs.creem.io (Webhooks — checkout.completed / refund.created /
// dispute.created) so the suite needs no Creem account and no network. Every
// amount is integer cents, exactly as Creem states it.

export const TEST_CREEM_SECRET = 'test-creem-webhook-secret';

export interface CheckoutCompletedOptions {
  readonly checkoutId: string;
  readonly orderId: string;
  /** Our reference, echoed by Creem as `request_id`; null omits it. */
  readonly reference: string | null;
  /** Put the reference only in the checkout metadata, not in `request_id`. */
  readonly referenceInMetadataOnly?: boolean;
  readonly productId: string;
  /** The product's list price, in cents. */
  readonly amountCents: number;
  readonly currency?: string;
  /** Tax on the order, in cents; how it is applied depends on `taxMode`. */
  readonly taxCents?: number;
  readonly taxMode?: 'inclusive' | 'exclusive';
  /** A discount off the list price, in cents; the checkout then carries a discount object. */
  readonly discountCents?: number;
  /** Creem's `mode` on every object: `test`, `sandbox`, `local` or `prod`. Omitted when null. */
  readonly mode?: string | null;
  /** Drop the order's money fields entirely, as a payload that states no amount would. */
  readonly omitAmounts?: boolean;
  /**
   * Emit the order exactly as Creem's own checkout.completed example does:
   * `amount`, `currency`, `status`, `type` and nothing else — no sub-total, no
   * tax, no amount_paid, no discount_amount, even when a discount is set.
   */
  readonly minimalOrder?: boolean;
  /** Keep sub_total / tax_amount / discount_amount but drop amount_due and amount_paid. */
  readonly omitPaidFields?: boolean;
  readonly customerEmail?: string;
}

/** The `object` of a checkout.completed event: the checkout with its order nested. */
export function checkoutCompletedObject(
  options: CheckoutCompletedOptions,
): Record<string, unknown> {
  const currency = options.currency ?? 'USD';
  const mode = options.mode === undefined ? 'test' : options.mode;
  const modeField = mode === null ? {} : { mode };
  const tax = options.taxCents ?? 0;
  const discount = options.discountCents ?? 0;
  const taxMode = options.taxMode ?? 'exclusive';
  const subTotal = options.amountCents - discount;
  // Exclusive: tax is added on top of the discounted price. Inclusive: the
  // discounted price already contains the tax.
  const amountPaid = taxMode === 'exclusive' ? subTotal + tax : subTotal;
  const money = options.omitAmounts
    ? {}
    : options.minimalOrder
      ? { amount: options.amountCents }
      : {
          amount: options.amountCents,
          sub_total: subTotal,
          tax_amount: tax,
          ...(discount > 0 ? { discount_amount: discount } : {}),
          ...(options.omitPaidFields ? {} : { amount_due: amountPaid, amount_paid: amountPaid }),
        };
  const referenceInRequestId =
    options.reference !== null && options.referenceInMetadataOnly !== true
      ? { request_id: options.reference }
      : {};
  const metadata =
    options.reference !== null && options.referenceInMetadataOnly === true
      ? { [CREEM_CHECKOUT_REFERENCE_KEY]: options.reference }
      : {};
  return {
    id: options.checkoutId,
    object: 'checkout',
    ...referenceInRequestId,
    order: {
      object: 'order',
      id: options.orderId,
      customer: 'cust_test',
      product: options.productId,
      ...money,
      currency,
      status: 'paid',
      type: 'onetime',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      ...modeField,
    },
    product: {
      id: options.productId,
      name: 'FluxRadar audit',
      description: 'FluxRadar audit',
      image_url: null,
      price: options.amountCents,
      currency,
      billing_type: 'onetime',
      status: 'active',
      tax_mode: taxMode,
      tax_category: 'saas',
      default_success_url: '',
      ...modeField,
    },
    customer: {
      id: 'cust_test',
      object: 'customer',
      email: options.customerEmail ?? 'jane.doe@example.com',
      name: 'Jane Doe',
      country: 'NL',
      ...modeField,
    },
    ...(discount > 0
      ? { discount: { id: 'dis_test', code: 'HALF', type: 'fixed', amount: discount } }
      : {}),
    custom_fields: [],
    status: 'completed',
    metadata,
    ...modeField,
  };
}

/**
 * `refundId` defaults to one refund per order, which is what a single full
 * refund looks like. Two partial refunds of the same order carry two different
 * ids, and that id — not the delivery — is what makes counting them idempotent.
 * `null` omits it entirely, as a payload that states no refund id would.
 */
export function refundCreatedObject(
  orderId: string,
  amountCents: number,
  currency = 'USD',
  refundId: string | null = `ref_${orderId}`,
  status = 'succeeded',
): Record<string, unknown> {
  return {
    ...(refundId === null ? {} : { id: refundId }),
    object: 'refund',
    status,
    refund_amount: amountCents,
    refund_currency: currency,
    reason: 'requested_by_customer',
    transaction: {
      id: `tran_${orderId}`,
      object: 'transaction',
      amount: amountCents,
      amount_paid: amountCents,
      currency,
      type: 'invoice',
      status: 'refunded',
      refunded_amount: amountCents,
      order: orderId,
      mode: 'test',
    },
    order: {
      object: 'order',
      id: orderId,
      product: 'prod_test',
      amount: amountCents,
      currency,
      status: 'paid',
      type: 'onetime',
      mode: 'test',
    },
    created_at: 1767225600000,
    mode: 'test',
  };
}

export function disputeCreatedObject(
  orderId: string,
  amountCents: number,
): Record<string, unknown> {
  return {
    id: `disp_${orderId}`,
    object: 'dispute',
    amount: amountCents,
    currency: 'USD',
    transaction: {
      id: `tran_${orderId}`,
      object: 'transaction',
      amount: amountCents,
      currency: 'USD',
      status: 'chargeback',
      order: orderId,
      mode: 'test',
    },
    order: {
      object: 'order',
      id: orderId,
      amount: amountCents,
      currency: 'USD',
      status: 'paid',
      type: 'onetime',
      mode: 'test',
    },
    created_at: 1767225600000,
    mode: 'test',
  };
}

export interface CreemEventInput {
  readonly id: string;
  readonly eventType: string;
  readonly object: Record<string, unknown>;
}

/** Serialises one event exactly as Creem posts it, plus its creem-signature. */
export function signedCreemDelivery(
  event: CreemEventInput,
  secret = TEST_CREEM_SECRET,
): { readonly rawBody: string; readonly signature: string } {
  const rawBody = JSON.stringify({
    id: event.id,
    eventType: event.eventType,
    created_at: 1767225600000,
    object: event.object,
  });
  return { rawBody, signature: signCreemWebhook(rawBody, secret) };
}
