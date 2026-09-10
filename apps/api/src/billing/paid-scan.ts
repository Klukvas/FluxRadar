import {
  ENTITLEMENT_DAYS,
  RULESET_VERSION,
  scanScopeSchema,
  type ExecutionConfig,
} from '@fluxradar/contracts';
import {
  captureExecutionConfig,
  legacyCheckoutConfig,
  lockOwnProfile,
} from '../profiles/execution-config.ts';
import type { Prisma } from '@prisma/client';

import { JOB_STATUSES, JOB_TYPES, PURCHASE_STATUSES } from './constants.ts';
import type { AiConsentInput } from './checkout-metadata.ts';
import { WebhookValidationError } from './errors.ts';
import type { PaidPlan } from './plans.ts';
import { ApiError } from '../http/errors.ts';

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
  readonly profileConfigVersion?: number | undefined;
  readonly executionConfig?: ExecutionConfig | undefined;
  readonly expectedProfileConfigVersion?: number | undefined;
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
  let profile;
  try {
    profile = await lockOwnProfile(
      tx,
      params.accountId,
      params.siteProfileId,
      params.expectedProfileConfigVersion,
    );
  } catch (error) {
    // HTTP callers need a typed 404 from lockOwnProfile, while payment webhooks
    // need a validation failure so the already-claimed checkout is rolled back
    // and recorded as rejected instead of escaping as an infrastructure error.
    if (error instanceof ApiError && error.code === 'NOT_FOUND') {
      throw new WebhookValidationError(
        `site profile ${params.siteProfileId} not found for account ${params.accountId}`,
      );
    }
    throw error;
  }

  const execution =
    params.executionConfig ??
    (params.provider === 'fastspring'
      ? legacyCheckoutConfig(profile.domain, params.plan, params.scopeJson)
      : captureExecutionConfig(
          profile,
          params.plan,
          scanScopeSchema.parse(JSON.parse(params.scopeJson)),
        ));
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
      domain: execution.profile.domain,
      status: 'Pending',
      scopeJson: params.scopeJson,
      profileConfigVersion: params.profileConfigVersion ?? profile.scanConfigVersion,
      executionConfigJson: JSON.stringify(execution),
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
