// FastSpring HTTP surface.
//
// The webhook handler receives the RAW body (express.raw is mounted in index.ts
// before express.json) because the X-FS-Signature HMAC covers the exact bytes on
// the wire. The checkout endpoints never accept an account or a site profile
// from the browser beyond an id the session owner must already own — the binding
// is written server-side and re-read from our database when the payment lands.

import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { scanScopeSchema } from '@fluxradar/contracts';
import { z } from 'zod';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import {
  RequestRateLimiter,
  SCAN_ACTION_LIMIT,
  SCAN_ACTION_WINDOW_MS,
  WEBHOOK_LIMIT,
  WEBHOOK_WINDOW_MS,
} from '../auth/rate-limit.ts';
import { aiConsentSchema } from '../billing/checkout-metadata.ts';
import {
  CHECKOUT_UNAVAILABLE_REASONS,
  type CheckoutUnavailableReason,
} from '../billing/constants.ts';
import { BillingUnavailableError } from '../billing/errors.ts';
import { PAID_PLANS, planPriceUsd } from '../billing/plans.ts';
import {
  FASTSPRING_PROVIDER,
  WEBHOOK_OUTCOMES,
  createCheckoutSession,
  findCheckoutStatus,
  handleFastSpringWebhook,
  type FastSpringConfig,
  type FastSpringConfigResult,
  type FetchLike,
} from '../billing/fastspring/index.ts';
import type { Mailer } from '../email/mailer.ts';
import { notifyScanEvent } from '../email/notifications.ts';
import { sendOk } from '../http/envelope.ts';
import { validationError } from '../http/errors.ts';
import { requiredParam } from '../http/params.ts';
import { parseInput } from '../http/validate.ts';

export const FASTSPRING_SIGNATURE_HEADER_NAME = 'x-fs-signature';

const checkoutSessionInputSchema = z.object({
  siteProfileId: z.string().min(1),
  plan: z.enum(PAID_PLANS),
  scope: scanScopeSchema,
  aiConsent: aiConsentSchema.optional(),
});

export interface FastSpringRouterDeps {
  readonly prisma: PrismaClient;
  readonly fastSpring: FastSpringConfigResult;
  readonly now: () => Date;
  readonly requestRateLimiter?: RequestRateLimiter;
  /** Test seam for the provider HTTP call. */
  readonly fetchImpl?: FetchLike;
}

export interface FastSpringWebhookDeps {
  readonly prisma: PrismaClient;
  readonly fastSpring: FastSpringConfigResult;
  readonly now: () => Date;
  readonly enqueueScan?: (scanId: string) => void;
  readonly mailer?: Mailer;
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
function requireConfig(result: FastSpringConfigResult): FastSpringConfig {
  if (result.state === 'configured') {
    return result.config;
  }
  if (result.state === 'invalid') {
    throw new BillingUnavailableError(CHECKOUT_UNAVAILABLE_REASONS.misconfigured, result.reason);
  }
  throw new BillingUnavailableError(
    CHECKOUT_UNAVAILABLE_REASONS.notConfigured,
    'no FASTSPRING_* variable is set in this environment',
  );
}

export function fastSpringRouter(deps: FastSpringRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);
  const requestRateLimiter = deps.requestRateLimiter ?? new RequestRateLimiter();

  // Lets the UI show a real setup state instead of guessing from a build flag.
  //
  // `popup` is what turns the browser's checkout into a FastSpring popup rather
  // than a hosted page in another tab: it carries the storefront the Store
  // Builder Library is initialised with. It is deliberately server-issued and
  // validated (billing/fastspring/popup-storefront.ts) instead of baked into the
  // bundle, so the same build serves a test and a live deployment and neither
  // can be pointed at the other's storefront. Nothing secret travels here —
  // every FastSpring seller ships this value in a public script tag.
  router.get('/billing/checkout-config', auth, (_req, res) => {
    const available = deps.fastSpring.state === 'configured';
    const popupStorefront = available ? deps.fastSpring.config.popupStorefront : null;
    sendOk(res, {
      provider: FASTSPRING_PROVIDER,
      available,
      mode: available ? deps.fastSpring.config.mode : null,
      unavailableReason: available ? null : unavailableReason(deps.fastSpring),
      popup: popupStorefront === null ? null : { storefront: popupStorefront },
      plans: PAID_PLANS.map((plan) => ({ plan, priceUsd: planPriceUsd(plan), currency: 'USD' })),
    });
  });

  router.post('/billing/checkout-session', auth, async (req, res) => {
    const config = requireConfig(deps.fastSpring);
    const input = parseInput(checkoutSessionInputSchema, req.body);
    const accountId = accountIdFrom(res);
    requestRateLimiter.assertAllowed(
      `checkout:${accountId}:${req.ip ?? 'unknown'}`,
      SCAN_ACTION_LIMIT,
      SCAN_ACTION_WINDOW_MS,
    );
    const session = await createCheckoutSession(
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
        aiConsent: input.aiConsent,
      },
    );
    sendOk(res, session, { status: 201 });
  });

  // Polled by the buyer after checkout: access appears only once the signed
  // provider webhook has been processed, never because the browser said so.
  router.get('/billing/checkout-session/:reference', auth, async (req, res) => {
    const reference = requiredParam(req.params.reference, 'reference');
    const status = await findCheckoutStatus(deps.prisma, accountIdFrom(res), reference);
    sendOk(res, status);
  });

  return router;
}

/** Mounted in index.ts before express.json so the HMAC sees the wire bytes. */
export function fastSpringWebhookHandler(deps: FastSpringWebhookDeps): RequestHandler {
  return async (req, res) => {
    deps.requestRateLimiter?.assertAllowed(
      `fastspring-webhook:${req.ip ?? 'unknown'}`,
      WEBHOOK_LIMIT,
      WEBHOOK_WINDOW_MS,
    );
    const config = requireConfig(deps.fastSpring);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw validationError('webhook body is empty');
    }
    const signature = req.get(FASTSPRING_SIGNATURE_HEADER_NAME) ?? '';
    const result = await handleFastSpringWebhook(deps.prisma, req.body, signature, {
      secret: config.webhookSecret,
      expectLive: config.liveMode,
      currencyPolicy: config.currencyPolicy,
      now: deps.now(),
    });
    // 202 says what 200 cannot: the delivery was accepted and stored, but at
    // least one event could not be acted on yet because the order it refers to
    // has not arrived. It stays a 2xx on purpose — a FastSpring retry would find
    // the same missing order and the event is replayed from its stored payload
    // the moment its order.completed lands (billing/fastspring/pending-refunds).
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
    // Answer first: a slow queue or mailer must not turn a processed payment
    // into a FastSpring retry.
    for (const scanId of result.createdScanIds) {
      deps.enqueueScan?.(scanId);
      void notifyScanEvent(
        deps.prisma,
        deps.mailer,
        scanId,
        'purchase_confirmed',
        'Your paid audit is ready to run.',
      ).catch(() => undefined);
    }
  };
}

/**
 * The closed code a client may see. `invalid` deliberately collapses to
 * "misconfigured": which variables are missing is in the startup log, not in a
 * browser-facing response.
 */
function unavailableReason(result: FastSpringConfigResult): CheckoutUnavailableReason {
  return result.state === 'invalid'
    ? CHECKOUT_UNAVAILABLE_REASONS.misconfigured
    : CHECKOUT_UNAVAILABLE_REASONS.notConfigured;
}
