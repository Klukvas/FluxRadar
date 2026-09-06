import { z } from 'zod';

import { BillingError } from '../errors.ts';
import { FASTSPRING_ENV_VARS, type FastSpringConfig } from './config.ts';

// Server-to-server FastSpring Sessions API. Basic-auth credentials never leave
// this module: they are put on the Authorization header and are absent from
// every error, log line and return value. The response the caller gets back
// contains only what the browser is allowed to see — a session id and the
// checkout URL to open.

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
 * Provider call failed. `status` is the FastSpring HTTP status, 0 for transport
 * errors. `message` is what the buyer may read; `detail` — when the difference
 * matters — is the operator's version, which the HTTP layer logs and never
 * sends. Rejected credentials and a storefront that is not configured are
 * operator problems, and telling a buyer which one it is describes our setup
 * without giving them anything to act on.
 */
export class FastSpringApiError extends BillingError {
  readonly status: number;

  constructor(status: number, message: string, detail?: string) {
    super('FASTSPRING_API', message, detail ?? null);
    this.status = status;
  }
}

export interface CreateSessionParams {
  readonly productPath: string;
  /** Order-level tags; the checkout reference travels here. */
  readonly tags: Readonly<Record<string, string>>;
  /** Item-level attributes; a copy of the reference so the link has two carriers. */
  readonly attributes: Readonly<Record<string, string>>;
}

export interface CreatedSession {
  readonly sessionId: string;
  readonly checkoutUrl: string;
  readonly expiresAt: Date | null;
  /** Amount/currency FastSpring priced the session at, when it reports them. */
  readonly quotedAmount: number | null;
  readonly quotedCurrency: string | null;
}

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<Response>;

export interface FastSpringClientDeps {
  readonly config: FastSpringConfig;
  /** Test seam; production uses global fetch. */
  readonly fetchImpl?: FetchLike;
}

const sessionV1ResponseSchema = z.object({
  id: z.string().min(1),
  currency: z.string().optional(),
  subtotal: z.number().optional(),
  expires: z.number().optional(),
});

// `netTotal` includes or excludes tax depending on the store's pricing mode,
// which is exactly the ambiguity the amount check must not inherit, so the
// tax-free figure FastSpring reports beside it is preferred when present
// (developer.fastspring.com — Sessions, CartResponse).
//
// The rest of the response is what makes the difference between a session that
// works and a 201 that quietly did something else. Sessions v2 answers 201 for a
// cart it could not fill, for inputs it decided to ignore and for a checkout that
// is already concluded, and says so in `checkoutStatus`, `status` and `warnings`
// rather than in the HTTP status. Reading only the URL out of such a response
// sends the buyer to a checkout that cannot take their money — or, worse, to one
// that can but has lost the order tag the payment is matched by, which is a real
// charge this API will refuse afterwards. Every one of those fields is therefore
// parsed and checked below (developer.fastspring.com — Sessions, "Create
// session": BaseSessionResponse, CartResponse, Warning).
const sessionV2ResponseSchema = z.object({
  id: z.string().min(1),
  currency: z.string().optional(),
  expires: z.string().optional(),
  status: z.string().optional(),
  checkoutStatus: z.array(z.string()).optional(),
  warnings: z
    .array(
      z.object({
        code: z.string().optional(),
        field: z.string().optional(),
        message: z.string().optional(),
      }),
    )
    .optional(),
  orderTags: z.record(z.string(), z.unknown()).optional(),
  cart: z
    .object({
      netTotal: z.number().optional(),
      withoutTaxNetTotal: z.number().optional(),
      lineItems: z.array(z.object({ productPath: z.string().optional() })).optional(),
    })
    .optional(),
  checkoutUrls: z.object({ webcheckoutUrl: z.string().min(1) }).optional(),
});

type SessionV2Response = z.infer<typeof sessionV2ResponseSchema>;

/** The only `checkoutStatus` a buyer link may be handed out for. */
const READY_FOR_CHECKOUT = 'READY_FOR_CHECKOUT';

/** The only session lifecycle state a freshly created session may be in. */
const SESSION_OPEN = 'OPEN';

export async function createFastSpringSession(
  deps: FastSpringClientDeps,
  params: CreateSessionParams,
): Promise<CreatedSession> {
  return deps.config.sessionApi === 'v2'
    ? createSessionV2(deps, params)
    : createSessionV1(deps, params);
}

async function createSessionV1(
  deps: FastSpringClientDeps,
  params: CreateSessionParams,
): Promise<CreatedSession> {
  const { config } = deps;
  // `expiration` is the documented Sessions v1 way to widen the default 24-hour
  // window, in days, up to 7 (developer.fastspring.com — Sessions v1, "Session
  // expiration"). It is absent from that page's OpenAPI schema, so the row's own
  // deadline never depends on FastSpring honouring it: `expiresAt` is only
  // overwritten by the `expires` FastSpring reports back.
  const payload = await post(deps, `${config.apiBaseUrl}/sessions`, {
    tags: params.tags,
    expiration: config.sessionExpirationDays,
    items: [{ product: params.productPath, quantity: 1, attributes: params.attributes }],
  });
  const parsed = sessionV1ResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new FastSpringApiError(502, 'FastSpring session response did not contain a session id');
  }
  if (config.storefrontUrl === null) {
    throw new FastSpringApiError(
      500,
      CHECKOUT_TEMPORARILY_UNAVAILABLE,
      `${FASTSPRING_ENV_VARS.storefrontUrl} is not set, so no buyer checkout URL can be built`,
    );
  }
  return {
    sessionId: parsed.data.id,
    checkoutUrl: `${config.storefrontUrl}/session/${encodeURIComponent(parsed.data.id)}`,
    expiresAt: parsed.data.expires === undefined ? null : new Date(parsed.data.expires),
    quotedAmount: parsed.data.subtotal ?? null,
    quotedCurrency: parsed.data.currency ?? null,
  };
}

async function createSessionV2(
  deps: FastSpringClientDeps,
  params: CreateSessionParams,
): Promise<CreatedSession> {
  const { config } = deps;
  const path = `${config.apiBaseUrl}/v2/checkouts/${checkoutPathSegments(config.checkoutPath)}/sessions`;
  const payload = await post(deps, path, {
    live: config.liveMode,
    orderTags: params.tags,
    cart: {
      lineItems: [{ productPath: params.productPath, quantity: 1, attributes: params.attributes }],
    },
  });
  const parsed = sessionV2ResponseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.checkoutUrls?.webcheckoutUrl === undefined) {
    throw new FastSpringApiError(502, 'FastSpring session response did not contain a checkout URL');
  }
  const unusable = describeUnusableSession(parsed.data, params);
  if (unusable !== null) {
    // A URL exists, so nothing here is a transport failure — FastSpring simply
    // answered with a session that cannot complete the purchase we opened it
    // for. Failing here is what keeps the buyer from paying into it.
    throw new FastSpringApiError(502, CHECKOUT_TEMPORARILY_UNAVAILABLE, unusable);
  }
  return {
    sessionId: parsed.data.id,
    checkoutUrl: parsed.data.checkoutUrls.webcheckoutUrl,
    expiresAt: parsed.data.expires === undefined ? null : new Date(parsed.data.expires),
    quotedAmount: parsed.data.cart?.withoutTaxNetTotal ?? parsed.data.cart?.netTotal ?? null,
    quotedCurrency: parsed.data.currency ?? null,
  };
}

/**
 * Why this session may not be handed to a buyer, or null when it may.
 *
 * Each check reads one field FastSpring documents, and each one is only applied
 * when FastSpring actually stated it: a session that says nothing about its own
 * status is taken at the value of the checkout URL it returned, while a session
 * that says something we cannot use is refused. The returned sentence is the
 * operator's — it names our own request and FastSpring's own codes — and travels
 * as the error's detail, which the HTTP layer logs and never sends to a buyer.
 */
function describeUnusableSession(
  session: SessionV2Response,
  params: CreateSessionParams,
): string | null {
  if (session.status !== undefined && session.status !== SESSION_OPEN) {
    return `FastSpring returned a session in lifecycle state ${session.status}, not ${SESSION_OPEN}`;
  }
  if (session.checkoutStatus !== undefined && !isReadyForCheckout(session.checkoutStatus)) {
    const stated = session.checkoutStatus.join(', ');
    return `FastSpring reported checkoutStatus [${stated}], not ${READY_FOR_CHECKOUT}`;
  }
  // "A list detailing any non-fatal errors or ignored input values encountered
  // while actively processing the session." Everything this client sends is
  // server-issued and required — the product, the quantity, the order tags — so
  // an ignored input is never cosmetic here.
  const warnings = session.warnings ?? [];
  if (warnings.length > 0) {
    const stated = warnings.map(describeWarning).join('; ');
    return `FastSpring ignored part of the session request (${stated})`;
  }
  const lineItems = session.cart?.lineItems;
  if (
    lineItems !== undefined &&
    !lineItems.some((item) => item.productPath === params.productPath)
  ) {
    return `FastSpring did not put the requested product ${params.productPath} in the session cart`;
  }
  // The checkout reference is how a payment is matched to the account, the site
  // profile and the plan it was opened for. A session that dropped it would take
  // the buyer's money and produce an order this API cannot link to anything.
  const missingTag = firstMissingTag(session.orderTags, params.tags);
  if (missingTag !== null) {
    return `FastSpring did not keep the order tag ${missingTag} the checkout reference travels in`;
  }
  return null;
}

/** `checkoutStatus` is a list; only a session that is ready and nothing else. */
function isReadyForCheckout(checkoutStatus: readonly string[]): boolean {
  return (
    checkoutStatus.length > 0 && checkoutStatus.every((status) => status === READY_FOR_CHECKOUT)
  );
}

/**
 * A warning as its code and field. FastSpring's own `message` is free text that
 * can echo request content, so it stays out of our error entirely — the code is
 * what an operator acts on.
 */
function describeWarning(warning: { readonly code?: string; readonly field?: string }): string {
  const field = warning.field === undefined ? '' : ` on ${warning.field}`;
  return `${warning.code ?? 'unnamed warning'}${field}`;
}

/** The first tag FastSpring did not echo back unchanged, when it echoed any. */
function firstMissingTag(
  echoed: Readonly<Record<string, unknown>> | undefined,
  sent: Readonly<Record<string, string>>,
): string | null {
  if (echoed === undefined) {
    return null;
  }
  return Object.entries(sent).find(([key, value]) => echoed[key] !== value)?.[0] ?? null;
}

/**
 * The checkout path as URL path segments.
 *
 * FastSpring's `checkoutPath` is `{storeId}/{checkoutId}` and the slash between
 * them is a real path separator: `/v2/checkouts/examplestore/popup-checkout/
 * sessions`. Percent-encoding the whole value turns that into `%2F` and asks
 * FastSpring for a checkout that does not exist, so each segment is encoded on
 * its own and the separator is kept (developer.fastspring.com — Sessions,
 * "Checkout path").
 */
function checkoutPathSegments(checkoutPath: string | null): string {
  return (checkoutPath ?? '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function post(deps: FastSpringClientDeps, url: string, body: unknown): Promise<unknown> {
  const { config } = deps;
  const doFetch = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(config.apiUsername, config.apiPassword),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // The caught error may embed the request (and its Authorization header),
    // so it is never forwarded or logged.
    throw new FastSpringApiError(0, 'FastSpring could not be reached');
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text().catch(() => '');
  if (!response.ok) {
    const failure = describeFailure(response.status, text);
    throw new FastSpringApiError(response.status, failure.message, failure.detail);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new FastSpringApiError(502, 'FastSpring returned a response that is not JSON');
  }
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

/**
 * Splits a provider failure into what the buyer is told and what the operator
 * needs. FastSpring error bodies name the rejected field and can echo request
 * content, so the provider's own words never leave this process: they are the
 * detail, and the buyer gets a sentence about what happened to their checkout.
 */
function describeFailure(status: number, body: string): ProviderFailure {
  if (status === 401 || status === 403) {
    return {
      message: CHECKOUT_TEMPORARILY_UNAVAILABLE,
      detail: `FastSpring rejected the API credentials (HTTP ${status})`,
    };
  }
  if (status === 429) {
    return { message: 'FastSpring rate limit reached, retry shortly' };
  }
  if (status >= 500) {
    return {
      message: 'FastSpring is temporarily unavailable',
      detail: `FastSpring answered HTTP ${status}`,
    };
  }
  const providerMessage = readProviderMessage(body);
  return {
    message: `FastSpring could not open the checkout session (HTTP ${status})`,
    detail:
      providerMessage === null
        ? `FastSpring answered HTTP ${status} with no message field`
        : `FastSpring answered HTTP ${status}: ${providerMessage}`,
  };
}

function readProviderMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === 'string' && parsed.message.length <= 200
      ? parsed.message
      : null;
  } catch {
    return null;
  }
}
