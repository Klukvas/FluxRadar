-- Durable, retryable delivery for purchase and refund notifications.
-- Existing markers are conservatively treated as sent, so this additive
-- migration never replays historical customer email.
ALTER TABLE "EmailNotification"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'sent',
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "leaseUntil" TIMESTAMP(3),
  ADD COLUMN "sentAt" TIMESTAMP(3),
  ADD COLUMN "lastError" TEXT;

CREATE INDEX "EmailNotification_status_nextAttemptAt_idx"
  ON "EmailNotification"("status", "nextAttemptAt");

CREATE INDEX "EmailNotification_status_leaseUntil_idx"
  ON "EmailNotification"("status", "leaseUntil");
