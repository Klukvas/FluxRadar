import { useCallback, useEffect, useRef, useState } from 'react';

import type { InitialRoute } from './app-routes';
import type { AppState } from './app-state';
import {
  clearPendingCheckout,
  readPendingCheckout,
  storePendingCheckout,
  type PendingCheckout,
} from './Checkout';
import { WORKSPACE_PATHS } from './workspace-paths';

/**
 * The purchase a buyer is paying for: this tab left for Creem's hosted
 * checkout page and returns via `/checkout/return`. Restored for the account
 * that started it, and put back in front of them if a reload — or the trip to
 * Creem and back — lost it.
 */
export function usePendingCheckout({
  account,
  entryRoute,
  setScreen,
}: Pick<AppState, 'account' | 'entryRoute' | 'setScreen'>) {
  // Held here, not inside the new-scan screen: this tab leaves for Creem's
  // hosted page and returns via /checkout/return, and the buyer may also
  // reload before the provider webhook lands, so the "confirming payment"
  // window has to survive both from any screen.
  const [pendingCheckout, setPendingCheckout] = useState<PendingCheckout | null>(null);
  // The return address is read once per page load. A second account signing in
  // on the same page must not be handed the first one's checkout to poll for.
  const returnConsumed = useRef(false);
  // The restore below is keyed on the id, not the account object. The session
  // refreshes the account without anyone signing in or out — an email verified,
  // a profile edited — and re-reading storage on each of those would drop the
  // `returned` flag the return address set, flipping the confirming window's
  // copy mid-payment.
  const accountId = account?.accountId ?? null;

  useEffect(() => {
    if (accountId === null) {
      setPendingCheckout(null);
      return;
    }
    const stored = readPendingCheckout(accountId);
    const checkoutReturn = returnConsumed.current ? null : entryRoute.checkoutReturn;
    const restored =
      checkoutReturn === null ? stored : returnedCheckout(accountId, checkoutReturn, stored);
    setPendingCheckout(restored);
    if (checkoutReturn !== null && restored !== null) {
      returnConsumed.current = true;
      // Kept, so a reload of the workspace goes on confirming this payment and
      // not an older checkout the slot may still have held.
      storePendingCheckout(restored);
      // The Creem parameters leave the address bar, and a reload lands on the
      // workspace with the stored record rather than on the return page again.
      window.history.replaceState(null, '', WORKSPACE_PATHS.desktop);
    }
    // A buyer who reloaded mid-payment lands on the marketing home screen, where
    // the confirming window is not rendered. Put them back in the workspace so
    // the payment they already made is visibly still being confirmed.
    if (restored !== null) {
      setScreen((current) => (current === 'home' || current === 'auth' ? 'desktop' : current));
    }
  }, [accountId]);

  // Back from the provider's page through the back-forward cache: the page is
  // shown again exactly as it was, without a load, so nothing re-read storage
  // and the record still says the tab is on its way out. It is a restored
  // checkout now, and marked as one — the window then pauses and offers the
  // checkout again instead of announcing a trip the tab has already made.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent): void => {
      if (!event.persisted) return;
      setPendingCheckout((current) =>
        current !== null && !current.restored ? { ...current, restored: true } : current,
      );
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  // Stable across renders so the confirming window is never handed a new
  // identity mid-payment; `CheckoutPending` guards its own polling as well.
  const startCheckout = useCallback((pending: PendingCheckout): void => {
    storePendingCheckout(pending);
    setPendingCheckout(pending);
  }, []);
  const endCheckout = useCallback((): void => {
    clearPendingCheckout();
    setPendingCheckout(null);
  }, []);

  return { pendingCheckout, startCheckout, endCheckout };
}

/**
 * The checkout the buyer has just come back from.
 *
 * The stored record is the one this browser started, kept whole. A return that
 * names a different reference does not replace it: the address is anyone's to
 * type, and a well-formed reference in it proves nothing — letting it win would
 * hand the slot to a checkout that may not exist and drop the page the genuine
 * one can still be reopened on. The stored checkout stays, the foreign return
 * is ignored, and the browser that started that other checkout, if there is
 * one, goes on confirming it.
 *
 * With nothing stored — the checkout was started in another browser, or
 * storage was cleared on the way — the return is confirmed by its reference
 * alone, which is all the poll needs; a reference the server never issued is
 * answered with 404 and the record dropped again (`CheckoutPending`). Neither
 * grants anything: the scan still appears only once the webhook created it.
 */
function returnedCheckout(
  accountId: string,
  checkoutReturn: NonNullable<InitialRoute['checkoutReturn']>,
  stored: PendingCheckout | null,
): PendingCheckout {
  if (stored !== null) {
    return stored.reference === checkoutReturn.reference ? { ...stored, returned: true } : stored;
  }
  return {
    accountId,
    reference: checkoutReturn.reference,
    checkoutUrl: null,
    restored: true,
    returned: true,
  };
}

export type PendingCheckoutState = ReturnType<typeof usePendingCheckout>;
