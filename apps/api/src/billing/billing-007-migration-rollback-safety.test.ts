import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../db.ts';
import {
  API_PACKAGE_ROOT,
  PRISMA_SCHEMA_PATH,
  testDatabaseUrl,
} from '../test-utils/template-db.ts';
import { createTestDb, seedAccountWithProfile, type TestDb } from '../test-utils/test-db.ts';

// BILLING-007: a deploy must never be able to make an automatic rollback unsafe.
//
// `prisma migrate deploy` runs before the new containers take traffic, and every
// remaining failure in the deploy leaves the PREVIOUS release serving. The
// previous release keeps reading the columns it was built against, so a migration
// that renames or removes one turns a failed deploy into a broken production.
//
// Two halves are checked here:
//   1. statically — no checked-in migration contains destructive DDL, and the
//      expand-phase compatibility columns are still declared;
//   2. against a real database — the sync triggers keep the legacy and the
//      provider-neutral id columns equal no matter which release wrote the row,
//      the previous release's account deletion still succeeds against tables it
//      does not know about, and the deploy's schema-surface probe actually
//      rejects a schema the previous release could not read.

const MIGRATIONS_DIR = join(API_PACKAGE_ROOT, 'prisma', 'migrations');
const SCHEMA_PATH = join(API_PACKAGE_ROOT, 'prisma', 'schema.prisma');

/**
 * A migration that genuinely has to be destructive (the contract phase that drops
 * the paddle* columns) declares it in its header. Shipping one is a deliberate
 * act: it may only be released once no container of any release that still reads
 * those columns can be started again.
 */
const CONTRACT_PHASE_MARKER = 'fluxradar:contract-phase';

const DESTRUCTIVE_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'RENAME COLUMN', pattern: /\bRENAME\s+COLUMN\b/i },
  { label: 'RENAME TO', pattern: /\bRENAME\s+TO\b/i },
  { label: 'RENAME CONSTRAINT', pattern: /\bRENAME\s+CONSTRAINT\b/i },
  { label: 'DROP COLUMN', pattern: /\bDROP\s+COLUMN\b/i },
  { label: 'DROP TABLE', pattern: /\bDROP\s+TABLE\b/i },
  { label: 'DROP INDEX', pattern: /\bDROP\s+INDEX\b/i },
  { label: 'DROP CONSTRAINT', pattern: /\bDROP\s+CONSTRAINT\b/i },
];

function migrationFiles(): readonly { readonly name: string; readonly sql: string }[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      sql: readFileSync(join(MIGRATIONS_DIR, entry.name, 'migration.sql'), 'utf8'),
    }));
}

/** Statement lines only: the rationale in the comments may name what it avoids. */
function statements(sql: string): readonly string[] {
  return sql
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('--'));
}

describe('BILLING-007 migration rollback safety', () => {
  it('ships no migration that the previous release could not survive', () => {
    for (const migration of migrationFiles()) {
      if (migration.sql.includes(CONTRACT_PHASE_MARKER)) {
        continue;
      }
      const body = statements(migration.sql).join('\n');
      for (const { label, pattern } of DESTRUCTIVE_PATTERNS) {
        expect(
          pattern.test(body),
          `${migration.name} contains ${label}. A release that is rolled back still reads the ` +
            'old shape, so this must move to a contract-phase migration in a later release.',
        ).toBe(false);
      }
    }
  });

  it('only makes a column NOT NULL when the same migration added it', () => {
    for (const migration of migrationFiles()) {
      const body = statements(migration.sql).join('\n');
      const added = new Set(
        [...body.matchAll(/ADD\s+COLUMN\s+"([^"]+)"/gi)].map((match) => match[1]),
      );
      for (const match of body.matchAll(/ALTER\s+COLUMN\s+"([^"]+)"\s+SET\s+NOT\s+NULL/gi)) {
        expect(
          added.has(match[1]),
          `${migration.name} makes the pre-existing column ${String(match[1])} NOT NULL, which the ` +
            'previous release cannot satisfy when it writes.',
        ).toBe(true);
      }
    }
  });

  it('still declares the expand-phase compatibility columns the previous release reads', () => {
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    // Removing any of these is the contract phase, and it may only ship in a
    // release after this one — together with the migration that drops them.
    for (const field of ['paddleTransactionId', 'paddleEventId', 'paddleSignature']) {
      expect(schema).toContain(field);
    }
  });

  describe('with a database', () => {
    let db: TestDb;

    beforeEach(async () => {
      db = await createTestDb();
    });

    afterEach(async () => {
      await db.cleanup();
    });

    it('fills the provider-neutral columns when only the legacy ones are written', async () => {
      const account = await seedAccountWithProfile(db.prisma);
      const transactionId = `txn_${randomUUID()}`;
      // Exactly the INSERT the previous release issues: it knows nothing about
      // provider/providerTransactionId.
      await db.prisma.$executeRawUnsafe(
        'INSERT INTO "Purchase" ("id","accountId","siteProfileId","plan","paddleTransactionId","amountUsd","currency") VALUES ($1,$2,$3,$4,$5,$6,$7)',
        'purchase-legacy-write',
        account.accountId,
        account.siteProfileId,
        'Basic',
        transactionId,
        55,
        'USD',
      );

      const purchase = await db.prisma.purchase.findUniqueOrThrow({
        where: { id: 'purchase-legacy-write' },
      });
      expect(purchase.provider).toBe('paddle');
      expect(purchase.providerTransactionId).toBe(transactionId);
    });

    it('fills the legacy columns when only the provider-neutral ones are written', async () => {
      const account = await seedAccountWithProfile(db.prisma);
      const orderId = `ord_${randomUUID()}`;
      await db.prisma.purchase.create({
        data: {
          accountId: account.accountId,
          siteProfileId: account.siteProfileId,
          plan: 'Basic',
          provider: 'fastspring',
          providerTransactionId: orderId,
          amountUsd: 55,
          currency: 'USD',
        },
      });

      // The previous release selects paddleTransactionId and requires a value.
      const [row] = await db.prisma.$queryRawUnsafe<{ paddleTransactionId: string | null }[]>(
        'SELECT "paddleTransactionId" FROM "Purchase" WHERE "providerTransactionId" = $1',
        orderId,
      );
      expect(row?.paddleTransactionId).toBe(orderId);
    });

    // An UPDATE is where COALESCE mirroring silently stops working: both columns
    // already hold a value, so a write to one of them keeps the other's old value
    // and the two column families start describing different orders.
    it('mirrors an UPDATE written by the previous release into the provider columns', async () => {
      const account = await seedAccountWithProfile(db.prisma);
      const purchase = await db.prisma.purchase.create({
        data: {
          accountId: account.accountId,
          siteProfileId: account.siteProfileId,
          plan: 'Basic',
          provider: 'paddle',
          providerTransactionId: `txn_${randomUUID()}`,
          amountUsd: 55,
          currency: 'USD',
        },
      });
      const corrected = `txn_${randomUUID()}`;

      // The previous release only knows the legacy column.
      await db.prisma.$executeRawUnsafe(
        'UPDATE "Purchase" SET "paddleTransactionId" = $1 WHERE "id" = $2',
        corrected,
        purchase.id,
      );

      const after = await db.prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
      expect(after.providerTransactionId).toBe(corrected);
    });

    it('mirrors an UPDATE written by this release into the legacy columns', async () => {
      const account = await seedAccountWithProfile(db.prisma);
      const purchase = await db.prisma.purchase.create({
        data: {
          accountId: account.accountId,
          siteProfileId: account.siteProfileId,
          plan: 'Basic',
          provider: 'fastspring',
          providerTransactionId: `ord_${randomUUID()}`,
          amountUsd: 55,
          currency: 'USD',
        },
      });
      const refund = await db.prisma.refundRecord.create({
        data: {
          purchaseId: purchase.id,
          idempotencyKey: `refund:${purchase.id}`,
          reasonCode: 'LEGAL_SUPPORT',
          status: 'requested',
          amountUsd: 55,
          provider: 'fastspring',
          providerTransactionId: purchase.providerTransactionId,
          providerEventId: 'fs_evt_before',
          providerSignature: 'sig-before',
        },
      });
      const settledOrderId = `ord_${randomUUID()}`;

      await db.prisma.purchase.update({
        where: { id: purchase.id },
        data: { providerTransactionId: settledOrderId },
      });
      await db.prisma.refundRecord.update({
        where: { id: refund.id },
        data: {
          providerTransactionId: settledOrderId,
          providerEventId: 'fs_evt_after',
          providerSignature: 'sig-after',
        },
      });

      const [updatedPurchase] = await db.prisma.$queryRawUnsafe<
        { paddleTransactionId: string | null }[]
      >('SELECT "paddleTransactionId" FROM "Purchase" WHERE "id" = $1', purchase.id);
      expect(updatedPurchase?.paddleTransactionId).toBe(settledOrderId);

      const [updatedRefund] = await db.prisma.$queryRawUnsafe<
        {
          paddleTransactionId: string | null;
          paddleEventId: string | null;
          paddleSignature: string | null;
        }[]
      >(
        'SELECT "paddleTransactionId", "paddleEventId", "paddleSignature" FROM "RefundRecord" WHERE "id" = $1',
        refund.id,
      );
      expect(updatedRefund?.paddleTransactionId).toBe(settledOrderId);
      expect(updatedRefund?.paddleEventId).toBe('fs_evt_after');
      expect(updatedRefund?.paddleSignature).toBe('sig-after');
    });

    it('mirrors an UPDATE of a webhook event in both directions', async () => {
      const event = await db.prisma.webhookEvent.create({
        data: {
          provider: 'fastspring',
          providerEventId: `fs_evt_${randomUUID()}`,
          eventType: 'order.completed',
          rawBody: '{}',
          signature: 'sig',
        },
      });
      const orderId = `ord_${randomUUID()}`;

      // Exactly what the webhook handler does once it knows the order.
      await db.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { providerTransactionId: orderId },
      });
      const [mirrored] = await db.prisma.$queryRawUnsafe<{ paddleTransactionId: string | null }[]>(
        'SELECT "paddleTransactionId" FROM "WebhookEvent" WHERE "id" = $1',
        event.id,
      );
      expect(mirrored?.paddleTransactionId).toBe(orderId);

      const legacyOrderId = `txn_${randomUUID()}`;
      await db.prisma.$executeRawUnsafe(
        'UPDATE "WebhookEvent" SET "paddleTransactionId" = $1 WHERE "id" = $2',
        legacyOrderId,
        event.id,
      );
      const back = await db.prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(back.providerTransactionId).toBe(legacyOrderId);
    });

    it('keeps webhook events and refund records readable from both column families', async () => {
      const account = await seedAccountWithProfile(db.prisma);
      const purchase = await db.prisma.purchase.create({
        data: {
          accountId: account.accountId,
          siteProfileId: account.siteProfileId,
          plan: 'Basic',
          provider: 'fastspring',
          providerTransactionId: `ord_${randomUUID()}`,
          amountUsd: 55,
          currency: 'USD',
        },
      });
      await db.prisma.webhookEvent.create({
        data: {
          provider: 'fastspring',
          providerEventId: 'fs_evt_sync',
          eventType: 'order.completed',
          rawBody: '{}',
          signature: 'sig',
        },
      });
      await db.prisma.refundRecord.create({
        data: {
          purchaseId: purchase.id,
          idempotencyKey: `refund:${purchase.id}`,
          reasonCode: 'LEGAL_SUPPORT',
          status: 'paid',
          amountUsd: 55,
          provider: 'fastspring',
          providerTransactionId: purchase.providerTransactionId,
          providerEventId: 'fs_evt_sync',
          providerSignature: 'sig',
        },
      });

      const [event] = await db.prisma.$queryRawUnsafe<{ paddleEventId: string | null }[]>(
        'SELECT "paddleEventId" FROM "WebhookEvent" WHERE "providerEventId" = $1',
        'fs_evt_sync',
      );
      expect(event?.paddleEventId).toBe('fs_evt_sync');

      const [refund] = await db.prisma.$queryRawUnsafe<
        { paddleTransactionId: string | null; paddleSignature: string | null }[]
      >(
        'SELECT "paddleTransactionId", "paddleSignature" FROM "RefundRecord" WHERE "purchaseId" = $1',
        purchase.id,
      );
      expect(refund?.paddleTransactionId).toBe(purchase.providerTransactionId);
      expect(refund?.paddleSignature).toBe('sig');
    });

    // The previous release has no CheckoutSession model, so after a rollback its
    // GDPR account deletion deletes SiteProfile and Account with checkout
    // sessions still pointing at them. Under the RESTRICT default that fails with
    // a foreign-key error and the account can never be erased; the migration
    // therefore declares both parents ON DELETE CASCADE.
    it('lets the previous release delete an account whose checkout sessions it cannot see', async () => {
      const account = await seedAccountWithProfile(db.prisma);
      await db.prisma.checkoutSession.create({
        data: {
          provider: 'fastspring',
          reference: `frcs_${randomUUID()}`,
          accountId: account.accountId,
          siteProfileId: account.siteProfileId,
          plan: 'Basic',
          productPath: 'fluxradar-basic-scan',
          expectedAmountUsd: 55,
          liveMode: false,
          scopeJson: JSON.stringify({ includeSubdomains: false }),
        },
      });

      // Raw SQL, in the previous release's own order: it never mentions
      // CheckoutSession because that table did not exist when it was built.
      await db.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'DELETE FROM "Purchase" WHERE "accountId" = $1',
          account.accountId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM "SiteProfile" WHERE "accountId" = $1',
          account.accountId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM "Session" WHERE "accountId" = $1',
          account.accountId,
        );
        await tx.$executeRawUnsafe('DELETE FROM "Account" WHERE "id" = $1', account.accountId);
      });

      expect(await db.prisma.account.count({ where: { id: account.accountId } })).toBe(0);
      expect(
        await db.prisma.checkoutSession.count({ where: { accountId: account.accountId } }),
      ).toBe(0);
    });
  });

  // The deploy gate that decides whether an automatic rollback is safe. It runs
  // the previous image's OWN Prisma client against the migrated schema, so it has
  // to fail when a contract-phase migration removed something that client still
  // selects — which `/health/ready` (a bare `SELECT 1`) cannot detect.
  describe('schema-surface rollback probe', () => {
    const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
    const PROBE_PATH = join(REPO_ROOT, 'deploy', 'rollback-schema-probe.cjs');
    const PRISMA_BIN = join(API_PACKAGE_ROOT, 'node_modules', '.bin', 'prisma');

    // Cloning a migrated template is a file copy; migrating each scratch database
    // from scratch is not. Doing it once keeps this block fast enough to stay
    // reliable on a loaded two-core CI runner.
    const TEMPLATE_NAME = `fluxradar_probe_template_${randomUUID().replaceAll('-', '')}`;
    const SETUP_TIMEOUT_MS = 120_000;
    const PROBE_TIMEOUT_MS = 60_000;

    let scratchName: string;
    let scratchUrl: string;
    let admin: TestDb;

    /** Same database as testDatabaseUrl(), with the database name swapped out. */
    function urlFor(databaseName: string): string {
      return testDatabaseUrl().replace(/\/[^/?]+(\?|$)/, `/${databaseName}$1`);
    }

    /**
     * Drops a scratch database, waiting out a backend this role may not kill.
     *
     * `WITH (FORCE)` terminates the other connections to the database, and
     * terminating one requires membership of the role that owns it. Right after a
     * database is created and migrated, the connection attached to it is usually
     * an autovacuum worker — owned by the superuser, not by the test role — and
     * the drop then fails with `42501` on a database that is about to be idle
     * anyway. Retrying briefly is enough; a drop that still fails after that is a
     * real failure and is left to throw.
     */
    async function dropDatabase(client: TestDb, name: string): Promise<void> {
      const attempts = 10;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          await client.prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
          return;
        } catch (error) {
          if (attempt === attempts) {
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
    }

    /** Runs the probe exactly as the deploy does, and reports what it decided. */
    function runProbe(databaseUrl: string): { readonly ok: boolean; readonly output: string } {
      try {
        const output = execFileSync(process.execPath, [PROBE_PATH], {
          env: { ...process.env, DATABASE_URL: databaseUrl, FLUXRADAR_PROBE_APP_DIR: REPO_ROOT },
          encoding: 'utf8',
          stdio: 'pipe',
        });
        return { ok: true, output };
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string };
        return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
      }
    }

    // The template carries exactly the schema the checked-in migrations produce.
    // Nothing stays connected to it, which is what lets each test clone it.
    beforeAll(async () => {
      const setup = await createTestDb();
      try {
        await setup.prisma.$executeRawUnsafe(`CREATE DATABASE "${TEMPLATE_NAME}"`);
        execFileSync(PRISMA_BIN, ['migrate', 'deploy', '--schema', PRISMA_SCHEMA_PATH], {
          cwd: API_PACKAGE_ROOT,
          env: { ...process.env, DATABASE_URL: urlFor(TEMPLATE_NAME) },
          stdio: 'pipe',
        });
      } finally {
        await setup.cleanup();
      }
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
      const teardown = await createTestDb();
      try {
        await dropDatabase(teardown, TEMPLATE_NAME);
      } finally {
        await teardown.cleanup();
      }
    }, SETUP_TIMEOUT_MS);

    // A throwaway clone, never the shared test database: the probe is only
    // meaningful against a schema this test is free to break on purpose.
    beforeEach(async () => {
      admin = await createTestDb();
      scratchName = `fluxradar_probe_${randomUUID().replaceAll('-', '')}`;
      scratchUrl = urlFor(scratchName);
      await admin.prisma.$executeRawUnsafe(
        `CREATE DATABASE "${scratchName}" TEMPLATE "${TEMPLATE_NAME}"`,
      );
    }, SETUP_TIMEOUT_MS);

    afterEach(async () => {
      await dropDatabase(admin, scratchName);
      await admin.cleanup();
    }, SETUP_TIMEOUT_MS);

    it(
      'passes against the schema this expand-phase migration produces',
      () => {
        const result = runProbe(scratchUrl);
        expect(result.output).toContain('schema-surface probe OK');
        expect(result.ok).toBe(true);
      },
      PROBE_TIMEOUT_MS,
    );

    it(
      'fails when a contract-phase migration drops a column the client still selects',
      async () => {
        const scratch = createPrismaClient(scratchUrl);
        try {
          // Exactly the contract phase documented in docs/DEPLOYMENT.md, shipped
          // one release too early: the previous image still selects paddleEventId.
          await scratch.$executeRawUnsafe('ALTER TABLE "WebhookEvent" DROP COLUMN "paddleEventId"');
        } finally {
          await scratch.$disconnect();
        }

        const result = runProbe(scratchUrl);
        expect(result.ok).toBe(false);
        expect(result.output).toContain('schema-surface probe FAILED');
        expect(result.output).toContain('WebhookEvent');
      },
      PROBE_TIMEOUT_MS,
    );

    it(
      'fails when a contract-phase migration drops a whole table',
      async () => {
        const scratch = createPrismaClient(scratchUrl);
        try {
          await scratch.$executeRawUnsafe('DROP TABLE "RefundRecord"');
        } finally {
          await scratch.$disconnect();
        }

        const result = runProbe(scratchUrl);
        expect(result.ok).toBe(false);
        expect(result.output).toContain('RefundRecord');
      },
      PROBE_TIMEOUT_MS,
    );

    // The readiness probe the gate used to rely on alone: it answers "the
    // database is reachable" and stays green through both failures above.
    it(
      'detects what a SELECT 1 readiness check cannot',
      async () => {
        const scratch = createPrismaClient(scratchUrl);
        try {
          await scratch.$executeRawUnsafe(
            'ALTER TABLE "Purchase" DROP COLUMN "paddleTransactionId"',
          );
          await expect(scratch.$queryRawUnsafe('SELECT 1')).resolves.toBeDefined();
        } finally {
          await scratch.$disconnect();
        }

        expect(runProbe(scratchUrl).ok).toBe(false);
      },
      PROBE_TIMEOUT_MS,
    );
  });
});
