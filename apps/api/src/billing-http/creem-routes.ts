// Creem HTTP surface.
//
// The webhook handler receives the RAW body (express.raw is mounted in index.ts
// before express.json) because the creem-signature HMAC covers the exact bytes
// on the wire. The checkout endpoints never accept an account or a site profile
// from the browser beyond an id the session owner must already own — the binding
// is written server-side and re-read from our database when the payment lands.
//
// The three checkout routes are the same paths the FastSpring router serves,
// deliberately: the browser talks to one checkout surface whichever provider is
// behind it, and index.ts mounts exactly one of the two routers
// (billing/checkout-provider.ts decides which).

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
import { findCheckoutStatus } from '../billing/checkout-status.ts';
import {
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
import { BillingUnavailableError } from '../billing/errors.ts';
import type { FetchLike } from '../billing/fastspring/client.ts';
import { WEBHOOK_OUTCOMES } from '../billing/fastspring/outcomes.ts';
import { assertOptInProvidersAvailable } from '../billing/opt-in-consent.ts';
import { PAID_PLANS, planPriceUsd, planUrlLimit } from '../billing/plans.ts';
import type { Mailer } from '../email/mailer.ts';
import { notifyScanEvent } from '../email/notifications.ts';
import { sendOk } from '../http/envelope.ts';
import { validationError } from '../http/errors.ts';
import { requiredParam } from '../http/params.ts';
import { parseInput } from '../http/validate.ts';
import type { EgressLocationMonitor } from '../integrations/crawl-egress-monitor.ts';
import { availableOptInAiProviders } from '../integrations/opt-in-ai-config.ts';
import { resolveLaunchEgressLocation } from '../scans/launch-egress.ts';

export const CREEM_SIGNATURE_HEADER_NAME = CREEM_SIGNATURE_HEADER;

/**
 * How the browser gets the buyer to the checkout. Creem hosts its page, so the
 * browser navigates there and is sent back afterwards; the FastSpring router
 * answers `popup` or `tab` for its two surfaces.
 */
export const CREEM_CHECKOUT_FLOW = 'redirect' as const;

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
  //
  // `checkoutFlow: 'redirect'` is what tells the browser to navigate to the
  // hosted page rather than open a popup or a tab; `popup` is null because no
  // provider script is ever loaded on our page for Creem. Nothing secret
  // travels here.
  //
  // `optInAiProviders` is the same kind of fact for the optional AI recipients:
  // the names this deployment can actually send to, so the form offers no
  // choice the scan would then fail. Names only — no key, host or model.
  router.get('/billing/checkout-config', auth, (_req, res) => {
    const config = deps.creem.state === 'configured' ? deps.creem.config : null;
    const available = config !== null;
    sendOk(res, {
      provider: CREEM_PROVIDER,
      checkoutFlow: CREEM_CHECKOUT_FLOW,
      available,
      mode: config?.mode ?? null,
      unavailableReason: available ? null : unavailableReason(deps.creem),
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
    const input = parseInput(checkoutSessionInputSchema, req.body);
    // Before the session exists, and long before a card is charged.
    assertOptInProvidersAvailable(input.aiConsent, optInAiProviders);
    const accountId = accountIdFrom(res);
    requestRateLimiter.assertAllowedAll(
      scanActionRules('checkout', accountId, req.ip ?? 'unknown'),
    );
    // Before a session row exists or the provider is called: a buyer must not
    // pay for a scan from a country whose network is down right now.
    const egress = await resolveLaunchEgressLocation(deps.egress, input.scope.egressLocation);
    const session = await createCreemCheckoutSession(
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
      },
    );
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
    // Answer first: a slow queue or mailer must not turn a processed payment
    // into a Creem retry.
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
function unavailableReason(result: CreemConfigResult): CheckoutUnavailableReason {
  return result.state === 'invalid'
    ? CHECKOUT_UNAVAILABLE_REASONS.misconfigured
    : CHECKOUT_UNAVAILABLE_REASONS.notConfigured;
}
