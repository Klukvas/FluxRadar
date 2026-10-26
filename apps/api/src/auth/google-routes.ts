import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';

import { readCookie } from '../http/cookies.ts';
import { ApiError } from '../http/errors.ts';
import { sendOk } from '../http/envelope.ts';
import { parseInput } from '../http/validate.ts';
import { isUniqueViolation } from '../billing/prisma-errors.ts';
import { RequestRateLimiter } from './rate-limit.ts';
import type { AuthRouterDeps } from './routes.ts';
import {
  createGoogleLoginProvider,
  readGoogleAuthConfig,
  GoogleEmailAuthorityError,
  type GoogleLoginProvider,
} from './google-provider.ts';

const STATE_COOKIE = 'fluxradar_google_login';
const STATE_LIFETIME_MS = 10 * 60 * 1000;
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const random = (): string => randomBytes(32).toString('base64url');
const startSchema = z.object({
  rememberMe: z.boolean().default(false),
  language: z.enum(['uk', 'en']).optional(),
});
const callbackSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().min(1).max(4096).optional(),
  error: z.string().min(1).max(200).optional(),
});

export type GoogleRouterDeps = AuthRouterDeps & {
  readonly googleProvider?: GoogleLoginProvider;
};

type AttachSession = (res: Response, accountId: string, rememberMe: boolean) => Promise<void>;

export function googleAuthRouter(deps: GoogleRouterDeps, attachSession: AttachSession): Router {
  const router = Router();
  const config = readGoogleAuthConfig(
    deps.frontendOrigin ?? process.env.FRONTEND_ORIGIN ?? 'http://localhost:5174',
  );
  const provider =
    config === null ? null : (deps.googleProvider ?? createGoogleLoginProvider(config));
  const limiter = deps.requestRateLimiter ?? new RequestRateLimiter();
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path:
      config === null
        ? '/auth/google'
        : new URL(config.redirectUri).pathname.replace(/\/callback$/, ''),
  };

  router.get('/auth/google/status', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    sendOk(res, { enabled: config !== null });
  });

  router.post('/auth/google/start', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (config === null || provider === null)
      throw new ApiError(503, 'GOOGLE_LOGIN_UNAVAILABLE', 'Google sign-in is unavailable');
    // A cross-origin form must not initiate a login in someone else's browser.
    if (req.headers.origin !== config.frontendOrigin)
      throw new ApiError(403, 'ORIGIN_REJECTED', 'Sign-in must start from FluxRadar');
    limiter.assertAllowed(`google-start:${req.ip ?? 'unknown'}`, 20, STATE_LIFETIME_MS);
    const input = parseInput(startSchema, req.body);
    const state = random();
    const binding = random();
    const nonce = random();
    const codeVerifier = random();
    const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const now = deps.now();
    await deps.prisma.googleLoginState.deleteMany({ where: { expiresAt: { lte: now } } });
    await deps.prisma.googleLoginState.create({
      data: {
        stateHash: digest(state),
        bindingHash: digest(binding),
        nonceHash: digest(nonce),
        codeVerifier,
        rememberMe: input.rememberMe,
        language: input.language ?? null,
        expiresAt: new Date(now.getTime() + STATE_LIFETIME_MS),
      },
    });
    res.cookie(STATE_COOKIE, binding, { ...cookieOptions, maxAge: STATE_LIFETIME_MS });
    sendOk(res, { url: provider.authorizationUrl(state, nonce, challenge) });
  });

  router.get('/auth/google/callback', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (config === null || provider === null)
      throw new ApiError(503, 'GOOGLE_LOGIN_UNAVAILABLE', 'Google sign-in is unavailable');
    let language: 'uk' | 'en' | null = null;
    const languageQuery = (): string => (language === null ? '' : `&lang=${language}`);
    const fail = (code: string): void => {
      res.redirect(
        303,
        `${config.frontendOrigin}/profiles?google_auth_error=${code}${languageQuery()}`,
      );
    };
    const binding = readCookie(req.headers.cookie, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, cookieOptions);
    const parsed = callbackSchema.safeParse(req.query);
    if (!parsed.success || binding === null || !/^[A-Za-z0-9_-]{43}$/.test(binding)) {
      fail('failed');
      return;
    }
    try {
      limiter.assertAllowed(`google-callback:${req.ip ?? 'unknown'}`, 40, STATE_LIFETIME_MS);
      const attempt = await deps.prisma.googleLoginState.findUnique({
        where: { stateHash: digest(parsed.data.state) },
      });
      if (attempt === null || attempt.bindingHash !== digest(binding)) {
        fail('failed');
        return;
      }
      language = attempt.language === 'uk' || attempt.language === 'en' ? attempt.language : null;
      // deleteMany is the atomic claim: concurrent callbacks cannot both exchange a code.
      const consumed = await deps.prisma.googleLoginState.deleteMany({
        where: {
          stateHash: attempt.stateHash,
          bindingHash: digest(binding),
          expiresAt: { gt: deps.now() },
        },
      });
      if (consumed.count !== 1) {
        fail('failed');
        return;
      }
      if (parsed.data.error !== undefined || parsed.data.code === undefined) {
        fail('cancelled');
        return;
      }
      const identity = await provider.exchange(
        parsed.data.code,
        attempt.codeVerifier,
        attempt.nonceHash,
        deps.now(),
      );
      const known = await deps.prisma.account.findUnique({
        where: { googleSubject: identity.subject },
      });
      let accountId: string;
      if (known !== null) {
        if (known.email.toLowerCase() !== identity.email.toLowerCase()) {
          fail('email_changed');
          return;
        }
        accountId = known.id;
      } else {
        // Email is never sufficient to attach a new identity to an existing account.
        const existing = await deps.prisma.account.findUnique({ where: { email: identity.email } });
        if (existing !== null) {
          fail('email_exists');
          return;
        }
        const account = await deps.prisma.account.create({
          data: {
            email: identity.email,
            googleSubject: identity.subject,
            passwordHash: null,
            emailVerifiedAt: deps.now(),
          },
        });
        accountId = account.id;
      }
      await attachSession(res, accountId, attempt.rememberMe);
      res.redirect(303, `${config.frontendOrigin}/profiles?google_auth=success${languageQuery()}`);
    } catch (error) {
      if (error instanceof GoogleEmailAuthorityError) {
        fail('use_email');
        return;
      }
      if (isUniqueViolation(error, 'email')) {
        fail('email_exists');
        return;
      }
      // Do not log provider responses: they can contain codes or identity tokens.
      deps.logger?.warn('Google login failed', { reason: 'exchange-or-account' });
      fail('failed');
    }
  });
  return router;
}
