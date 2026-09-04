// Маршруты auth: register / login / logout / me. Пароли — bcrypt cost 12;
// login защищён in-memory rate limit 5/15 мин на (email, IP); ответ на
// неверный email и неверный пароль одинаков — перечисление аккаунтов закрыто.

import { Router } from 'express';
import type { Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { loginInputSchema, registerInputSchema } from '@fluxradar/contracts';

import { isUniqueViolation } from '../billing/prisma-errors.ts';
import { isInternalFreeEmail } from '../billing/internal-access.ts';
import { readCookie } from '../http/cookies.ts';
import { conflict, unauthorized } from '../http/errors.ts';
import { sendOk } from '../http/envelope.ts';
import { parseInput } from '../http/validate.ts';
import { deleteAccountData } from '../data-retention.ts';
import { accountIdFrom, requireAuth } from './middleware.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import type { LoginRateLimiter } from './rate-limit.ts';
import { SESSION_COOKIE_NAME, createSession, deleteSessionByToken } from './sessions.ts';

export interface AuthRouterDeps {
  readonly prisma: PrismaClient;
  readonly loginRateLimiter: LoginRateLimiter;
  readonly now: () => Date;
  readonly internalFreeEmails: ReadonlySet<string>;
}

function accountDto(
  account: { readonly id: string; readonly email: string },
  internalFreeEmails: ReadonlySet<string>,
): Record<string, unknown> {
  return {
    accountId: account.id,
    email: account.email,
    internalFreeAccess: isInternalFreeEmail(account.email, internalFreeEmails),
  };
}

async function attachSessionCookie(
  deps: AuthRouterDeps,
  res: Response,
  accountId: string,
): Promise<void> {
  const session = await createSession(deps.prisma, accountId, deps.now());
  // Secure-флаг не ставится: v0.1 работает на локальном http (D-011);
  // включается вместе с HTTPS-развёртыванием.
  res.cookie(SESSION_COOKIE_NAME, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: session.expiresAt,
  });
}

export function authRouter(deps: AuthRouterDeps): Router {
  const router = Router();
  const { prisma } = deps;

  router.post('/auth/register', async (req, res) => {
    const input = parseInput(registerInputSchema, req.body);
    const passwordHash = await hashPassword(input.password);
    const email = input.email.toLowerCase();
    try {
      const account = await prisma.account.create({ data: { email, passwordHash } });
      await attachSessionCookie(deps, res, account.id);
      sendOk(res, accountDto(account, deps.internalFreeEmails), { status: 201 });
    } catch (error) {
      if (isUniqueViolation(error, 'email')) {
        throw conflict('EMAIL_TAKEN', 'an account with this email already exists');
      }
      throw error;
    }
  });

  router.post('/auth/login', async (req, res) => {
    const input = parseInput(loginInputSchema, req.body);
    const email = input.email.toLowerCase();
    const ip = req.ip ?? 'unknown';
    deps.loginRateLimiter.assertAllowed(email, ip);

    const account = await prisma.account.findUnique({ where: { email } });
    const passwordOk =
      account !== null && (await verifyPassword(input.password, account.passwordHash));
    if (account === null || !passwordOk) {
      throw unauthorized('invalid email or password');
    }

    deps.loginRateLimiter.reset(email, ip);
    await attachSessionCookie(deps, res, account.id);
    sendOk(res, accountDto(account, deps.internalFreeEmails));
  });

  router.post('/auth/logout', async (req, res) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    if (token !== null) {
      await deleteSessionByToken(prisma, token);
    }
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    sendOk(res, null);
  });

  router.get('/auth/me', requireAuth(prisma, deps.now), async (_req, res) => {
    const accountId = accountIdFrom(res);
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (account === null) {
      throw unauthorized('session account no longer exists');
    }
    sendOk(res, accountDto(account, deps.internalFreeEmails));
  });

  router.delete('/account', requireAuth(prisma, deps.now), async (_req, res) => {
    const accountId = accountIdFrom(res);
    await deleteAccountData(prisma, accountId);
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    sendOk(res, { deleted: true });
  });

  return router;
}
