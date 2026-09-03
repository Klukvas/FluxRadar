// Billing error hierarchy: every rejection carries a machine-readable code so
// API handlers (T-12) can map it to an envelope error without string matching.

export class BillingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
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
