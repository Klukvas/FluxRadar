// GET /admin/stats — the owner's business dashboard.
//
// Only an account whose address is listed in FLUXRADAR_ADMIN_EMAILS reaches it,
// and to everyone else it does not exist: no session, an expired one, a
// non-admin account, an unconfirmed admin address, or a deployment with the list
// empty all fall through to the same handler an unknown route reaches, so the
// response cannot be told apart from a path nobody ever mounted. That is also
// why `days` is validated only after access is settled — a 400 to a stranger
// would confirm the route is there.

import { Router, type Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { SESSION_COOKIE_NAME, findSessionAccountId } from '../auth/sessions.ts';
import { readCookie } from '../http/cookies.ts';
import { sendOk } from '../http/envelope.ts';
import type { ApiLogger } from '../http/logger.ts';
import { parseInput } from '../http/validate.ts';
import { ADMIN_EMAILS_ENV, isAdminEmail } from './admin-emails.ts';
import { readBusinessStats } from './stats.ts';
import {
  DEFAULT_STATS_WINDOW_DAYS,
  STATS_WINDOW_DAYS,
  statsWindow,
  type StatsWindowDays,
} from './stats-window.ts';

export const ADMIN_STATS_PATH = '/admin/stats';

/** The exact spellings a window may be asked for: "07" or "30.0" are refused, not read. */
const WINDOW_PARAMS = STATS_WINDOW_DAYS.map((days) => `${days}` as const);

const statsQuerySchema = z.object({
  days: z
    .enum(WINDOW_PARAMS)
    .default(`${DEFAULT_STATS_WINDOW_DAYS}`)
    .transform((days): StatsWindowDays => Number(days) as StatsWindowDays),
});

export interface AdminStatsRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  /** Normalized admin addresses; empty switches the dashboard off. */
  readonly adminEmails: ReadonlySet<string>;
  readonly logger: ApiLogger;
}

export function adminStatsRouter(deps: AdminStatsRouterDeps): Router {
  const router = Router();
  // The count only: the addresses are personal data and the log is not the
  // place to confirm which ones hold the keys.
  if (deps.adminEmails.size > 0) {
    deps.logger.info('admin stats enabled', {
      variable: ADMIN_EMAILS_ENV,
      adminCount: deps.adminEmails.size,
    });
  }

  router.get(ADMIN_STATS_PATH, async (req, res, next) => {
    if (!(await isAdminRequest(deps, req))) {
      next();
      return;
    }
    const { days } = parseInput(statsQuerySchema, req.query);
    const stats = await readBusinessStats(deps.prisma, statsWindow(days, deps.now()));
    // Business figures, per account: never kept by a shared cache or the browser's.
    res.setHeader('Cache-Control', 'private, no-store');
    sendOk(res, stats);
  });

  return router;
}

/**
 * Whether the session belongs to a listed admin whose address is confirmed.
 *
 * The confirmation matters because the list names addresses, not accounts: if
 * the owner's address were ever free to register — never signed up, or the
 * account deleted — whoever registered it first would otherwise hold the key
 * without being able to read a single email sent to it.
 */
async function isAdminRequest(deps: AdminStatsRouterDeps, req: Request): Promise<boolean> {
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
