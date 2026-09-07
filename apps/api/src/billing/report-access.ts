// Who may still read a paid report.
//
// A full refund or a chargeback suspends the entitlement, and the reason is
// written where the suspension is written (fastspring/refund-events.ts): "a
// buyer whose money was returned must not keep the report the money paid for".
// Until this module existed, only two places asked — the worker
// (orchestrator/worker.ts) and the module retry — so a suspension stopped future
// work and revoked nothing a customer could already see: the scan, its
// dashboard, its issues and its export all served the paid report exactly as
// before. This is the one rule those read paths now share.
//
// EXPIRY IS NOT SUSPENSION, and it deliberately does not revoke a read.
// `ENTITLEMENT_DAYS` (30) bounds what may still be BOUGHT with the purchase —
// "after expiry no new scans/retries are queued, a Running scan may finish"
// (packages/contracts/src/tariffs.ts) — so a report that was paid for and
// delivered stays readable afterwards. The retry route asks the stricter
// question, and says so by asking for `now`.

import { forbidden } from '../http/errors.ts';
import { PURCHASE_STATUSES } from './constants.ts';

/**
 * The Prisma `include` every one of these checks needs, and nothing more: the
 * purchase's billing status and the entitlement's two fields. Selecting instead
 * of loading the rows whole keeps a report read from carrying payment details it
 * has no business seeing.
 */
export const PAID_ACCESS_INCLUDE = {
  purchase: {
    select: {
      status: true,
      entitlement: { select: { suspended: true, expiresAt: true } },
    },
  },
} as const;

export interface PaidAccessEntitlement {
  readonly suspended: boolean;
  readonly expiresAt: Date;
}

export interface PaidAccessPurchase {
  readonly status: string;
  readonly entitlement: PaidAccessEntitlement | null;
}

/** A scan loaded with {@link PAID_ACCESS_INCLUDE}. */
export interface PaidAccessScan {
  readonly purchaseId: string | null;
  readonly purchase: PaidAccessPurchase | null;
}

/** Why paid access is gone, or null when it is intact. */
export type PaidAccessDenial = 'refunded' | 'suspended' | 'missing' | 'expired';

/**
 * The single decision. `null` means the scan may be read.
 *
 * A Free scan has no purchase, so there is nothing to revoke and nothing to
 * check — the one-time Free check must keep working after any billing event on
 * an unrelated purchase.
 *
 * Everything else fails CLOSED: a paid scan whose purchase row cannot be seen is
 * denied rather than served, because the only ways to get here are a purchase
 * that was deleted and a caller that forgot the include.
 *
 * Pass `now` to also apply the entitlement window; leave it out for reads, which
 * outlive it (see the note at the top of this file).
 */
export function paidAccessDenial(
  scan: PaidAccessScan,
  options: { readonly now?: Date } = {},
): PaidAccessDenial | null {
  if (scan.purchaseId === null) return null;
  const purchase = scan.purchase;
  if (purchase === null || purchase === undefined) return 'missing';
  if (purchase.status !== PURCHASE_STATUSES.paid) return 'refunded';
  const entitlement = purchase.entitlement;
  if (entitlement === null) return 'missing';
  if (entitlement.suspended) return 'suspended';
  if (options.now !== undefined && entitlement.expiresAt.getTime() <= options.now.getTime()) {
    return 'expired';
  }
  return null;
}

export function isPaidAccessActive(scan: PaidAccessScan): boolean {
  return paidAccessDenial(scan) === null;
}

/**
 * The guard for every read of paid report data: the scan itself, its dashboard,
 * its issues and evidence, and its export.
 *
 * 403 and not 404: the account does own this scan, and pretending it never
 * existed would leave a customer who was refunded staring at a workspace that
 * lost a scan. The list still shows the row — without its report payload — so
 * the message and the list say the same thing.
 */
export function assertPaidReportAccess(scan: PaidAccessScan): void {
  if (paidAccessDenial(scan) === null) return;
  throw forbidden(
    'ENTITLEMENT_SUSPENDED',
    'this report is no longer available: the payment for it was refunded or reversed',
  );
}

/**
 * The stricter guard, for buying more work with a purchase rather than reading
 * what it already produced: the module retry and the process trigger. Expiry
 * counts here, and the code stays `ENTITLEMENT_INACTIVE` (D-194).
 */
export function assertPaidWorkAllowed(scan: PaidAccessScan, now: Date): void {
  if (paidAccessDenial(scan, { now }) === null) return;
  throw forbidden(
    'ENTITLEMENT_INACTIVE',
    'this scan is unavailable after entitlement expiry or suspension',
  );
}
