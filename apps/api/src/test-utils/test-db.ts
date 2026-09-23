import { randomUUID } from 'node:crypto';
import { describe } from 'vitest';
import type { PrismaClient, Purchase, Scan } from '@prisma/client';
import { RULESET_VERSION, TARIFFS } from '@fluxradar/contracts';
import type { ScanRuntimeStatus } from '@fluxradar/contracts';

import { createPrismaClient } from '../db.ts';
import { PURCHASE_STATUSES } from '../billing/constants.ts';
import { FASTSPRING_PROVIDER } from '../billing/fastspring/config.ts';
import { testDatabaseUrl } from './template-db.ts';
import { isTestDatabaseReady, testDatabaseSkipReason } from './test-database-url.ts';
import { TRUNCATED_TABLES } from './truncated-tables.ts';

/**
 * A suite that needs the disposable PostgreSQL database.
 *
 * Without one it is SKIPPED, with the guard's reason in the suite name, so a run
 * on a machine that has no test database reports "skipped, because …" instead of
 * either failing or quietly passing. A database that is configured but refused
 * never reaches here: global-setup.ts already failed the run.
 */
export function describeDb(name: string, suite: () => void): void {
  if (isTestDatabaseReady()) {
    describe(name, suite);
    return;
  }
  describe.skip(`${name} [skipped: ${testDatabaseSkipReason()}]`, suite);
}

export interface TestDb {
  readonly prisma: PrismaClient;
  readonly databaseUrl: string;
  cleanup(): Promise<void>;
}

/**
 * Isolated test state in the disposable PostgreSQL database.
 *
 * `testDatabaseUrl()` re-runs the guard here rather than trusting the one
 * global-setup ran, so the TRUNCATE below cannot reach a database the guard
 * would refuse — including on a run that never went through global setup at all.
 * Vitest runs DB-backed files sequentially; truncation keeps each file isolated.
 *
 * The list names every table rather than relying on CASCADE, and
 * truncate-coverage.test.ts checks it against the schema: a table with no
 * foreign key — `CrawlEgressUsage` and `CrawlEgressLocationUsage` are keyed by
 * month and location alone — is reached by no cascade at all, and a missing
 * name carries its rows into the next test file.
 */
export async function createTestDb(): Promise<TestDb> {
  const databaseUrl = testDatabaseUrl();
  const prisma = createPrismaClient(databaseUrl);
  const tables = TRUNCATED_TABLES.map((table) => `"${table}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE`);
  return {
    prisma,
    databaseUrl,
    async cleanup(): Promise<void> {
      // Teardown is a disconnect and nothing else: a suite that failed halfway
      // leaves its rows for the next run's TRUNCATE, which is guarded, rather
      // than issuing a second destructive statement from an error path.
      await prisma.$disconnect();
    },
  };
}

export interface SeededAccount {
  readonly accountId: string;
  readonly siteProfileId: string;
  readonly domain: string;
}

export async function seedAccountWithProfile(prisma: PrismaClient): Promise<SeededAccount> {
  const account = await prisma.account.create({
    data: { email: `user-${randomUUID()}@example.com`, passwordHash: 'test-hash' },
  });
  const profile = await prisma.siteProfile.create({
    data: { accountId: account.id, name: 'Test Site', domain: 'https://example.com' },
  });
  return { accountId: account.id, siteProfileId: profile.id, domain: profile.domain };
}

export interface SeedScanParams {
  readonly account: SeededAccount;
  readonly status: ScanRuntimeStatus;
  readonly plan?: 'Free' | 'Basic' | 'Complete';
  readonly withPurchase?: boolean;
  readonly statusReason?: string;
  readonly moduleRetryCount?: number;
  readonly platformRetryCount?: number;
}

export interface SeededScan {
  readonly scan: Scan;
  readonly purchase: Purchase | null;
}

/**
 * Directly seeds a scan (optionally with its purchase) in an arbitrary state.
 *
 * It writes NO entitlement, which production never does (createPaidScan writes
 * both in one transaction). The paid-access guard fails closed on that, so a
 * scan seeded here answers 403 `ENTITLEMENT_SUSPENDED` on the report endpoints;
 * create the entitlement in the test when it needs to read one.
 */
export async function seedScan(prisma: PrismaClient, params: SeedScanParams): Promise<SeededScan> {
  const plan = params.plan ?? 'Basic';
  const purchase =
    params.withPurchase === false
      ? null
      : await prisma.purchase.create({
          data: {
            accountId: params.account.accountId,
            siteProfileId: params.account.siteProfileId,
            plan,
            provider: FASTSPRING_PROVIDER,
            providerTransactionId: `ord_${randomUUID()}`,
            amountUsd: TARIFFS[plan].priceUsd,
            currency: 'USD',
            status: PURCHASE_STATUSES.paid,
          },
        });
  const scan = await prisma.scan.create({
    data: {
      purchaseId: purchase?.id ?? null,
      accountId: params.account.accountId,
      siteProfileId: params.account.siteProfileId,
      plan,
      domain: params.account.domain,
      status: params.status,
      statusReason: params.statusReason ?? null,
      scopeJson: JSON.stringify({ includeSubdomains: false }),
      rulesetVersion: RULESET_VERSION,
      moduleRetryCount: params.moduleRetryCount ?? 0,
      platformRetryCount: params.platformRetryCount ?? 0,
      startedAt: params.status === 'Running' ? new Date() : null,
    },
  });
  return { scan, purchase };
}

export interface SeedModuleParams {
  readonly scanId: string;
  readonly module: string;
  readonly runtimeStatus: string;
  readonly usableOutput: boolean;
  readonly applicableChecks?: number;
  readonly completedApplicableChecks?: number;
}

export async function seedScanModule(
  prisma: PrismaClient,
  params: SeedModuleParams,
): Promise<void> {
  await prisma.scanModule.create({
    data: {
      scanId: params.scanId,
      module: params.module,
      runtimeStatus: params.runtimeStatus,
      usableOutput: params.usableOutput,
      applicableChecks: params.applicableChecks ?? null,
      completedApplicableChecks: params.completedApplicableChecks ?? null,
    },
  });
}

/**
 * Records that this site let the crawler in, so a checkout may open.
 *
 * `createCheckoutSession` refuses to sell an audit of a site whose last
 * reachability probe is missing, stale, or negative (FASTSPRING-009). Tests
 * about the checkout itself state the precondition here rather than running a
 * probe, so a failure names the thing they are actually testing.
 */
export async function seedReachableSite(
  prisma: PrismaClient,
  accountId: string,
  siteProfileId: string,
  checkedAt = new Date(),
): Promise<void> {
  // The probe is only usable for the domain it recorded, so the seed reads the
  // profile's own domain rather than inventing one — a mismatch here would
  // refuse the checkout for a reason the test is not about.
  const profile = await prisma.siteProfile.findUniqueOrThrow({ where: { id: siteProfileId } });
  const row = { accountId, origin: profile.domain, state: 'reachable', checkedAt };
  await prisma.siteReachabilityProbe.upsert({
    where: { siteProfileId },
    create: { siteProfileId, ...row },
    update: row,
  });
}
