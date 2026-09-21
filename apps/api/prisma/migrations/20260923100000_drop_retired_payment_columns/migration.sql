-- fluxradar:contract-phase — drops the retired payment provider's columns (D-229).
--
-- The contract half of 20260906180000_fastspring_provider_neutral_billing. Those
-- columns only ever held copies of the provider-neutral ones, written by the
-- mirroring triggers for a release that no longer exists; no code reads or
-- writes them, and the release before this one already stopped declaring them
-- in schema.prisma, so the rollback probe's Prisma client does not select them.
--
-- SHIP ONLY once every retained rollback candidate is the D-229 release or
-- later. The probe checks the previous release; the workflow keeps two, and a
-- manual rollback to one that still selects these columns would fail.
--
-- Not reversible by design: nothing is lost (every value is a copy of a column
-- that stays), and restoring the old shape means re-running the expand
-- migration's SQL by hand, never an automatic rollback.

DROP TRIGGER "Purchase_sync_provider_ids" ON "Purchase";
DROP TRIGGER "WebhookEvent_sync_provider_ids" ON "WebhookEvent";
DROP TRIGGER "RefundRecord_sync_provider_ids" ON "RefundRecord";
DROP FUNCTION "fluxradar_sync_purchase_ids"();
DROP FUNCTION "fluxradar_sync_webhook_event_ids"();
DROP FUNCTION "fluxradar_sync_refund_record_ids"();

DROP INDEX "Purchase_paddleTransactionId_key";
DROP INDEX "WebhookEvent_paddleEventId_key";
DROP INDEX "WebhookEvent_paddleTransactionId_idx";

ALTER TABLE "Purchase" DROP COLUMN "paddleTransactionId";
ALTER TABLE "WebhookEvent" DROP COLUMN "paddleEventId", DROP COLUMN "paddleTransactionId";
ALTER TABLE "RefundRecord"
  DROP COLUMN "paddleTransactionId", DROP COLUMN "paddleEventId", DROP COLUMN "paddleSignature";

-- The provider is always written explicitly; a default naming a retired
-- provider could only ever mislabel a row that forgot to set it.
ALTER TABLE "Purchase" ALTER COLUMN "provider" DROP DEFAULT;
ALTER TABLE "WebhookEvent" ALTER COLUMN "provider" DROP DEFAULT;
ALTER TABLE "RefundRecord" ALTER COLUMN "provider" DROP DEFAULT;
