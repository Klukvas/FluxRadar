// The numbers behind the owner dashboard, read from this product's own tables.
//
// GA4 only sees visitors who accepted analytics cookies and never sees whether a
// FastSpring payment went through; these tables see every account, scan and
// order. Everything is counted in the database (count / groupBy / aggregate and
// one grouped raw query for the daily series): the answer is a few dozen rows
// however many accounts exist, and no row about an individual account, scan or
// order ever leaves this module — only counts, sums and the grouping keys, which
// are status, plan and currency literals.
//
// Two rules the figures follow:
//
// - MONEY IS NEVER ADDED ACROSS CURRENCIES. A purchase is summed on its charged
//   basis — what the buyer actually paid, in the currency they paid in — which
//   is the basis the refund lines are stated on (billing/fastspring/
//   refund-amounts.ts), so gross, refunded and net line up per currency.
// - TEST-MODE ORDERS ARE NOT REVENUE. A purchase whose checkout was opened in
//   the provider's test mode is counted apart (`testMode`) and left out of every
//   money and conversion figure. A purchase with no checkout row at all — a
//   historical order, or one whose checkout was removed with its account —
//   cannot be shown to be a test, so it counts as real.

import type { Prisma, PrismaClient } from '@prisma/client';

import { CHECKOUT_SESSION_STATUSES } from '../billing/constants.ts';
import {
  UNRECORDED_CURRENCY,
  conversionRate,
  fillDailySeries,
  revenueLines,
  type CurrencyAmount,
  type DailyPoint,
  type DailySeries,
  type RevenueLine,
  type StatsWindow,
  type StatsWindowDays,
} from './stats-window.ts';

export interface StatusCount {
  readonly status: string;
  readonly count: number;
}

export interface PlanCount {
  readonly plan: string;
  readonly count: number;
}

export interface PeriodStats {
  readonly accounts: { readonly created: number; readonly verified: number };
  readonly freeChecks: { readonly claimed: number };
  readonly scans: {
    readonly created: number;
    readonly byStatus: readonly StatusCount[];
    readonly byPlan: readonly PlanCount[];
  };
  /** Live-mode checkouts opened in the period, and how those same checkouts ended. */
  readonly checkouts: {
    readonly opened: number;
    readonly completed: number;
    readonly rejected: number;
    readonly conversion: number | null;
  };
  readonly purchases: { readonly completed: number; readonly byStatus: readonly StatusCount[] };
  readonly revenue: readonly RevenueLine[];
  readonly refunds: { readonly count: number };
  readonly testMode: { readonly checkoutsOpened: number; readonly purchases: number };
}

export interface BusinessStats {
  readonly window: { readonly days: StatsWindowDays; readonly from: string; readonly to: string };
  readonly period: PeriodStats;
  readonly allTime: PeriodStats;
  readonly daily: readonly DailyPoint[];
}

/** A purchase paid through a checkout opened in the provider's test mode. */
const TEST_MODE_PURCHASE: Prisma.PurchaseWhereInput = { checkout: { is: { liveMode: false } } };
const REAL_PURCHASE: Prisma.PurchaseWhereInput = { NOT: TEST_MODE_PURCHASE };

export async function readBusinessStats(
  prisma: PrismaClient,
  window: StatsWindow,
): Promise<BusinessStats> {
  const [period, allTime, daily] = await Promise.all([
    readPeriodStats(prisma, window.from),
    readPeriodStats(prisma, null),
    readDailySeries(prisma, window),
  ]);
  return {
    window: { days: window.days, from: window.from.toISOString(), to: window.to.toISOString() },
    period,
    allTime,
    daily,
  };
}

/** Everything created since `since`, or ever when it is null. */
async function readPeriodStats(prisma: PrismaClient, since: Date | null): Promise<PeriodStats> {
  const created = since === null ? {} : { createdAt: { gte: since } };
  const [accounts, verified, freeChecks, scans, checkouts, purchases, testPurchases, refunds] =
    await Promise.all([
      prisma.account.count({ where: created }),
      prisma.account.count({ where: { ...created, emailVerifiedAt: { not: null } } }),
      prisma.freeCheckClaim.count({
        where: since === null ? {} : { claimedAt: { gte: since } },
      }),
      prisma.scan.groupBy({ by: ['plan', 'status'], where: created, _count: { _all: true } }),
      prisma.checkoutSession.groupBy({
        by: ['liveMode', 'status'],
        where: created,
        _count: { _all: true },
      }),
      prisma.purchase.groupBy({
        by: ['status', 'currency', 'settledCurrency'],
        where: { ...created, ...REAL_PURCHASE },
        _count: { _all: true },
        _sum: { amountUsd: true, settledAmount: true },
      }),
      prisma.purchase.count({ where: { ...created, ...TEST_MODE_PURCHASE } }),
      prisma.providerRefund.groupBy({
        by: ['currency'],
        where: { ...created, purchase: REAL_PURCHASE },
        _count: { _all: true },
        _sum: { amountCharged: true },
      }),
    ]);

  const scanRows = scans.map((row) => ({ ...row, count: row._count._all }));
  const liveCheckouts = checkouts.filter((row) => row.liveMode);
  const purchaseRows = purchases.map((row) => ({ ...row, count: row._count._all }));
  const refundRows = refunds.map((row) => ({ ...row, count: row._count._all }));
  const openedLive = total(liveCheckouts.map((row) => row._count._all));
  const completedLive = checkoutsIn(liveCheckouts, CHECKOUT_SESSION_STATUSES.completed);

  return {
    accounts: { created: accounts, verified },
    freeChecks: { claimed: freeChecks },
    scans: {
      created: total(scanRows.map((row) => row.count)),
      byStatus: countBy(scanRows, (row) => row.status).map(([status, count]) => ({
        status,
        count,
      })),
      byPlan: countBy(scanRows, (row) => row.plan).map(([plan, count]) => ({ plan, count })),
    },
    checkouts: {
      opened: openedLive,
      completed: completedLive,
      rejected: checkoutsIn(liveCheckouts, CHECKOUT_SESSION_STATUSES.rejected),
      conversion: conversionRate(openedLive, completedLive),
    },
    purchases: {
      completed: total(purchaseRows.map((row) => row.count)),
      byStatus: countBy(purchaseRows, (row) => row.status).map(([status, count]) => ({
        status,
        count,
      })),
    },
    revenue: revenueLines(purchaseRows.map(chargedAmount), refundRows.map(refundedAmount)),
    refunds: { count: total(refundRows.map((row) => row.count)) },
    testMode: {
      checkoutsOpened: total(
        checkouts.filter((row) => !row.liveMode).map((row) => row._count._all),
      ),
      purchases: testPurchases,
    },
  };
}

/**
 * A group of purchases on its charged basis, as `chargeBasisOf` reads one
 * purchase: the settled figure in the settled currency when the provider
 * localised the charge, the USD figure otherwise. The webhook writes the settled
 * pair together or not at all (`settledFields`), so the currency decides it.
 */
function chargedAmount(row: {
  readonly currency: string;
  readonly settledCurrency: string | null;
  readonly _sum: { readonly amountUsd: number | null; readonly settledAmount: number | null };
}): CurrencyAmount {
  return row.settledCurrency === null
    ? { currency: row.currency, amount: row._sum.amountUsd ?? 0 }
    : { currency: row.settledCurrency, amount: row._sum.settledAmount ?? 0 };
}

/** Refund lines are already on the charged basis (ProviderRefund.amountCharged). */
function refundedAmount(row: {
  readonly currency: string | null;
  readonly _sum: { readonly amountCharged: number | null };
}): CurrencyAmount {
  return { currency: row.currency ?? UNRECORDED_CURRENCY, amount: row._sum.amountCharged ?? 0 };
}

function checkoutsIn(
  rows: readonly { readonly status: string; readonly _count: { readonly _all: number } }[],
  status: string,
): number {
  return total(rows.filter((row) => row.status === status).map((row) => row._count._all));
}

function total(counts: readonly number[]): number {
  return counts.reduce((sum, count) => sum + count, 0);
}

/** Re-groups already-grouped rows by one key, largest first — counts of counts, never rows. */
function countBy<Row extends { readonly count: number }>(
  rows: readonly Row[],
  keyOf: (row: Row) => string,
): (readonly [string, number])[] {
  const totals = rows.reduce(
    (sums, row) => new Map(sums).set(keyOf(row), (sums.get(keyOf(row)) ?? 0) + row.count),
    new Map<string, number>(),
  );
  return [...totals].sort(
    ([leftKey, leftCount], [rightKey, rightCount]) =>
      rightCount - leftCount || leftKey.localeCompare(rightKey),
  );
}

interface DayCountRow {
  readonly series: DailySeries;
  readonly day: string;
  readonly count: number;
}

/**
 * New accounts, scans and real purchases per UTC day of the window.
 *
 * Grouping by day is the one thing Prisma's groupBy cannot express, so this is
 * raw SQL — a tagged template, so the only value in it is a bound parameter. The
 * columns are `timestamp without time zone` holding UTC, which is why the day is
 * read straight off the stored value and the bound instant is converted to UTC
 * explicitly: comparing it as a `timestamptz` would shift it by whatever time
 * zone the database session happens to run in.
 */
async function readDailySeries(prisma: PrismaClient, window: StatsWindow): Promise<DailyPoint[]> {
  const from = window.from.toISOString();
  const rows = await prisma.$queryRaw<DayCountRow[]>`
    SELECT 'accounts' AS "series", to_char("createdAt", 'YYYY-MM-DD') AS "day", COUNT(*)::int AS "count"
      FROM "Account"
     WHERE "createdAt" >= (${from}::timestamptz AT TIME ZONE 'UTC')
     GROUP BY 2
    UNION ALL
    SELECT 'scans', to_char("createdAt", 'YYYY-MM-DD'), COUNT(*)::int
      FROM "Scan"
     WHERE "createdAt" >= (${from}::timestamptz AT TIME ZONE 'UTC')
     GROUP BY 2
    UNION ALL
    SELECT 'purchases', to_char(purchase."createdAt", 'YYYY-MM-DD'), COUNT(*)::int
      FROM "Purchase" AS purchase
     WHERE purchase."createdAt" >= (${from}::timestamptz AT TIME ZONE 'UTC')
       AND NOT EXISTS (
         SELECT 1
           FROM "CheckoutSession" AS checkout
          WHERE checkout."purchaseId" = purchase."id"
            AND checkout."liveMode" = false
       )
     GROUP BY 2`;
  return fillDailySeries(window, rows);
}
