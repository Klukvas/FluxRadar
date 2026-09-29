import type { PrismaClient, Scan, ScanModule } from '@prisma/client';
import { PLANS, TARIFFS, planSupports } from '@fluxradar/contracts';

import { PAID_ACCESS_INCLUDE, type PaidAccessScan } from '../billing/report-access.ts';
import { forbidden } from '../http/errors.ts';
import { pageMetaFrom, type PageMeta, type PageRequest } from '../http/pagination.ts';

const ORDER = [{ createdAt: 'desc' }, { id: 'desc' }] as const;
const HISTORY_PLANS = PLANS.filter((plan) => planSupports(plan, 'scanHistory'));
const PAID_PLANS_WITHOUT_HISTORY = PLANS.filter(
  (plan) => !planSupports(plan, 'scanHistory') && TARIFFS[plan].priceUsd > 0,
);

export type ScanHistoryScan = Scan &
  PaidAccessScan & { modules: ScanModule[]; job: { readonly status: string } | null };

export interface ScanHistoryPage {
  readonly scans: readonly ScanHistoryScan[];
  readonly meta: PageMeta;
}

export async function listScanHistory(
  prisma: PrismaClient,
  where: { readonly accountId: string; readonly siteProfileId?: string },
  page: PageRequest,
  historyRequested: boolean,
): Promise<ScanHistoryPage> {
  const [unlocking, gated] = await Promise.all([
    prisma.scan.findFirst({
      where: { ...where, plan: { in: [...HISTORY_PLANS] } },
      select: { id: true },
    }),
    prisma.scan.findFirst({
      where: { ...where, plan: { in: [...PAID_PLANS_WITHOUT_HISTORY] } },
      select: { id: true },
    }),
  ]);
  if (unlocking === null && gated !== null) {
    if (historyRequested) {
      throw forbidden('HISTORY_REQUIRES_COMPLETE', 'scan history is not included in this plan');
    }
    const current =
      page.offset === 0
        ? ((await prisma.scan.findMany({
            where,
            include: { modules: true, job: { select: { status: true } }, ...PAID_ACCESS_INCLUDE },
            orderBy: [...ORDER],
            take: 1,
          })) as ScanHistoryScan[])
        : [];
    return {
      scans: current,
      meta: { total: 1, page: page.page, limit: page.limit, hasNext: false },
    };
  }
  const [scans, total] = await Promise.all([
    prisma.scan.findMany({
      where,
      include: { modules: true, job: { select: { status: true } }, ...PAID_ACCESS_INCLUDE },
      orderBy: [...ORDER],
      skip: page.offset,
      take: page.limit,
    }) as Promise<ScanHistoryScan[]>,
    prisma.scan.count({ where }),
  ]);
  return { scans, meta: pageMetaFrom(page, scans.length, total) };
}
