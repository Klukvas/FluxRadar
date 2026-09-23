import { RULESET_VERSION } from '@fluxradar/contracts';
import type { ScanScopeInput } from '@fluxradar/contracts';
import type { PrismaClient, Scan } from '@prisma/client';

import { JOB_TYPES } from './constants.ts';
import type { PaddleCustomData, PaidPlan } from './webhook-schema.ts';
import { captureExecutionConfig, lockOwnProfile } from '../profiles/execution-config.ts';
import { validationError } from '../http/errors.ts';
import { scopeTargetMessage, scopeTargetProblems } from '../scans/scope-targets.ts';

export interface InternalCheckoutParams {
  readonly prisma: PrismaClient;
  readonly accountId: string;
  readonly siteProfileId: string;
  readonly plan: PaidPlan;
  readonly scope: ScanScopeInput;
  readonly aiConsent: PaddleCustomData['aiConsent'];
  readonly now: Date;
  readonly expectedProfileConfigVersion?: number | undefined;
}

/**
 * Creates a production scan for an explicitly allowlisted internal account.
 * It intentionally has no Purchase/Entitlement row: no payment happened, so
 * billing history must not contain a fabricated paid transaction.
 */
export async function createInternalFreeScan(params: InternalCheckoutParams): Promise<Scan> {
  return params.prisma.$transaction(async (tx) => {
    const profile = await lockOwnProfile(
      tx,
      params.accountId,
      params.siteProfileId,
      params.expectedProfileConfigVersion,
    );
    // Seeds and API checks name addresses; they have to be this site's.
    const problems = scopeTargetProblems(params.scope, profile.domain);
    if (problems.length > 0) {
      throw validationError(scopeTargetMessage(problems));
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
        profileConfigVersion: profile.scanConfigVersion,
        executionConfigJson: JSON.stringify(
          captureExecutionConfig(profile, params.plan, params.scope),
        ),
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
