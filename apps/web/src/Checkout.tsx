import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, Panel, Terminal, Window } from './components';
import {
  ApiRequestError,
  apiRequest,
  type CheckoutConfig,
  type CheckoutReasonCode,
  type CheckoutStatus,
  type Scan,
} from './api';
import { trackPurchase } from './checkout-analytics';
import type { PendingCheckout } from './checkout-storage';
import { copy, type Language } from './i18n';

// Paid checkout in the browser.
//
// Creem hosts the checkout page itself: this tab is sent to it, and Creem sends
// it back to `/checkout/return` (see pending-checkout.ts).
//
// The browser never reports a payment. It asks the API whether one has been
// confirmed, and the scan appears only because the signed Creem webhook
// created it — a blocked tab, a return address or a hand-crafted request
// cannot produce a paid scan.

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
/** A poll may fail this often in a row before the buyer is told something broke. */
const POLL_ERROR_BUDGET = 3;

const recoveryCopy = {
  en: {
    body: 'Payment confirmation is paused. Your checkout is still active.',
    resume: 'Resume payment confirmation',
    stop: 'Stop tracking this checkout',
  },
  uk: {
    body: 'Підтвердження платежу призупинено. Ваше оформлення досі активне.',
    resume: 'Продовжити підтвердження платежу',
    stop: 'Не відстежувати це оформлення',
  },
} as const;

/** A dismissed confirmation can be reopened without creating a second checkout. */
export function CheckoutRecovery({
  language,
  onResume,
  onStopTracking,
}: {
  readonly language: Language;
  readonly onResume: () => void;
  readonly onStopTracking: () => void;
}) {
  const t = recoveryCopy[language];
  return (
    <aside className="checkout-recovery" role="status">
      <p>{t.body}</p>
      <Button onClick={onResume}>{t.resume}</Button>
      <Button onClick={onStopTracking}>{t.stop}</Button>
    </aside>
  );
}

export type { PendingCheckout };
export {
  clearPendingCheckout,
  readPendingCheckout,
  storePendingCheckout,
} from './checkout-storage';

/**
 * Whether this deployment sells scans, as the server answers it.
 *
 * "We have not asked yet" is a third state, not a quiet "no": treating the
 * unanswered moment as unavailable makes the buyer read "paid scans are not
 * enabled here" for as long as the request takes, and then watch it contradict
 * itself. The screen shows nothing conclusive until the answer is in.
 */
export type CheckoutConfigState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly config: CheckoutConfig }
  | { readonly status: 'unavailable' };

const CHECKOUT_CONFIG_LOADING: CheckoutConfigState = { status: 'loading' };
const CHECKOUT_CONFIG_UNAVAILABLE: CheckoutConfigState = { status: 'unavailable' };

export function useCheckoutConfig(enabled: boolean): CheckoutConfigState {
  const [state, setState] = useState<CheckoutConfigState>(CHECKOUT_CONFIG_LOADING);
  useEffect(() => {
    // Nobody asked: an internal account never sees a checkout, so there is no
    // pending question and no reason to leave the screen waiting on one.
    if (!enabled) {
      setState(CHECKOUT_CONFIG_UNAVAILABLE);
      return undefined;
    }
    let active = true;
    setState(CHECKOUT_CONFIG_LOADING);
    void apiRequest<CheckoutConfig>('/billing/checkout-config')
      .then((value) => {
        if (active) setState({ status: 'ready', config: value });
        return value;
      })
      // An unreachable config endpoint means "not available", never "assume paid".
      .catch(() => {
        if (active) setState(CHECKOUT_CONFIG_UNAVAILABLE);
      });
    return () => {
      active = false;
    };
  }, [enabled]);
  return state;
}

export interface CheckoutPendingProps {
  readonly language: Language;
  readonly checkout: PendingCheckout;
  readonly onConfirmed: (scan: Scan) => void;
  readonly onCancel: () => void;
  readonly onError: (message: string) => void;
  /**
   * The server has no such checkout for this account. A return address can
   * name any well-formed reference, so the record behind this window may never
   * have been a checkout at all; the parent drops it rather than keep polling
   * for a payment that cannot arrive.
   */
  readonly onNotFound: () => void;
}

/**
 * "Confirming payment" state: tells the buyer where the tab is going, or that
 * it is back, then polls the server-side checkout status. The scan appears
 * only after the Creem webhook created it.
 */
export function CheckoutPending(props: CheckoutPendingProps) {
  const t = copy[props.language].checkout;
  const { checkout, onConfirmed, onError, onNotFound } = props;
  const [status, setStatus] = useState<CheckoutStatus | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const startedAt = useRef(Date.now());
  const consecutiveErrors = useRef(0);
  // The parent re-renders for reasons that have nothing to do with this payment
  // — a scan list refresh, a language switch — and hands down freshly allocated
  // callbacks each time. Reading them through a ref keeps the polling effect
  // below keyed on the checkout itself, so a parent render can neither restart
  // the timer nor fire an extra status request while the buyer is paying.
  const handlers = useRef({ onConfirmed, onError, onNotFound, pollFailed: t.pollFailed });
  useEffect(() => {
    handlers.current = { onConfirmed, onError, onNotFound, pollFailed: t.pollFailed };
  });

  // Prices and the store's test/live mode, for the purchase report below.
  const checkoutConfig = useCheckoutConfig(true);
  const readyConfig = checkoutConfig.status === 'ready' ? checkoutConfig.config : null;
  const confirmedPurchase = status?.scanId == null ? null : status;
  useEffect(() => {
    if (confirmedPurchase !== null) trackPurchase(confirmedPurchase, readyConfig);
    // Keyed on the purchase id, not the status object: polling that returns the
    // same order again must not report it again.
  }, [confirmedPurchase?.purchaseId, readyConfig]);

  const { reference } = checkout;

  const load = useCallback(async (): Promise<boolean> => {
    // The reference is one path segment, and it can come back from local storage
    // — the same untrusted slot `checkout-storage.ts` guards. Encoding it keeps a
    // tampered value a (failing) lookup instead of letting it steer the request
    // at another endpoint.
    const current = await apiRequest<CheckoutStatus>(
      `/billing/checkout-session/${encodeURIComponent(reference)}`,
    );
    setStatus(current);
    if (current.scanId === null) {
      return false;
    }
    handlers.current.onConfirmed(await apiRequest<Scan>(`/scans/${current.scanId}`));
    return true;
  }, [reference]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      if (!active) return;
      try {
        if (await load()) return;
        consecutiveErrors.current = 0;
      } catch (caught) {
        if (!active) return;
        // Not a dropped request: the server looked and has no such checkout for
        // this account. Nothing will ever confirm it, so the watch ends at once
        // and the parent drops the record — without the "could not read the
        // status" sentence, which would describe a payment that never existed.
        if (isCheckoutNotFound(caught)) {
          handlers.current.onNotFound();
          return;
        }
        // A dropped request must not end the watch: the payment is already in
        // flight and only the server can say whether it landed. Give up only
        // after the failure repeats.
        consecutiveErrors.current += 1;
        if (consecutiveErrors.current >= POLL_ERROR_BUDGET) {
          const { onError: report, pollFailed } = handlers.current;
          report(caught instanceof Error ? caught.message : pollFailed);
          return;
        }
      }
      if (!active) return;
      if (Date.now() - startedAt.current > POLL_TIMEOUT_MS) {
        setTimedOut(true);
        return;
      }
      timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
    };
    // `load` changes only when the checkout reference does, so the watch runs
    // once per checkout.
  }, [load]);

  const rejected = status?.status === 'rejected';
  const rejectionDetail = rejected ? rejectionCopy(t, status?.reasonCode ?? null) : null;
  const progress = redirectCopy(t, checkout);
  return (
    <Window
      title={t.windowTitle}
      className="window--dialog"
      onClose={props.onCancel}
      closeLabel={props.language === 'uk' ? 'Закрити вікно' : 'Close window'}
    >
      <div className="stack">
        <Panel title={t.panelTitle}>
          <p>{rejected ? t.rejected : timedOut ? t.stillWaiting : progress}</p>
          {rejectionDetail === null ? null : <p className="muted">{rejectionDetail}</p>}
          <p className="muted">{t.noScanUntilConfirmed}</p>
          {checkout.checkoutUrl !== null && !rejected ? (
            // Same tab, as the checkout was opened: the buyer comes back the way
            // they came, through the return address.
            <p>
              <a href={checkout.checkoutUrl}>{t.openCheckoutLink}</a>
            </p>
          ) : null}
        </Panel>
        <Terminal
          lines={[
            `checkout ${checkout.reference}`,
            `status   ${status?.status ?? 'pending'}`,
            'scan     created by provider webhook only',
          ]}
          active={!timedOut && !rejected}
        />
        <div className="button-row">
          <Button
            variant="primary"
            onClick={() => {
              void load().catch((caught: unknown) => {
                // The same verdict as the watch above: a checkout the server
                // does not know is over, not broken.
                if (isCheckoutNotFound(caught)) props.onNotFound();
                else props.onError(caught instanceof Error ? caught.message : t.pollFailed);
              });
            }}
          >
            {t.checkAgain}
          </Button>
          <Button onClick={props.onCancel}>{t.close}</Button>
        </div>
      </div>
    </Window>
  );
}

/**
 * The sentence for the checkout's progress: the tab is on its way to Creem,
 * or it has just come back, or the workspace was reopened with the payment
 * still unconfirmed.
 */
function redirectCopy(t: (typeof copy)[Language]['checkout'], checkout: PendingCheckout): string {
  if (checkout.returned === true) return t.redirectReturned;
  return checkout.restored ? t.checkoutPaused : t.redirectOpening;
}

/**
 * Whether a failed status read means "no such checkout for this account".
 * Only the status endpoint's own 404 says so; a network drop, a 5xx or an
 * expired session are all reasons to keep asking.
 */
function isCheckoutNotFound(caught: unknown): boolean {
  return caught instanceof ApiRequestError && caught.status === 404;
}

/**
 * The sentence for a rejection code. An unknown code — a server newer than this
 * bundle — falls back to saying nothing beyond the generic rejection copy,
 * rather than showing the buyer a code.
 */
function rejectionCopy(
  t: (typeof copy)[Language]['checkout'],
  code: CheckoutReasonCode | null,
): string | null {
  switch (code) {
    case 'checkout_expired':
      return t.rejectedExpired;
    case 'provider_unavailable':
      return t.rejectedProviderUnavailable;
    case 'payment_not_verified':
      return t.rejectedPaymentNotVerified;
    default:
      return null;
  }
}
