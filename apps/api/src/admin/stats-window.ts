// The arithmetic around the owner dashboard's numbers, kept apart from the
// queries so the two parts that are easy to get subtly wrong — which UTC days a
// window covers, and never adding one currency to another — can be tested
// without a database.

/** The windows the dashboard offers. Anything else is refused, not rounded. */
export const STATS_WINDOW_DAYS = [7, 30, 90] as const;
export type StatsWindowDays = (typeof STATS_WINDOW_DAYS)[number];
export const DEFAULT_STATS_WINDOW_DAYS: StatsWindowDays = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A refund line whose currency was never recorded. Nothing written since the
 * cumulative-refund migration leaves it empty, but the column is nullable, and
 * such an amount must not be silently counted as some real currency.
 */
export const UNRECORDED_CURRENCY = 'unrecorded';

export interface StatsWindow {
  readonly days: StatsWindowDays;
  /** 00:00 UTC of the window's first day. */
  readonly from: Date;
  /** The moment the numbers were read; today is included up to here. */
  readonly to: Date;
}

/**
 * The last `days` calendar days in UTC, today included.
 *
 * Whole days rather than "now minus 30 × 24 h": a window that starts mid-day
 * would make its first bar a partial day and every bar's height depend on the
 * hour the page was opened.
 */
export function statsWindow(days: StatsWindowDays, now: Date): StatsWindow {
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { days, from: new Date(todayStart - (days - 1) * DAY_MS), to: now };
}

/** `YYYY-MM-DD` of the UTC day an instant falls on — the key the database groups by. */
export function utcDayKey(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

export const DAILY_SERIES = ['accounts', 'scans', 'purchases'] as const;
export type DailySeries = (typeof DAILY_SERIES)[number];

/** One (series, day) count as the database returns it; days with nothing are absent. */
export interface DayCount {
  readonly series: DailySeries;
  readonly day: string;
  readonly count: number;
}

export interface DailyPoint {
  readonly day: string;
  readonly accounts: number;
  readonly scans: number;
  readonly purchases: number;
}

/** Every day of the window, oldest first, with a zero wherever the database had no row. */
export function fillDailySeries(window: StatsWindow, counts: readonly DayCount[]): DailyPoint[] {
  const byKey = new Map(counts.map((row) => [`${row.series}:${row.day}`, row.count]));
  const countOf = (series: DailySeries, day: string): number => byKey.get(`${series}:${day}`) ?? 0;
  return Array.from({ length: window.days }, (_, index) => {
    const day = utcDayKey(new Date(window.from.getTime() + index * DAY_MS));
    return {
      day,
      accounts: countOf('accounts', day),
      scans: countOf('scans', day),
      purchases: countOf('purchases', day),
    };
  });
}

export interface CurrencyAmount {
  readonly currency: string;
  readonly amount: number;
}

/**
 * To the cent. Sums of stored floats drift (55 + 120 + 0.1 …), and a dashboard
 * that shows 175.10000000000002 is read as a bug in the money, not in the display.
 */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Adds amounts of the SAME currency only; the result has one entry per currency, sorted. */
export function sumByCurrency(amounts: readonly CurrencyAmount[]): CurrencyAmount[] {
  const totals = amounts.reduce(
    (sums, { currency, amount }) => new Map(sums).set(currency, (sums.get(currency) ?? 0) + amount),
    new Map<string, number>(),
  );
  return [...totals]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([currency, amount]) => ({ currency, amount: roundMoney(amount) }));
}

export interface RevenueLine {
  readonly currency: string;
  /** Charged for purchases made in the period. */
  readonly gross: number;
  /** Returned by the provider in the period, whichever purchase it was for. */
  readonly refunded: number;
  /** `gross - refunded`, per currency: money in and out of the same account. */
  readonly net: number;
}

/**
 * One line per currency that saw a charge or a refund. A currency with only a
 * refund in the period still gets a line, with a negative net — hiding it would
 * make the period look better than the money that actually moved.
 */
export function revenueLines(
  charged: readonly CurrencyAmount[],
  refunded: readonly CurrencyAmount[],
): RevenueLine[] {
  const gross = new Map(sumByCurrency(charged).map((line) => [line.currency, line.amount]));
  const returned = new Map(sumByCurrency(refunded).map((line) => [line.currency, line.amount]));
  // Code-unit order, not locale order: the same list in the same order on every server.
  const currencies = [...new Set([...gross.keys(), ...returned.keys()])].sort();
  return currencies.map((currency) => {
    const grossAmount = gross.get(currency) ?? 0;
    const refundedAmount = returned.get(currency) ?? 0;
    return {
      currency,
      gross: grossAmount,
      refunded: refundedAmount,
      net: roundMoney(grossAmount - refundedAmount),
    };
  });
}

/** Share of opened checkouts that ended in a payment; null when none were opened. */
export function conversionRate(opened: number, completed: number): number | null {
  if (opened === 0) return null;
  return Math.round((completed / opened) * 10_000) / 10_000;
}
