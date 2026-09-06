import type { Prisma } from '@prisma/client';

import { CHECKOUT_SESSION_STATUSES } from './constants.ts';

// When a server-side checkout binding is still live, and when it is dead.
//
// A CheckoutSession row is written BEFORE the provider is called, so an
// abandoned tab, a provider timeout or a 5xx all leave a `created` row behind.
// Such a row must never become a permanent blocker: it is what
// `DELETE /profiles/:id` refuses on, and it is the only thing that keeps a
// deleted profile's binding alive for a payment that can still land.
//
// "Still live" is decided by the deadline the row carries, never by its age
// alone: `expiresAt` is the provider's own session expiry when FastSpring
// reports one, and the deadline we opened the session with otherwise.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deadline for a row that carries none — only pre-existing rows and rows whose
 * creation crashed between the INSERT and the provider response. A FastSpring
 * session can be configured to live at most this long, so nothing payable is
 * ever declared dead by this fallback.
 */
export const CHECKOUT_SESSION_FALLBACK_TTL_DAYS = 7;

/**
 * How long past its deadline an unpaid session is left alone before the
 * retention sweep closes it. The sweep only relabels — a late payment can still
 * claim a session it closed (see `claimableCheckoutSessionWhere`) — but a
 * generous margin keeps that path theoretical rather than routine.
 */
export const CHECKOUT_ABANDON_GRACE_DAYS = 7;

export const CHECKOUT_STATUS_REASONS = {
  /** The provider never opened a checkout, so this row can never be paid. */
  providerUnavailable: 'checkout could not be opened with the payment provider',
  /** Closed by the retention sweep: the deadline passed with no payment. */
  abandoned: 'checkout expired before a payment arrived',
} as const;

/** The deadline a session is opened with, before the provider reports its own. */
export function provisionalCheckoutDeadline(createdAt: Date, expirationDays: number): Date {
  return new Date(createdAt.getTime() + expirationDays * DAY_MS);
}

/**
 * Sessions that can still be paid. Only these block a profile deletion: an
 * expired one binds nothing the provider can still charge for.
 */
export function openCheckoutSessionWhere(now: Date): Prisma.CheckoutSessionWhereInput {
  return {
    status: CHECKOUT_SESSION_STATUSES.created,
    OR: [
      { expiresAt: { gt: now } },
      { expiresAt: null, createdAt: { gt: daysBefore(now, CHECKOUT_SESSION_FALLBACK_TTL_DAYS) } },
    ],
  };
}

/** Unpaid sessions whose deadline passed long enough ago to close them. */
export function abandonedCheckoutSessionWhere(now: Date): Prisma.CheckoutSessionWhereInput {
  return {
    status: CHECKOUT_SESSION_STATUSES.created,
    purchaseId: null,
    OR: [
      { expiresAt: { lte: daysBefore(now, CHECKOUT_ABANDON_GRACE_DAYS) } },
      {
        expiresAt: null,
        createdAt: {
          lte: daysBefore(now, CHECKOUT_SESSION_FALLBACK_TTL_DAYS + CHECKOUT_ABANDON_GRACE_DAYS),
        },
      },
    ],
  };
}

/**
 * What an incoming order may still turn into a purchase.
 *
 * `created` is the normal case. A session the sweep closed as abandoned is
 * accepted too, and that is deliberate: it granted nothing (`purchaseId` is
 * null), so honouring a payment that arrives against it is exactly what would
 * have happened had the sweep not run. Housekeeping must never be able to
 * swallow a real charge. Every other rejection reason stays terminal.
 */
export function claimableCheckoutSessionWhere(): Prisma.CheckoutSessionWhereInput {
  return {
    purchaseId: null,
    OR: [
      { status: CHECKOUT_SESSION_STATUSES.created },
      {
        status: CHECKOUT_SESSION_STATUSES.rejected,
        statusReason: CHECKOUT_STATUS_REASONS.abandoned,
      },
    ],
  };
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}
