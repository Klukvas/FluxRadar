// Маршруты auth: register / login / logout / me. Пароли — bcrypt cost 12;
// login защищён in-memory rate limit 5/15 мин на (email, IP); ответ на
// неверный email и неверный пароль одинаков — перечисление аккаунтов закрыто.

import { Router } from 'express';
import type { Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { loginInputSchema, registerInputSchema } from '@fluxradar/contracts';
import { z } from 'zod';

import { isUniqueViolation } from '../billing/prisma-errors.ts';
import { isInternalFreeEmail } from '../billing/internal-access.ts';
import { readCookie } from '../http/cookies.ts';
import { conflict, unauthorized, validationError } from '../http/errors.ts';
import { sendOk } from '../http/envelope.ts';
import { parseInput } from '../http/validate.ts';
import { accountDeletionHash, deleteAccountData } from '../data-retention.ts';
import { accountIdFrom, requireAuth } from './middleware.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import {
  EMAIL_ACTION_LIMIT,
  EMAIL_ACTION_WINDOW_MS,
  EMAIL_IP_ACTION_LIMIT,
  EMAIL_TOKEN_ACTION_LIMIT,
  REGISTER_LIMIT,
  REGISTER_WINDOW_MS,
  type LoginRateLimiter,
  RequestRateLimiter,
} from './rate-limit.ts';
import { SESSION_COOKIE_NAME, createSession, deleteSessionByToken } from './sessions.ts';
import { consumeEmailToken, issueEmailToken } from './email-tokens.ts';
import { createMailer, emailText, type Mailer } from '../email/mailer.ts';
import type { PrivateObjectStore } from '../integrations/s3.ts';
import type { ApiLogger } from '../http/logger.ts';

export interface AuthRouterDeps {
  readonly prisma: PrismaClient;
  readonly loginRateLimiter: LoginRateLimiter;
  readonly now: () => Date;
  readonly internalFreeEmails: ReadonlySet<string>;
  readonly requestRateLimiter?: RequestRateLimiter;
  readonly mailer?: Mailer;
  readonly frontendOrigin?: string;
  readonly objectStore?: PrivateObjectStore | null;
  readonly logger?: ApiLogger;
}

function accountDto(
  account: {
    readonly id: string;
    readonly email: string;
    readonly emailVerifiedAt?: Date | null;
    readonly onboardingCompletedAt?: Date | null;
    readonly onboardingSkippedAt?: Date | null;
  },
  internalFreeEmails: ReadonlySet<string>,
): Record<string, unknown> {
  return {
    accountId: account.id,
    email: account.email,
    internalFreeAccess: isInternalFreeEmail(account.email, internalFreeEmails),
    emailVerified: account.emailVerifiedAt !== null,
    onboarding: {
      status:
        account.onboardingCompletedAt !== null
          ? 'completed'
          : account.onboardingSkippedAt !== null
            ? 'skipped'
            : 'pending',
    },
  };
}

const emailSchema = z.object({ email: z.email().max(254) });
const resetConfirmSchema = z.object({
  token: z.string().min(20).max(200),
  password: registerInputSchema.shape.password,
});

function originFor(deps: AuthRouterDeps): string {
  return deps.frontendOrigin ?? process.env.FRONTEND_ORIGIN ?? 'http://localhost:5174';
}

async function deliverVerification(
  deps: AuthRouterDeps,
  account: { readonly id: string; readonly email: string },
  now: Date,
): Promise<'sent' | 'not-configured' | 'provider-error'> {
  const mailer = deps.mailer ?? createMailer();
  const token = await issueEmailToken(deps.prisma, account.id, 'verification', now);
  const link = `${originFor(deps)}/?verify_email=${encodeURIComponent(token)}`;
  try {
    const result = await mailer.send({
      to: account.email,
      subject: 'Verify your FluxRadar email',
      html: `<p>Confirm your FluxRadar email to keep your workspace secure.</p><p><a href="${emailText(link)}">Verify email</a></p>`,
      text: `Confirm your FluxRadar email: ${link}`,
    });
    return result.status;
  } catch {
    return 'provider-error';
  }
}

async function deliverPasswordReset(
  deps: AuthRouterDeps,
  account: { readonly id: string; readonly email: string },
  now: Date,
): Promise<void> {
  const mailer = deps.mailer ?? createMailer();
  const token = await issueEmailToken(deps.prisma, account.id, 'password_reset', now);
  const link = `${originFor(deps)}/?reset_token=${encodeURIComponent(token)}`;
  try {
    await mailer.send({
      to: account.email,
      subject: 'Reset your FluxRadar password',
      html: `<p>Use this one-time link to reset your FluxRadar password.</p><p><a href="${emailText(link)}">Reset password</a></p><p>The link expires in one hour.</p>`,
      text: `Reset your FluxRadar password: ${link}\nThe link expires in one hour.`,
    });
  } catch {
    // The request remains deliberately indistinguishable from an unknown email.
  }
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
  const requestRateLimiter = deps.requestRateLimiter ?? new RequestRateLimiter();

  router.post('/auth/register', async (req, res) => {
    const input = parseInput(registerInputSchema, req.body);
    requestRateLimiter.assertAllowed(
      `register:${req.ip ?? 'unknown'}`,
      REGISTER_LIMIT,
      REGISTER_WINDOW_MS,
    );
    const passwordHash = await hashPassword(input.password);
    const email = input.email.toLowerCase();
    try {
      const account = await prisma.account.create({ data: { email, passwordHash } });
      const verificationStatus = await deliverVerification(deps, account, deps.now());
      await attachSessionCookie(deps, res, account.id);
      sendOk(
        res,
        {
          ...accountDto(account, deps.internalFreeEmails),
          emailVerification: { status: verificationStatus },
        },
        { status: 201 },
      );
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

  router.post('/auth/resend-verification', async (req, res) => {
    const input = parseInput(emailSchema, req.body);
    const email = input.email.toLowerCase();
    requestRateLimiter.assertAllowed(
      `verification:${req.ip ?? 'unknown'}:${email}`,
      EMAIL_ACTION_LIMIT,
      EMAIL_ACTION_WINDOW_MS,
    );
    requestRateLimiter.assertAllowed(
      `email-action:${req.ip ?? 'unknown'}`,
      EMAIL_IP_ACTION_LIMIT,
      EMAIL_ACTION_WINDOW_MS,
    );
    const account = await prisma.account.findUnique({ where: { email } });
    if (account !== null && account.emailVerifiedAt === null) {
      void deliverVerification(deps, account, deps.now()).catch(() => undefined);
    }
    sendOk(
      res,
      { status: 'accepted', message: 'If the account exists, an email will be sent.' },
      { status: 202 },
    );
  });

  router.get('/auth/verify-email', async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (token === '') throw validationError('verification token is required');
    requestRateLimiter.assertAllowed(
      `email-token:${req.ip ?? 'unknown'}`,
      EMAIL_TOKEN_ACTION_LIMIT,
      EMAIL_ACTION_WINDOW_MS,
    );
    const consumed = await consumeEmailToken(prisma, token, 'verification', deps.now());
    if (consumed === null)
      throw conflict('EMAIL_TOKEN_INVALID', 'verification link is invalid or expired');
    await prisma.account.update({
      where: { id: consumed.accountId },
      data: { emailVerifiedAt: deps.now() },
    });
    sendOk(res, { status: 'verified' });
  });

  router.post('/auth/password-reset/request', async (req, res) => {
    const input = parseInput(emailSchema, req.body);
    const email = input.email.toLowerCase();
    requestRateLimiter.assertAllowed(
      `password-reset:${req.ip ?? 'unknown'}:${email}`,
      EMAIL_ACTION_LIMIT,
      EMAIL_ACTION_WINDOW_MS,
    );
    requestRateLimiter.assertAllowed(
      `email-action:${req.ip ?? 'unknown'}`,
      EMAIL_IP_ACTION_LIMIT,
      EMAIL_ACTION_WINDOW_MS,
    );
    const account = await prisma.account.findUnique({ where: { email } });
    if (account !== null)
      void deliverPasswordReset(deps, account, deps.now()).catch(() => undefined);
    sendOk(
      res,
      { status: 'accepted', message: 'If the account exists, an email will be sent.' },
      { status: 202 },
    );
  });

  router.post('/auth/password-reset/confirm', async (req, res) => {
    const input = parseInput(resetConfirmSchema, req.body);
    requestRateLimiter.assertAllowed(
      `email-token:${req.ip ?? 'unknown'}`,
      EMAIL_TOKEN_ACTION_LIMIT,
      EMAIL_ACTION_WINDOW_MS,
    );
    const consumed = await consumeEmailToken(prisma, input.token, 'password_reset', deps.now());
    if (consumed === null)
      throw conflict('PASSWORD_RESET_INVALID', 'password reset link is invalid or expired');
    const passwordHash = await hashPassword(input.password);
    await prisma.$transaction([
      prisma.account.update({ where: { id: consumed.accountId }, data: { passwordHash } }),
      prisma.session.deleteMany({ where: { accountId: consumed.accountId } }),
    ]);
    sendOk(res, { status: 'reset' });
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
    const result = await deleteAccountData(prisma, accountId, deps.objectStore);
    if (result.orphanedArtifactCount > 0) {
      deps.logger?.warn('account artifact cleanup incomplete', {
        accountIdHash: accountDeletionHash(accountId),
        orphanedArtifactCount: result.orphanedArtifactCount,
      });
    }
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    sendOk(res, { deleted: true });
  });

  router.patch('/account/onboarding', requireAuth(prisma, deps.now), async (req, res) => {
    const input = parseInput(z.object({ completed: z.boolean() }), req.body);
    const accountId = accountIdFrom(res);
    const updated = await prisma.account.update({
      where: { id: accountId },
      data: input.completed
        ? { onboardingCompletedAt: deps.now(), onboardingSkippedAt: null }
        : { onboardingCompletedAt: null, onboardingSkippedAt: deps.now() },
    });
    sendOk(res, accountDto(updated, deps.internalFreeEmails));
  });

  return router;
}
