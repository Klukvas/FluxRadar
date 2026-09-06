-- Expand-phase follow-up: keep the mirrored id columns equal on UPDATE too.
-- Additive only — it replaces three trigger function bodies and creates,
-- renames and drops nothing.
--
-- The bug this fixes: the functions installed by
-- 20260906180000_fastspring_provider_neutral_billing fill each column pair with
-- COALESCE, which is exactly right on INSERT and wrong on UPDATE. On an UPDATE
-- both columns already hold a value, so COALESCE keeps whichever was there and
-- the write to one side is not mirrored to the other:
--
--   UPDATE "WebhookEvent" SET "paddleTransactionId" = 'new'   -- previous release
--   -> "providerTransactionId" still reads 'old'
--
--   prisma.refundRecord.update({ providerTransactionId: 'new' })  -- this release
--   -> "paddleTransactionId" still reads 'old'
--
-- The two column families then disagree about the same row, which is precisely
-- what the expand phase exists to prevent: after a rollback the previous release
-- reads its own stale column and matches a refund, a purchase or a dedup record
-- to the wrong id.
--
-- The rule below is "whichever side this statement changed wins, and the
-- provider-neutral column wins a tie", so a row written by either release stays
-- readable by both. INSERT keeps the COALESCE behaviour unchanged.

CREATE OR REPLACE FUNCTION "fluxradar_sync_purchase_ids"() RETURNS trigger AS $fluxradar$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."providerTransactionId" IS DISTINCT FROM OLD."providerTransactionId" THEN
      NEW."paddleTransactionId" := NEW."providerTransactionId";
    ELSIF NEW."paddleTransactionId" IS DISTINCT FROM OLD."paddleTransactionId" THEN
      NEW."providerTransactionId" := NEW."paddleTransactionId";
    END IF;
  END IF;
  NEW."providerTransactionId" := COALESCE(NEW."providerTransactionId", NEW."paddleTransactionId");
  NEW."paddleTransactionId" := COALESCE(NEW."paddleTransactionId", NEW."providerTransactionId");
  RETURN NEW;
END;
$fluxradar$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "fluxradar_sync_webhook_event_ids"() RETURNS trigger AS $fluxradar$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."providerEventId" IS DISTINCT FROM OLD."providerEventId" THEN
      NEW."paddleEventId" := NEW."providerEventId";
    ELSIF NEW."paddleEventId" IS DISTINCT FROM OLD."paddleEventId" THEN
      NEW."providerEventId" := NEW."paddleEventId";
    END IF;
    IF NEW."providerTransactionId" IS DISTINCT FROM OLD."providerTransactionId" THEN
      NEW."paddleTransactionId" := NEW."providerTransactionId";
    ELSIF NEW."paddleTransactionId" IS DISTINCT FROM OLD."paddleTransactionId" THEN
      NEW."providerTransactionId" := NEW."paddleTransactionId";
    END IF;
  END IF;
  NEW."providerEventId" := COALESCE(NEW."providerEventId", NEW."paddleEventId");
  NEW."paddleEventId" := COALESCE(NEW."paddleEventId", NEW."providerEventId");
  NEW."providerTransactionId" := COALESCE(NEW."providerTransactionId", NEW."paddleTransactionId");
  NEW."paddleTransactionId" := COALESCE(NEW."paddleTransactionId", NEW."providerTransactionId");
  RETURN NEW;
END;
$fluxradar$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "fluxradar_sync_refund_record_ids"() RETURNS trigger AS $fluxradar$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."providerTransactionId" IS DISTINCT FROM OLD."providerTransactionId" THEN
      NEW."paddleTransactionId" := NEW."providerTransactionId";
    ELSIF NEW."paddleTransactionId" IS DISTINCT FROM OLD."paddleTransactionId" THEN
      NEW."providerTransactionId" := NEW."paddleTransactionId";
    END IF;
    IF NEW."providerEventId" IS DISTINCT FROM OLD."providerEventId" THEN
      NEW."paddleEventId" := NEW."providerEventId";
    ELSIF NEW."paddleEventId" IS DISTINCT FROM OLD."paddleEventId" THEN
      NEW."providerEventId" := NEW."paddleEventId";
    END IF;
    IF NEW."providerSignature" IS DISTINCT FROM OLD."providerSignature" THEN
      NEW."paddleSignature" := NEW."providerSignature";
    ELSIF NEW."paddleSignature" IS DISTINCT FROM OLD."paddleSignature" THEN
      NEW."providerSignature" := NEW."paddleSignature";
    END IF;
  END IF;
  NEW."providerTransactionId" := COALESCE(NEW."providerTransactionId", NEW."paddleTransactionId");
  NEW."paddleTransactionId" := COALESCE(NEW."paddleTransactionId", NEW."providerTransactionId");
  NEW."providerEventId" := COALESCE(NEW."providerEventId", NEW."paddleEventId");
  NEW."paddleEventId" := COALESCE(NEW."paddleEventId", NEW."providerEventId");
  NEW."providerSignature" := COALESCE(NEW."providerSignature", NEW."paddleSignature");
  NEW."paddleSignature" := COALESCE(NEW."paddleSignature", NEW."providerSignature");
  RETURN NEW;
END;
$fluxradar$ LANGUAGE plpgsql;
