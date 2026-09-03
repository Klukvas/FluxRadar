// Resolved/Reopened по fingerprint между Complete-сканами профиля (§14, D-110).
// Начальный статус нового issue наследует последнюю известную судьбу того же
// fingerprint в успешных Complete-сканах: Resolved → Reopened, пользовательские
// Acknowledged/Ignored/False Positive переносятся (решение принято о том же
// evidence), остальное → New. После успешного Complete-скана fingerprint-ы
// предыдущего Complete-скана, отсутствующие в новом, помечаются Resolved.

import type { PrismaClient, Scan } from '@prisma/client';
import type { IssueStatus } from '@fluxradar/contracts';

const CARRIED_USER_STATUSES: readonly IssueStatus[] = ['Acknowledged', 'Ignored', 'False Positive'];

function inheritedStatus(previous: string): IssueStatus {
  if (previous === 'Resolved') {
    return 'Reopened';
  }
  if ((CARRIED_USER_STATUSES as readonly string[]).includes(previous)) {
    return previous as IssueStatus;
  }
  return 'New';
}

/**
 * Начальные статусы новых issues Complete-скана. Ищется последнее вхождение
 * каждого fingerprint среди более ранних успешных Complete-сканов профиля.
 */
export async function initialIssueStatuses(
  prisma: PrismaClient,
  scan: Scan,
  fingerprints: readonly string[],
): Promise<ReadonlyMap<string, IssueStatus>> {
  if (scan.plan !== 'Complete' || fingerprints.length === 0) {
    return new Map();
  }
  const previous = await prisma.issue.findMany({
    where: {
      fingerprint: { in: [...fingerprints] },
      scan: {
        siteProfileId: scan.siteProfileId,
        plan: 'Complete',
        status: 'Completed',
        id: { not: scan.id },
      },
    },
    orderBy: { observedAt: 'desc' },
    select: { fingerprint: true, status: true },
  });
  const statuses = new Map<string, IssueStatus>();
  for (const issue of previous) {
    // Сортировка desc: первое вхождение fingerprint — самое свежее.
    if (!statuses.has(issue.fingerprint)) {
      statuses.set(issue.fingerprint, inheritedStatus(issue.status));
    }
  }
  return statuses;
}

/**
 * После успешного Complete-скана: fingerprint-ы предыдущего Complete-скана,
 * не найденные в новом, получают Resolved (§14: «Resolved назначается только
 * при успешном Complete-скане, в котором прежний fingerprint отсутствует»).
 */
export async function markResolvedAgainstPrevious(
  prisma: PrismaClient,
  scan: Scan,
): Promise<number> {
  if (scan.plan !== 'Complete') {
    return 0;
  }
  const previousScan = await prisma.scan.findFirst({
    where: {
      siteProfileId: scan.siteProfileId,
      plan: 'Complete',
      status: 'Completed',
      id: { not: scan.id },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (previousScan === null) {
    return 0;
  }
  const currentFingerprints = await prisma.issue.findMany({
    where: { scanId: scan.id },
    select: { fingerprint: true },
  });
  const { count } = await prisma.issue.updateMany({
    where: {
      scanId: previousScan.id,
      status: { not: 'Resolved' },
      fingerprint: { notIn: currentFingerprints.map((issue) => issue.fingerprint) },
    },
    data: { status: 'Resolved' },
  });
  return count;
}
