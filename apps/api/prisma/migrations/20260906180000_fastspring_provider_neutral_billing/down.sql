-- Manual reversal of the expand phase in migration.sql.
--
-- Prisma has no down migrations, and an automatic release rollback must NOT run
-- this: the expand phase is backward compatible on purpose, so the previous image
-- keeps working against the migrated schema and nothing has to be undone. Use this
-- only when the FastSpring work is abandoned entirely and no release that knows the
-- provider-neutral columns is deployed any more.
--
--   psql "$DATABASE_URL" -f down.sql
--   DELETE FROM "_prisma_migrations"
--     WHERE migration_name = '20260906180000_fastspring_provider_neutral_billing';
--
-- Destructive: it drops the CheckoutSession table and every provider-neutral
-- column. Take a dump first.

DROP TABLE IF EXISTS "CheckoutSession";

DROP TRIGGER IF EXISTS "RefundRecord_sync_provider_ids" ON "RefundRecord";
DROP FUNCTION IF EXISTS "fluxradar_sync_refund_record_ids"();
ALTER TABLE "RefundRecord" DROP COLUMN IF EXISTS "providerSignature";
ALTER TABLE "RefundRecord" DROP COLUMN IF EXISTS "providerEventId";
ALTER TABLE "RefundRecord" DROP COLUMN IF EXISTS "providerTransactionId";
ALTER TABLE "RefundRecord" DROP COLUMN IF EXISTS "provider";

DROP INDEX IF EXISTS "WebhookEvent_providerTransactionId_idx";
DROP INDEX IF EXISTS "WebhookEvent_provider_providerEventId_key";
DROP TRIGGER IF EXISTS "WebhookEvent_sync_provider_ids" ON "WebhookEvent";
DROP FUNCTION IF EXISTS "fluxradar_sync_webhook_event_ids"();
-- Rows written only by the FastSpring release have no legacy id; the previous
-- release cannot read them, so they are removed before the column is restored.
DELETE FROM "WebhookEvent" WHERE "paddleEventId" IS NULL;
ALTER TABLE "WebhookEvent" ALTER COLUMN "paddleEventId" SET NOT NULL;
ALTER TABLE "WebhookEvent" DROP COLUMN IF EXISTS "outcomeReason";
ALTER TABLE "WebhookEvent" DROP COLUMN IF EXISTS "outcome";
ALTER TABLE "WebhookEvent" DROP COLUMN IF EXISTS "providerTransactionId";
ALTER TABLE "WebhookEvent" DROP COLUMN IF EXISTS "providerEventId";
ALTER TABLE "WebhookEvent" DROP COLUMN IF EXISTS "provider";

DROP INDEX IF EXISTS "Purchase_provider_providerTransactionId_key";
DROP TRIGGER IF EXISTS "Purchase_sync_provider_ids" ON "Purchase";
DROP FUNCTION IF EXISTS "fluxradar_sync_purchase_ids"();
DELETE FROM "Purchase" WHERE "paddleTransactionId" IS NULL;
ALTER TABLE "Purchase" ALTER COLUMN "paddleTransactionId" SET NOT NULL;
ALTER TABLE "Purchase" DROP COLUMN IF EXISTS "settledCurrency";
ALTER TABLE "Purchase" DROP COLUMN IF EXISTS "settledAmount";
ALTER TABLE "Purchase" DROP COLUMN IF EXISTS "providerTransactionId";
ALTER TABLE "Purchase" DROP COLUMN IF EXISTS "provider";
