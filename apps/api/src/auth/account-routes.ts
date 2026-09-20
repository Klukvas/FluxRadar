// The signed-in owner's own account: changing the password and reading what
// they have bought.
//
// Both existed only indirectly. A password could be changed only by pretending
// to have forgotten it and waiting for an email, and purchases were visible only
// as the scans they started — a refunded or disputed one simply vanished from
// view, with no record of the charge the owner can see on their card statement.

import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { registerInputSchema } from '@fluxradar/contracts';
import { z } from 'zod';

import { readCookie } from '../http/cookies.ts';
import { sendOk } from '../http/envelope.ts';
import { ApiError, unauthorized } from '../http/errors.ts';
import { parseInput } from '../http/validate.ts';
import { accountIdFrom, requireAuth } from './middleware.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import {
  PASSWORD_CHANGE_LIMIT,
  PASSWORD_CHANGE_WINDOW_MS,
  RequestRateLimiter,
} from './rate-limit.ts';
import { SESSION_COOKIE_NAME, deleteOtherSessions } from './sessions.ts';

export interface AccountRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly requestRateLimiter?: RequestRateLimiter;
}

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: registerInputSchema.shape.password,
});

/** Most recent purchases shown on the account screen; older ones are in the receipts email. */
const PURCHASE_HISTORY_LIMIT = 50;

export function accountRouter(deps: AccountRouterDeps): Router {
  const router = Router();
  const { prisma } = deps;
  const requestRateLimiter = deps.requestRateLimiter ?? new RequestRateLimiter();
  const auth = requireAuth(prisma, deps.now);

  router.post('/account/password', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    // Counted before bcrypt, like login: every attempt costs ~250ms of CPU.
    requestRateLimiter.assertAllowed(
      `password-change:${accountId}`,
      PASSWORD_CHANGE_LIMIT,
      PASSWORD_CHANGE_WINDOW_MS,
    );
    const input = parseInput(passwordChangeSchema, req.body);
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (account === null) throw unauthorized('session account no longer exists');
    if (!(await verifyPassword(input.currentPassword, account.passwordHash))) {
      // 400 rather than 401: the session is valid, and a 401 reads to the web
      // app as "signed out".
      throw new ApiError(400, 'CURRENT_PASSWORD_INCORRECT', 'current password is incorrect');
    }
    const passwordHash = await hashPassword(input.newPassword);
    await prisma.account.update({ where: { id: accountId }, data: { passwordHash } });
    await deleteOtherSessions(
      prisma,
      accountId,
      readCookie(req.headers.cookie, SESSION_COOKIE_NAME),
    );
    sendOk(res, { status: 'changed' });
  });

  router.get('/account/purchases', auth, async (_req, res) => {
    const accountId = accountIdFrom(res);
    const purchases = await prisma.purchase.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take: PURCHASE_HISTORY_LIMIT,
      select: {
        id: true,
        plan: true,
        status: true,
        amountUsd: true,
        currency: true,
        settledAmount: true,
        settledCurrency: true,
        createdAt: true,
        siteProfile: { select: { domain: true, name: true } },
        entitlement: { select: { expiresAt: true, suspended: true } },
        scan: { select: { id: true, status: true } },
      },
    });
    sendOk(
      res,
      purchases.map((purchase) => ({
        id: purchase.id,
        plan: purchase.plan,
        status: purchase.status,
        // What the card was charged: the settled amount when the provider
        // localised the currency, otherwise the list price.
        amount: purchase.settledAmount ?? purchase.amountUsd,
        currency: purchase.settledCurrency ?? purchase.currency,
        createdAt: purchase.createdAt.toISOString(),
        domain: purchase.siteProfile.domain,
        profileName: purchase.siteProfile.name,
        entitlementExpiresAt: purchase.entitlement?.expiresAt.toISOString() ?? null,
        scanId: purchase.scan?.id ?? null,
        scanStatus: purchase.scan?.status ?? null,
      })),
    );
  });

  return router;
}
