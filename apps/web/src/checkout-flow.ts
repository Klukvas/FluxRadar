// Which way the browser reaches a paid checkout, as one closed value.
//
// The server names the flow explicitly; an older server does not, and the one
// thing it could sell through was FastSpring, whose flow follows from whether a
// popup storefront is configured. Reading both through this helper keeps that
// fallback in one place instead of in every screen that opens a checkout.

import type { CheckoutConfig } from './api';

export type CheckoutFlow = 'popup' | 'tab' | 'redirect';

/**
 * The flow a config asks for. An unanswered config (null) reads as the hosted
 * tab, the flow that needs nothing from the config to work.
 *
 * `redirect` is taken at its word. Either FastSpring flow is derived from the
 * popup storefront instead of from the declared value: a popup cannot open
 * without one, so a config that declares `popup` and carries none is a tab
 * checkout whatever it says.
 */
export function checkoutFlowOf(config: CheckoutConfig | null): CheckoutFlow {
  if (config === null) return 'tab';
  if (config.checkoutFlow === 'redirect') return 'redirect';
  return config.popup !== null ? 'popup' : 'tab';
}
