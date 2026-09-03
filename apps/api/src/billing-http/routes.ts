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
import { handlePaddleWebhook, simulatePaidCheckout } from '../billing/index.ts';
import { PADDLE_PRICE_IDS, PAID_PLANS, paddleCustomDataSchema } from '../billing/webhook-schema.ts';
import type { PaidPlan } from '../billing/webhook-schema.ts';
import { sendOk } from '../http/envelope.ts';
import { validationError } from '../http/errors.ts';
import { parseInput } from '../http/validate.ts';
import { findOwnProfile } from '../profiles/routes.ts';

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
}

/** Отдельный handler: маршрут монтируется в app.ts ДО express.json (raw body). */
export function webhookHandler(deps: BillingRouterDeps): RequestHandler {
  return async (req, res) => {
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

  router.post('/billing/dev-checkout', auth, async (req, res) => {
    const input = parseInput(devCheckoutInputSchema, req.body);
    const accountId = accountIdFrom(res);
    const profile = await findOwnProfile(deps.prisma, accountId, input.siteProfileId);
    if (!PAID_PLANS.includes(input.plan)) {
      throw validationError('plan must be Basic or Complete');
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
    }
  });

  return router;
}
