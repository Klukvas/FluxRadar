// FastSpring runtime configuration. Credentials, product paths and the webhook
// secret come from the environment only — nothing here is ever hardcoded, and
// no value is echoed into an error message or a log line.
//
// Three states, deliberately explicit:
//   not_configured — no FASTSPRING_* variable is set. Paid checkout stays off
//                    and the API reports a setup state instead of pretending.
//   invalid        — some variables are set but the set is incomplete. This is
//                    fail-closed: production refuses to boot, and the HTTP layer
//                    reports the missing names (names only, never values).
//   configured     — the complete set is present.

import { PAID_PLANS, type PaidPlan } from '../plans.ts';
import { readPopupStorefront } from './popup-storefront.ts';

export const FASTSPRING_PROVIDER = 'fastspring' as const;

export type FastSpringMode = 'test' | 'live';
export type FastSpringSessionApi = 'v1' | 'v2';

/**
 * How an order whose currency differs from the session quote is treated.
 *
 * 'strict'    — only the quoted currency is accepted. Correct when the storefront
 *               charges a single currency and the buyer cannot change it.
 * 'localized' — FastSpring may charge the buyer in their own currency. The order
 *               is still bound to our session and product, and the amount is
 *               checked against the USD figure FastSpring reports for its payout
 *               when it provides one.
 *
 * The two are not interchangeable: 'strict' against a storefront that localises
 * currency rejects orders the buyer has already paid for, and 'localized' against
 * a single-currency storefront simply never triggers. Which one is correct is a
 * property of the FastSpring store, which is why live mode may not be switched on
 * until an operator has confirmed it (FASTSPRING_STORE_VERIFIED).
 */
export type FastSpringCurrencyPolicy = 'strict' | 'localized';

export const FASTSPRING_CURRENCY_POLICIES: readonly FastSpringCurrencyPolicy[] = [
  'strict',
  'localized',
];

/** The exact value FASTSPRING_STORE_VERIFIED must carry to unlock live mode. */
export const FASTSPRING_STORE_VERIFIED_VALUE = 'verified';

export interface FastSpringConfig {
  readonly mode: FastSpringMode;
  readonly liveMode: boolean;
  readonly apiBaseUrl: string;
  readonly apiUsername: string;
  readonly apiPassword: string;
  readonly webhookSecret: string;
  readonly sessionApi: FastSpringSessionApi;
  readonly currencyPolicy: FastSpringCurrencyPolicy;
  /** Sessions v1 only: buyer checkout origin, e.g. https://acme.onfastspring.com. */
  readonly storefrontUrl: string | null;
  /**
   * Sessions v2 only: the checkout configured in the FastSpring app, as the
   * `{storeId}/{checkoutId}` path FastSpring documents (e.g.
   * `examplestore/popup-checkout`). Both halves are URL path segments.
   */
  readonly checkoutPath: string | null;
  /**
   * Sessions v2 only: the `data-storefront` value the browser initialises the
   * Store Builder Library with, as `{store}.onfastspring.com/{checkout}`. This
   * is the only FastSpring value that is deliberately sent to the browser — the
   * popup checkout cannot open without it — and it is validated against the
   * configured mode by `popup-storefront.ts`.
   */
  readonly popupStorefront: string | null;
  /**
   * The FastSpring product path of each paid plan that has one.
   *
   * Partial on purpose. A plan whose product has not been created in the
   * FastSpring app yet is simply absent: the deployment still boots, and the
   * plans that do have a product still sell. A plan added to the catalogue
   * before its product exists must not take the checkout down with it.
   */
  readonly productPaths: Readonly<Partial<Record<PaidPlan, string>>>;
  /**
   * How long the buyer link stays valid, in days (1–7). Sent to the Sessions v1
   * API as the session expiration, and used by both APIs as the deadline a
   * CheckoutSession row carries until FastSpring reports its own.
   */
  readonly sessionExpirationDays: number;
}

export type FastSpringConfigResult =
  | { readonly state: 'configured'; readonly config: FastSpringConfig }
  | { readonly state: 'not_configured' }
  | { readonly state: 'invalid'; readonly missing: readonly string[]; readonly reason: string };

export const FASTSPRING_ENV_VARS = {
  mode: 'FASTSPRING_MODE',
  apiUsername: 'FASTSPRING_API_USERNAME',
  apiPassword: 'FASTSPRING_API_PASSWORD',
  webhookSecret: 'FASTSPRING_WEBHOOK_SECRET',
  sessionApi: 'FASTSPRING_SESSION_API',
  currencyPolicy: 'FASTSPRING_CURRENCY_POLICY',
  storeVerified: 'FASTSPRING_STORE_VERIFIED',
  storefrontUrl: 'FASTSPRING_STOREFRONT_URL',
  checkoutPath: 'FASTSPRING_CHECKOUT_PATH',
  popupStorefront: 'FASTSPRING_POPUP_STOREFRONT',
  apiBaseUrl: 'FASTSPRING_API_BASE_URL',
  sessionExpirationDays: 'FASTSPRING_SESSION_EXPIRATION_DAYS',
  productPathBasic: 'FASTSPRING_PRODUCT_PATH_BASIC',
  productPathComplete: 'FASTSPRING_PRODUCT_PATH_COMPLETE',
  productPathWebsiteAudit: 'FASTSPRING_PRODUCT_PATH_WEBSITE_AUDIT',
} as const;

const PRODUCT_PATH_VARS: Readonly<Record<PaidPlan, string>> = {
  Basic: FASTSPRING_ENV_VARS.productPathBasic,
  WebsiteAudit: FASTSPRING_ENV_VARS.productPathWebsiteAudit,
  Complete: FASTSPRING_ENV_VARS.productPathComplete,
};

/**
 * The plans whose product path this deployment refuses to boot without.
 *
 * Basic and Complete have been sold from the start, so an environment that
 * configures FastSpring at all and forgets one of them is misconfigured rather
 * than deliberately narrowed. Website Audit is newer than some stores, so its
 * absence is a plan that cannot be bought yet, not a broken checkout.
 */
const REQUIRED_PRODUCT_PATH_PLANS: readonly PaidPlan[] = ['Basic', 'Complete'];

/**
 * FastSpring variable names this deployment may be missing and still boot.
 *
 * `readFastSpringConfig` is all-or-nothing for everything else on purpose — one
 * FASTSPRING_* variable present turns the provider from "not configured" into a
 * set that is judged as a whole — which is why DEPLOY-003 insists every name it
 * knows is wired into the release. These names are the exception the reader
 * itself makes: absent, they do not invalidate anything; they only mean the plan
 * behind them cannot be bought here yet.
 */
export const OPTIONAL_FASTSPRING_ENV_VARS: readonly string[] = PAID_PLANS.filter(
  (plan) => !REQUIRED_PRODUCT_PATH_PLANS.includes(plan),
).map((plan) => PRODUCT_PATH_VARS[plan]);

const DEFAULT_API_BASE_URL = 'https://api.fastspring.com';
const DEFAULT_SESSION_EXPIRATION_DAYS = 1;
const MAX_SESSION_EXPIRATION_DAYS = 7;

function trimmed(value: string | undefined): string | null {
  const result = value?.trim() ?? '';
  return result === '' ? null : result;
}

/** Every variable that decides whether FastSpring is meant to be switched on. */
function presentVarNames(env: NodeJS.ProcessEnv): readonly string[] {
  return Object.values(FASTSPRING_ENV_VARS).filter((name) => trimmed(env[name]) !== null);
}

export function readFastSpringConfig(env: NodeJS.ProcessEnv = process.env): FastSpringConfigResult {
  if (presentVarNames(env).length === 0) {
    return { state: 'not_configured' };
  }

  const missing: string[] = [];
  const require = (name: string): string => {
    const value = trimmed(env[name]);
    if (value === null) {
      missing.push(name);
      return '';
    }
    return value;
  };

  const rawMode = require(FASTSPRING_ENV_VARS.mode);
  const apiUsername = require(FASTSPRING_ENV_VARS.apiUsername);
  const apiPassword = require(FASTSPRING_ENV_VARS.apiPassword);
  const webhookSecret = require(FASTSPRING_ENV_VARS.webhookSecret);
  const productPaths = Object.fromEntries(
    PAID_PLANS.flatMap((plan) => {
      const value = REQUIRED_PRODUCT_PATH_PLANS.includes(plan)
        ? require(PRODUCT_PATH_VARS[plan])
        : trimmed(env[PRODUCT_PATH_VARS[plan]]);
      return value === null || value === '' ? [] : [[plan, value] as const];
    }),
  ) as Readonly<Partial<Record<PaidPlan, string>>>;

  const sessionApi = (trimmed(env[FASTSPRING_ENV_VARS.sessionApi]) ?? 'v1') as FastSpringSessionApi;
  const storefrontUrl = trimmed(env[FASTSPRING_ENV_VARS.storefrontUrl]);
  const checkoutPath = trimmed(env[FASTSPRING_ENV_VARS.checkoutPath]);
  const rawPopupStorefront = trimmed(env[FASTSPRING_ENV_VARS.popupStorefront]);
  if (sessionApi === 'v1' && storefrontUrl === null) {
    missing.push(FASTSPRING_ENV_VARS.storefrontUrl);
  }
  if (sessionApi === 'v2' && checkoutPath === null) {
    missing.push(FASTSPRING_ENV_VARS.checkoutPath);
  }
  // v2 is the popup flow: the buyer pays in a FastSpring iframe over our own
  // page, which the Store Builder Library cannot open without knowing which
  // storefront to load. Without it there is no checkout at all, so it is
  // required rather than defaulted to a guess built from the checkout path.
  if (sessionApi === 'v2' && rawPopupStorefront === null) {
    missing.push(FASTSPRING_ENV_VARS.popupStorefront);
  }

  if (missing.length > 0) {
    return {
      state: 'invalid',
      missing,
      reason: `FastSpring is partially configured; missing: ${missing.join(', ')}`,
    };
  }
  if (sessionApi !== 'v1' && sessionApi !== 'v2') {
    return {
      state: 'invalid',
      missing: [FASTSPRING_ENV_VARS.sessionApi],
      reason: `${FASTSPRING_ENV_VARS.sessionApi} must be "v1" or "v2"`,
    };
  }
  if (sessionApi === 'v2' && !isUsableCheckoutPath(checkoutPath)) {
    return {
      state: 'invalid',
      missing: [FASTSPRING_ENV_VARS.checkoutPath],
      reason:
        `${FASTSPRING_ENV_VARS.checkoutPath} must be the FastSpring checkout path ` +
        '"{storeId}/{checkoutId}", with no leading, trailing or doubled slash',
    };
  }
  if (rawMode !== 'test' && rawMode !== 'live') {
    return {
      state: 'invalid',
      missing: [FASTSPRING_ENV_VARS.mode],
      reason: `${FASTSPRING_ENV_VARS.mode} must be "test" or "live"`,
    };
  }
  let popupStorefront: string | null = null;
  if (rawPopupStorefront !== null) {
    const parsed = readPopupStorefront(rawPopupStorefront, rawMode === 'live');
    if (!parsed.ok) {
      return {
        state: 'invalid',
        missing: [FASTSPRING_ENV_VARS.popupStorefront],
        reason: `${FASTSPRING_ENV_VARS.popupStorefront} ${parsed.reason}`,
      };
    }
    popupStorefront = parsed.value;
  }
  const currencyPolicy = trimmed(env[FASTSPRING_ENV_VARS.currencyPolicy]) ?? 'strict';
  if (!FASTSPRING_CURRENCY_POLICIES.includes(currencyPolicy as FastSpringCurrencyPolicy)) {
    return {
      state: 'invalid',
      missing: [FASTSPRING_ENV_VARS.currencyPolicy],
      reason: `${FASTSPRING_ENV_VARS.currencyPolicy} must be "strict" or "localized"`,
    };
  }
  // Live mode charges real cards, and two of its preconditions live in the
  // FastSpring app rather than in this repository: order tags have to reach the
  // webhook, and the storefront's currency behaviour has to match
  // FASTSPRING_CURRENCY_POLICY. Neither can be verified from here, so live mode
  // fails closed until an operator states in the environment that both were
  // checked. Test mode never needs it.
  if (
    rawMode === 'live' &&
    trimmed(env[FASTSPRING_ENV_VARS.storeVerified]) !== FASTSPRING_STORE_VERIFIED_VALUE
  ) {
    return {
      state: 'invalid',
      missing: [FASTSPRING_ENV_VARS.storeVerified],
      reason:
        `${FASTSPRING_ENV_VARS.mode}=live requires ${FASTSPRING_ENV_VARS.storeVerified}=` +
        `${FASTSPRING_STORE_VERIFIED_VALUE}, set only after the FastSpring store has been ` +
        'checked by hand (order tags reach the webhook; the storefront ' +
        `currency behaviour matches ${FASTSPRING_ENV_VARS.currencyPolicy})`,
    };
  }
  const expiration = readExpirationDays(env);
  if (expiration === null) {
    return {
      state: 'invalid',
      missing: [FASTSPRING_ENV_VARS.sessionExpirationDays],
      reason: `${FASTSPRING_ENV_VARS.sessionExpirationDays} must be an integer between 1 and ${MAX_SESSION_EXPIRATION_DAYS}`,
    };
  }

  return {
    state: 'configured',
    config: {
      mode: rawMode,
      liveMode: rawMode === 'live',
      apiBaseUrl: (trimmed(env[FASTSPRING_ENV_VARS.apiBaseUrl]) ?? DEFAULT_API_BASE_URL).replace(
        /\/+$/,
        '',
      ),
      apiUsername,
      apiPassword,
      webhookSecret,
      sessionApi,
      currencyPolicy: currencyPolicy as FastSpringCurrencyPolicy,
      storefrontUrl: storefrontUrl === null ? null : storefrontUrl.replace(/\/+$/, ''),
      checkoutPath,
      popupStorefront,
      productPaths,
      sessionExpirationDays: expiration,
    },
  };
}

/**
 * A checkout path FastSpring can resolve. Each segment becomes one URL path
 * segment, so an empty one — a leading, trailing or doubled slash — would build
 * a request for a checkout that does not exist. That is refused at boot rather
 * than at the first buyer's click (developer.fastspring.com — Sessions,
 * "Checkout path").
 */
function isUsableCheckoutPath(checkoutPath: string | null): boolean {
  return checkoutPath !== null && checkoutPath.split('/').every((segment) => segment.trim() !== '');
}

function readExpirationDays(env: NodeJS.ProcessEnv): number | null {
  const raw = trimmed(env[FASTSPRING_ENV_VARS.sessionExpirationDays]);
  if (raw === null) {
    return DEFAULT_SESSION_EXPIRATION_DAYS;
  }
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > MAX_SESSION_EXPIRATION_DAYS) {
    return null;
  }
  return days;
}

/** The plan a FastSpring product path belongs to, or null for a foreign product. */
export function planForProductPath(config: FastSpringConfig, productPath: string): PaidPlan | null {
  // An unmapped plan has `undefined` here, which must never match a request
  // that also failed to name a product path.
  if (productPath.trim() === '') return null;
  return PAID_PLANS.find((plan) => config.productPaths[plan] === productPath) ?? null;
}

/** Whether this deployment can actually open a checkout for the plan. */
export function isPlanPurchasable(config: FastSpringConfig, plan: PaidPlan): boolean {
  return config.productPaths[plan] !== undefined;
}
