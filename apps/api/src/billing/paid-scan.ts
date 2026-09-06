import { ENTITLEMENT_DAYS, RULESET_VERSION } from '@fluxradar/contracts';
import type { Prisma } from '@prisma/client';

import { JOB_STATUSES, JOB_TYPES, PURCHASE_STATUSES } from './constants.ts';
import type { AiConsentInput } from './checkout-metadata.ts';
import { WebhookValidationError } from './errors.ts';
import type { PaidPlan } from './plans.ts';

export interface PaidScanParams {
  readonly provider: string;
  readonly providerTransactionId: string;
  readonly accountId: string;
  readonly siteProfileId: string;
  readonly plan: PaidPlan;
  /** USD-normalised price; the refund policy and reporting work in this figure. */
  readonly amount: number;
  readonly currency: string;
  /** What the buyer was actually charged, when the provider localised it. */
  readonly settledAmount?: number | undefined;
  readonly settledCurrency?: string | undefined;
  /** Provider product identifier (FastSpring product path / MockPaddle price id). */
  readonly priceId: string;
  readonly scopeJson: string;
  readonly aiConsent?: AiConsentInput | undefined;
  readonly now: Date;
}

export interface PaidScanRecords {
  readonly purchaseId: string;
  readonly entitlementId: string;
  readonly scanId: string;
}

/**
 * The single place a payment turns into product access (§18): Purchase →
 * Entitlement (30 days) → Scan (Pending) → Job, plus the per-scan AI consent.
 * Callers must run this inside one transaction with the webhook dedup insert so
 * a redelivered event cannot produce a second scan.
 */
export async function createPaidScan(
  tx: Prisma.TransactionClient,
  params: PaidScanParams,
): Promise<PaidScanRecords> {
  const profile = await tx.siteProfile.findUnique({ where: { id: params.siteProfileId } });
  if (profile === null || profile.accountId !== params.accountId) {
    throw new WebhookValidationError(
      `site profile ${params.siteProfileId} not found for account ${params.accountId}`,
    );
  }

  const purchase = await tx.purchase.create({
    data: {
      accountId: params.accountId,
      siteProfileId: params.siteProfileId,
      plan: params.plan,
      provider: params.provider,
      providerTransactionId: params.providerTransactionId,
      amountUsd: params.amount,
      currency: params.currency,
      settledAmount: params.settledAmount ?? null,
      settledCurrency: params.settledCurrency ?? null,
      priceId: params.priceId,
      status: PURCHASE_STATUSES.paid,
    },
  });
  const entitlement = await tx.entitlement.create({
    data: { purchaseId: purchase.id, expiresAt: addDays(params.now, ENTITLEMENT_DAYS) },
  });
  const scan = await tx.scan.create({
    data: {
      purchaseId: purchase.id,
      accountId: params.accountId,
      siteProfileId: params.siteProfileId,
      plan: params.plan,
      domain: profile.domain,
      status: 'Pending',
      scopeJson: params.scopeJson,
      rulesetVersion: RULESET_VERSION,
    },
  });
  await tx.job.create({
    data: { scanId: scan.id, type: JOB_TYPES.scan, status: JOB_STATUSES.pending },
  });
  // Consent per scan (§5): without this row the GEO module reports
  // Unavailable/ConsentMissing and never reaches an AI provider.
  if (params.aiConsent !== undefined) {
    await tx.aiConsent.create({
      data: {
        accountId: params.accountId,
        scanId: scan.id,
        providersJson: JSON.stringify(params.aiConsent.providers),
        noticeVersion: params.aiConsent.noticeVersion,
      },
    });
  }

  return { purchaseId: purchase.id, entitlementId: entitlement.id, scanId: scan.id };
}

export function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}
