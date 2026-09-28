// Payment providers this codebase once integrated but no longer talks to.
//
// A retired provider still owns historical rows — Purchase, CheckoutSession,
// RefundRecord — because deleting production history to match a code removal
// is not an option. Code that decides whether a *current* payment provider is
// involved (which providers can still move money, which still get a webhook)
// checks this list to leave those old rows out of that decision.

/** Providers with no code left that can process a checkout, webhook, or refund for them. */
export const RETIRED_PAYMENT_PROVIDERS: readonly string[] = ['fastspring'];
