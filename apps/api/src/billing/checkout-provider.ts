import { CREEM_PROVIDER, type CreemConfigResult } from './creem/config.ts';
import { FASTSPRING_PROVIDER, type FastSpringConfigResult } from './fastspring/config.ts';

// Which provider opens NEW checkouts in this deployment.
//
// Two payment providers can be configured at once, and that is a normal state
// rather than a mistake: a deployment moving from FastSpring to Creem keeps the
// FastSpring credentials so FastSpring's webhooks — refunds and chargebacks for
// orders already sold — are still verified and applied, while every new sale
// goes through Creem. Both webhook routes therefore stay mounted whenever their
// provider is configured. What has to be decided once, in one place, is the
// checkout surface (`/billing/checkout-config`, `/billing/checkout-session`),
// because Express takes the first router that claims a path and a second one is
// silently shadowed.
//
// The rule is deliberately small:
//   * one provider configured  → it sells; FLUXRADAR_CHECKOUT_PROVIDER may name
//                                it but need not;
//   * both configured          → FLUXRADAR_CHECKOUT_PROVIDER MUST name one, or
//                                the checkout is `invalid` (production refuses
//                                to boot, and the checkout answers 503);
//   * the variable names a provider that is not configured → `invalid` too.
// Nothing is guessed, and a guess is the one thing this must never do: the
// wrong provider sells a plan with the other provider's products.

export const CHECKOUT_PROVIDER_ENV = 'FLUXRADAR_CHECKOUT_PROVIDER';

export const CHECKOUT_PROVIDER_NAMES = [FASTSPRING_PROVIDER, CREEM_PROVIDER] as const;

export type CheckoutProviderName = (typeof CHECKOUT_PROVIDER_NAMES)[number];

export type CheckoutProviderSelection =
  | { readonly state: 'selected'; readonly provider: CheckoutProviderName }
  /** Neither provider is configured: paid checkout is simply off. */
  | { readonly state: 'none' }
  | { readonly state: 'invalid'; readonly reason: string };

function trimmed(value: string | undefined): string | null {
  const result = value?.trim() ?? '';
  return result === '' ? null : result;
}

function isProviderName(value: string): value is CheckoutProviderName {
  return (CHECKOUT_PROVIDER_NAMES as readonly string[]).includes(value);
}

/**
 * The provider new checkouts open with, given both readers' answers.
 *
 * Pure: it decides nothing about the webhooks and reads nothing but the one
 * variable. A provider whose own configuration is `invalid` is not "configured"
 * here — its reader already fails the boot with the missing names, and this
 * must not add a second, vaguer reason on top.
 */
export function resolveCheckoutProvider(
  fastSpring: FastSpringConfigResult,
  creem: CreemConfigResult,
  env: NodeJS.ProcessEnv = process.env,
): CheckoutProviderSelection {
  const configured: CheckoutProviderName[] = [
    ...(fastSpring.state === 'configured' ? [FASTSPRING_PROVIDER] : []),
    ...(creem.state === 'configured' ? [CREEM_PROVIDER] : []),
  ];
  const requested = trimmed(env[CHECKOUT_PROVIDER_ENV]);
  if (requested !== null && !isProviderName(requested)) {
    return {
      state: 'invalid',
      reason: `${CHECKOUT_PROVIDER_ENV} must be one of ${CHECKOUT_PROVIDER_NAMES.join(', ')}`,
    };
  }
  if (requested !== null) {
    if (!configured.includes(requested)) {
      return {
        state: 'invalid',
        reason:
          `${CHECKOUT_PROVIDER_ENV}=${requested} names a payment provider that is not ` +
          'configured in this environment',
      };
    }
    return { state: 'selected', provider: requested };
  }
  if (configured.length === 0) {
    return { state: 'none' };
  }
  if (configured.length > 1) {
    return {
      state: 'invalid',
      reason:
        `both FastSpring and Creem are configured; set ${CHECKOUT_PROVIDER_ENV} to ` +
        `${CHECKOUT_PROVIDER_NAMES.join(' or ')} to say which one opens new checkouts`,
    };
  }
  const [only] = configured;
  return only === undefined ? { state: 'none' } : { state: 'selected', provider: only };
}
