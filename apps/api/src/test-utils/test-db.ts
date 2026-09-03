import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient, Purchase, Scan } from '@prisma/client';
import { RULESET_VERSION, TARIFFS } from '@fluxradar/contracts';
import type { ScanRuntimeStatus } from '@fluxradar/contracts';

import { createPrismaClient } from '../db.ts';
import { PURCHASE_STATUSES } from '../billing/constants.ts';
import { TEMPLATE_DB_PATH } from './template-db.ts';

export const TEST_WEBHOOK_SECRET = 'test-paddle-webhook-secret';

export interface TestDb {
  readonly prisma: PrismaClient;
  readonly databaseUrl: string;
  cleanup(): Promise<void>;
}

/** Isolated per-test-file SQLite database copied from the pushed template. */
export async function createTestDb(): Promise<TestDb> {
  const dir = await mkdtemp(join(tmpdir(), 'fluxradar-test-db-'));
  const dbPath = join(dir, 'test.db');
  await copyFile(TEMPLATE_DB_PATH, dbPath);
  const databaseUrl = `file:${dbPath}`;
  const prisma = createPrismaClient(databaseUrl);
  return {
    prisma,
    databaseUrl,
    async cleanup(): Promise<void> {
      await prisma.$disconnect();
      await rm(dir, { recursive: true, force: true });
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

/** Directly seeds a scan (optionally with its purchase) in an arbitrary state. */
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
            paddleTransactionId: `txn_${randomUUID()}`,
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
