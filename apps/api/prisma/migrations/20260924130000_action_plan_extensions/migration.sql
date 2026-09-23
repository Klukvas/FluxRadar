-- What this branch's Action Plan needs on top of 20260924100000_action_plan.
--
-- That migration is already applied in production, so it is left exactly as it
-- is and the difference is expressed here instead. Everything below is
-- additive: three nullable columns and one index. No column is tightened, no
-- constraint is dropped, and no row is rewritten, so the release that predates
-- this migration keeps writing both tables unchanged and a rollback needs no
-- data fix.

-- The fence that says WHICH attempt owns a scan's generation slot. The start
-- timestamp cannot do it alone: two claims in the same millisecond are
-- indistinguishable, and a superseded run finishing late would match a newer
-- claim. NULL on scans whose slot was claimed before this column existed —
-- those runs are past their five-minute staleness window and cannot finish.
ALTER TABLE "Scan" ADD COLUMN "actionPlanRunAttemptId" TEXT;

-- The Action Plan click notice the attempt accepted; the click is the consent,
-- so the attempt records which notice it was given under. NULL on rows written
-- before the column existed — "not recorded", the same reading as
-- "Scan"."crawlSummaryJson", not a claim that no notice was shown.
ALTER TABLE "ActionPlanAttempt" ADD COLUMN "noticeVersion" TEXT;

-- When a re-run superseded this attempt. A cleared row keeps counting against
-- the caps — the money was spent — but no longer describes the current report,
-- which is what keeps a stale failure off a freshly re-run scan.
ALTER TABLE "ActionPlanAttempt" ADD COLUMN "clearedAt" TIMESTAMP(3);

-- The hourly per-account cap is checked on every generation request, under the
-- spend lock. Without this index that check reads the whole spend log while
-- holding it.
CREATE INDEX "ActionPlanAttempt_accountId_createdAt_idx" ON "ActionPlanAttempt"("accountId", "createdAt");
