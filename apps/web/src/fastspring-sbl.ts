// FastSpring Store Builder Library (SBL) — popup checkout.
//
// The buyer pays in a FastSpring-hosted iframe rendered over this page. What
// they pay for was decided entirely on our server: `POST /billing/checkout-session`
// validated the account, the site profile, the plan and the crawl scope, wrote a
// CheckoutSession row and asked FastSpring's Sessions API for a session. Only the
// opaque session id reaches this module, and handing it to the SBL is the
// documented way to open a checkout for a server-built session:
//
//   "checkout — Pass a session ID from the /sessions API to skip building a new
//    session entirely." (developer.fastspring.com — Session Objects)
//
// So nothing here decides a price, a product or an entitlement, and no FastSpring
// API credential exists in the browser at all: the API username, password and
// webhook secret never leave the server, and the only FastSpring value this
// bundle receives is the public storefront from `/billing/checkout-config`.
//
// Payment is still confirmed exclusively by the signed `order.completed` webhook.
// The callbacks below move the UI along; none of them grants anything.

/**
 * Pinned Store Builder Library version.
 *
 * Pinned rather than floating: this script runs on the page that renders the
 * payment UI, and an unreviewed automatic upgrade there is a change to the
 * checkout itself. 1.0.6 is the version FastSpring's own integration guide ships
 * (developer.fastspring.com — Add checkout to your site, "Preview and test").
 * Bumping it means bumping this constant, nothing else.
 */
export const SBL_VERSION = '1.0.6';

/** The only origin the SBL script may be fetched from; mirrored in the CSP. */
export const SBL_ORIGIN = 'https://sbl.onfastspring.com';

export const SBL_SCRIPT_URL = `${SBL_ORIGIN}/sbl/${SBL_VERSION}/fastspring-builder.min.js`;

/** FastSpring requires exactly this id on the script block. */
export const SBL_SCRIPT_ID = 'fsc-api';

/** How long the SBL has to become usable before the buyer is told it did not. */
const SBL_READY_TIMEOUT_MS = 15_000;

/** How often the module looks for `window.fastspring` after the script loads. */
const SBL_READY_POLL_MS = 50;

/**
 * `data-*` callbacks are resolved by FastSpring as function *names* on `window`,
 * so the bridge into this module has to be a global. One fixed, namespaced set is
 * installed once and forwards to whichever checkout is currently open.
 */
const CALLBACK_GLOBALS = {
  popupClosed: 'fluxradarFastSpringPopupClosed',
  popupWebhookReceived: 'fluxradarFastSpringWebhookReceived',
  error: 'fluxradarFastSpringError',
} as const;

/** Why a popup checkout could not be opened. The UI turns each into a sentence. */
export type PopupFailureReason =
  /** The configured storefront is not a FastSpring one — a server misconfiguration. */
  | 'storefront_invalid'
  /** The script never loaded: offline, blocked by an extension, or refused by the CSP. */
  | 'sdk_unavailable'
  /** The script loaded but never published `window.fastspring.builder`. */
  | 'sdk_timeout'
  /** The SBL reported an error while opening the checkout for this session. */
  | 'launch_failed';

export type PopupLaunch =
  { readonly ok: true } | { readonly ok: false; readonly reason: PopupFailureReason };

interface FastSpringBuilder {
  push: (session: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    fastspring?: { builder?: FastSpringBuilder };
  }
}

/**
 * A storefront value this module is willing to load, as
 * `{store}[.test].onfastspring.com/{checkout}`.
 *
 * The server validates the same shape before it ever sends the value
 * (`billing/fastspring/popup-storefront.ts`), and this is the second half of that
 * check: the value arrives over the network and is also restored from local
 * storage, so it is treated as untrusted input. It becomes the origin the buyer
 * types their card number into, and it is interpolated into a script attribute —
 * anything but a FastSpring storefront is refused rather than repaired.
 */
export function isPopupStorefront(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.onfastspring\.com\/\S+$/.test(value)
  );
}

/** What the caller wants to know while a checkout is open. */
export interface PopupListeners {
  /** The buyer closed the popup — after paying or by cancelling. */
  readonly onClosed: () => void;
  /** FastSpring reported an error for the open checkout. */
  readonly onError: (code: string) => void;
  /** FastSpring received an order webhook while the popup was still open. */
  readonly onOrderReceived?: () => void;
}

let listeners: PopupListeners | null = null;
let popupOpen = false;
let loadingStorefront: string | null = null;
let loading: Promise<FastSpringBuilder> | null = null;

/**
 * Opens the FastSpring popup checkout for a session created on our server.
 *
 * Never throws: every failure comes back as a reason the caller can put in front
 * of the buyer, because a checkout that silently does nothing after a click is
 * indistinguishable from a broken page.
 */
export async function openPopupCheckout(
  storefront: string,
  sessionId: string,
  handlers: PopupListeners,
): Promise<PopupLaunch> {
  if (popupOpen) {
    // The checkout is already on screen. A second click must not push the same
    // session again — the buyer would be looking at a checkout being rebuilt
    // under them, and FastSpring would be asked to open a session it is already
    // showing.
    return { ok: true };
  }
  if (!isPopupStorefront(storefront)) {
    return { ok: false, reason: 'storefront_invalid' };
  }
  // Installed before anything can fire one: FastSpring resolves each `data-*`
  // callback to a global by name, and a name that is not defined when the event
  // arrives is simply dropped.
  installCallbackGlobals();

  let builder: FastSpringBuilder;
  try {
    builder = await loadStoreBuilder(storefront);
  } catch (caught) {
    return { ok: false, reason: failureReason(caught) };
  }

  listeners = handlers;
  popupOpen = true;
  try {
    // The one documented bridge from the server-side Sessions API to the popup:
    // the session id replaces the cart the SBL would otherwise build in the
    // browser, so the product, the quantity and the order tag carrying our
    // checkout reference all stay server-issued.
    builder.push({ checkout: sessionId });
  } catch {
    // The SBL's own message can quote page state, so it is not forwarded; the
    // reason code is what the UI needs and what an operator can act on.
    popupOpen = false;
    listeners = null;
    return { ok: false, reason: 'launch_failed' };
  }
  return { ok: true };
}

/** Stops delivering callbacks to a checkout the UI has finished with. */
export function releasePopupCheckout(): void {
  listeners = null;
  popupOpen = false;
}

/**
 * Loads the SBL once and resolves with its builder.
 *
 * The script is injected rather than placed in `index.html` so a deployment with
 * no paid checkout never contacts FastSpring at all, and so the storefront — which
 * differs between the test and live deployments of the same bundle — comes from
 * the server rather than from build-time configuration.
 */
function loadStoreBuilder(storefront: string): Promise<FastSpringBuilder> {
  const ready = window.fastspring?.builder;
  if (ready !== undefined) {
    return Promise.resolve(ready);
  }
  if (loading !== null && loadingStorefront === storefront) {
    return loading;
  }
  if (loading !== null) {
    // `data-storefront` is read once, at load. A second storefront would silently
    // check out against the first one, so it is refused instead.
    return Promise.reject(new SblFailure('storefront_invalid'));
  }
  loadingStorefront = storefront;
  loading = injectStoreBuilder(storefront).catch((caught: unknown) => {
    // A failed load must not poison later attempts: the buyer's next click should
    // try again rather than repeat a cached network error.
    loading = null;
    loadingStorefront = null;
    throw caught;
  });
  return loading;
}

/**
 * The script block FastSpring documents, as attributes.
 *
 * Kept as data so the contract is stated once and can be asserted directly:
 * every name here comes from developer.fastspring.com (Store Builder Overview
 * for `id`/`src`/`data-storefront`, Callbacks for the three `data-*` hooks), and
 * `id` in particular must be exactly `fsc-api` or the library does not start.
 */
export function storeBuilderScriptAttributes(storefront: string): Readonly<Record<string, string>> {
  return {
    id: SBL_SCRIPT_ID,
    src: SBL_SCRIPT_URL,
    type: 'text/javascript',
    'data-storefront': storefront,
    'data-popup-closed': CALLBACK_GLOBALS.popupClosed,
    'data-popup-webhook-received': CALLBACK_GLOBALS.popupWebhookReceived,
    'data-error-callback': CALLBACK_GLOBALS.error,
  };
}

function injectStoreBuilder(storefront: string): Promise<FastSpringBuilder> {
  return new Promise<FastSpringBuilder>((resolve, reject) => {
    const script = document.createElement('script');
    for (const [name, value] of Object.entries(storeBuilderScriptAttributes(storefront))) {
      script.setAttribute(name, value);
    }

    let settled = false;
    const finish = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(deadline);
      window.clearInterval(poll);
      outcome();
    };

    // `load` fires after the script has run, but the builder is published as a
    // side effect of that run — polling covers the versions that finish setting
    // themselves up a tick later, and costs nothing when it is ready at once.
    const poll = window.setInterval(() => {
      const builder = window.fastspring?.builder;
      if (builder !== undefined) {
        finish(() => resolve(builder));
      }
    }, SBL_READY_POLL_MS);

    const deadline = window.setTimeout(() => {
      finish(() => reject(new SblFailure(script.isConnected ? 'sdk_timeout' : 'sdk_unavailable')));
    }, SBL_READY_TIMEOUT_MS);

    script.addEventListener('error', () => {
      script.remove();
      finish(() => reject(new SblFailure('sdk_unavailable')));
    });
    script.addEventListener('load', () => {
      const builder = window.fastspring?.builder;
      if (builder !== undefined) {
        finish(() => resolve(builder));
      }
    });

    try {
      document.head.appendChild(script);
    } catch {
      // A page that refuses to attach the script at all is the same outcome for
      // the buyer as one that never fetched it, and the pending timers must not
      // outlive the attempt.
      finish(() => reject(new SblFailure('sdk_unavailable')));
    }
  });
}

/** Publishes the three callback names the script tag refers to. */
function installCallbackGlobals(): void {
  const globals = window as unknown as Record<string, unknown>;
  globals[CALLBACK_GLOBALS.popupClosed] = (): void => {
    popupOpen = false;
    listeners?.onClosed();
  };
  globals[CALLBACK_GLOBALS.popupWebhookReceived] = (): void => {
    // Only a hint that an order exists; the scan still appears solely because the
    // signed webhook reached our server and created it.
    listeners?.onOrderReceived?.();
  };
  globals[CALLBACK_GLOBALS.error] = (code: unknown): void => {
    popupOpen = false;
    listeners?.onError(typeof code === 'string' ? code : 'unknown');
  };
}

class SblFailure extends Error {
  readonly reason: PopupFailureReason;

  constructor(reason: PopupFailureReason) {
    super(reason);
    this.name = 'SblFailure';
    this.reason = reason;
  }
}

function failureReason(caught: unknown): PopupFailureReason {
  return caught instanceof SblFailure ? caught.reason : 'sdk_unavailable';
}

/** Test seam: forgets the loaded script so each test starts from a clean page. */
export function resetStoreBuilderForTests(): void {
  loading = null;
  loadingStorefront = null;
  listeners = null;
  popupOpen = false;
  document.getElementById(SBL_SCRIPT_ID)?.remove();
  delete window.fastspring;
}
