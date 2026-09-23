// Deleting one site profile together with the audit and billing history of that site.
//
// It is account deletion scoped to one site: the same rows go in the same
// foreign-key order (`deleteScanRows` / `deletePurchaseRows`), a DeletedScan fact
// stays behind for every scan, and exported reports leave object storage only
// after the database transaction commits. What it refuses is anything still in
// motion, because removing those rows mid-flight loses money or a report the
// owner is owed:
//   * a scan the worker may be running (Pending, Queued, Running);
//   * a checkout that can still be paid — the provider webhook needs its binding;
//   * a refund still being processed — its record is what says money is owed.
//
// A dispute does not block. The provider settles it on its side, and nothing
// ever moves a purchase out of Disputed again, so refusing on it would make the
// profile permanently undeletable — the same trap an abandoned checkout once was.
//
// Free-check claims are keyed by origin, not by profile, and deliberately stay:
// deleting and re-adding a site must not hand out a second free check.

import type { Prisma, PrismaClient } from '@prisma/client';

import { openCheckoutSessionWhere } from '../billing/checkout-lifecycle.ts';
import { REFUND_STATUSES } from '../billing/constants.ts';
import {
  accountDeletionHash,
  deletePurchaseRows,
  deleteScanRows,
  purchaseDeliveryFilters,
  removeStoredObjects,
} from '../data-retention.ts';
import { createConfiguredObjectStore, type PrivateObjectStore } from '../integrations/s3.ts';

export const PROFILE_DELETION_REASON = 'profile-deletion';

// Paused is active: the run has not been given up on, and deleting the profile
// under it would remove the site a resume is about to crawl.
const ACTIVE_SCAN_STATUSES = ['Pending', 'Queued', 'Running', 'Paused'];
const OPEN_REFUND_STATUSES = [REFUND_STATUSES.requested, REFUND_STATUSES.processing];

export const PROFILE_DELETION_BLOCKERS = {
  activeScan: 'PROFILE_HAS_ACTIVE_SCAN',
  openCheckout: 'PROFILE_HAS_OPEN_CHECKOUT',
  openRefund: 'PROFILE_HAS_OPEN_REFUND',
} as const;

export type ProfileDeletionBlocker =
  (typeof PROFILE_DELETION_BLOCKERS)[keyof typeof PROFILE_DELETION_BLOCKERS];

export type ProfileDeletionResult =
  | {
      readonly kind: 'deleted';
      readonly deletedScanCount: number;
      /** Reports whose rows are gone but whose storage delete failed. */
      readonly orphanedArtifactCount: number;
    }
  | { readonly kind: 'blocked'; readonly blocker: ProfileDeletionBlocker }
  | { readonly kind: 'not-found' };

export interface ProfileDeletionInput {
  readonly accountId: string;
  readonly profileId: string;
  readonly now: Date;
}

type RowDeletionOutcome =
  | Exclude<ProfileDeletionResult, { readonly kind: 'deleted' }>
  | {
      readonly kind: 'deleted';
      readonly deletedScanCount: number;
      readonly objectKeys: readonly string[];
    };

export async function deleteSiteProfileData(
  prisma: PrismaClient,
  input: ProfileDeletionInput,
  objectStore: PrivateObjectStore | null = createConfiguredObjectStore(),
): Promise<ProfileDeletionResult> {
  const outcome = await prisma.$transaction((tx) => deleteProfileRows(tx, input), {
    maxWait: 10_000,
    timeout: 30_000,
  });
  if (outcome.kind !== 'deleted') return outcome;
  return {
    kind: 'deleted',
    deletedScanCount: outcome.deletedScanCount,
    orphanedArtifactCount: await removeStoredObjects(objectStore, outcome.objectKeys),
  };
}

async function deleteProfileRows(
  tx: Prisma.TransactionClient,
  input: ProfileDeletionInput,
): Promise<RowDeletionOutcome> {
  // Locked before anything is checked. Inserting a scan or checkout session for
  // this profile takes a key-share lock on the row through its foreign key, so
  // it either committed before this point (and the checks below see it) or
  // waits for this transaction and then finds no profile to attach to.
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "SiteProfile"
    WHERE "id" = ${input.profileId} AND "accountId" = ${input.accountId}
    FOR UPDATE`;
  if (locked.length === 0) return { kind: 'not-found' };

  const siteProfileId = input.profileId;
  const blocker = await findDeletionBlocker(tx, siteProfileId, input.now);
  if (blocker !== null) return { kind: 'blocked', blocker };

  const scans = await tx.scan.findMany({ where: { siteProfileId }, select: { id: true } });
  const scanIds = scans.map(({ id }) => id);
  const artifacts = await tx.exportArtifact.findMany({
    where: { scanId: { in: scanIds } },
    select: { objectKey: true },
  });
  const purchases = await tx.purchase.findMany({
    where: { siteProfileId },
    select: { id: true, provider: true, providerTransactionId: true },
  });

  await deleteScanRows(tx, scanIds, {
    accountIdHash: accountDeletionHash(input.accountId),
    reason: PROFILE_DELETION_REASON,
  });
  await tx.checkoutSession.deleteMany({ where: { siteProfileId } });
  await deletePurchaseRows(
    tx,
    purchases.map(({ id }) => id),
  );
  if (purchases.length > 0) {
    // The provider's deliveries for these orders carry the buyer's details and
    // go with the purchases, exactly as they do on account deletion.
    await tx.webhookEvent.deleteMany({ where: { OR: purchaseDeliveryFilters(purchases) } });
  }
  await tx.siteGoogleBinding.deleteMany({ where: { siteProfileId } });
  // The ownership proof is about this profile's domain and means nothing
  // without it; the Bing binding is a pointer at a provider resource chosen for
  // this profile and means nothing without it either.
  await tx.domainVerification.deleteMany({ where: { siteProfileId } });
  await tx.siteBingBinding.deleteMany({ where: { siteProfileId } });
  // The last thing this site said about letting our crawler in. It is a
  // precondition for a purchase, not a record worth keeping past the profile.
  await tx.siteReachabilityProbe.deleteMany({ where: { siteProfileId } });
  await tx.siteProfile.delete({ where: { id: siteProfileId } });
  return {
    kind: 'deleted',
    deletedScanCount: scanIds.length,
    objectKeys: artifacts.map(({ objectKey }) => objectKey),
  };
}

async function findDeletionBlocker(
  tx: Prisma.TransactionClient,
  siteProfileId: string,
  now: Date,
): Promise<ProfileDeletionBlocker | null> {
  const activeScans = await tx.scan.count({
    where: { siteProfileId, status: { in: ACTIVE_SCAN_STATUSES } },
  });
  if (activeScans > 0) return PROFILE_DELETION_BLOCKERS.activeScan;

  const openCheckouts = await tx.checkoutSession.count({
    where: { siteProfileId, ...openCheckoutSessionWhere(now) },
  });
  if (openCheckouts > 0) return PROFILE_DELETION_BLOCKERS.openCheckout;

  const openRefunds = await tx.refundRecord.count({
    where: { status: { in: OPEN_REFUND_STATUSES }, purchase: { siteProfileId } },
  });
  return openRefunds > 0 ? PROFILE_DELETION_BLOCKERS.openRefund : null;
}
