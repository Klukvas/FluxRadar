// The little the browser keeps about a checkout it has already started.
//
// The checkout itself outlives the React tree that opened it: the buyer can
// reload, restore the tab, or come back from a wallet provider before the signed
// FastSpring webhook lands. Without a persisted reference they would be left with
// a paid order and no screen that can tell them it is being confirmed.
//
// Everything read back out of local storage is untrusted input. The slot is
// shared with everything else on this origin and survives across sessions, so
// each field is validated rather than repaired, and a record that fails is
// dropped.

import { isPopupStorefront } from './fastspring-sbl';

const PENDING_STORAGE_KEY = 'fluxradar.pendingCheckout';

export interface PendingCheckout {
  /** Carried so a different account signing in here never adopts this checkout. */
  readonly accountId: string;
  readonly reference: string;
  /** The FastSpring session id the popup checkout is opened for. */
  readonly sessionId: string;
  /** The provider-hosted checkout page, used only as an explained fallback. */
  readonly checkoutUrl: string;
  /** The popup storefront, or null when this deployment has no popup checkout. */
  readonly storefront: string | null;
  /** True once this record came back from storage rather than from a click. */
  readonly restored: boolean;
  /** Hosted fallback flow only: the browser refused the checkout tab. */
  readonly popupBlocked: boolean;
}

export function storePendingCheckout(pending: PendingCheckout): void {
  try {
    window.localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Private-mode or a full quota: the in-memory flow still works for this tab.
  }
}

export function clearPendingCheckout(): void {
  try {
    window.localStorage.removeItem(PENDING_STORAGE_KEY);
  } catch {
    // Nothing to recover from; the caller has already dropped its own state.
  }
}

export function readPendingCheckout(accountId: string): PendingCheckout | null {
  const raw = readStoredValue();
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingCheckout>;
    if (
      typeof parsed.reference !== 'string' ||
      typeof parsed.sessionId !== 'string' ||
      !isCheckoutUrl(parsed.checkoutUrl) ||
      !isStoredStorefront(parsed.storefront) ||
      parsed.accountId !== accountId
    ) {
      return null;
    }
    return {
      accountId,
      reference: parsed.reference,
      sessionId: parsed.sessionId,
      checkoutUrl: parsed.checkoutUrl,
      storefront: parsed.storefront ?? null,
      // Always true here, whatever was written: a restored checkout must not
      // reopen a payment window on its own, only offer to.
      restored: true,
      popupBlocked: parsed.popupBlocked === true,
    };
  } catch {
    clearPendingCheckout();
    return null;
  }
}

/**
 * A restored checkout URL is rendered as a link and opened in a tab, so
 * `javascript:` or `data:` in that slot would turn "continue your payment" into a
 * script the buyer clicks themselves. Only an absolute http(s) URL is a checkout.
 */
function isCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** Absent is a hosted checkout; present must still be a FastSpring storefront. */
function isStoredStorefront(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || isPopupStorefront(value);
}

/** Storage access throws in some privacy modes; an unreadable store is "nothing". */
function readStoredValue(): string | null {
  try {
    return window.localStorage.getItem(PENDING_STORAGE_KEY);
  } catch {
    return null;
  }
}
