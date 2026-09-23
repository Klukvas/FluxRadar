import { apiRequest, type CheckoutSession, type Scan } from './api';
import { openCheckoutWindow, type PendingCheckout } from './Checkout';
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
    // Internal allowlist only: creates a scan without a purchase, and is
    // refused for everyone else (and in production).
    const created = await apiRequest<{ scanId: string } & Record<string, unknown>>(
      '/billing/dev-checkout',
      { method: 'POST', body: JSON.stringify({ ...purchase, ...aiConsent }) },
    );
    return apiRequest<Scan>(`/scans/${created.scanId}`);
  }
  const session = await apiRequest<CheckoutSession>('/billing/checkout-session', {
    method: 'POST',
    body: JSON.stringify({ ...purchase, ...aiConsent }),
  });
  // With a popup checkout configured, the FastSpring iframe opens over this
  // page from `CheckoutPending` and the hosted URL is never opened by us — it
  // stays only as the link the buyer clicks if the popup could not load.
  // Without one (the older hosted storefront), the provider page opens in a tab.
  const { storefront } = request;
  request.onCheckoutStarted({
    accountId: request.accountId,
    reference: session.reference,
    sessionId: session.sessionId,
    checkoutUrl: session.checkoutUrl,
    storefront,
    restored: false,
    popupBlocked: storefront === null && !openCheckoutWindow(session.checkoutUrl),
  });
  return null;
}
