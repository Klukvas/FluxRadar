// Creem runtime configuration. The API key, the webhook secret and the product
// ids come from the environment only — nothing here is ever hardcoded, and no
// value is echoed into an error message or a log line.
//
// Three states, deliberately explicit:
//   not_configured — no CREEM_* variable is set. Paid checkout through Creem
//                    stays off and the API reports a setup state instead of
//                    pretending.
//   invalid        — some variables are set but the set is incomplete. This is
//                    fail-closed: production refuses to boot, and the HTTP layer
//                    reports the missing names (names only, never values).
//   configured     — the complete set is present.
//
// Creem is a merchant of record with a HOSTED checkout: the API creates a
// checkout session server-side, the buyer is sent to the URL Creem returns, and
// Creem sends them back to `returnUrl` afterwards. Test mode and live mode are
// two separate Creem environments with separate keys, separate products and
// separate webhook secrets (docs.creem.io — Test Mode), which is why the mode
// decides the API base URL here rather than being a flag on a request.

import { PAID_PLANS, type PaidPlan } from '../plans.ts';

export const CREEM_PROVIDER = 'creem' as const;

export type CreemMode = 'test' | 'live';

/** The exact value CREEM_STORE_VERIFIED must carry to unlock live mode. */
export const CREEM_STORE_VERIFIED_VALUE = 'verified';

/** Where the hosted checkout sends the buyer back; a path on the web app. */
export const CREEM_RETURN_PATH = '/checkout/return';

export interface CreemConfig {
  readonly mode: CreemMode;
  readonly liveMode: boolean;
  /** `https://api.creem.io` for live, `https://test-api.creem.io` for test. */
  readonly apiBaseUrl: string;
  readonly apiKey: string;
  readonly webhookSecret: string;
  /**
   * The Creem product id of each paid plan that has one.
   *
   * Partial on purpose: a plan whose
   * product has not been created in the Creem dashboard yet is simply absent —
   * the deployment still boots, and the plans that do have a product still
   * sell. A plan added to the catalogue before its product exists must not take
   * the checkout down with it.
   */
  readonly productIds: Readonly<Partial<Record<PaidPlan, string>>>;
  /**
   * The absolute URL Creem redirects the buyer to after payment, with the
   * checkout, order and request ids appended as query parameters. It is our
   * web app's return page, never a Creem value, and it is the only place the
   * browser learns a payment MAY have happened — the scan still appears solely
   * because the signed webhook created it.
   */
  readonly returnUrl: string;
}

export type CreemConfigResult =
  | { readonly state: 'configured'; readonly config: CreemConfig }
  | { readonly state: 'not_configured' }
  | { readonly state: 'invalid'; readonly missing: readonly string[]; readonly reason: string };

export const CREEM_ENV_VARS = {
  mode: 'CREEM_MODE',
  apiKey: 'CREEM_API_KEY',
  webhookSecret: 'CREEM_WEBHOOK_SECRET',
  storeVerified: 'CREEM_STORE_VERIFIED',
  apiBaseUrl: 'CREEM_API_BASE_URL',
  returnUrl: 'CREEM_RETURN_URL',
  productIdBasic: 'CREEM_PRODUCT_ID_BASIC',
  productIdComplete: 'CREEM_PRODUCT_ID_COMPLETE',
  productIdWebsiteAudit: 'CREEM_PRODUCT_ID_WEBSITE_AUDIT',
} as const;

/** The web app's origin; the return URL is derived from it when none is stated. */
export const FRONTEND_ORIGIN_ENV = 'FRONTEND_ORIGIN';

const PRODUCT_ID_VARS: Readonly<Record<PaidPlan, string>> = {
  Basic: CREEM_ENV_VARS.productIdBasic,
  WebsiteAudit: CREEM_ENV_VARS.productIdWebsiteAudit,
  Complete: CREEM_ENV_VARS.productIdComplete,
};

/**
 * The plans whose product id this deployment refuses to boot without.
 *
 * Basic and Complete have been sold from the start, so an environment that
 * configures Creem at all and forgets one of them is misconfigured rather than
 * deliberately narrowed. Website Audit is newer, so its absence is a plan that
 * cannot be bought yet, not a broken checkout.
 */
const REQUIRED_PRODUCT_ID_PLANS: readonly PaidPlan[] = ['Basic', 'Complete'];

/**
 * Creem variable names this deployment may be missing and still boot.
 *
 * `readCreemConfig` is all-or-nothing for everything else on purpose — one
 * CREEM_* variable present turns the provider from "not configured" into a set
 * that is judged as a whole — which is why the deploy wiring test insists every
 * name it knows is forwarded into the release. These names are the exception
 * the reader itself makes: absent, they do not invalidate anything. A missing
 * product id only means the plan behind it cannot be bought here yet, and a
 * missing return URL is derived from FRONTEND_ORIGIN.
 */
export const OPTIONAL_CREEM_ENV_VARS: readonly string[] = [
  ...PAID_PLANS.filter((plan) => !REQUIRED_PRODUCT_ID_PLANS.includes(plan)).map(
    (plan) => PRODUCT_ID_VARS[plan],
  ),
  CREEM_ENV_VARS.returnUrl,
];

const LIVE_API_BASE_URL = 'https://api.creem.io';
const TEST_API_BASE_URL = 'https://test-api.creem.io';

function trimmed(value: string | undefined): string | null {
  const result = value?.trim() ?? '';
  return result === '' ? null : result;
}

/** Every variable that decides whether Creem is meant to be switched on. */
function presentVarNames(env: NodeJS.ProcessEnv): readonly string[] {
  return Object.values(CREEM_ENV_VARS).filter((name) => trimmed(env[name]) !== null);
}

export function readCreemConfig(env: NodeJS.ProcessEnv = process.env): CreemConfigResult {
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

  const rawMode = require(CREEM_ENV_VARS.mode);
  const apiKey = require(CREEM_ENV_VARS.apiKey);
  const webhookSecret = require(CREEM_ENV_VARS.webhookSecret);
  const productIds = Object.fromEntries(
    PAID_PLANS.flatMap((plan) => {
      const value = REQUIRED_PRODUCT_ID_PLANS.includes(plan)
        ? require(PRODUCT_ID_VARS[plan])
        : trimmed(env[PRODUCT_ID_VARS[plan]]);
      return value === null || value === '' ? [] : [[plan, value] as const];
    }),
  ) as Readonly<Partial<Record<PaidPlan, string>>>;

  if (missing.length > 0) {
    return {
      state: 'invalid',
      missing,
      reason: `Creem is partially configured; missing: ${missing.join(', ')}`,
    };
  }
  if (rawMode !== 'test' && rawMode !== 'live') {
    return {
      state: 'invalid',
      missing: [CREEM_ENV_VARS.mode],
      reason: `${CREEM_ENV_VARS.mode} must be "test" or "live"`,
    };
  }
  // Live mode charges real cards, and its preconditions live in the Creem
  // dashboard rather than in this repository: the live webhook endpoint has to
  // exist, subscribed to the three events, with ITS secret (not the test one)
  // in CREEM_WEBHOOK_SECRET, and the live products have to be priced at the
  // tariff in USD. None of that can be verified from here, so live mode fails
  // closed until an operator states in the environment that it was checked.
  // Test mode never needs it.
  if (
    rawMode === 'live' &&
    trimmed(env[CREEM_ENV_VARS.storeVerified]) !== CREEM_STORE_VERIFIED_VALUE
  ) {
    return {
      state: 'invalid',
      missing: [CREEM_ENV_VARS.storeVerified],
      reason:
        `${CREEM_ENV_VARS.mode}=live requires ${CREEM_ENV_VARS.storeVerified}=` +
        `${CREEM_STORE_VERIFIED_VALUE}, set only after the live Creem webhook (its endpoint, ` +
        'its events and its secret) and the live product prices have been checked by hand',
    };
  }
  const returnUrl = readReturnUrl(env, rawMode === 'live');
  if (!returnUrl.ok) {
    return { state: 'invalid', missing: [CREEM_ENV_VARS.returnUrl], reason: returnUrl.reason };
  }

  const defaultApiBaseUrl = rawMode === 'live' ? LIVE_API_BASE_URL : TEST_API_BASE_URL;
  return {
    state: 'configured',
    config: {
      mode: rawMode,
      liveMode: rawMode === 'live',
      apiBaseUrl: (trimmed(env[CREEM_ENV_VARS.apiBaseUrl]) ?? defaultApiBaseUrl).replace(
        /\/+$/,
        '',
      ),
      apiKey,
      webhookSecret,
      productIds,
      returnUrl: returnUrl.value,
    },
  };
}

type ReturnUrlResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string };

/**
 * The buyer's way back.
 *
 * `CREEM_RETURN_URL` when a deployment states one; otherwise the web app's own
 * return page, built from FRONTEND_ORIGIN — the same variable every account
 * email builds its links from. Either way it has to be an absolute http(s) URL,
 * because Creem opens it in the buyer's browser after payment: a relative path
 * or a bare host would strand a buyer who has just paid on a Creem error page.
 * Live mode insists on https — a payment return page on plain http is a
 * checkout id and an order id sent in the clear.
 */
function readReturnUrl(env: NodeJS.ProcessEnv, liveMode: boolean): ReturnUrlResult {
  const stated = trimmed(env[CREEM_ENV_VARS.returnUrl]);
  const origin = trimmed(env[FRONTEND_ORIGIN_ENV]);
  const candidate =
    stated ?? (origin === null ? null : `${origin.replace(/\/+$/, '')}${CREEM_RETURN_PATH}`);
  if (candidate === null) {
    return {
      ok: false,
      reason:
        `${CREEM_ENV_VARS.returnUrl} is not set and ${FRONTEND_ORIGIN_ENV} is empty, so there ` +
        'is no page to send a buyer back to after a Creem payment',
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      ok: false,
      reason:
        `${stated === null ? FRONTEND_ORIGIN_ENV : CREEM_ENV_VARS.returnUrl} must be an absolute ` +
        'http(s) URL for the Creem return page to be reachable',
    };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      reason: `${CREEM_ENV_VARS.returnUrl} must use http or https`,
    };
  }
  if (liveMode && parsed.protocol !== 'https:') {
    return {
      ok: false,
      reason: `${CREEM_ENV_VARS.returnUrl} must be an https URL when ${CREEM_ENV_VARS.mode}=live`,
    };
  }
  return { ok: true, value: parsed.toString() };
}

/** The plan a Creem product id belongs to, or null for a foreign product. */
export function creemPlanForProductId(config: CreemConfig, productId: string): PaidPlan | null {
  // An unmapped plan has `undefined` here, which must never match an order that
  // also failed to name a product.
  if (productId.trim() === '') return null;
  return PAID_PLANS.find((plan) => config.productIds[plan] === productId) ?? null;
}

/** Whether this deployment can actually open a checkout for the plan. */
export function isCreemPlanPurchasable(config: CreemConfig, plan: PaidPlan): boolean {
  return config.productIds[plan] !== undefined;
}
