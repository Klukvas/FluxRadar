-- fluxradar:contract-phase — drops the retired payment provider's columns (D-231).
-- fluxradar:contract-requires 20260922100000_egress_locations
--
-- The contract half of 20260906180000_fastspring_provider_neutral_billing. Those
-- columns only ever held copies of the provider-neutral ones, written by the
-- mirroring triggers for a release that no longer exists; no code reads or
-- writes them, and the D-229 release already stopped declaring them in
-- schema.prisma, so its Prisma client does not select them.
--
-- SHIP ONLY when both rollback candidates the deploy keeps are D-229 or later:
-- the release that is live when this deploys, and the one before it. That is
-- the first release carrying D-229, then at least one ordinary release, then
-- this one. D-229 came with #20 but reached production only with fda0eaa (#21):
-- #20's own deploy stopped at the pre-migration snapshot. 84f91d9 followed it.
-- The prerequisite line above is how deploy/contract-phase-gate.sh (D-230)
-- holds that order: 20260922100000_egress_locations is the one migration the
-- D-229 release added (#20, squash-merged together with D-228), so a release
-- that ships it is D-229 or later, and the backup stage refuses this migration
-- until every rollback candidate does. A pre-D-229 release would otherwise fail
-- on the first query that selects these columns. If this deploy fails after
-- `migrate deploy`, the pruning step never runs, so the oldest release (before
-- D-229) is still on disk: never roll back to it — the gate's rollback-target
-- mode refuses it (docs/DEPLOYMENT.md, "Rolling back by hand").
--
-- There is no way back in SQL, and no down.sql on purpose. Re-running earlier
-- migrations does not rebuild this shape: the paddle* columns and their
-- indexes come from 20260904110000_init, the expand migration's ADD COLUMN
-- "provider" fails on columns that are still here, and its backfill copies
-- paddle* into the provider-neutral columns — the opposite direction. The way
-- back is the snapshot the deploy's `backup` stage takes just before this
-- migration (deploy/backup/pre-migration-snapshot.sh; docs/DEPLOYMENT.md, "The
-- snapshot before a migration" and "Restoring"). A restore returns the whole
-- database to that moment and loses everything written since, so it is
-- disaster recovery, not a rollback — and the reason this migration must not
-- ship with ALLOW_MIGRATION_WITHOUT_BACKUP=true.
--
-- Dropping loses no data: every dropped value is a copy of a column that stays.

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
