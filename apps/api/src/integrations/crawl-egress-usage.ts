// How much of the egress proxy's monthly traffic allowance we have spent.
//
// The Kyiv VPS the crawl leaves through sells 1 TB a month. Nothing counted it,
// so the first sign of running out would have been every scan failing at once,
// reported to us by a customer.
//
// What is counted here is the page and media bodies a crawl read — which is the
// overwhelming majority of what crosses the proxy, and all of it attributable
// to a scan. It is therefore a floor, not a bill: request headers, TLS and
// retries are not in it. The warning threshold is set low enough that the gap
// does not matter, and `vnstat` on the VPS remains the authority.

import type { PrismaClient } from '@prisma/client';

import type { ApiLogger } from '../http/logger.ts';

/** The VPS plan's monthly allowance. */
export const EGRESS_MONTHLY_BYTE_LIMIT = 1_000_000_000_000;

/** Share of the allowance at which the log starts asking for attention. */
export const EGRESS_WARNING_RATIO = 0.8;

/** `YYYY-MM` in UTC — the unit the hosting plan resets on. */
export function usageMonthOf(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface EgressUsage {
  readonly month: string;
  readonly bytes: number;
  readonly limitBytes: number;
  /** 0..1 of the monthly allowance; may exceed 1 once the plan is overrun. */
  readonly usedRatio: number;
  readonly nearingLimit: boolean;
}

/**
 * Adds one crawl's bytes to this month's total and reports where that leaves us.
 *
 * Upsert on the month, incremented in the database rather than read-modify-write,
 * so two scans finishing at once cannot lose each other's traffic.
 */
export async function recordEgressUsage(
  prisma: PrismaClient,
  bytes: number,
  now: Date,
): Promise<EgressUsage> {
  const month = usageMonthOf(now);
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0;
  const row = await prisma.crawlEgressUsage.upsert({
    where: { month },
    create: { month, bytes: BigInt(safeBytes) },
    update: { bytes: { increment: BigInt(safeBytes) } },
  });
  return usageOf(month, Number(row.bytes));
}

export async function readEgressUsage(prisma: PrismaClient, now: Date): Promise<EgressUsage> {
  const month = usageMonthOf(now);
  const row = await prisma.crawlEgressUsage.findUnique({ where: { month } });
  return usageOf(month, row === null ? 0 : Number(row.bytes));
}

function usageOf(month: string, bytes: number): EgressUsage {
  const usedRatio = bytes / EGRESS_MONTHLY_BYTE_LIMIT;
  return {
    month,
    bytes,
    limitBytes: EGRESS_MONTHLY_BYTE_LIMIT,
    usedRatio,
    nearingLimit: usedRatio >= EGRESS_WARNING_RATIO,
  };
}

/** Warns once the allowance is running out; says nothing while it is not. */
export function logEgressUsage(logger: ApiLogger, usage: EgressUsage): void {
  if (!usage.nearingLimit) return;
  logger.warn('crawl egress traffic is nearing the monthly allowance', {
    month: usage.month,
    bytes: usage.bytes,
    limitBytes: usage.limitBytes,
    usedPercent: Math.round(usage.usedRatio * 100),
  });
}
