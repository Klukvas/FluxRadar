// Who gets past the door of every owner-only route (/admin/stats, /admin/accounts).
//
// One check shared by every such route, so they cannot drift apart: a route
// that answered a stranger differently from its neighbour would confirm that
// both exist. A request this refuses falls through to the 404 handler.

import type { Request } from 'express';
import type { PrismaClient } from '@prisma/client';

import { SESSION_COOKIE_NAME, findSessionAccountId } from '../auth/sessions.ts';
import { readCookie } from '../http/cookies.ts';
import { isAdminEmail } from './admin-emails.ts';

export interface AdminAccessDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  /** Normalized admin addresses; empty switches every admin route off. */
  readonly adminEmails: ReadonlySet<string>;
}

/**
 * Whether the session belongs to a listed admin whose address is confirmed.
 *
 * The confirmation matters because the list names addresses, not accounts: if
 * the owner's address were ever free to register — never signed up, or the
 * account deleted — whoever registered it first would otherwise hold the key
 * without being able to read a single email sent to it.
 */
export async function isAdminRequest(deps: AdminAccessDeps, req: Request): Promise<boolean> {
  if (deps.adminEmails.size === 0) return false;
  const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  if (token === null) return false;
  const accountId = await findSessionAccountId(deps.prisma, token, deps.now());
  if (accountId === null) return false;
  const account = await deps.prisma.account.findUnique({
    where: { id: accountId },
    select: { email: true, emailVerifiedAt: true },
  });
  return (
    account !== null &&
    account.emailVerifiedAt !== null &&
    isAdminEmail(account.email, deps.adminEmails)
  );
}
