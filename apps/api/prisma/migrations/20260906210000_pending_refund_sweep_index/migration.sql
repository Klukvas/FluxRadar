-- Access path for the pending-refund sweep.
-- EXPAND PHASE — additive only. It creates one index; nothing is renamed, dropped
-- or narrowed, so the previous release (which does not know the index exists)
-- keeps working unchanged if the deploy is rolled back.
--
-- The sweep runs every five minutes and asks for the `unlinked` webhook events of
-- one provider, oldest first, whose order already has a Purchase. WebhookEvent
-- keeps every delivery bound to a live purchase, so it grows with sales volume
-- while the handful of pending rows the sweep is looking for does not: without a
-- leading (provider, outcome) index that question is a sequential scan of the
-- whole table, twelve times an hour. With it, Postgres walks only the pending
-- rows, in the `processedAt` order the sweep asks for, and stops at the batch
-- limit.
--
-- Plain CREATE INDEX, not CONCURRENTLY: Prisma runs each migration inside a
-- transaction, where CONCURRENTLY is not allowed. The lock is acceptable because
-- WebhookEvent is written once per webhook delivery — build time is measured in
-- milliseconds at this table's size. Should that stop being true, the index has
-- to be created out of band before the deploy, and this statement then finds it
-- already there.

CREATE INDEX IF NOT EXISTS "WebhookEvent_provider_outcome_processedAt_idx"
  ON "WebhookEvent"("provider", "outcome", "processedAt");
