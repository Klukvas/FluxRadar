// GET /admin/stats — the owner's business dashboard — GET /admin/accounts,
// the list of registered accounts it shows beneath the numbers, and
// PATCH /admin/accounts/test-account, the list's per-account test flag.
//
// Only an account whose address is listed in FLUXRADAR_ADMIN_EMAILS reaches it,
// and to everyone else it does not exist: no session, an expired one, a
// non-admin account, an unconfirmed admin address, or a deployment with the list
// empty all fall through to the same handler an unknown route reaches, so the
// response cannot be told apart from a path nobody ever mounted. That is also
// why `days`, `page`, `q`, `test`, `sort` and `dir` are validated only after
// access is settled — a 400 to a stranger would confirm the route is there.

import { Router } from 'express';
import { z } from 'zod';

import { sendOk } from '../http/envelope.ts';
import type { ApiLogger } from '../http/logger.ts';
import { notFound } from '../http/errors.ts';
import { parseInput } from '../http/validate.ts';
import { ACCOUNT_SORTS, readAccountList, setTestAccount } from './accounts.ts';
import { isAdminRequest, type AdminAccessDeps } from './admin-access.ts';
import { ADMIN_EMAILS_ENV } from './admin-emails.ts';
import { readBusinessStats } from './stats.ts';
import {
  DEFAULT_STATS_WINDOW_DAYS,
  STATS_WINDOW_DAYS,
  statsWindow,
  type StatsWindowDays,
} from './stats-window.ts';

export const ADMIN_STATS_PATH = '/admin/stats';
export const ADMIN_ACCOUNTS_PATH = '/admin/accounts';
export const ADMIN_ACCOUNT_TEST_PATH = '/admin/accounts/test-account';

/** The longest an email address can be, so the longest part of one worth searching for. */
const MAX_EMAIL_QUERY_LENGTH = 254;

/** The exact spellings a window may be asked for: "07" or "30.0" are refused, not read. */
const WINDOW_PARAMS = STATS_WINDOW_DAYS.map((days) => `${days}` as const);

const statsQuerySchema = z.object({
  days: z
    .enum(WINDOW_PARAMS)
    .default(`${DEFAULT_STATS_WINDOW_DAYS}`)
    .transform((days): StatsWindowDays => Number(days) as StatsWindowDays),
});

/**
 * A page number with no sign, no leading zero and no fraction; a repeated
 * parameter arrives as an array and is refused like a repeated `days`. A blank
 * or whitespace-only `q` means no search rather than a 400. `test=exclude` is
 * the only spelling that hides test accounts — anything else is refused, not
 * read as "show them". `sort` takes exactly the sort keys `accounts.ts` lists,
 * and `dir` is refused on its own: a direction with no column would sort by
 * nothing.
 */
const accountsQuerySchema = z
  .object({
    page: z
      .string()
      .regex(/^[1-9]\d{0,5}$/)
      .default('1')
      .transform(Number),
    q: z
      .string()
      .trim()
      .max(MAX_EMAIL_QUERY_LENGTH)
      .optional()
      .transform((query) => (query === undefined || query === '' ? null : query)),
    test: z.enum(['exclude']).optional(),
    sort: z.enum(ACCOUNT_SORTS).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.dir !== undefined && value.sort === undefined) {
      ctx.addIssue({ code: 'custom', path: ['dir'], message: 'dir requires sort' });
    }
  });

/**
 * The test flag of one account, keyed by the exact address the list showed.
 * The address is a plain string rather than an email schema: a stored address
 * the owner can see must be settable, and an address the tables do not hold
 * simply finds no account.
 */
const accountTestSchema = z.object({
  email: z.string().trim().min(1).max(MAX_EMAIL_QUERY_LENGTH),
  testAccount: z.boolean(),
});

export interface AdminStatsRouterDeps extends AdminAccessDeps {
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

  router.get(ADMIN_ACCOUNTS_PATH, async (req, res, next) => {
    if (!(await isAdminRequest(deps, req))) {
      next();
      return;
    }
    const { page, q, test, sort, dir } = parseInput(accountsQuerySchema, req.query);
    const accounts = await readAccountList(deps.prisma, {
      page,
      query: q,
      excludeTest: test === 'exclude',
      sort: sort ?? null,
      dir: dir ?? 'asc',
    });
    // Email addresses: never kept by a shared cache or the browser's.
    res.setHeader('Cache-Control', 'private, no-store');
    sendOk(res, accounts);
  });

  router.patch(ADMIN_ACCOUNT_TEST_PATH, async (req, res, next) => {
    if (!(await isAdminRequest(deps, req))) {
      next();
      return;
    }
    const { email, testAccount } = parseInput(accountTestSchema, req.body);
    if (!(await setTestAccount(deps.prisma, email, testAccount))) {
      // An address the tables do not hold: nothing was marked, and the list
      // most likely moved under the owner since the page was drawn.
      throw notFound();
    }
    sendOk(res, { email, testAccount });
  });

  return router;
}
