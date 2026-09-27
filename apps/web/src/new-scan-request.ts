import { apiRequest, type CheckoutSession, type Scan } from './api';
import { openCheckoutWindow, type PendingCheckout } from './Checkout';
import type { CheckoutFlow } from './checkout-flow';
import { AI_PROCESSING_NOTICE_VERSION, AI_PROCESSING_PROVIDERS } from './ai-processing-notice';
import type { AiProcessingOptInProvider } from './ai-processing-notice';
import type { Plan } from './plan-modules';
import type { ScanScopePayload } from './scan-scope';

/**
 * The three ways a scan comes into existence, behind one call.
 *
 * "Start the scan" means a different request per plan: Free creates one on the
 * profile, an internal account creates one without a purchase, and everyone
 * else buys — and a bought scan does not exist until the provider's signed
 * webhook creates it. That last case is why this returns `Scan | null`: no scan
 * yet is the correct answer, not a failure, and the checkout the buyer was
 * handed to is reported through `onCheckoutStarted` instead.
 */
export interface ScanRequest {
  readonly accountId: string;
  readonly profileId: string;
  readonly plan: Plan;
  readonly scope: ScanScopePayload;
  readonly expectedProfileConfigVersion: number | undefined;
  /**
   * The optional AI recipients the owner turned on, beyond the default ones.
   * Empty is the normal case, and a provider absent from it receives nothing.
   */
  readonly optInAiProviders: readonly AiProcessingOptInProvider[];
  readonly internalFreeAccess: boolean;
  /** The FastSpring popup storefront, or null for the older hosted checkout. */
  readonly storefront: string | null;
  /** How this deployment's checkout is reached, from the same config as the storefront. */
  readonly checkoutFlow: CheckoutFlow;
  readonly onCheckoutStarted: (pending: PendingCheckout) => void;
}

/** The scan that now exists, or null when a paid checkout took the request over. */
export async function requestScan(request: ScanRequest): Promise<Scan | null> {
  const { plan, profileId, scope, expectedProfileConfigVersion } = request;
  if (plan === 'Free') {
    return apiRequest<Scan>(`/profiles/${profileId}/free-check`, {
      method: 'POST',
      body: JSON.stringify({ scope, expectedProfileConfigVersion }),
    });
  }
  // Basic and Complete include provider-backed AI checks as part of the
  // purchased audit. The UI presents the data-transfer notice before checkout;
  // this compatibility field records which notice applied to the scan so the
  // orchestrator can enforce that contract boundary.
  const aiConsent = {
    aiConsent: {
      providers: [...AI_PROCESSING_PROVIDERS, ...request.optInAiProviders],
      noticeVersion: AI_PROCESSING_NOTICE_VERSION,
    },
  };
  const purchase = { siteProfileId: profileId, plan, scope, expectedProfileConfigVersion };
  if (request.internalFreeAccess) {
    // Internal allowlist only: creates a scan without a purchase, and answers
    // 402 for everyone else. There is no simulated payment behind it — nothing
    // but a signed provider order grants a purchase (D-229).
    const created = await apiRequest<{ scanId: string } & Record<string, unknown>>(
      '/billing/internal-checkout',
      { method: 'POST', body: JSON.stringify({ ...purchase, ...aiConsent }) },
    );
    return apiRequest<Scan>(`/scans/${created.scanId}`);
  }
  const session = await apiRequest<CheckoutSession>('/billing/checkout-session', {
    method: 'POST',
    body: JSON.stringify({ ...purchase, ...aiConsent }),
  });
  const { accountId, checkoutFlow, storefront } = request;
  const started = {
    accountId,
    reference: session.reference,
    sessionId: session.sessionId,
    checkoutUrl: session.checkoutUrl,
    restored: false,
  };
  if (checkoutFlow === 'redirect') {
    // The hosted page takes over this tab, and the provider sends the buyer back
    // to `/checkout/return` when they are done. The record is stored before the
    // page unloads: it is what the return page confirms the payment against.
    request.onCheckoutStarted({
      ...started,
      storefront: null,
      flow: 'redirect',
      popupBlocked: false,
    });
    window.location.assign(session.checkoutUrl);
    return null;
  }
  // With a popup checkout configured, the FastSpring iframe opens over this
  // page from `CheckoutPending` and the hosted URL is never opened by us — it
  // stays only as the link the buyer clicks if the popup could not load.
  // Without one (the older hosted storefront), the provider page opens in a tab.
  request.onCheckoutStarted({
    ...started,
    storefront,
    flow: checkoutFlow,
    popupBlocked: storefront === null && !openCheckoutWindow(session.checkoutUrl),
  });
  return null;
}
