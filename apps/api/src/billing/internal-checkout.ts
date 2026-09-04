import { RULESET_VERSION } from '@fluxradar/contracts';
import type { ScanScopeInput } from '@fluxradar/contracts';
import type { PrismaClient, Scan } from '@prisma/client';

import { JOB_TYPES } from './constants.ts';
import type { PaddleCustomData, PaidPlan } from './webhook-schema.ts';
import { notFound } from '../http/errors.ts';

export interface InternalCheckoutParams {
  readonly prisma: PrismaClient;
  readonly accountId: string;
  readonly siteProfileId: string;
  readonly plan: PaidPlan;
  readonly scope: ScanScopeInput;
  readonly aiConsent: PaddleCustomData['aiConsent'];
  readonly now: Date;
}

/**
 * Creates a production scan for an explicitly allowlisted internal account.
 * It intentionally has no Purchase/Entitlement row: no payment happened, so
 * billing history must not contain a fabricated paid transaction.
 */
export async function createInternalFreeScan(params: InternalCheckoutParams): Promise<Scan> {
  return params.prisma.$transaction(async (tx) => {
    const profile = await tx.siteProfile.findFirst({
      where: { id: params.siteProfileId, accountId: params.accountId },
    });
    if (profile === null) {
      throw notFound('site profile not found');
    }

    const scan = await tx.scan.create({
      data: {
        purchaseId: null,
        accountId: params.accountId,
        siteProfileId: profile.id,
        plan: params.plan,
        domain: profile.domain,
        status: 'Pending',
        scopeJson: JSON.stringify(params.scope),
        rulesetVersion: RULESET_VERSION,
        createdAt: params.now,
      },
    });
    await tx.job.create({
      data: {
        scanId: scan.id,
        type: JOB_TYPES.scan,
        status: 'Pending',
        createdAt: params.now,
      },
    });

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

    return scan;
  });
}
