-- FastSpring billing: provider-neutral identifiers + server-side checkout binding.
-- EXPAND PHASE — additive only. Nothing here renames, drops or narrows anything
-- that the previous release reads or writes.
--
-- Why it has to be additive: the deploy workflow runs `prisma migrate deploy`
-- BEFORE the new containers take traffic, and its rollback path puts the PREVIOUS
-- image back whenever readiness, Caddy or the smoke test fails. That image still
-- selects "paddleTransactionId" / "paddleEventId" / "paddleSignature", so a rename
-- would turn an automatic rollback into a silent production outage.
--
-- What this migration does instead:
--   1. adds provider-neutral columns beside the paddle* ones,
--   2. adds a `provider` discriminator, backfilled (and defaulted) to 'paddle' so
--      a legacy MockPaddle id can never be confused with a FastSpring id,
--   3. backfills the new columns from the legacy ones,
--   4. keeps every legacy column, constraint and index in place,
--   5. installs BEFORE INSERT/UPDATE triggers that mirror each id pair in BOTH
--      directions, so a row written by either release is readable by both.
--
-- The CONTRACT phase (dropping the paddle* columns, their indexes and these
-- triggers) ships as its own migration in a LATER release, once no container of
-- the previous release can be brought back. The exact statements are kept in
-- docs/DEPLOYMENT.md; `down.sql` next to this file reverses the expand phase.

-- ── Purchase ────────────────────────────────────────────────────────────────
ALTER TABLE "Purchase" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'paddle';
ALTER TABLE "Purchase" ADD COLUMN "providerTransactionId" TEXT;
-- What the buyer was actually charged, when FastSpring localised the currency.
-- amountUsd/currency stay the USD-normalised figures the refund policy works in.
ALTER TABLE "Purchase" ADD COLUMN "settledAmount" DOUBLE PRECISION;
ALTER TABLE "Purchase" ADD COLUMN "settledCurrency" TEXT;

UPDATE "Purchase"
  SET "providerTransactionId" = "paddleTransactionId"
  WHERE "providerTransactionId" IS NULL;

CREATE OR REPLACE FUNCTION "fluxradar_sync_purchase_ids"() RETURNS trigger AS $fluxradar$
BEGIN
  NEW."providerTransactionId" := COALESCE(NEW."providerTransactionId", NEW."paddleTransactionId");
  NEW."paddleTransactionId" := COALESCE(NEW."paddleTransactionId", NEW."providerTransactionId");
  RETURN NEW;
END;
$fluxradar$ LANGUAGE plpgsql;

CREATE TRIGGER "Purchase_sync_provider_ids"
  BEFORE INSERT OR UPDATE ON "Purchase"
  FOR EACH ROW EXECUTE FUNCTION "fluxradar_sync_purchase_ids"();

-- Safe only because the trigger above fills whichever side the writer omitted.
ALTER TABLE "Purchase" ALTER COLUMN "providerTransactionId" SET NOT NULL;
ALTER TABLE "Purchase" ALTER COLUMN "paddleTransactionId" DROP NOT NULL;

-- "Purchase_paddleTransactionId_key" is deliberately kept: the previous release
-- relies on it for its own idempotency. The pair below is the new key. While both
-- exist, a FastSpring order id that happened to equal a legacy MockPaddle
-- transaction id would lose the legacy index instead of the new one — a duplicate
-- either way, which the handlers treat identically (see billing/prisma-errors.ts).
CREATE UNIQUE INDEX "Purchase_provider_providerTransactionId_key"
  ON "Purchase"("provider", "providerTransactionId");

-- ── WebhookEvent ────────────────────────────────────────────────────────────
ALTER TABLE "WebhookEvent" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'paddle';
ALTER TABLE "WebhookEvent" ADD COLUMN "providerEventId" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN "providerTransactionId" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN "outcome" TEXT NOT NULL DEFAULT 'processed';
ALTER TABLE "WebhookEvent" ADD COLUMN "outcomeReason" TEXT;

UPDATE "WebhookEvent"
  SET "providerEventId" = COALESCE("providerEventId", "paddleEventId"),
      "providerTransactionId" = COALESCE("providerTransactionId", "paddleTransactionId");

CREATE OR REPLACE FUNCTION "fluxradar_sync_webhook_event_ids"() RETURNS trigger AS $fluxradar$
BEGIN
  NEW."providerEventId" := COALESCE(NEW."providerEventId", NEW."paddleEventId");
  NEW."paddleEventId" := COALESCE(NEW."paddleEventId", NEW."providerEventId");
  NEW."providerTransactionId" := COALESCE(NEW."providerTransactionId", NEW."paddleTransactionId");
  NEW."paddleTransactionId" := COALESCE(NEW."paddleTransactionId", NEW."providerTransactionId");
  RETURN NEW;
END;
$fluxradar$ LANGUAGE plpgsql;

CREATE TRIGGER "WebhookEvent_sync_provider_ids"
  BEFORE INSERT OR UPDATE ON "WebhookEvent"
  FOR EACH ROW EXECUTE FUNCTION "fluxradar_sync_webhook_event_ids"();

ALTER TABLE "WebhookEvent" ALTER COLUMN "providerEventId" SET NOT NULL;
ALTER TABLE "WebhookEvent" ALTER COLUMN "paddleEventId" DROP NOT NULL;

CREATE UNIQUE INDEX "WebhookEvent_provider_providerEventId_key"
  ON "WebhookEvent"("provider", "providerEventId");
CREATE INDEX "WebhookEvent_providerTransactionId_idx"
  ON "WebhookEvent"("providerTransactionId");

-- ── RefundRecord ────────────────────────────────────────────────────────────
ALTER TABLE "RefundRecord" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'paddle';
ALTER TABLE "RefundRecord" ADD COLUMN "providerTransactionId" TEXT;
ALTER TABLE "RefundRecord" ADD COLUMN "providerEventId" TEXT;
ALTER TABLE "RefundRecord" ADD COLUMN "providerSignature" TEXT;

UPDATE "RefundRecord"
  SET "providerTransactionId" = COALESCE("providerTransactionId", "paddleTransactionId"),
      "providerEventId" = COALESCE("providerEventId", "paddleEventId"),
      "providerSignature" = COALESCE("providerSignature", "paddleSignature");

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

CREATE TRIGGER "RefundRecord_sync_provider_ids"
  BEFORE INSERT OR UPDATE ON "RefundRecord"
  FOR EACH ROW EXECUTE FUNCTION "fluxradar_sync_refund_record_ids"();

-- ── CheckoutSession ─────────────────────────────────────────────────────────
-- New table: invisible to the previous release, so purely additive.
CREATE TABLE "CheckoutSession" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "siteProfileId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "productPath" TEXT NOT NULL,
    "expectedAmountUsd" DOUBLE PRECISION NOT NULL,
    "quotedAmount" DOUBLE PRECISION,
    "quotedCurrency" TEXT,
    "liveMode" BOOLEAN NOT NULL,
    "providerSessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "statusReason" TEXT,
    "settledAmount" DOUBLE PRECISION,
    "settledCurrency" TEXT,
    "scopeJson" TEXT NOT NULL,
    "aiConsentJson" TEXT,
    "purchaseId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckoutSession_reference_key" ON "CheckoutSession"("reference");
CREATE UNIQUE INDEX "CheckoutSession_purchaseId_key" ON "CheckoutSession"("purchaseId");
CREATE INDEX "CheckoutSession_accountId_createdAt_idx" ON "CheckoutSession"("accountId", "createdAt");
CREATE INDEX "CheckoutSession_provider_providerSessionId_idx" ON "CheckoutSession"("provider", "providerSessionId");

-- ON DELETE CASCADE, not Prisma's RESTRICT default, and that is a rollback
-- requirement rather than a preference. The previous release does not know this
-- table, so its GDPR account deletion deletes SiteProfile and Account without
-- clearing checkout sessions first. Under RESTRICT that deletion fails with a
-- foreign-key error after a rollback, leaving an account that asked to be erased
-- undeletable. CASCADE keeps the old deletion order working unchanged, and the
-- current release still deletes the sessions explicitly (see data-retention.ts).
-- Reachable only via those parents: a checkout session is meaningless without the
-- account and profile it was opened for, and the purchase it produced survives it.
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_siteProfileId_fkey"
  FOREIGN KEY ("siteProfileId") REFERENCES "SiteProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- The purchase outlives the session it came from: SET NULL keeps the paid record
-- and its scan intact when a purchase row is removed.
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
