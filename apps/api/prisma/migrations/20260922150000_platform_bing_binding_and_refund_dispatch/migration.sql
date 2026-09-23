-- Platform lane, additive only. Two new tables and nothing else: no column is
-- dropped, renamed or made stricter, so the release that precedes this one keeps
-- running against the migrated database and a rollback needs no data fix.
--
-- Both tables are empty on creation and both are unique-keyed on a column that
-- can only hold one row per site profile / per purchase, so there is nothing to
-- deduplicate first (see ~/.claude/rules/common/patterns.md, migration safety).

-- Which Bing Webmaster site feeds one site profile's report.
CREATE TABLE "SiteBingBinding" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "siteProfileId" TEXT NOT NULL,
    "siteUrl" TEXT,
    "verifiedAtSelection" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteBingBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteBingBinding_siteProfileId_key" ON "SiteBingBinding"("siteProfileId");
CREATE INDEX "SiteBingBinding_accountId_idx" ON "SiteBingBinding"("accountId");

-- CASCADE on both parents. This row points at a provider resource; it is not a
-- record anyone is owed, and it must never be able to refuse the deletion of the
-- account or the site profile it belongs to (an optional integration blocking a
-- GDPR erasure). The application deletes it explicitly as well —
-- src/data-retention.ts and src/profiles/profile-deletion.ts — so the cascade is
-- the backstop, not the plan.
ALTER TABLE "SiteBingBinding"
    ADD CONSTRAINT "SiteBingBinding_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SiteBingBinding"
    ADD CONSTRAINT "SiteBingBinding_siteProfileId_fkey"
    FOREIGN KEY ("siteProfileId") REFERENCES "SiteProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The outbound refund submission and everything known about its answer.
CREATE TABLE "RefundDispatch" (
    "id" TEXT NOT NULL,
    "refundRecordId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "stateReason" TEXT,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "providerRefundId" TEXT,
    "providerReasonCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundDispatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefundDispatch_refundRecordId_key" ON "RefundDispatch"("refundRecordId");
CREATE UNIQUE INDEX "RefundDispatch_purchaseId_key" ON "RefundDispatch"("purchaseId");
CREATE UNIQUE INDEX "RefundDispatch_idempotencyKey_key" ON "RefundDispatch"("idempotencyKey");
CREATE INDEX "RefundDispatch_state_requestedAt_idx" ON "RefundDispatch"("state", "requestedAt");

-- CASCADE: a RefundRecord removed by account deletion takes its submission
-- record with it, exactly as ProviderRefund follows its Purchase.
ALTER TABLE "RefundDispatch"
    ADD CONSTRAINT "RefundDispatch_refundRecordId_fkey"
    FOREIGN KEY ("refundRecordId") REFERENCES "RefundRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
