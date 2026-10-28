-- Additive: three nullable columns on CheckoutSession. No rows to backfill —
-- existing sessions simply stay unmatched by any idempotency key, and clients
-- that send none behave exactly as before. The unique index lets a repeated
-- POST /billing/checkout-session find its own row and replay the stored
-- checkout URL instead of opening a second payable session. Uniqueness is per
-- account: lookups are always account-scoped, the pair is what a concurrent
-- same-draft retry collides on (handled as P2002 → replay in the route), and a
-- key another account already holds is refused before a create.
ALTER TABLE "CheckoutSession" ADD COLUMN "clientKey" TEXT;
ALTER TABLE "CheckoutSession" ADD COLUMN "requestHash" TEXT;
ALTER TABLE "CheckoutSession" ADD COLUMN "checkoutUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutSession_accountId_clientKey_key" ON "CheckoutSession"("accountId", "clientKey");
