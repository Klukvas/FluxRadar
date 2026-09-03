import type { PrismaClient, RefundRecord, ScanModule } from '@prisma/client';

import { STATUS_REASONS } from './constants.ts';
import { BillingNotFoundError, InvalidTransitionError } from './errors.ts';
import { requestRefund } from './refund.ts';
import { transitionScan } from './state-machine.ts';

export type ScanOutcome =
  | { readonly kind: 'Completed' }
  | { readonly kind: 'Partial'; readonly statusReason: string }
  /** Zero usable modules on the first pass: the single free external retry (§18). */
  | { readonly kind: 'ExternalRetryGranted' }
  | {
      readonly kind: 'Failed';
      readonly statusReason: typeof STATUS_REASONS.noUsableOutput;
      /** Automatic full refund; null for the purchase-less Free check. */
      readonly refund: RefundRecord | null;
    };

/**
 * Terminalizes a Running scan from its ScanModule rows (§18 + D-026/D-027).
 *
 * - every relevant module usable and all applicable checks closed -> Completed;
 * - at least one usable module -> Partial, no automatic refund;
 * - zero usable modules -> one free external retry (module_retry_count <= 1 via
 *   CAS), then Failed with NoUsableOutput and the EXTERNAL_NO_USABLE_OUTPUT
 *   full refund. Partial refunds are not supported.
 *
 * `usableOutput` is the stored per-module verdict computed by the worker with
 * @fluxradar/scoring `hasUsableOutput`; a module whose checks completed without
 * a valid metric/score/finding-with-evidence has usableOutput=false and lands
 * in the NoUsableOutput branch (§18 billing fixture).
 */
export async function resolveScanOutcome(prisma: PrismaClient, scanId: string): Promise<ScanOutcome> {
  const scan = await prisma.scan.findUnique({ where: { id: scanId }, include: { modules: true } });
  if (!scan) {
    throw new BillingNotFoundError(`scan ${scanId} not found`);
  }
  if (scan.status !== 'Running') {
    throw new InvalidTransitionError(`scan ${scanId} is ${scan.status}, only Running scans resolve`);
  }

  // Fully Not-applicable modules neither block Completed nor count as usable;
  // when ALL modules are N/A the scan falls through to NoUsableOutput (D-027).
  const relevant = scan.modules.filter((module) => module.runtimeStatus !== 'Not applicable');
  const usable = relevant.filter((module) => module.usableOutput);

  if (usable.length === 0) {
    return resolveNoUsableOutput(prisma, scanId, scan.purchaseId);
  }
  if (usable.length === relevant.length && relevant.every(allApplicableChecksClosed)) {
    await transitionScan(prisma, scanId, 'Running', 'Completed', { statusReason: null });
    return { kind: 'Completed' };
  }
  const statusReason =
    usable.length < relevant.length
      ? STATUS_REASONS.externalModuleFailure
      : STATUS_REASONS.incompleteChecks;
  await transitionScan(prisma, scanId, 'Running', 'Partial', { statusReason });
  return { kind: 'Partial', statusReason };
}

async function resolveNoUsableOutput(
  prisma: PrismaClient,
  scanId: string,
  purchaseId: string | null,
): Promise<ScanOutcome> {
  // Grant the single external retry atomically: the counter guard inside the
  // WHERE keeps module_retry_count <= 1 even under concurrent resolution.
  const { count } = await prisma.scan.updateMany({
    where: { id: scanId, status: 'Running', moduleRetryCount: { lt: 1 } },
    data: { moduleRetryCount: { increment: 1 } },
  });
  if (count === 1) {
    return { kind: 'ExternalRetryGranted' };
  }

  await transitionScan(prisma, scanId, 'Running', 'Failed', {
    statusReason: STATUS_REASONS.noUsableOutput,
  });
  const refund =
    purchaseId === null
      ? null
      : (await requestRefund(prisma, purchaseId, 'EXTERNAL_NO_USABLE_OUTPUT')).record;
  return { kind: 'Failed', statusReason: STATUS_REASONS.noUsableOutput, refund };
}

function allApplicableChecksClosed(module: ScanModule): boolean {
  const applicable = module.applicableChecks ?? 0;
  const completed = module.completedApplicableChecks ?? 0;
  return completed >= applicable;
}
