-- Manual reversal: restores the INSERT-only (COALESCE) mirroring the previous
-- migration installed. Prisma has no down migrations, and an automatic release
-- rollback must NOT run this — the forward version is strictly safer for both
-- releases, so there is nothing to undo when a deploy is rolled back.
--
--   psql "$DATABASE_URL" -f down.sql
--   DELETE FROM "_prisma_migrations"
--     WHERE migration_name = '20260906190000_fastspring_trigger_update_sync';
--
-- Reversing this reintroduces the divergence described in migration.sql: an
-- UPDATE that writes one column of a mirrored pair stops updating the other.

CREATE OR REPLACE FUNCTION "fluxradar_sync_purchase_ids"() RETURNS trigger AS $fluxradar$
BEGIN
  NEW."providerTransactionId" := COALESCE(NEW."providerTransactionId", NEW."paddleTransactionId");
  NEW."paddleTransactionId" := COALESCE(NEW."paddleTransactionId", NEW."providerTransactionId");
  RETURN NEW;
END;
$fluxradar$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "fluxradar_sync_webhook_event_ids"() RETURNS trigger AS $fluxradar$
BEGIN
  NEW."providerEventId" := COALESCE(NEW."providerEventId", NEW."paddleEventId");
  NEW."paddleEventId" := COALESCE(NEW."paddleEventId", NEW."providerEventId");
  NEW."providerTransactionId" := COALESCE(NEW."providerTransactionId", NEW."paddleTransactionId");
  NEW."paddleTransactionId" := COALESCE(NEW."paddleTransactionId", NEW."providerTransactionId");
  RETURN NEW;
END;
$fluxradar$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "fluxradar_sync_refund_record_ids"() RETURNS trigger AS $fluxradar$
BEGIN
  NEW."providerTransactionId" := COALESCE(NEW."providerTransactionId", NEW."paddleTransactionId");
  NEW."paddleTransactionId" := COALESCE(NEW."paddleTransactionId", NEW."providerTransactionId");
  NEW."providerEventId" := COALESCE(NEW."providerEventId", NEW."paddleEventId");
  NEW."paddleEventId" := COALESCE(NEW."paddleEventId", NEW."providerEventId");
  NEW."providerSignature" := COALESCE(NEW."providerSignature", NEW."paddleSignature");
  NEW."paddleSignature" := COALESCE(NEW."paddleSignature", NEW."providerSignature");
  RETURN NEW;
END;
$fluxradar$ LANGUAGE plpgsql;
