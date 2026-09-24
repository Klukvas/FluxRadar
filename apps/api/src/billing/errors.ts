import type { CheckoutUnavailableReason } from './constants.ts';

// Billing error hierarchy: every rejection carries a machine-readable code so
// API handlers (T-12) can map it to an envelope error without string matching.

export class BillingError extends Error {
  readonly code: string;
  /**
   * Operator-facing explanation: environment variable names, provider error
   * text, anything that describes how this deployment is wired. The HTTP layer
   * logs it and answers with `message` alone, so diagnosing a misconfiguration
   * never requires putting it in front of a browser.
   */
  readonly detail: string | null;

  constructor(code: string, message: string, detail: string | null = null) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.detail = detail;
  }
}

/** Webhook signature does not match HMAC-SHA256 over the raw body (D-029). */
export class InvalidSignatureError extends BillingError {
  constructor(message = 'webhook signature verification failed') {
    super('INVALID_SIGNATURE', message);
  }
}

/** Payload failed schema validation or amount/currency/priceId checks (§18). */
export class WebhookValidationError extends BillingError {
  constructor(message: string) {
    super('WEBHOOK_VALIDATION', message);
  }
}

/** Scan state transition rejected: not allowed by §18 or lost the atomic CAS. */
export class InvalidTransitionError extends BillingError {
  constructor(message: string) {
    super('INVALID_TRANSITION', message);
  }
}

/** Refund rejected by policy for the given reason code (§18 refund policy v1). */
export class RefundPolicyError extends BillingError {
  constructor(message: string) {
    super('REFUND_POLICY', message);
  }
}

/** Referenced entity (purchase, scan, site profile) does not exist. */
export class BillingNotFoundError extends BillingError {
  constructor(message: string) {
    super('NOT_FOUND', message);
  }
}

/**
 * The site itself is not in a state that can be audited, so the sale is refused.
 *
 * Distinct from a validation error because nothing about the request is wrong:
 * the buyer filled the form correctly and their site is refusing our crawler.
 * `state` is the crawler's own reach verdict, so a client can write the right
 * sentence — an allowlist entry, a robots.txt line, or a site that is simply
 * down — instead of one apology for all of them.
 */
export class SitePreconditionError extends BillingError {
  readonly state: string;

  constructor(state: string, message: string) {
    super('SITE_NOT_READY', message);
    this.state = state;
  }
}

/**
 * The plan exists in the catalogue, but this deployment cannot sell it.
 *
 * A plan whose provider product has not been created yet has no product path
 * (`FASTSPRING_PRODUCT_PATH_*`), so no checkout can be opened for it. Refused
 * here, before a CheckoutSession row exists and before the provider is called,
 * so a buyer never ends up with an open session that can never be paid. The
 * other plans keep selling; which one is unavailable is not a buyer's problem
 * to diagnose, so the detail stays in the log.
 */
export class PlanNotPurchasableError extends BillingError {
  constructor(plan: string) {
    super(
      'PLAN_NOT_AVAILABLE',
      'this plan cannot be bought here yet',
      `no product path is configured for plan "${plan}"`,
    );
  }
}

/**
 * A billing provider is not configured (or only partially): fail closed, 503.
 *
 * `reason` is the same closed code `/billing/checkout-config` reports, so a
 * client can tell "never switched on" from "switched on wrong" and localise the
 * sentence itself. Which variables are missing is an operator's business and
 * travels in `detail`, which only the log sees.
 */
export class BillingUnavailableError extends BillingError {
  readonly reason: CheckoutUnavailableReason;

  constructor(reason: CheckoutUnavailableReason, detail: string) {
    super('BILLING_UNAVAILABLE', 'paid checkout is not available in this environment', detail);
    this.reason = reason;
  }
}
