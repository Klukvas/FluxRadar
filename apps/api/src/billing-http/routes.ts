// HTTP-слой биллинга. Webhook принимает СЫРОЕ тело (express.raw монтируется в
// app.ts до express.json) — HMAC-SHA256 считается по байтам провода (D-029).
// Dev-checkout (D-008) строит подписанное событие MockPaddle и прогоняет его
// через боевой webhook-код; scope и consent едут внутри события (D-134).

import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { TARIFFS, scanScopeSchema } from '@fluxradar/contracts';
import { z } from 'zod';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import { isInternalFreeEmail } from '../billing/internal-access.ts';
import { createInternalFreeScan } from '../billing/internal-checkout.ts';
import { handlePaddleWebhook, simulatePaidCheckout } from '../billing/index.ts';
import { PADDLE_PRICE_IDS, PAID_PLANS, paddleCustomDataSchema } from '../billing/webhook-schema.ts';
import type { PaidPlan } from '../billing/webhook-schema.ts';
import { sendOk } from '../http/envelope.ts';
import { paymentRequired, unauthorized, validationError } from '../http/errors.ts';
import { parseInput } from '../http/validate.ts';
import { findOwnProfile } from '../profiles/routes.ts';
import {
  SCAN_ACTION_LIMIT,
  SCAN_ACTION_WINDOW_MS,
  WEBHOOK_LIMIT,
  WEBHOOK_WINDOW_MS,
  RequestRateLimiter,
} from '../auth/rate-limit.ts';
import type { Mailer } from '../email/mailer.ts';
import { notifyScanEvent } from '../email/notifications.ts';

export const PADDLE_SIGNATURE_HEADER = 'paddle-signature';

const devCheckoutInputSchema = z
  .object({
    siteProfileId: z.string().min(1),
    plan: z.enum(Object.keys(PADDLE_PRICE_IDS) as [PaidPlan, ...PaidPlan[]]),
    scope: scanScopeSchema,
    aiConsent: paddleCustomDataSchema.shape.aiConsent,
  })
  .superRefine((input, ctx) => {
    const { urlLimit } = TARIFFS[input.plan];
    if (input.scope.maxPages !== undefined && input.scope.maxPages > urlLimit) {
      ctx.addIssue({
        code: 'custom',
        message: `maxPages exceeds the ${input.plan} plan limit of ${urlLimit} URLs`,
        path: ['scope', 'maxPages'],
      });
    }
  });

export interface BillingRouterDeps {
  readonly prisma: PrismaClient;
  readonly webhookSecret: string;
  readonly now: () => Date;
  readonly enqueueScan?: (scanId: string) => void;
  readonly internalFreeEmails: ReadonlySet<string>;
  readonly requestRateLimiter?: RequestRateLimiter;
  readonly mailer?: Mailer;
}

type WebhookHandlerDeps = Pick<BillingRouterDeps, 'prisma' | 'webhookSecret' | 'now'> & {
  readonly requestRateLimiter?: RequestRateLimiter;
};

/** Отдельный handler: маршрут монтируется в app.ts ДО express.json (raw body). */
export function webhookHandler(deps: WebhookHandlerDeps): RequestHandler {
  return async (req, res) => {
    deps.requestRateLimiter?.assertAllowed(
      `webhook:${req.ip ?? 'unknown'}`,
      WEBHOOK_LIMIT,
      WEBHOOK_WINDOW_MS,
    );
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (rawBody === '') {
      throw validationError('webhook body is empty');
    }
    const signature = req.get(PADDLE_SIGNATURE_HEADER) ?? '';
    const result = await handlePaddleWebhook(deps.prisma, rawBody, signature, {
      secret: deps.webhookSecret,
      now: deps.now(),
    });
    sendOk(res, {
      deduplicated: result.deduplicated,
      eventId: result.eventId,
      eventType: result.eventType,
      purchaseId: result.purchaseId,
      scanId: result.scanId,
    });
  };
}

export function billingRouter(deps: BillingRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);
  const requestRateLimiter = deps.requestRateLimiter ?? new RequestRateLimiter();

  router.post('/billing/dev-checkout', auth, async (req, res) => {
    const input = parseInput(devCheckoutInputSchema, req.body);
    const accountId = accountIdFrom(res);
    requestRateLimiter.assertAllowed(
      `checkout:${accountId}:${req.ip ?? 'unknown'}`,
      SCAN_ACTION_LIMIT,
      SCAN_ACTION_WINDOW_MS,
    );
    const account = await deps.prisma.account.findUnique({
      where: { id: accountId },
      select: { email: true },
    });
    if (account === null) {
      throw unauthorized('session account no longer exists');
    }
    const internalFreeAccess = isInternalFreeEmail(account.email, deps.internalFreeEmails);
    if (process.env.NODE_ENV === 'production' && !internalFreeAccess) {
      throw paymentRequired('live checkout is not configured for this environment');
    }
    const profile = await findOwnProfile(deps.prisma, accountId, input.siteProfileId);
    if (!PAID_PLANS.includes(input.plan)) {
      throw validationError('plan must be Basic or Complete');
    }

    if (internalFreeAccess) {
      const scan = await createInternalFreeScan({
        prisma: deps.prisma,
        accountId,
        siteProfileId: profile.id,
        plan: input.plan,
        scope: input.scope,
        aiConsent: input.aiConsent,
        now: deps.now(),
      });
      sendOk(
        res,
        {
          purchaseId: null,
          entitlementId: null,
          scanId: scan.id,
          transactionId: null,
          eventId: null,
          plan: input.plan,
          billing: 'internal-free',
        },
        { status: 201 },
      );
      deps.enqueueScan?.(scan.id);
      void notifyScanEvent(
        deps.prisma,
        deps.mailer,
        scan.id,
        'purchase_confirmed',
        'Your internal test audit is ready to run.',
      ).catch(() => undefined);
      return;
    }

    const { result, event } = await simulatePaidCheckout({
      prisma: deps.prisma,
      accountId,
      siteProfileId: profile.id,
      plan: input.plan,
      secret: deps.webhookSecret,
      customData: {
        scope: input.scope,
        ...(input.aiConsent !== undefined ? { aiConsent: input.aiConsent } : {}),
      },
    });
    sendOk(
      res,
      {
        purchaseId: result.purchaseId,
        entitlementId: result.entitlementId,
        scanId: result.scanId,
        transactionId: event.transactionId,
        eventId: event.eventId,
        plan: input.plan,
      },
      { status: 201 },
    );
    if (result.scanId !== null) {
      deps.enqueueScan?.(result.scanId);
      void notifyScanEvent(
        deps.prisma,
        deps.mailer,
        result.scanId,
        'purchase_confirmed',
        'Your paid audit is ready to run.',
      ).catch(() => undefined);
    }
  });

  return router;
}
