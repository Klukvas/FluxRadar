// Whether this deployment exposes the MockPaddle development surface.
//
// `/billing/dev-checkout` mints a purchase, an entitlement and a paid scan from
// a locally signed event — no money moves. `/webhooks/paddle` accepts the same
// event from outside. Together they are a second, non-provider way to grant paid
// access, which is exactly what makes them a development affordance and nothing
// else.
//
// They used to be switched off by `NODE_ENV !== 'production'`. That reads as
// "off in production", but it is really "on everywhere the variable is not
// literally the string production" — an unset NODE_ENV in a container, a staging
// value, a typo — and in every one of those cases ANY authenticated account
// could mint Complete scans for free. A safety property must not be a side
// effect of a variable that is mostly used to pick a log format, so the switch is
// now its own explicit opt-in and defaults to off.
//
// This is deliberately NOT the internal free-access allowlist. That one is a
// production feature: FLUXRADAR_INTERNAL_FREE_EMAILS names the exact accounts
// that may run a paid plan without paying, it fails closed when unset, and it
// keeps working with this flag off — see billing/internal-access.ts.

const MOCK_CHECKOUT_ENV = 'FLUXRADAR_ENABLE_MOCK_CHECKOUT';

/**
 * True only for an explicit `FLUXRADAR_ENABLE_MOCK_CHECKOUT=true`. Anything
 * else — unset, empty, "1", "yes", a typo — is off, because a value nobody
 * intended must never open the free path.
 */
export function isMockCheckoutEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[MOCK_CHECKOUT_ENV] ?? '').trim().toLowerCase() === 'true';
}
