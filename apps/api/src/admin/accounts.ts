// The registered accounts behind the owner dashboard's Accounts list.
//
// Unlike stats.ts this module does hand out per-account rows — to the listed
// admin only, behind the same door — so what a row carries is fixed here and
// nothing else leaves: no id, no password hash, no session. The scan and
// purchase counts are joined inside the page query and dropped before the row
// is built.
//
// A page costs two statements however many accounts exist: one raw page query
// and one count for the pager. The page query attaches each account's scan and
// purchase counts through grouped subqueries — the same whole-table groupBys
// the dashboard's numbers run on every load — so the list can be ordered by
// the computed columns (scans, purchases, last activity) as well as the stored
// ones. Purchases are counted the way the dashboard counts
// `purchases.completed` (stats.ts): every real order whatever its status,
// test-mode orders left out. The ORDER BY column and direction are chosen from
// a fixed whitelist, never built from a client string; anything a client types
// — the email search, the page — reaches the query only as a bound parameter.

import { Prisma, type PrismaClient } from '@prisma/client';

export const ACCOUNTS_PAGE_SIZE = 50;

/** Where the tutorial stands for one account, from the two onboarding timestamps. */
export type TutorialStatus = 'pending' | 'completed' | 'skipped';

/**
 * The columns the list can be ordered by; the API accepts exactly these
 * spellings. The web client's `ACCOUNT_SORTS` (apps/web/src/admin-accounts.ts)
 * lists the same keys — a key added or renamed here must follow there, or the
 * dashboard's sort buttons will be answered with a 400.
 */
export const ACCOUNT_SORTS = [
  'email',
  'registered',
  'confirmed',
  'tutorial',
  'freeCheck',
  'scans',
  'purchases',
  'lastActivity',
  'testAccount',
] as const;
export type AccountSort = (typeof ACCOUNT_SORTS)[number];
export type SortDirection = 'asc' | 'desc';

export interface AccountRow {
  readonly email: string;
  readonly createdAt: string;
  readonly emailVerified: boolean;
  readonly freeCheckUsedAt: string | null;
  readonly scans: number;
  readonly purchases: number;
  /** The latest of sign-up, newest scan and newest real purchase. */
  readonly lastActivityAt: string;
  readonly tutorial: TutorialStatus;
  readonly testAccount: boolean;
}

export interface AccountList {
  readonly page: number;
  readonly pageSize: typeof ACCOUNTS_PAGE_SIZE;
  readonly total: number;
  readonly rows: readonly AccountRow[];
}

export interface AccountListRequest {
  /** 1-based. */
  readonly page: number;
  /** A case-insensitive part of the email address, or null for every account. */
  readonly query: string | null;
  /** Leave out the accounts the owner marked as test accounts. */
  readonly excludeTest: boolean;
  /** The column to order by, or null for the default: newest first, ties by address. */
  readonly sort: AccountSort | null;
  readonly dir: SortDirection;
}

/** What the page query reads back; the ORDER BY expressions are built from it. */
interface AccountPageRow {
  readonly email: string;
  readonly createdAt: Date;
  readonly emailVerifiedAt: Date | null;
  readonly freeCheckUsedAt: Date | null;
  readonly onboardingCompletedAt: Date | null;
  readonly onboardingSkippedAt: Date | null;
  readonly isTestAccount: boolean;
  readonly scanCount: number;
  readonly purchaseCount: number;
  readonly lastActivityAt: Date;
}

/**
 * The SQL each sort key orders by. Fixed literals keyed by the whitelist, never
 * client text; the direction is appended before the NULLS marker. Nullable
 * dates get NULLS LAST so "never" rows stay at the bottom in both directions;
 * counts COALESCE the left join's NULL to 0; tutorial sorts the three statuses
 * alphabetically, and last activity is the greatest of the three timestamps
 * (GREATEST ignores the NULLs).
 */
const ORDER_COLUMNS: Readonly<
  Record<AccountSort, { readonly expression: string; readonly nullsLast?: boolean }>
> = {
  email: { expression: 'LOWER(account."email")' },
  registered: { expression: 'account."createdAt"' },
  confirmed: { expression: 'account."emailVerifiedAt"', nullsLast: true },
  tutorial: {
    expression: `CASE
        WHEN account."onboardingCompletedAt" IS NOT NULL THEN 'completed'
        WHEN account."onboardingSkippedAt" IS NOT NULL THEN 'skipped'
        ELSE 'pending' END`,
  },
  freeCheck: { expression: 'account."freeCheckUsedAt"', nullsLast: true },
  scans: { expression: 'COALESCE(scans."count", 0)' },
  purchases: { expression: 'COALESCE(purchases."count", 0)' },
  lastActivity: {
    expression: 'GREATEST(account."createdAt", scans."latest", purchases."latest")',
  },
  testAccount: { expression: 'account."isTestAccount"' },
};

/** The newest-first order the list always falls back to for ties. */
const TIE_BREAK = Prisma.sql`account."createdAt" DESC, account."email" ASC`;

export async function readAccountList(
  prisma: PrismaClient,
  request: AccountListRequest,
): Promise<AccountList> {
  const where: Prisma.AccountWhereInput = {
    ...(request.query === null
      ? {}
      : { email: { contains: literalPattern(request.query), mode: 'insensitive' } }),
    ...(request.excludeTest ? { isTestAccount: false } : {}),
  };
  const [page, total] = await Promise.all([
    readPage(prisma, request),
    prisma.account.count({ where }),
  ]);

  const rows = page.map((row): AccountRow => ({
    email: row.email,
    createdAt: row.createdAt.toISOString(),
    emailVerified: row.emailVerifiedAt !== null,
    freeCheckUsedAt: row.freeCheckUsedAt?.toISOString() ?? null,
    scans: row.scanCount,
    purchases: row.purchaseCount,
    lastActivityAt: row.lastActivityAt.toISOString(),
    tutorial: tutorialStatusOf(row),
    testAccount: row.isTestAccount,
  }));
  return { page: request.page, pageSize: ACCOUNTS_PAGE_SIZE, total, rows };
}

/** One page of accounts with their activity attached, ordered as requested. */
async function readPage(
  prisma: PrismaClient,
  request: AccountListRequest,
): Promise<AccountPageRow[]> {
  const emailFilter =
    request.query === null
      ? Prisma.empty
      : Prisma.sql` AND account."email" ILIKE ${`%${literalPattern(request.query)}%`} ESCAPE '\\'`;
  const testFilter = request.excludeTest
    ? Prisma.sql` AND account."isTestAccount" = false`
    : Prisma.empty;
  const orderBy =
    request.sort === null
      ? Prisma.sql`account."createdAt" DESC, account."email" ASC`
      : (() => {
          const column = ORDER_COLUMNS[request.sort];
          return Prisma.sql`${Prisma.raw(column.expression)} ${Prisma.raw(
            request.dir === 'asc' ? 'ASC' : 'DESC',
          )}${column.nullsLast === true ? Prisma.sql` NULLS LAST` : Prisma.empty}, ${TIE_BREAK}`;
        })();

  return prisma.$queryRaw<AccountPageRow[]>`
    SELECT account."email",
           account."createdAt",
           account."emailVerifiedAt",
           account."freeCheckUsedAt",
           account."onboardingCompletedAt",
           account."onboardingSkippedAt",
           account."isTestAccount",
           COALESCE(scans."count", 0)::int AS "scanCount",
           COALESCE(purchases."count", 0)::int AS "purchaseCount",
           GREATEST(account."createdAt", scans."latest", purchases."latest") AS "lastActivityAt"
      FROM "Account" AS account
      LEFT JOIN (
        SELECT "accountId", COUNT(*)::int AS "count", MAX("createdAt") AS "latest"
          FROM "Scan"
         GROUP BY "accountId"
      ) AS scans ON scans."accountId" = account."id"
      LEFT JOIN (
        SELECT purchase."accountId", COUNT(*)::int AS "count", MAX(purchase."createdAt") AS "latest"
          FROM "Purchase" AS purchase
         WHERE NOT EXISTS (
           SELECT 1
             FROM "CheckoutSession" AS checkout
            WHERE checkout."purchaseId" = purchase."id"
              AND checkout."liveMode" = false
         )
         GROUP BY purchase."accountId"
      ) AS purchases ON purchases."accountId" = account."id"
     WHERE TRUE${emailFilter}${testFilter}
     ORDER BY ${orderBy}
     LIMIT ${ACCOUNTS_PAGE_SIZE}
     OFFSET ${(request.page - 1) * ACCOUNTS_PAGE_SIZE}`;
}

/** The one of the three onboarding states the two timestamps spell out. */
function tutorialStatusOf(account: {
  readonly onboardingCompletedAt: Date | null;
  readonly onboardingSkippedAt: Date | null;
}): TutorialStatus {
  if (account.onboardingCompletedAt !== null) return 'completed';
  if (account.onboardingSkippedAt !== null) return 'skipped';
  return 'pending';
}

/**
 * Marks an account as a test account, or back. The address is the key the list
 * hands out; the match is exact, so a stored address is changed only when the
 * exact spelling the list showed comes back.
 */
export async function setTestAccount(
  prisma: PrismaClient,
  email: string,
  testAccount: boolean,
): Promise<boolean> {
  const result = await prisma.account.updateMany({
    where: { email },
    data: { isTestAccount: testAccount },
  });
  return result.count > 0;
}

/**
 * Prisma hands `contains` to ILIKE as is, so `_` and `%` would be wildcards and
 * `\` an escape; `\` is Postgres' default LIKE escape, so prefixing each makes
 * the search a literal substring.
 */
function literalPattern(query: string): string {
  return query.replace(/[\\%_]/g, '\\$&');
}
