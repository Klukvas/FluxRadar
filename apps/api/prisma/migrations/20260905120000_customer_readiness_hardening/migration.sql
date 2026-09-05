-- Older releases inserted this content-free fact with create(). Keep the
-- newest fact for each account before enforcing idempotency at the DB level.
WITH ranked AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "accountIdHash"
            ORDER BY "completedAt" DESC NULLS LAST, "requestedAt" DESC, "id" DESC
        ) AS rn
    FROM "AccountDeletionAudit"
)
DELETE FROM "AccountDeletionAudit" AS audit
USING ranked
WHERE audit."id" = ranked."id"
  AND ranked.rn > 1;

CREATE UNIQUE INDEX "AccountDeletionAudit_accountIdHash_key"
  ON "AccountDeletionAudit"("accountIdHash");
