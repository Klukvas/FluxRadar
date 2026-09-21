-- The Action Plan (D-232): an AI-written plan per scan and language, and the
-- log of attempts to write one.
--
-- Purely additive. The Scan counters default to 0 and the run columns are
-- nullable, so a row written before this migration is a scan with no plan and
-- a full budget, and the previous release keeps writing scans without knowing
-- the columns exist.
--
-- Both new tables reference Scan with ON DELETE CASCADE rather than RESTRICT:
-- after a rollback the previous release deletes scans (retention, account and
-- profile deletion) without knowing these tables, and under RESTRICT every
-- scan with a plan would stop its delete — the CheckoutSession case BILLING-007
-- describes. This release deletes both tables itself before the scan.

-- AlterTable
ALTER TABLE "Scan" ADD COLUMN     "actionPlanAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "actionPlanRunLanguage" TEXT,
ADD COLUMN     "actionPlanRunStartedAt" TIMESTAMP(3),
ADD COLUMN     "actionPlanSuccesses" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ActionPlan" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "contentJson" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "usageJson" TEXT NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionPlanAttempt" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failureCode" TEXT,
    "usageJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ActionPlanAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActionPlan_scanId_language_key" ON "ActionPlan"("scanId", "language");

-- CreateIndex
CREATE INDEX "ActionPlanAttempt_createdAt_idx" ON "ActionPlanAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "ActionPlanAttempt_scanId_idx" ON "ActionPlanAttempt"("scanId");

-- AddForeignKey
ALTER TABLE "ActionPlan" ADD CONSTRAINT "ActionPlan_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionPlanAttempt" ADD CONSTRAINT "ActionPlanAttempt_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

