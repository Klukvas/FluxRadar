// The little the browser keeps about a checkout it has already started.
//
// The checkout itself outlives the React tree that opened it: the buyer can
// reload, restore the tab, or come back from a wallet provider before the signed
// provider webhook lands — and on the Creem flow the tab leaves this app
// altogether and is sent back to it. Without a persisted reference they would be
// left with a paid order and no screen that can tell them it is being confirmed.
//
// Everything read back out of local storage is untrusted input. The slot is
// shared with everything else on this origin and survives across sessions, so
// each field is validated rather than repaired, and a record that fails is
// dropped.

import type { CheckoutFlow } from './checkout-flow';
import { isPopupStorefront } from './fastspring-sbl';

const PENDING_STORAGE_KEY = 'fluxradar.pendingCheckout';

const CHECKOUT_FLOWS: readonly CheckoutFlow[] = ['popup', 'tab', 'redirect'];

export interface PendingCheckout {
  /** Carried so a different account signing in here never adopts this checkout. */
  readonly accountId: string;
  readonly reference: string;
  /**
   * The provider's own id for the checkout: what the FastSpring popup is opened
   * for. Empty for a checkout known only by its reference, which is all the
   * Creem return address carries.
   */
  readonly sessionId: string;
  /**
   * The provider-hosted checkout page, offered as a link when the buyer has to
   * get back to it themselves. Null when there is no page to offer — only a
   * checkout rebuilt from the Creem return address has none.
   */
  readonly checkoutUrl: string | null;
  /** The popup storefront, or null when this deployment has no popup checkout. */
  readonly storefront: string | null;
  /** How the checkout was opened, which decides what the confirming window shows. */
  readonly flow: CheckoutFlow;
  /** True once this record came back from storage rather than from a click. */
  readonly restored: boolean;
  /** Hosted fallback flow only: the browser refused the checkout tab. */
  readonly popupBlocked: boolean;
  /**
   * Redirect flow only: the buyer has just come back from the provider's page.
   * Set by the return address, never by storage — a reload of the workspace is
   * not a return.
   */
  readonly returned?: boolean;
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
      !isStoredCheckoutUrl(parsed.checkoutUrl) ||
      !isStoredStorefront(parsed.storefront) ||
      !isStoredFlow(parsed.flow) ||
      parsed.accountId !== accountId
    ) {
      return null;
    }
    const storefront = parsed.storefront ?? null;
    return {
      accountId,
      reference: parsed.reference,
      sessionId: parsed.sessionId,
      checkoutUrl: parsed.checkoutUrl,
      storefront,
      // A record written before flows had a name is a FastSpring one, and its
      // flow follows from the storefront exactly as it did then.
      flow: parsed.flow ?? (storefront !== null ? 'popup' : 'tab'),
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
 * script the buyer clicks themselves. Only an absolute http(s) URL is a checkout;
 * null is a checkout with no page to offer.
 */
function isStoredCheckoutUrl(value: unknown): value is string | null {
  if (value === null) return true;
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

/** Absent predates named flows; present must name one of them. */
function isStoredFlow(value: unknown): value is CheckoutFlow | undefined {
  return value === undefined || (CHECKOUT_FLOWS as readonly unknown[]).includes(value);
}

/** Storage access throws in some privacy modes; an unreadable store is "nothing". */
function readStoredValue(): string | null {
  try {
    return window.localStorage.getItem(PENDING_STORAGE_KEY);
  } catch {
    return null;
  }
}
