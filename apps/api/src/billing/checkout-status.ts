import type { PrismaClient } from '@prisma/client';

import { checkoutReasonCode, type CheckoutReasonCode } from './checkout-status-reason.ts';
import { BillingNotFoundError } from './errors.ts';

// Payment progress the buyer may poll while the provider webhook is in flight.
//
// Provider-neutral on purpose: a CheckoutSession row is read by its reference
// and by the account that opened it, and the answer is the same whichever
// provider the row was opened with. Access appears here only once the signed
// provider webhook has been processed — never because the browser said so.

export interface CheckoutStatusView {
  readonly reference: string;
  readonly plan: string;
  /** 'created' — no confirmed payment yet; 'completed' — webhook granted access. */
  readonly status: string;
  /**
   * Why a rejected checkout produced nothing, as a closed code the UI localises.
   * The internal reason stays in the database for support — see
   * `billing/checkout-status-reason.ts`.
   */
  readonly reasonCode: CheckoutReasonCode | null;
  readonly scanId: string | null;
  readonly purchaseId: string | null;
  readonly expiresAt: string | null;
}

export async function findCheckoutStatus(
  prisma: PrismaClient,
  accountId: string,
  reference: string,
): Promise<CheckoutStatusView> {
  const row = await prisma.checkoutSession.findFirst({
    where: { reference, accountId },
    include: { purchase: { include: { scan: { select: { id: true } } } } },
  });
  if (row === null) {
    throw new BillingNotFoundError('checkout session not found');
  }
  return {
    reference: row.reference,
    plan: row.plan,
    status: row.status,
    reasonCode: checkoutReasonCode(row.status, row.statusReason),
    scanId: row.purchase?.scan?.id ?? null,
    purchaseId: row.purchaseId,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}
