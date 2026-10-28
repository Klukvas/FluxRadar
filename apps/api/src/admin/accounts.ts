// The registered accounts behind the owner dashboard's Accounts list.
//
// Unlike stats.ts this module does hand out per-account rows — to the listed
// admin only, behind the same door — so what a row carries is fixed here and
// nothing else leaves: no id, no password hash, no session. The id is read to
// join the counts and dropped before the row is built.
//
// A page costs four queries however many accounts exist: the page and its
// total, then one grouped count each for scans and purchases over that page's
// ids. Purchases are counted the way the dashboard counts `purchases.completed`
// (stats.ts): every real order whatever its status, test-mode orders left out.

import type { Prisma, PrismaClient } from '@prisma/client';

import { REAL_PURCHASE } from './stats.ts';

export const ACCOUNTS_PAGE_SIZE = 50;

/** Where the tutorial stands for one account, from the two onboarding timestamps. */
export type TutorialStatus = 'pending' | 'completed' | 'skipped';

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
}

interface AccountActivity {
  readonly count: number;
  readonly latest: Date | null;
}

interface GroupedActivity {
  readonly accountId: string;
  readonly _count: { readonly _all: number };
  readonly _max: { readonly createdAt: Date | null };
}

const NO_ACTIVITY: AccountActivity = { count: 0, latest: null };

export async function readAccountList(
  prisma: PrismaClient,
  request: AccountListRequest,
): Promise<AccountList> {
  const where: Prisma.AccountWhereInput =
    request.query === null
      ? {}
      : { email: { contains: literalPattern(request.query), mode: 'insensitive' } };
  const [accounts, total] = await Promise.all([
    prisma.account.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { email: 'asc' }],
      skip: (request.page - 1) * ACCOUNTS_PAGE_SIZE,
      take: ACCOUNTS_PAGE_SIZE,
      select: {
        id: true,
        email: true,
        createdAt: true,
        emailVerifiedAt: true,
        freeCheckUsedAt: true,
        onboardingCompletedAt: true,
        onboardingSkippedAt: true,
        isTestAccount: true,
      },
    }),
    prisma.account.count({ where }),
  ]);
  const ids = accounts.map((account) => account.id);
  const [scans, purchases] = ids.length === 0 ? [[], []] : await readActivity(prisma, ids);
  const scansOf = activityByAccount(scans);
  const purchasesOf = activityByAccount(purchases);

  const rows = accounts.map((account): AccountRow => {
    const scanActivity = scansOf.get(account.id) ?? NO_ACTIVITY;
    const purchaseActivity = purchasesOf.get(account.id) ?? NO_ACTIVITY;
    return {
      email: account.email,
      createdAt: account.createdAt.toISOString(),
      emailVerified: account.emailVerifiedAt !== null,
      freeCheckUsedAt: account.freeCheckUsedAt?.toISOString() ?? null,
      scans: scanActivity.count,
      purchases: purchaseActivity.count,
      lastActivityAt: latestOf([
        account.createdAt,
        scanActivity.latest,
        purchaseActivity.latest,
      ]).toISOString(),
      tutorial: tutorialStatusOf(account),
      testAccount: account.isTestAccount,
    };
  });
  return { page: request.page, pageSize: ACCOUNTS_PAGE_SIZE, total, rows };
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

async function readActivity(
  prisma: PrismaClient,
  ids: readonly string[],
): Promise<readonly [readonly GroupedActivity[], readonly GroupedActivity[]]> {
  const ofPage = { accountId: { in: [...ids] } };
  return Promise.all([
    prisma.scan.groupBy({
      by: ['accountId'],
      where: ofPage,
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.purchase.groupBy({
      by: ['accountId'],
      where: { ...ofPage, ...REAL_PURCHASE },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
  ]);
}

function activityByAccount(rows: readonly GroupedActivity[]): ReadonlyMap<string, AccountActivity> {
  return new Map(
    rows.map((row) => [row.accountId, { count: row._count._all, latest: row._max.createdAt }]),
  );
}

function latestOf(dates: readonly [Date, ...(Date | null)[]]): Date {
  const [first, ...rest] = dates;
  return rest.reduce<Date>(
    (latest, date) => (date !== null && date > latest ? date : latest),
    first,
  );
}
