// Support requests from the floating form on every page.
//
// The form is open to guests as well as to signed-in owners, and that decides
// two things here. The reply address is never taken from the form when a session
// can state it: a signed-in request carries the account's own address, and a
// guest's is labelled unverified in the channel, because anyone can type any
// address into a public form. And since the endpoint is public and every accepted
// request lands in a person's Telegram channel, it is limited by client address
// as well as by account or reply address (see auth/rate-limit.ts for why the two
// keys are separate).

import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import {
  SUPPORT_REQUEST_IP_LIMIT,
  SUPPORT_REQUEST_LIMIT,
  SUPPORT_REQUEST_WINDOW_MS,
  type RateLimitRule,
  type RequestRateLimiter,
} from '../auth/rate-limit.ts';
import { SESSION_COOKIE_NAME, findSessionAccountId } from '../auth/sessions.ts';
import { readCookie } from '../http/cookies.ts';
import { sendOk } from '../http/envelope.ts';
import { ApiError } from '../http/errors.ts';
import type { ApiLogger } from '../http/logger.ts';
import { parseInput } from '../http/validate.ts';
import type { SupportChannel } from './support-channel.ts';
import type { SupportSender } from './support-message.ts';

export const SUPPORT_SUBJECT_MIN_LENGTH = 3;
export const SUPPORT_SUBJECT_MAX_LENGTH = 200;
export const SUPPORT_MESSAGE_MIN_LENGTH = 10;
export const SUPPORT_MESSAGE_MAX_LENGTH = 2000;
const SUPPORT_PAGE_MAX_LENGTH = 300;

const supportRequestSchema = z.object({
  subject: z.string().trim().min(SUPPORT_SUBJECT_MIN_LENGTH).max(SUPPORT_SUBJECT_MAX_LENGTH),
  message: z.string().trim().min(SUPPORT_MESSAGE_MIN_LENGTH).max(SUPPORT_MESSAGE_MAX_LENGTH),
  email: z.email().max(254).optional(),
  // The path alone reaches the channel: a query string can carry a one-time
  // verification or password-reset token.
  page: z
    .string()
    .startsWith('/')
    .max(SUPPORT_PAGE_MAX_LENGTH)
    .transform((path) => path.split(/[?#]/)[0] ?? path)
    .optional(),
  language: z.enum(['en', 'uk']).optional(),
});

export interface SupportRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  /** null when this deployment has nowhere to deliver a request. */
  readonly channel: SupportChannel | null;
  readonly requestRateLimiter: RequestRateLimiter;
  readonly logger: ApiLogger;
}

export function supportRouter(deps: SupportRouterDeps): Router {
  const router = Router();

  // A cheap read the launcher makes on every page load, so it stays outside the
  // submission limit. The route answers either way: a form hidden because the
  // probe 404'd would look the same as a deliberate "no support channel".
  router.get('/support/status', (_req, res) => {
    sendOk(res, { available: deps.channel !== null });
  });

  router.post('/support', async (req, res) => {
    const { channel } = deps;
    if (channel === null) {
      throw new ApiError(503, 'SUPPORT_UNAVAILABLE', 'in-app support is not available right now');
    }
    const input = parseInput(supportRequestSchema, req.body);
    const sender = await resolveSender(deps, req.headers.cookie, input.email);
    deps.requestRateLimiter.assertAllowedAll(supportRequestRules(sender, req.ip ?? 'unknown'));
    try {
      await channel.send({
        sender,
        subject: input.subject,
        message: input.message,
        page: input.page ?? null,
        language: input.language ?? null,
      });
    } catch (error) {
      deps.logger.error('support request delivery failed', {
        channel: channel.kind,
        sender: sender.kind,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ApiError(
        502,
        'SUPPORT_DELIVERY_FAILED',
        'your message could not be delivered, try again later',
      );
    }
    sendOk(res, { status: 'sent' });
  });

  return router;
}

/**
 * The account behind a live session, or a guest with the address they typed. A
 * session that expired while the page stayed open is a guest like any other, so
 * such a request needs an address too — the client is told so by code and asks.
 */
async function resolveSender(
  deps: SupportRouterDeps,
  cookieHeader: string | undefined,
  email: string | undefined,
): Promise<SupportSender> {
  const token = readCookie(cookieHeader, SESSION_COOKIE_NAME);
  const accountId =
    token === null ? null : await findSessionAccountId(deps.prisma, token, deps.now());
  if (accountId !== null) {
    const account = await deps.prisma.account.findUnique({
      where: { id: accountId },
      select: { email: true },
    });
    if (account !== null) return { kind: 'account', accountId, email: account.email };
  }
  if (email === undefined) {
    throw new ApiError(
      400,
      'SUPPORT_EMAIL_REQUIRED',
      'an email address is required when not signed in',
    );
  }
  return { kind: 'guest', email };
}

function supportRequestRules(sender: SupportSender, ip: string): readonly RateLimitRule[] {
  const senderKey =
    sender.kind === 'account'
      ? `support:account:${sender.accountId}`
      : `support:email:${sender.email.toLowerCase()}`;
  return [
    { key: senderKey, limit: SUPPORT_REQUEST_LIMIT, windowMs: SUPPORT_REQUEST_WINDOW_MS },
    {
      key: `support:ip:${ip}`,
      limit: SUPPORT_REQUEST_IP_LIMIT,
      windowMs: SUPPORT_REQUEST_WINDOW_MS,
    },
  ];
}
