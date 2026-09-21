// What the owner dashboard reads from GET /admin/stats, and how.
//
// The answer is checked field by field before the screen draws a single number:
// a partly-read payload would show zeros that look exactly like a quiet week.
// Anything that is not the expected shape — including the `null` and scan
// objects the workspace test mocks answer unknown paths with — is treated the
// same as the API's own 404: the dashboard is not available here.

import { ApiRequestError, apiRequest } from './api';

/** The screen's URL. The API route has the same path under the API origin. */
export const ADMIN_STATS_PATH = '/admin/stats';

export const ADMIN_STATS_WINDOWS = [7, 30, 90] as const;
export type AdminStatsWindow = (typeof ADMIN_STATS_WINDOWS)[number];
export const DEFAULT_ADMIN_STATS_WINDOW: AdminStatsWindow = 30;

export interface StatusCount {
  readonly status: string;
  readonly count: number;
}

export interface PlanCount {
  readonly plan: string;
  readonly count: number;
}

export interface RevenueLine {
  readonly currency: string;
  readonly gross: number;
  readonly refunded: number;
  readonly net: number;
}

export interface AdminPeriodStats {
  readonly accounts: { readonly created: number; readonly verified: number };
  readonly freeChecks: { readonly claimed: number };
  readonly scans: {
    readonly created: number;
    readonly byStatus: readonly StatusCount[];
    readonly byPlan: readonly PlanCount[];
  };
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

export interface DailyPoint {
  readonly day: string;
  readonly accounts: number;
  readonly scans: number;
  readonly purchases: number;
}

export interface AdminStats {
  readonly window: { readonly days: number; readonly from: string; readonly to: string };
  readonly period: AdminPeriodStats;
  readonly allTime: AdminPeriodStats;
  readonly daily: readonly DailyPoint[];
}

export type AdminStatsResult =
  | { readonly kind: 'ready'; readonly stats: AdminStats }
  /** 404, or an answer this screen cannot read: nothing to show and nothing to retry. */
  | { readonly kind: 'unavailable' }
  /** Network, session or server trouble: worth another try. */
  | { readonly kind: 'failed'; readonly message: string };

export async function loadAdminStats(days: AdminStatsWindow): Promise<AdminStatsResult> {
  try {
    const stats = readAdminStats(await apiRequest<unknown>(`${ADMIN_STATS_PATH}?days=${days}`));
    return stats === null ? { kind: 'unavailable' } : { kind: 'ready', stats };
  } catch (caught) {
    if (caught instanceof ApiRequestError && caught.status === 404) return { kind: 'unavailable' };
    return {
      kind: 'failed',
      message: caught instanceof Error ? caught.message : 'The numbers could not be loaded.',
    };
  }
}

type Shape = Readonly<Record<string, unknown>>;

function isShape(value: unknown): value is Shape {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasCounts(value: unknown, keys: readonly string[]): value is Shape {
  return isShape(value) && keys.every((key) => isCount(value[key]));
}

function isListOf<Row>(value: unknown, isRow: (row: unknown) => row is Row): value is Row[] {
  return Array.isArray(value) && value.every(isRow);
}

function isStatusCount(value: unknown): value is StatusCount {
  return isShape(value) && typeof value.status === 'string' && isCount(value.count);
}

function isPlanCount(value: unknown): value is PlanCount {
  return isShape(value) && typeof value.plan === 'string' && isCount(value.count);
}

function isRevenueLine(value: unknown): value is RevenueLine {
  return (
    isShape(value) &&
    typeof value.currency === 'string' &&
    isAmount(value.gross) &&
    isAmount(value.refunded) &&
    isAmount(value.net)
  );
}

function isDailyPoint(value: unknown): value is DailyPoint {
  return (
    hasCounts(value, ['accounts', 'scans', 'purchases']) &&
    typeof value.day === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.day)
  );
}

function isPeriodStats(value: unknown): value is AdminPeriodStats {
  if (!isShape(value)) return false;
  const { accounts, freeChecks, scans, checkouts, purchases, revenue, refunds, testMode } = value;
  const conversion = isShape(checkouts) ? checkouts.conversion : undefined;
  return (
    hasCounts(accounts, ['created', 'verified']) &&
    hasCounts(freeChecks, ['claimed']) &&
    hasCounts(scans, ['created']) &&
    isListOf(scans.byStatus, isStatusCount) &&
    isListOf(scans.byPlan, isPlanCount) &&
    hasCounts(checkouts, ['opened', 'completed', 'rejected']) &&
    (conversion === null || isAmount(conversion)) &&
    hasCounts(purchases, ['completed']) &&
    isListOf(purchases.byStatus, isStatusCount) &&
    isListOf(revenue, isRevenueLine) &&
    hasCounts(refunds, ['count']) &&
    hasCounts(testMode, ['checkoutsOpened', 'purchases'])
  );
}

/** The dashboard's data, or null when the answer is not the shape this screen draws. */
export function readAdminStats(value: unknown): AdminStats | null {
  if (!isShape(value)) return null;
  const { window, period, allTime, daily } = value;
  if (
    !isShape(window) ||
    !isCount(window.days) ||
    typeof window.from !== 'string' ||
    typeof window.to !== 'string'
  ) {
    return null;
  }
  if (!isPeriodStats(period) || !isPeriodStats(allTime) || !isListOf(daily, isDailyPoint)) {
    return null;
  }
  return {
    window: { days: window.days, from: window.from, to: window.to },
    period,
    allTime,
    daily,
  };
}
