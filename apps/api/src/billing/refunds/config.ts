// Whether this deployment may send a refund to a payment provider, and nothing
// about how.
//
// THE DEFAULT IS THAT IT MAY NOT. Every state below other than `auto` records the
// refund and leaves the money to a person, which is the policy this product has
// shipped with: refunds are issued from the provider's own console. Turning the
// outbound path on is a deployment decision that cannot be made by accident —
// it takes two variables, one of which names the provider whose returns API the
// operator actually tested.
//
//   off     — no dispatcher. Refund decisions are recorded as `manual`.
//   manual  — the default. Same as `off` for the money; the difference is that
//             the sweep still runs and reports the queue, so an operator can see
//             what is waiting.
//   auto    — the dispatcher submits. Requires FLUXRADAR_REFUND_DISPATCH_ACK to
//             name the provider, and a completely configured provider client.
//
// A misspelt value is not "on": it is refused at boot by validateRuntimeConfig,
// the same way a half-configured FastSpring is.

export const REFUND_DISPATCH_ENV = 'FLUXRADAR_REFUND_DISPATCH';
export const REFUND_DISPATCH_ACK_ENV = 'FLUXRADAR_REFUND_DISPATCH_ACK';

export const REFUND_DISPATCH_MODES = ['off', 'manual', 'auto'] as const;

export type RefundDispatchMode = (typeof REFUND_DISPATCH_MODES)[number];

/** Typed as the literal, so no refactor can widen the default into `auto`. */
export const DEFAULT_REFUND_DISPATCH_MODE = 'manual' satisfies RefundDispatchMode;

export type RefundDispatchConfig =
  | { readonly state: 'inactive'; readonly mode: 'off' | 'manual' }
  | { readonly state: 'active'; readonly mode: 'auto'; readonly provider: string }
  | { readonly state: 'invalid'; readonly reason: string };

function trimmed(value: string | undefined): string | null {
  const result = value?.trim() ?? '';
  return result === '' ? null : result;
}

/**
 * How this process is allowed to treat outbound refunds.
 *
 * Pure: it reads the environment and decides nothing else. The caller is what
 * refuses to boot on `invalid` (integrations/config.ts) and what refuses to
 * submit on anything but `active` (dispatcher.ts).
 */
export function readRefundDispatchConfig(
  env: NodeJS.ProcessEnv = process.env,
): RefundDispatchConfig {
  const raw = trimmed(env[REFUND_DISPATCH_ENV]);
  if (raw === null) return { state: 'inactive', mode: DEFAULT_REFUND_DISPATCH_MODE };
  const mode = REFUND_DISPATCH_MODES.find((candidate) => candidate === raw);
  if (mode === undefined) {
    return {
      state: 'invalid',
      reason: `${REFUND_DISPATCH_ENV} must be one of ${REFUND_DISPATCH_MODES.join(', ')}`,
    };
  }
  if (mode === 'off' || mode === 'manual') return { state: 'inactive', mode };
  const acknowledged = trimmed(env[REFUND_DISPATCH_ACK_ENV]);
  if (acknowledged === null) {
    return {
      state: 'invalid',
      reason:
        `${REFUND_DISPATCH_ENV}=auto sends real refunds to a payment provider and requires ` +
        `${REFUND_DISPATCH_ACK_ENV} to name the provider whose returns API was tested first`,
    };
  }
  return { state: 'active', mode: 'auto', provider: acknowledged };
}

/** True only for a deployment that switched outbound refunds on for this provider. */
export function submitsRefundsTo(provider: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const config = readRefundDispatchConfig(env);
  return config.state === 'active' && config.provider === provider;
}
