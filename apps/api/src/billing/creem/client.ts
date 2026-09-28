import { z } from 'zod';

import { BillingError } from '../errors.ts';
import type { FetchLike } from '../fastspring/client.ts';
import type { CreemConfig } from './config.ts';

// Server-to-server Creem Checkout API (docs.creem.io — Checkout API, "Create a
// checkout session"). The API key never leaves this module: it is put on the
// x-api-key header and is absent from every error, log line and return value.
// The response the caller gets back contains only what the browser is allowed
// to see — a checkout id and the hosted checkout URL to send the buyer to.

const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = 'FluxRadar/0.1 (+https://fluxradar.net)';

/** What a buyer is told when the failure is ours to fix, not theirs. */
const CHECKOUT_TEMPORARILY_UNAVAILABLE = 'Paid checkout is temporarily unavailable';

/** A provider failure, split into the buyer's sentence and the operator's. */
interface ProviderFailure {
  readonly message: string;
  readonly detail?: string;
}

/**
 * Provider call failed. `status` is the Creem HTTP status, 0 for transport
 * errors. `message` is what the buyer may read; `detail` — when the difference
 * matters — is the operator's version, which the HTTP layer logs and never
 * sends. A rejected API key and a product that does not exist in this Creem
 * environment are operator problems, and telling a buyer which one it is
 * describes our setup without giving them anything to act on.
 */
export class CreemApiError extends BillingError {
  readonly status: number;

  constructor(status: number, message: string, detail?: string) {
    super('CREEM_API', message, detail ?? null);
    this.status = status;
  }
}

export interface CreateCheckoutParams {
  readonly productId: string;
  /**
   * What the product has to cost, in cents, and in which currency. Creem
   * answers with the product it put on the checkout; a catalogue entry that
   * disagrees with the tariff is refused before the buyer ever sees the page,
   * which is the cheap moment — after the charge it is a manual refund.
   */
  readonly expectedPriceCents: number;
  readonly expectedCurrency: string;
  /**
   * Our checkout reference. Creem echoes it as `request_id` on the
   * checkout.completed webhook and on the return redirect, which is how a
   * payment is matched to the session that opened it.
   */
  readonly requestId: string;
  readonly successUrl: string;
  /** A second carrier for the reference, echoed as the checkout's metadata. */
  readonly metadata: Readonly<Record<string, string>>;
  /** Pre-fills the buyer's email on the hosted page; null leaves it blank. */
  readonly customerEmail: string | null;
}

export interface CreatedCheckout {
  readonly checkoutId: string;
  readonly checkoutUrl: string;
}

export interface CreemClientDeps {
  readonly config: CreemConfig;
  /** Test seam; production uses global fetch. */
  readonly fetchImpl?: FetchLike;
}

// Only the fields this side acts on are named; everything else Creem adds over
// time passes through and is ignored, so a new field never turns a working
// checkout into a refused one. `mode` and `status` ARE read: a session Creem
// answers 200 for can still be one a buyer cannot pay into.
const productResponseSchema = z
  .object({
    id: z.string().optional(),
    price: z.number().optional(),
    currency: z.string().optional(),
  })
  .passthrough();

const checkoutResponseSchema = z
  .object({
    id: z.string().min(1),
    checkout_url: z.string().min(1),
    status: z.string().optional(),
    mode: z.string().optional(),
    request_id: z.string().optional(),
    // A bare product id, or the product itself when Creem expands it.
    product: z.union([z.string(), productResponseSchema]).optional(),
  })
  .passthrough();

type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

/** The only lifecycle state a freshly created checkout may be in. */
const CHECKOUT_PENDING = 'pending';

/** The `mode` a live-environment Creem object carries; everything else is not live. */
export const CREEM_LIVE_MODE = 'prod';

export async function createCreemCheckout(
  deps: CreemClientDeps,
  params: CreateCheckoutParams,
): Promise<CreatedCheckout> {
  const payload = await post(deps, `${deps.config.apiBaseUrl}/v1/checkouts`, {
    product_id: params.productId,
    request_id: params.requestId,
    success_url: params.successUrl,
    metadata: params.metadata,
    ...(params.customerEmail === null ? {} : { customer: { email: params.customerEmail } }),
  });
  const parsed = checkoutResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new CreemApiError(502, 'Creem checkout response did not contain a checkout URL');
  }
  const unusable = describeUnusableCheckout(parsed.data, params, deps.config);
  if (unusable !== null) {
    // A URL exists, so nothing here is a transport failure — Creem simply
    // answered with a checkout that cannot complete the purchase we opened it
    // for. Failing here is what keeps the buyer from paying into it.
    throw new CreemApiError(502, CHECKOUT_TEMPORARILY_UNAVAILABLE, unusable);
  }
  return { checkoutId: parsed.data.id, checkoutUrl: parsed.data.checkout_url };
}

/**
 * Why this checkout may not be handed to a buyer, or null when it may.
 *
 * Each check reads one field Creem documents, and each one is only applied when
 * Creem actually stated it. The returned sentence is the operator's — it names
 * our own request and Creem's own values — and travels as the error's detail,
 * which the HTTP layer logs and never sends to a buyer.
 */
function describeUnusableCheckout(
  checkout: CheckoutResponse,
  params: CreateCheckoutParams,
  config: CreemConfig,
): string | null {
  if (!isHttpsUrl(checkout.checkout_url)) {
    return 'Creem returned a checkout URL that is not an https URL';
  }
  if (checkout.status !== undefined && checkout.status !== CHECKOUT_PENDING) {
    return `Creem returned a checkout in state ${checkout.status}, not ${CHECKOUT_PENDING}`;
  }
  // A test key answering with a live checkout, or the reverse, is a key put in
  // the wrong environment's variable. The buyer would pay into an environment
  // whose webhook secret this deployment does not hold.
  if (checkout.mode !== undefined && (checkout.mode === CREEM_LIVE_MODE) !== config.liveMode) {
    return `Creem returned a checkout in mode ${checkout.mode}, which is not the configured ${config.mode} mode`;
  }
  // The checkout reference is how a payment is matched to the account, the site
  // profile and the plan it was opened for. A checkout that dropped it would
  // take the buyer's money and produce an order this API cannot link to anything.
  if (checkout.request_id !== undefined && checkout.request_id !== params.requestId) {
    return 'Creem did not keep the request_id the checkout reference travels in';
  }
  return describeMispricedProduct(checkout, params);
}

/**
 * The product Creem put on the checkout, against the tariff — only when Creem
 * expanded it. A bare id says nothing about the price and is not held against
 * the checkout; the webhook still checks what was actually charged.
 */
function describeMispricedProduct(
  checkout: CheckoutResponse,
  params: CreateCheckoutParams,
): string | null {
  const product = checkout.product;
  if (product === undefined || typeof product === 'string') {
    return null;
  }
  if (product.id !== undefined && product.id !== params.productId) {
    return `Creem put product ${product.id} on the checkout, not the requested ${params.productId}`;
  }
  const currency = product.currency?.toUpperCase();
  if (currency !== undefined && currency !== params.expectedCurrency) {
    return (
      `Creem product ${params.productId} is priced in ${currency}, not ${params.expectedCurrency}; ` +
      'the catalogue entry does not match the tariff'
    );
  }
  if (product.price !== undefined && product.price !== params.expectedPriceCents) {
    return (
      `Creem product ${params.productId} is priced at ${product.price} cents, not the tariff's ` +
      `${params.expectedPriceCents}; the catalogue entry does not match the tariff`
    );
  }
  return null;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

async function post(deps: CreemClientDeps, url: string, body: unknown): Promise<unknown> {
  const doFetch = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': deps.config.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // The caught error may embed the request (and its x-api-key header), so it
    // is never forwarded or logged.
    throw new CreemApiError(0, 'Creem could not be reached');
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text().catch(() => '');
  if (!response.ok) {
    const failure = describeFailure(response.status, text);
    throw new CreemApiError(response.status, failure.message, failure.detail);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CreemApiError(502, 'Creem returned a response that is not JSON');
  }
}

/**
 * Splits a provider failure into what the buyer is told and what the operator
 * needs. Creem error bodies name the rejected field and can echo request
 * content, so the provider's own words never leave this process: they are the
 * detail, and the buyer gets a sentence about what happened to their checkout.
 */
function describeFailure(status: number, body: string): ProviderFailure {
  if (status === 401 || status === 403) {
    return {
      message: CHECKOUT_TEMPORARILY_UNAVAILABLE,
      detail: `Creem rejected the API key (HTTP ${status})`,
    };
  }
  if (status === 404) {
    return {
      message: CHECKOUT_TEMPORARILY_UNAVAILABLE,
      detail: 'Creem answered HTTP 404: the product id does not exist in this Creem environment',
    };
  }
  if (status === 429) {
    return { message: 'Creem rate limit reached, retry shortly' };
  }
  if (status >= 500) {
    return {
      message: 'Creem is temporarily unavailable',
      detail: `Creem answered HTTP ${status}`,
    };
  }
  const providerMessage = readProviderMessage(body);
  return {
    message: `Creem could not open the checkout session (HTTP ${status})`,
    detail:
      providerMessage === null
        ? `Creem answered HTTP ${status} with no message field`
        : `Creem answered HTTP ${status}: ${providerMessage}`,
  };
}

function readProviderMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    const message = Array.isArray(parsed.message) ? parsed.message.join('; ') : parsed.message;
    return typeof message === 'string' && message.length > 0 && message.length <= 200
      ? message
      : null;
  } catch {
    return null;
  }
}
