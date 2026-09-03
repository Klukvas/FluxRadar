import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { TARIFFS } from '@fluxradar/contracts';

const TERMINAL_SCAN_STATUSES = ['Partial', 'Completed', 'Failed', 'Cancelled'];

/** Deletes a scan snapshot and every dependent result row. */
export async function deleteScanResult(prisma: PrismaClient, scanId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const scan = await tx.scan.findUnique({ where: { id: scanId }, select: { accountId: true } });
    if (scan === null) {
      return;
    }
    await tx.deletedScan.upsert({
      where: { scanId },
      create: { scanId, accountIdHash: accountDeletionHash(scan.accountId), reason: 'retention' },
      update: { accountIdHash: accountDeletionHash(scan.accountId), reason: 'retention' },
    });
    await tx.job.deleteMany({ where: { scanId } });
    await tx.issue.deleteMany({ where: { scanId } });
    await tx.scanModule.deleteMany({ where: { scanId } });
    await tx.aiResponseRecord.deleteMany({ where: { scanId } });
    await tx.aiConsent.deleteMany({ where: { scanId } });
    await tx.scan.delete({ where: { id: scanId } });
  });
}

/** Removes terminal snapshots whose plan-specific retention window expired. */
export async function purgeExpiredScans(prisma: PrismaClient, now: Date): Promise<number> {
  const candidates = await prisma.scan.findMany({
    where: { status: { in: TERMINAL_SCAN_STATUSES } },
    select: { id: true, plan: true, createdAt: true },
  });
  let deleted = 0;
  for (const scan of candidates) {
    const retentionDays = TARIFFS[scan.plan as keyof typeof TARIFFS]?.retentionDays;
    if (retentionDays === undefined) {
      continue;
    }
    const expiresAt = scan.createdAt.getTime() + retentionDays * 24 * 60 * 60 * 1000;
    if (expiresAt <= now.getTime()) {
      await deleteScanResult(prisma, scan.id);
      deleted += 1;
    }
  }
  return deleted;
}

/** Stable, content-free audit identifier retained after account deletion. */
export function accountDeletionHash(accountId: string): string {
  return createHash('sha256').update(`fluxradar-account:${accountId}`).digest('hex');
}

/** Deletes user-owned data while retaining a minimal deletion fact. */
export async function deleteAccountData(prisma: PrismaClient, accountId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.accountDeletionAudit.create({
      data: {
        accountIdHash: accountDeletionHash(accountId),
        status: 'completed',
        completedAt: new Date(),
      },
    });
    const purchases = await tx.purchase.findMany({
      where: { accountId },
      select: { id: true, paddleTransactionId: true },
    });
    const purchaseIds = purchases.map(({ id }) => id);
    const transactionIds = purchases.map(({ paddleTransactionId }) => paddleTransactionId);
    const scans = await tx.scan.findMany({ where: { accountId }, select: { id: true } });
    const scanIds = scans.map(({ id }) => id);
    for (const scan of scans) {
      await tx.deletedScan.upsert({
        where: { scanId: scan.id },
        create: { scanId: scan.id, accountIdHash: accountDeletionHash(accountId), reason: 'account-deletion' },
        update: { accountIdHash: accountDeletionHash(accountId), reason: 'account-deletion' },
      });
    }
    await tx.job.deleteMany({ where: { scanId: { in: scanIds } } });
    await tx.issue.deleteMany({ where: { scanId: { in: scanIds } } });
    await tx.scanModule.deleteMany({ where: { scanId: { in: scanIds } } });
    await tx.aiResponseRecord.deleteMany({ where: { scanId: { in: scanIds } } });
    await tx.aiConsent.deleteMany({ where: { scanId: { in: scanIds } } });
    await tx.scan.deleteMany({ where: { id: { in: scanIds } } });
    await tx.refundRecord.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
    await tx.entitlement.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
    await tx.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
    await tx.siteProfile.deleteMany({ where: { accountId } });
    await tx.session.deleteMany({ where: { accountId } });
    await tx.aiConsent.deleteMany({ where: { accountId } });
    await tx.webhookEvent.deleteMany({
      where: {
        OR: [
          { accountId },
          ...(transactionIds.length > 0
            ? [{ paddleTransactionId: { in: transactionIds } }]
            : []),
        ],
      },
    });
    await tx.account.delete({ where: { id: accountId } });
  });
}
