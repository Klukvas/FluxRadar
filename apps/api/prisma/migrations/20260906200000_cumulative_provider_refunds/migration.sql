-- Cumulative partial refunds: one row per refund the provider reported.
-- EXPAND PHASE — additive only. It creates one table and backfills it; nothing
-- is renamed, dropped or narrowed, so the previous release (which does not know
-- this table exists) keeps working unchanged if the deploy is rolled back.
--
-- The bug this fixes: RefundRecord is the aggregate and §18 admits exactly one
-- per purchase, so the FastSpring return handler had nowhere to put the second
-- partial return and overwrote the first. Two $27.50 returns against a $55 order
-- therefore each measured as 50% of the charge, neither reached the full-refund
-- ratio, and the buyer kept a report whose money had gone back in full.
--
-- The FK is ON DELETE CASCADE for the same reason CheckoutSession's is: after a
-- rollback the previous release deletes purchases without clearing a table it
-- has never heard of, and the RESTRICT default would make a GDPR account
-- deletion fail with a foreign-key error instead.

CREATE TABLE "ProviderRefund" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRefundId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "amountCharged" DOUBLE PRECISION NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "currency" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderRefund_pkey" PRIMARY KEY ("id")
);

-- The refund is counted once per purchase, whatever redelivers it.
CREATE UNIQUE INDEX "ProviderRefund_purchaseId_providerRefundId_key"
  ON "ProviderRefund"("purchaseId", "providerRefundId");

ALTER TABLE "ProviderRefund"
  ADD CONSTRAINT "ProviderRefund_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: a production database already holds refunds this table did not exist
-- for, and a new partial return must add to them rather than start from zero. The
-- rows that describe money actually returned by FastSpring are exactly the ones
-- the return handler wrote: provider 'fastspring' with status 'paid'. An internal
-- refund REQUEST (status 'requested') is deliberately not backfilled — no money
-- has moved yet, and the return.created that does move it will add its own line.
--
-- The charged-basis figure is reconstructed the same way the handler computes it:
-- through the order's own USD/settled ratio when the buyer was charged in another
-- currency, and as the USD figure itself otherwise.
INSERT INTO "ProviderRefund" (
    "id", "purchaseId", "provider", "providerRefundId", "eventType",
    "amountCharged", "amountUsd", "currency", "reason", "createdAt"
)
SELECT
    'backfill_' || r."id",
    r."purchaseId",
    r."provider",
    COALESCE(r."providerEventId", r."refundRequestId", 'refund-record:' || r."id"),
    'return.created',
    CASE
      WHEN p."settledAmount" IS NOT NULL AND p."amountUsd" > 0
        THEN ROUND((r."amountUsd" * p."settledAmount" / p."amountUsd")::numeric, 2)::double precision
      ELSE r."amountUsd"
    END,
    r."amountUsd",
    COALESCE(p."settledCurrency", p."currency", 'USD'),
    'backfilled from RefundRecord ' || r."id"
      || ' by migration 20260906200000_cumulative_provider_refunds',
    COALESCE(r."processedAt", r."requestedAt", CURRENT_TIMESTAMP)
FROM "RefundRecord" r
JOIN "Purchase" p ON p."id" = r."purchaseId"
WHERE r."provider" = 'fastspring'
  AND r."status" = 'paid'
ON CONFLICT DO NOTHING;
