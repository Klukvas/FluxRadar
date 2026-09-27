// The scan a report is compared with — one definition, for every reader of it.
//
// "The previous scan" is a product rule, not a query detail (§14, D-110): it is
// the most recent EARLIER scan of the same site profile, on the SAME plan, that
// finished. Same plan because two plans read different module sets — Website
// Audit never runs SEO — so a finding missing from the other plan's report is
// not a fix, and comparing across plans would call every SEO finding of a
// Complete scan "resolved" the moment a Website Audit ran after it.
//
// It lived in two places before this file: the Resolved/Reopened pass in
// orchestrator/issue-sync.ts and the "since last scan" read in
// issues/summary.ts. Two copies of a rule this consequential is one copy too
// many — they had already drifted on whether the candidate must be earlier at
// all — so both now call in here, and so does the comparison endpoint.
//
// Ordering is a keyset, not a bare `createdAt desc`: scan history is ordered by
// (createdAt DESC, id DESC) everywhere in this API, and two scans created in the
// same millisecond must not be able to answer "which came first" differently
// from one read to the next. The same keyset is what makes "earlier" exact
// instead of "not itself".

import type { Prisma, PrismaClient, Scan } from '@prisma/client';

import {
  PAID_ACCESS_INCLUDE,
  isPaidAccessActive,
  type PaidAccessScan,
} from '../billing/report-access.ts';

/** Newest first, with the id as the tie-break — the API's scan-history order. */
export const PREVIOUS_SCAN_ORDER = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

/** What a scan has to be to serve as another's previous scan. */
export type ComparedAgainst = Pick<
  Scan,
  'id' | 'siteProfileId' | 'accountId' | 'plan' | 'createdAt'
>;

/**
 * Strictly earlier in (createdAt, id) order, same profile, same plan, finished.
 *
 * Exported as a where-clause so a caller that needs to ask a different question
 * about the same set — "is there any earlier scan of ANOTHER plan" — can build it
 * from the same predicate instead of restating it.
 */
export function previousScanWhere(scan: ComparedAgainst): Prisma.ScanWhereInput {
  return {
    accountId: scan.accountId,
    siteProfileId: scan.siteProfileId,
    plan: scan.plan,
    status: 'Completed',
    // Never itself, whatever timestamp the caller is holding: the worker passes a
    // scan row it loaded before the run wrote to it, and a comparison must not be
    // able to compare a scan with itself because of that.
    id: { not: scan.id },
    OR: [{ createdAt: { lt: scan.createdAt } }, { createdAt: scan.createdAt, id: { lt: scan.id } }],
  };
}

/** The same predicate with the plan condition inverted: earlier, but not this plan. */
export function earlierScanOfAnotherPlanWhere(scan: ComparedAgainst): Prisma.ScanWhereInput {
  const { plan, ...rest } = previousScanWhere(scan);
  void plan;
  return { ...rest, plan: { not: scan.plan } };
}

/**
 * The previous scan of this plan, whatever became of its payment.
 *
 * This is the worker's reading: the Resolved/Reopened pass is deciding what the
 * run just proved about earlier findings, and a refunded purchase does not
 * un-observe them.
 */
export async function findPreviousScan(
  prisma: PrismaClient,
  scan: ComparedAgainst,
): Promise<Scan | null> {
  return prisma.scan.findFirst({
    where: previousScanWhere(scan),
    orderBy: [...PREVIOUS_SCAN_ORDER],
  });
}

/**
 * How far back a report read looks for a previous scan the owner may still see.
 *
 * A reversed payment can hide the latest one or two; a profile with more
 * unreadable reports in a row than this has no comparison worth drawing.
 */
export const PREVIOUS_SCAN_CANDIDATES = 5;

/**
 * The previous scan of this plan whose report the account may still read.
 *
 * This is the report's reading. A previous report whose payment was reversed is
 * skipped rather than counted: its findings are no longer the owner's to read,
 * and a count derived from them is still a read of them.
 */
export async function findPreviousReadableScan(
  prisma: PrismaClient,
  scan: ComparedAgainst,
): Promise<Scan | null> {
  const candidates = (await prisma.scan.findMany({
    where: previousScanWhere(scan),
    orderBy: [...PREVIOUS_SCAN_ORDER],
    take: PREVIOUS_SCAN_CANDIDATES,
    include: { ...PAID_ACCESS_INCLUDE },
  })) as (Scan & PaidAccessScan)[];
  return candidates.find((candidate) => isPaidAccessActive(candidate)) ?? null;
}

/** Whether ANY earlier finished scan of the profile ran on a different plan. */
export async function hasEarlierScanOfAnotherPlan(
  prisma: PrismaClient,
  scan: ComparedAgainst,
): Promise<boolean> {
  const other = await prisma.scan.findFirst({
    where: earlierScanOfAnotherPlanWhere(scan),
    select: { id: true },
  });
  return other !== null;
}
