// The scan a report is compared with — one definition, for every reader of it.
//
// "The previous scan" is a product rule, not a query detail (§14, D-110): it is
// the scan of the same site profile, on the SAME plan, that COMPLETED most
// recently before this one completed. Same plan because two plans read different
// module sets — Website Audit never runs SEO — so a finding missing from the
// other plan's report is not a fix, and comparing across plans would call every
// SEO finding of a Complete scan "resolved" the moment a Website Audit ran
// after it.
//
// WHY COMPLETION TIME AND NOT CREATION TIME. A Partial scan can be retried
// module by module, and the retry re-terminalizes it: scan A ends Partial, the
// owner buys B, B completes, then the owner retries A's unfinished section and
// A completes. Ordered by creation, A's baseline is whatever came before A —
// B's whole picture is skipped, and A closes findings against a reading two
// runs old. Ordered by completion, A's baseline is B: the retry makes A's
// findings current as of the moment A finished, so the meaningful comparison is
// the latest complete picture before that moment. `Scan.completedAt` is written
// on every result state and cleared again on Partial → Running, so it is
// exactly that moment (billing/state-machine.ts).
//
// It lived in two places before this file: the Resolved/Reopened pass in
// orchestrator/issue-sync.ts and the "since last scan" read in
// issues/summary.ts. Two copies of a rule this consequential is one copy too
// many — they had already drifted on whether the candidate must be earlier at
// all — so both now call in here, and so do the new-issue status inheritance and
// the comparison endpoint.
//
// Ordering is a keyset, not a bare `completedAt desc`: two scans that finished
// in the same millisecond must not be able to answer "which came first"
// differently from one read to the next. The same keyset is what makes
// "earlier" exact instead of "not itself".
//
// INDEXES. The filter is served by `Scan(accountId, siteProfileId, createdAt,
// id)`; the sort is not, so PostgreSQL orders the matching rows itself. The
// matching set is the finished scans of ONE profile on ONE plan — tens of rows
// for the busiest customer — so the sort is not worth an index of its own.

import type { Prisma, PrismaClient, Scan } from '@prisma/client';

import {
  PAID_ACCESS_INCLUDE,
  isPaidAccessActive,
  type PaidAccessScan,
} from '../billing/report-access.ts';

/** Latest completion first, with the id as the tie-break. */
export const PREVIOUS_SCAN_ORDER = [{ completedAt: 'desc' }, { id: 'desc' }] as const;

/** What a scan has to be to serve as another's previous scan. */
export type ComparedAgainst = Pick<
  Scan,
  'id' | 'siteProfileId' | 'accountId' | 'plan' | 'completedAt'
>;

/**
 * Strictly earlier in (completedAt, id) order — or no bound at all.
 *
 * A scan that has not reached a result state has no completion time, and there
 * is no instant to be earlier than. Its baseline is then simply the latest
 * finished scan of the plan: that is what "the previous scan" means while this
 * one is still running, and it keeps a comparison read of an unfinished report
 * from silently answering "there is nothing before this".
 */
function completedBefore(scan: ComparedAgainst): Prisma.ScanWhereInput {
  const at = scan.completedAt;
  if (at === null) {
    return {};
  }
  return { OR: [{ completedAt: { lt: at } }, { completedAt: at, id: { lt: scan.id } }] };
}

/**
 * Same profile, same plan, finished, and completed before this one.
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
    // A Completed scan is the only one with usable output to compare against;
    // whether its MODULES produced any is the verdict's question, not the
    // selection's, because "the previous scan produced nothing" is a fact the
    // report has to be able to state rather than skip past silently.
    status: 'Completed',
    // Never itself, whatever timestamp the caller is holding: the worker passes a
    // scan row it loaded before the run wrote to it, and a comparison must not be
    // able to compare a scan with itself because of that.
    id: { not: scan.id },
    ...completedBefore(scan),
  };
}

/** The same predicate with the plan condition inverted: earlier, but not this plan. */
export function earlierScanOfAnotherPlanWhere(scan: ComparedAgainst): Prisma.ScanWhereInput {
  return { ...previousScanWhere(scan), plan: { not: scan.plan } };
}

/**
 * The previous scan of this plan, whatever became of its payment.
 *
 * This is the §14 selection itself, and every reader that must agree with the
 * Resolved/Reopened pass takes it: the pass is deciding what the run just proved
 * about earlier findings, and a refunded purchase does not un-observe them.
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

/** The previous scan, and whether its own report is still the owner's to read. */
export interface PreviousScanRead {
  readonly scan: Scan;
  /**
   * False when the purchase behind it was reversed, suspended or expired.
   *
   * It does NOT change which scan was selected — the comparison has to be drawn
   * against the same run the Resolved statuses were written against, or the two
   * halves of the report disagree. It decides one thing: whether that report may
   * be linked to.
   */
  readonly readable: boolean;
}

/**
 * The same selection as {@link findPreviousScan}, with its readability read.
 *
 * One query, one row, the same where-clause and the same order — so "the scan
 * the comparison used" and "the scan the Resolved pass used" cannot drift apart
 * through a second definition.
 */
export async function findPreviousScanRead(
  prisma: PrismaClient,
  scan: ComparedAgainst,
): Promise<PreviousScanRead | null> {
  const previous = (await prisma.scan.findFirst({
    where: previousScanWhere(scan),
    orderBy: [...PREVIOUS_SCAN_ORDER],
    include: { ...PAID_ACCESS_INCLUDE },
  })) as (Scan & PaidAccessScan) | null;
  return previous === null ? null : { scan: previous, readable: isPaidAccessActive(previous) };
}

/**
 * How far back the LEGACY "since last scan" block looks for a readable report.
 *
 * The comparison endpoint does not use it: it compares against the §14 scan
 * whatever became of the payment, and reports readability separately. This is
 * the older `GET /scans/:id/changes` read, which counts findings of the previous
 * report and therefore may not reach into one the owner no longer owns. A
 * reversed payment can hide the latest one or two; a profile with more
 * unreadable reports in a row than this has no such block worth drawing.
 */
export const PREVIOUS_SCAN_CANDIDATES = 5;

/**
 * The previous scan of this plan whose report the account may still read.
 *
 * A previous report whose payment was reversed is skipped rather than counted:
 * its findings are no longer the owner's to read, and a count derived from them
 * is still a read of them.
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
