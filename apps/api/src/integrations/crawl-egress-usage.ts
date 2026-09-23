// How much of each egress proxy's monthly traffic allowance we have spent.
//
// The Kyiv VPS the crawl leaves through sells 1 TB a month. Nothing counted it,
// so the first sign of running out would have been every scan failing at once,
// reported to us by a customer. With a choice of locations (D-228) each proxy
// is its own VPS on its own plan, so each is counted — and warned about —
// against its own allowance.
//
// What is counted here is the page and media bodies a crawl read — which is the
// overwhelming majority of what crosses the proxy, and all of it attributable
// to a scan. It is therefore a floor, not a bill: request headers, TLS and
// retries are not in it. The warning threshold is set low enough that the gap
// does not matter, and `vnstat` on the VPS remains the authority.

import type { PrismaClient } from '@prisma/client';

import type { ApiLogger } from '../http/logger.ts';
import type { EgressLocationDefinition } from './crawl-egress-locations.ts';

/** Share of the allowance at which the log starts asking for attention. */
export const EGRESS_WARNING_RATIO = 0.8;

/** The part of a location the counter needs: its id and its plan's allowance. */
export type MeteredEgressLocation = Pick<EgressLocationDefinition, 'id' | 'monthlyTrafficBytes'>;

/** `YYYY-MM` in UTC — the unit the hosting plan resets on. */
export function usageMonthOf(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface EgressUsage {
  readonly location: string;
  readonly month: string;
  readonly bytes: number;
  readonly limitBytes: number;
  /** 0..1 of the monthly allowance; may exceed 1 once the plan is overrun. */
  readonly usedRatio: number;
  readonly nearingLimit: boolean;
}

/**
 * Adds one crawl's bytes to its location's total for this month, and reports
 * where that leaves the location.
 *
 * Upsert on location and month, incremented in the database rather than
 * read-modify-write, so two scans finishing at once cannot lose each other's
 * traffic.
 */
export async function recordEgressUsage(
  prisma: PrismaClient,
  location: MeteredEgressLocation,
  bytes: number,
  now: Date,
): Promise<EgressUsage> {
  const month = usageMonthOf(now);
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0;
  const row = await prisma.crawlEgressLocationUsage.upsert({
    where: { location_month: { location: location.id, month } },
    create: { location: location.id, month, bytes: BigInt(safeBytes) },
    update: { bytes: { increment: BigInt(safeBytes) } },
  });
  return usageOf(location, month, Number(row.bytes));
}

export async function readEgressUsage(
  prisma: PrismaClient,
  location: MeteredEgressLocation,
  now: Date,
): Promise<EgressUsage> {
  const month = usageMonthOf(now);
  const row = await prisma.crawlEgressLocationUsage.findUnique({
    where: { location_month: { location: location.id, month } },
  });
  return usageOf(location, month, row === null ? 0 : Number(row.bytes));
}

function usageOf(location: MeteredEgressLocation, month: string, bytes: number): EgressUsage {
  const usedRatio = bytes / location.monthlyTrafficBytes;
  return {
    location: location.id,
    month,
    bytes,
    limitBytes: location.monthlyTrafficBytes,
    usedRatio,
    nearingLimit: usedRatio >= EGRESS_WARNING_RATIO,
  };
}

/** Warns once a location's allowance is running out; says nothing while it is not. */
export function logEgressUsage(logger: ApiLogger, usage: EgressUsage): void {
  if (!usage.nearingLimit) return;
  logger.warn('crawl egress traffic is nearing the monthly allowance', {
    location: usage.location,
    month: usage.month,
    bytes: usage.bytes,
    limitBytes: usage.limitBytes,
    usedPercent: Math.round(usage.usedRatio * 100),
  });
}
