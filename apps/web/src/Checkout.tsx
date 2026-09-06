import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, Panel, Terminal, Window } from './components';
import {
  apiRequest,
  type CheckoutConfig,
  type CheckoutReasonCode,
  type CheckoutStatus,
  type Scan,
} from './api';
import { openPopupCheckout, releasePopupCheckout, type PopupFailureReason } from './fastspring-sbl';
import type { PendingCheckout } from './checkout-storage';
import { copy, type Language } from './i18n';

// Paid checkout in the browser.
//
// The default flow is FastSpring's popup checkout: the server creates the
// checkout session, and the Store Builder Library opens it in a FastSpring iframe
// over this page (see fastspring-sbl.ts). A deployment configured for the older
// hosted storefront instead opens the provider page in a tab.
//
// Either way the browser never reports a payment. It asks the API whether one has
// been confirmed, and the scan appears only because the signed provider webhook
// created it — a closed popup, a blocked tab or a hand-crafted request cannot
// produce a paid scan.

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
/** A poll may fail this often in a row before the buyer is told something broke. */
const POLL_ERROR_BUDGET = 3;

export type { PendingCheckout };
export {
  clearPendingCheckout,
  readPendingCheckout,
  storePendingCheckout,
} from './checkout-storage';

export function useCheckoutConfig(enabled: boolean): CheckoutConfig | null {
  const [config, setConfig] = useState<CheckoutConfig | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    void apiRequest<CheckoutConfig>('/billing/checkout-config')
      .then((value) => {
        if (active) setConfig(value);
        return value;
      })
      // An unreachable config endpoint means "not available", never "assume paid".
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [enabled]);
  return config;
}

/**
 * Opens the provider-hosted checkout in a new tab. Returns false ONLY when the
 * browser actually blocked it, so the caller can offer the link instead of
 * silently doing nothing.
 *
 * This is the fallback path for a deployment without a popup checkout — the
 * Sessions v1 storefront flow. It is never used to substitute for a popup
 * checkout that failed: there the buyer is told what happened and clicks the
 * link themselves.
 *
 * The features string deliberately omits `noopener`: passing it makes
 * `window.open` return null on success as well, which is indistinguishable from
 * a blocked popup and would tell every buyer their checkout was blocked while it
 * was opening in front of them. Reverse tabnabbing is prevented instead by
 * severing the handle right after the tab exists, which the checkout page cannot
 * observe in between.
 */
export function openCheckoutWindow(checkoutUrl: string): boolean {
  // A blocked popup is null; some engines answer undefined, so test the handle
  // itself rather than one of the two spellings.
  const opened = window.open(checkoutUrl, '_blank');
  if (!opened) {
    return false;
  }
  try {
    opened.opener = null;
  } catch {
    // A cross-origin WindowProxy may refuse the assignment. The tab is open
    // either way, and modern browsers already isolate it in its own process.
  }
  return true;
}

/** Where the popup checkout is in its own lifecycle, beside the payment status. */
type PopupState =
  /** No popup checkout for this deployment — the hosted tab was opened instead. */
  | { readonly kind: 'hosted' }
  /** A restored checkout: the buyer decides whether to reopen it. */
  | { readonly kind: 'paused' }
  | { readonly kind: 'opening' }
  | { readonly kind: 'open' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'failed'; readonly reason: PopupFailureReason };

export interface CheckoutPendingProps {
  readonly language: Language;
  readonly checkout: PendingCheckout;
  readonly onConfirmed: (scan: Scan) => void;
  readonly onCancel: () => void;
  readonly onError: (message: string) => void;
}

/**
 * "Confirming payment" state: it opens the FastSpring popup for the session the
 * server created, then polls the server-side checkout status. The scan appears
 * only after the provider webhook created it.
 */
export function CheckoutPending(props: CheckoutPendingProps) {
  const t = copy[props.language].checkout;
  const { checkout, onConfirmed, onError } = props;
  const [status, setStatus] = useState<CheckoutStatus | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [popup, setPopup] = useState<PopupState>(() => initialPopupState(checkout));
  // Bumped when FastSpring says something happened, so the watch below asks the
  // server at once instead of waiting out the poll interval.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const startedAt = useRef(Date.now());
  const consecutiveErrors = useRef(0);
  // The parent re-renders for reasons that have nothing to do with this payment
  // — a scan list refresh, a language switch — and hands down freshly allocated
  // callbacks each time. Reading them through a ref keeps the polling effect
  // below keyed on the checkout itself, so a parent render can neither restart
  // the timer nor fire an extra status request while the buyer is paying.
  const handlers = useRef({ onConfirmed, onError, pollFailed: t.pollFailed });
  useEffect(() => {
    handlers.current = { onConfirmed, onError, pollFailed: t.pollFailed };
  });

  const { storefront, sessionId, reference } = checkout;
  const opening = popup.kind === 'opening';
  useEffect(() => {
    if (!opening || storefront === null) return undefined;
    let active = true;
    void openPopupCheckout(storefront, sessionId, {
      onClosed: () => {
        setPopup({ kind: 'closed' });
        setRefreshNonce((value) => value + 1);
      },
      onError: () => setPopup({ kind: 'failed', reason: 'launch_failed' }),
      onOrderReceived: () => setRefreshNonce((value) => value + 1),
    }).then((launch) => {
      if (active)
        setPopup(launch.ok ? { kind: 'open' } : { kind: 'failed', reason: launch.reason });
      return launch;
    });
    return () => {
      active = false;
    };
  }, [opening, storefront, sessionId]);

  // The checkout window belongs to this component; leaving it subscribed after
  // the buyer closes the confirming window would deliver a later callback into a
  // payment nobody is watching.
  useEffect(() => releasePopupCheckout, []);

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
    // once per checkout and once more each time FastSpring reports progress.
  }, [load, refreshNonce]);

  const rejected = status?.status === 'rejected';
  const rejectionDetail = rejected ? rejectionCopy(t, status?.reasonCode ?? null) : null;
  return (
    <Window title={t.windowTitle} className="window--dialog" onClose={props.onCancel}>
      <div className="stack">
        <Panel title={t.panelTitle}>
          <p>{rejected ? t.rejected : timedOut ? t.stillWaiting : progressCopy(t, popup)}</p>
          {rejectionDetail === null ? null : <p className="muted">{rejectionDetail}</p>}
          <p className="muted">{t.noScanUntilConfirmed}</p>
          {popup.kind === 'failed' ? (
            <>
              <p>{popupFailureCopy(t, popup.reason)}</p>
              <p className="muted">{t.popupFallbackHint}</p>
              <p>
                <a href={checkout.checkoutUrl} target="_blank" rel="noreferrer noopener">
                  {t.openCheckoutLink}
                </a>
              </p>
            </>
          ) : null}
          {checkout.storefront === null && checkout.popupBlocked ? (
            <>
              <p>{t.popupBlocked}</p>
              <p>
                <a href={checkout.checkoutUrl} target="_blank" rel="noreferrer noopener">
                  {t.openCheckoutLink}
                </a>
              </p>
            </>
          ) : null}
        </Panel>
        <Terminal
          lines={[
            `checkout ${checkout.reference}`,
            `status   ${status?.status ?? 'pending'}`,
            `popup    ${popup.kind}`,
            'scan     created by provider webhook only',
          ]}
          active={!timedOut && !rejected}
        />
        <div className="button-row">
          {canReopen(popup) ? (
            <Button variant="primary" onClick={() => setPopup({ kind: 'opening' })}>
              {t.popupReopen}
            </Button>
          ) : null}
          <Button
            variant={canReopen(popup) ? undefined : 'primary'}
            onClick={() => {
              void load().catch((caught: unknown) =>
                props.onError(caught instanceof Error ? caught.message : t.pollFailed),
              );
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
 * A checkout that was just started opens its popup at once. One restored from
 * storage does not: the buyer reloaded, may already have paid, and a payment
 * window that reopens by itself over a page they did not ask it on is worse than
 * a button that says it can be reopened.
 */
function initialPopupState(checkout: PendingCheckout): PopupState {
  if (checkout.storefront === null) return { kind: 'hosted' };
  return checkout.restored ? { kind: 'paused' } : { kind: 'opening' };
}

/** The popup can be opened again whenever it is not currently on screen. */
function canReopen(popup: PopupState): boolean {
  return popup.kind === 'paused' || popup.kind === 'closed' || popup.kind === 'failed';
}

function progressCopy(t: (typeof copy)[Language]['checkout'], popup: PopupState): string {
  switch (popup.kind) {
    case 'opening':
      return t.popupOpening;
    case 'open':
      return t.popupOpen;
    case 'closed':
      return t.popupClosed;
    case 'paused':
      return t.popupPaused;
    default:
      return t.confirming;
  }
}

/**
 * The sentence for a popup that did not open. Each reason is something the buyer
 * can act on differently — a blocked script is theirs to unblock, a
 * misconfiguration is ours — and none of them means anything was charged.
 */
function popupFailureCopy(
  t: (typeof copy)[Language]['checkout'],
  reason: PopupFailureReason,
): string {
  switch (reason) {
    case 'sdk_unavailable':
    case 'sdk_timeout':
      return t.popupFailedSdk;
    case 'storefront_invalid':
      return t.popupFailedStorefront;
    default:
      return t.popupFailedLaunch;
  }
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
