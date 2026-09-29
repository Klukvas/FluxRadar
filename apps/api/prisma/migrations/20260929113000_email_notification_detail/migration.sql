-- Delivery retries must retain the event-specific wording. Rebuilding it from
-- only the kind would turn an internal-free message into a payment confirmation.
ALTER TABLE "EmailNotification"
  ADD COLUMN "detail" TEXT NOT NULL DEFAULT '';
