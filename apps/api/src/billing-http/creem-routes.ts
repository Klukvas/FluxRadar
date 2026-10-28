// Creem HTTP surface.
//
// The webhook handler receives the RAW body (express.raw is mounted in index.ts
// before express.json) because the creem-signature HMAC covers the exact bytes
// on the wire. The checkout endpoints never accept an account or a site profile
// from the browser beyond an id the session owner must already own — the binding
// is written server-side and re-read from our database when the payment lands.
//
// The three checkout routes (/billing/checkout-config,
// /billing/checkout-session, /webhooks/creem) are the browser's one checkout
// surface; index.ts mounts this router unconditionally.

import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { scanScopeSchema } from '@fluxradar/contracts';
import type { AiProviderName } from '@fluxradar/ai';
import { z } from 'zod';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import {
  RequestRateLimiter,
  WEBHOOK_LIMIT,
  WEBHOOK_WINDOW_MS,
  scanActionRules,
} from '../auth/rate-limit.ts';
import { aiConsentSchema } from '../billing/checkout-metadata.ts';
import {
  checkoutRequestHash,
  IDEMPOTENCY_KEY_HEADER,
  readIdempotencyKey,
} from '../billing/checkout-idempotency.ts';
import { openCheckoutSessionWhere } from '../billing/checkout-lifecycle.ts';
import { findCheckoutStatus } from '../billing/checkout-status.ts';
import {
  CHECKOUT_SESSION_STATUSES,
  CHECKOUT_UNAVAILABLE_REASONS,
  type CheckoutUnavailableReason,
} from '../billing/constants.ts';
import {
  CREEM_PROVIDER,
  CREEM_SIGNATURE_HEADER,
  createCreemCheckoutSession,
  handleCreemWebhook,
  isCreemPlanPurchasable,
  type CreemConfig,
  type CreemConfigResult,
} from '../billing/creem/index.ts';
import {
  checkoutSessionViewFromRow,
  type CreemCheckoutSessionView,
} from '../billing/creem/checkout-session.ts';
import { BillingUnavailableError } from '../billing/errors.ts';
import { isUniqueViolation } from '../billing/prisma-errors.ts';
import type { FetchLike } from '../billing/fetch-like.ts';
import { WEBHOOK_OUTCOMES } from '../billing/webhook-outcomes.ts';
import { assertOptInProvidersAvailable } from '../billing/opt-in-consent.ts';
import { PAID_PLANS, planPriceUsd, planUrlLimit } from '../billing/plans.ts';
import { sendOk } from '../http/envelope.ts';
import { ApiError, conflict, validationError } from '../http/errors.ts';
import { requiredParam } from '../http/params.ts';
import { parseInput } from '../http/validate.ts';
import type { EgressLocationMonitor } from '../integrations/crawl-egress-monitor.ts';
import { availableOptInAiProviders } from '../integrations/opt-in-ai-config.ts';
import { resolveLaunchEgressLocation } from '../scans/launch-egress.ts';

export const CREEM_SIGNATURE_HEADER_NAME = CREEM_SIGNATURE_HEADER;

// The page count is the one part of the scope whose ceiling is the plan being
// bought, so it cannot be checked by `scanScopeSchema` alone — and a checkout
// that opened on a scope the plan does not sell would be a payment for a scan
// this side would then have to trim. It is refused here, on the input, before
// the profile is read, before a session row exists, and as the same 400
// VALIDATION any other malformed field earns. `createCreemCheckoutSession`
// re-checks it as the floor under this.
const checkoutSessionInputSchema = z
  .object({
    siteProfileId: z.string().min(1),
    plan: z.enum(PAID_PLANS),
    scope: scanScopeSchema,
    aiConsent: aiConsentSchema.optional(),
    expectedProfileConfigVersion: z.number().int().min(1).optional(),
  })
  .superRefine((input, ctx) => {
    const urlLimit = planUrlLimit(input.plan);
    if (input.scope.maxPages !== undefined && input.scope.maxPages > urlLimit) {
      ctx.addIssue({
        code: 'custom',
        message: `maxPages exceeds the ${input.plan} plan limit of ${urlLimit} URLs`,
        path: ['scope', 'maxPages'],
      });
    }
  });

export interface CreemRouterDeps {
  readonly prisma: PrismaClient;
  readonly creem: CreemConfigResult;
  readonly now: () => Date;
  /** Checks the chosen egress location before a buyer is sent to pay (D-228). */
  readonly egress: EgressLocationMonitor;
  readonly requestRateLimiter?: RequestRateLimiter;
  /** Test seam for the provider HTTP call. */
  readonly fetchImpl?: FetchLike;
  /** Test seam; production reads GOOGLE_AI_API_KEY / PERPLEXITY_API_KEY. */
  readonly optInAiProviders?: readonly AiProviderName[];
}

export interface CreemWebhookDeps {
  readonly prisma: PrismaClient;
  readonly creem: CreemConfigResult;
  readonly now: () => Date;
  readonly enqueueScan?: (scanId: string) => void;
  readonly requestRateLimiter?: RequestRateLimiter;
}

/**
 * Resolves the live configuration or fails closed with 503.
 *
 * A partially configured environment is an operator error, not a buyer error —
 * and the names of the absent variables describe how this deployment is wired,
 * which is a map for anyone probing the checkout and means nothing to the buyer.
 * They travel as the error's operator detail, which the HTTP layer logs and
 * never sends; the response carries only the closed reason code.
 */
function requireConfig(result: CreemConfigResult): CreemConfig {
  if (result.state === 'configured') {
    return result.config;
  }
  if (result.state === 'invalid') {
    throw new BillingUnavailableError(CHECKOUT_UNAVAILABLE_REASONS.misconfigured, result.reason);
  }
  throw new BillingUnavailableError(
    CHECKOUT_UNAVAILABLE_REASONS.notConfigured,
    'no CREEM_* variable is set in this environment',
  );
}

export function creemRouter(deps: CreemRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);
  const requestRateLimiter = deps.requestRateLimiter ?? new RequestRateLimiter();
  const optInAiProviders = deps.optInAiProviders ?? availableOptInAiProviders();

  // Lets the UI show a real setup state instead of guessing from a build flag.
  // Every checkout is a redirect to Creem's hosted page. The checkoutFlow/popup
  // fields below exist only for a tab still running the previous web bundle —
  // see the comment there. Nothing secret travels here.
  //
  // `optInAiProviders` is the same kind of fact for the optional AI recipients:
  // the names this deployment can actually send to, so the form offers no
  // choice the scan would then fail. Names only — no key, host or model.
  router.get('/billing/checkout-config', auth, (_req, res) => {
    const config = deps.creem.state === 'configured' ? deps.creem.config : null;
    const available = config !== null;
    sendOk(res, {
      provider: CREEM_PROVIDER,
      available,
      mode: config?.mode ?? null,
      unavailableReason: available ? null : unavailableReason(deps.creem),
      // `checkoutFlow`/`popup` exist only so a tab still running the previous
      // (FastSpring-era) web bundle reads them during and shortly after this
      // deploy: that bundle's `checkoutFlowOf` takes 'redirect' at its word,
      // and otherwise reads a missing `popup` as truthy (`undefined !== null`)
      // and opens a popup tab that `window.open` often blocks. The branch's
      // own web client ignores both fields. Safe to remove in a later release
      // once no old tab can still be open.
      checkoutFlow: 'redirect',
      popup: null,
      // `available` per plan, because a product can exist at the provider for
      // one plan and not another. A plan without one is still listed with its
      // price and marked unavailable, so the UI can say it cannot be bought here
      // rather than silently dropping a product the catalogue advertises.
      plans: PAID_PLANS.map((plan) => ({
        plan,
        priceUsd: planPriceUsd(plan),
        currency: 'USD',
        available: config !== null && isCreemPlanPurchasable(config, plan),
      })),
      optInAiProviders,
    });
  });

  router.post('/billing/checkout-session', auth, async (req, res) => {
    const config = requireConfig(deps.creem);
    // One key per draft (§18 idempotency contract): a retry after a lost
    // response must find its own session, never open a second payable one.
    const clientKey = readIdempotencyKey(req.get(IDEMPOTENCY_KEY_HEADER));
    const input = parseInput(checkoutSessionInputSchema, req.body);
    const accountId = accountIdFrom(res);
    requestRateLimiter.assertAllowedAll(
      scanActionRules('checkout', accountId, req.ip ?? 'unknown'),
    );
    const requestHash = checkoutRequestHash(input);

    if (clientKey !== null) {
      const replayed = await replayCheckoutIfAny(deps, accountId, clientKey, requestHash);
      if (replayed !== null) {
        sendOk(res, replayed, { status: 201 });
        return;
      }
      // No row for this account holds the key. If another account does, that is
      // deliberate cross-account reuse of someone else's draft key — refuse
      // rather than mint a second checkout under it.
      const foreign = await deps.prisma.checkoutSession.findFirst({
        where: { clientKey },
        select: { accountId: true },
      });
      if (foreign !== null) {
        throw conflict(
          'CHECKOUT_IDEMPOTENCY_CONFLICT',
          'This checkout attempt was already started under this key. Reload and try again.',
        );
      }
    }

    // Before the session exists, and long before a card is charged.
    assertOptInProvidersAvailable(input.aiConsent, optInAiProviders);
    // Before a session row exists or the provider is called: a buyer must not
    // pay for a scan from a country whose network is down right now.
    const egress = await resolveLaunchEgressLocation(deps.egress, input.scope.egressLocation);
    let session: CreemCheckoutSessionView;
    try {
      session = await createCreemCheckoutSession(
        {
          prisma: deps.prisma,
          config,
          now: deps.now,
          ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
        },
        {
          accountId,
          siteProfileId: input.siteProfileId,
          plan: input.plan,
          scope: input.scope,
          egress,
          aiConsent: input.aiConsent,
          expectedProfileConfigVersion: input.expectedProfileConfigVersion,
          clientKey: clientKey ?? undefined,
          // The hash only matters next to its key: a headerless request stores
          // neither, exactly as it did before the contract existed.
          requestHash: clientKey === null ? undefined : requestHash,
        },
      );
    } catch (error) {
      // A concurrent retry of the same draft can race this create into the
      // per-account unique index. Re-read and follow the state machine instead
      // of answering 500. `raced === null` means the re-read took the adoption
      // path (a closed row released the key) or found no row at all; either
      // way this loser of the create race answers 409, and the client's next
      // retry converges: it finds the winner's row and replays it, or finds no
      // keyed row and creates fresh. Refusing loudly here is what keeps the
      // race from ever creating twice.
      if (clientKey !== null && isUniqueViolation(error, 'clientKey')) {
        const raced = await replayCheckoutIfAny(deps, accountId, clientKey, requestHash);
        if (raced !== null) {
          sendOk(res, raced, { status: 201 });
          return;
        }
        throw conflict(
          'CHECKOUT_IDEMPOTENCY_CONFLICT',
          'This checkout attempt was already started under this key. Reload and try again.',
        );
      }
      throw error;
    }
    sendOk(res, session, { status: 201 });
  });

  // Polled by the buyer after checkout: access appears only once the signed
  // provider webhook has been processed, never because the browser said so —
  // and never because Creem sent the buyer back to the return page.
  router.get('/billing/checkout-session/:reference', auth, async (req, res) => {
    const reference = requiredParam(req.params.reference, 'reference');
    const status = await findCheckoutStatus(deps.prisma, accountIdFrom(res), reference);
    sendOk(res, status);
  });

  return router;
}

/**
 * The idempotent replay of a draft that already reached the server.
 *
 * Looked up by (accountId, clientKey): the unique index is per account, and a
 * key minted by another account is theirs, never a replay of ours (the route
 * refuses cross-account reuse before any create).
 *
 * - Same hash, session still open or already completed, provider view present:
 *   the stored view comes back verbatim — no provider call, no new payable
 *   session, and none of the launch preconditions re-run, because the row
 *   already captured the facts they would re-derive (the profile version lock
 *   included). The view's mode is the row's own, not the current config's.
 * - Same hash, session still open, provider view MISSING: the row was inserted
 *   but the process died before the provider fields were stored. That window
 *   covers both "died before the provider call" and "died after it" —
 *   indistinguishable from the row — so neither replay nor adoption is safe.
 *   A retryable coded error keeps the draft free of a bare 500, and the row's
 *   deadline decides when the key can be adopted.
 * - Same hash, session closed (rejected or expired): the draft's checkout is
 *   dead. The key is released from the old row and the caller falls through to
 *   create a fresh session under the SAME key, so the next repeat dedupes
 *   against the new row. If that fresh creation fails, the next repeat either
 *   finds no row under the key (create failed before the insert) or finds the
 *   freshly closed row and adopts again — the same end state either way: one
 *   fresh attempt per retry, never two payable sessions.
 * - Different hash: a client bug; refused loudly rather than silently
 *   creating a second session for one key.
 * - No row: null — create as if the key were new.
 */
async function replayCheckoutIfAny(
  deps: CreemRouterDeps,
  accountId: string,
  clientKey: string,
  requestHash: string,
): Promise<CreemCheckoutSessionView | null> {
  const existing = await deps.prisma.checkoutSession.findFirst({
    where: { accountId, clientKey },
  });
  if (existing === null) return null;
  if (existing.requestHash !== requestHash) {
    throw conflict(
      'CHECKOUT_IDEMPOTENCY_CONFLICT',
      'This checkout attempt was already started with different settings. Reload and try again.',
    );
  }
  const stillOpen =
    (await deps.prisma.checkoutSession.findFirst({
      where: { id: existing.id, ...openCheckoutSessionWhere(deps.now()) },
    })) !== null;
  const hasProviderView =
    existing.providerSessionId !== null && existing.checkoutUrl !== null;
  if (stillOpen && !hasProviderView) {
    throw new ApiError(
      409,
      'CHECKOUT_STILL_OPENING',
      'The checkout is still opening. Try again in a moment.',
      5,
    );
  }
  if (stillOpen || existing.status === CHECKOUT_SESSION_STATUSES.completed) {
    return checkoutSessionViewFromRow(existing);
  }
  await deps.prisma.checkoutSession.updateMany({
    where: { id: existing.id, clientKey },
    data: { clientKey: null },
  });
  return null;
}

/** Mounted in index.ts before express.json so the HMAC sees the wire bytes. */
export function creemWebhookHandler(deps: CreemWebhookDeps): RequestHandler {
  return async (req, res) => {
    deps.requestRateLimiter?.assertAllowed(
      `creem-webhook:${req.ip ?? 'unknown'}`,
      WEBHOOK_LIMIT,
      WEBHOOK_WINDOW_MS,
    );
    const config = requireConfig(deps.creem);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw validationError('webhook body is empty');
    }
    const signature = req.get(CREEM_SIGNATURE_HEADER_NAME) ?? '';
    const result = await handleCreemWebhook(deps.prisma, req.body, signature, {
      secret: config.webhookSecret,
      expectLive: config.liveMode,
      now: deps.now(),
    });
    // 202 says what 200 cannot: the delivery was accepted and stored, but the
    // event could not be acted on yet because the order it refers to has not
    // arrived. It stays a 2xx on purpose — a Creem retry would find the same
    // missing order and the event is replayed from its stored payload the
    // moment its checkout.completed lands (billing/creem/pending-refunds).
    const pending = result.results.some((event) => event.outcome === WEBHOOK_OUTCOMES.unlinked);
    sendOk(
      res,
      {
        received: result.received,
        results: result.results.map(({ eventId, eventType, outcome, reason, scanId }) => ({
          eventId,
          eventType,
          outcome,
          reason,
          scanId,
        })),
      },
      pending ? { status: 202 } : {},
    );
    // Answer first: a slow queue must not turn a processed payment into a Creem
    // retry. Nothing is mailed from here — Creem sends the buyer their own
    // payment receipt, and a second confirmation from us said the same thing
    // twice.
    for (const scanId of result.createdScanIds) {
      deps.enqueueScan?.(scanId);
    }
  };
}

/**
 * The closed code a client may see. `invalid` deliberately collapses to
 * "misconfigured": which variables are missing is in the startup log, not in a
 * browser-facing response.
 */
function unavailableReason(result: CreemConfigResult): CheckoutUnavailableReason {
  return result.state === 'invalid'
    ? CHECKOUT_UNAVAILABLE_REASONS.misconfigured
    : CHECKOUT_UNAVAILABLE_REASONS.notConfigured;
}
