import { useCallback, useEffect, useState } from 'react';

import type { AppState } from './app-state';
import {
  clearPendingCheckout,
  readPendingCheckout,
  storePendingCheckout,
  type PendingCheckout,
} from './Checkout';

/**
 * The purchase a buyer is paying for in another tab: restored for the account
 * that started it, and put back in front of them if a reload lost it.
 */
export function usePendingCheckout({
  account,
  setScreen,
}: Pick<AppState, 'account' | 'setScreen'>) {
  // Held here, not inside the new-scan screen: the buyer pays in another tab and
  // may reload or navigate away before the provider webhook lands, and the
  // "confirming payment" window has to survive that from any screen.
  const [pendingCheckout, setPendingCheckout] = useState<PendingCheckout | null>(null);

  useEffect(() => {
    const restored = account === null ? null : readPendingCheckout(account.accountId);
    setPendingCheckout(restored);
    // A buyer who reloaded mid-payment lands on the marketing home screen, where
    // the confirming window is not rendered. Put them back in the workspace so
    // the payment they already made is visibly still being confirmed.
    if (restored !== null) {
      setScreen((current) => (current === 'home' || current === 'auth' ? 'desktop' : current));
    }
  }, [account]);

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

export type PendingCheckoutState = ReturnType<typeof usePendingCheckout>;
