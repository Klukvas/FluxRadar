-- The pages a paused scan already read, so resuming continues instead of
-- starting over.
--
-- Additive and self-contained: the previous release does not write this table
-- and does not read it. The two foreign keys cascade for the same reason every
-- other table added in this series does — after a rollback the older code
-- deletes an account or a scan without clearing these rows first, and a
-- RESTRICT constraint would turn that into a failed deletion.
--
-- No backfill is possible or wanted: evidence only exists for a run that was
-- paused after this release, and a scan paused before it simply re-crawls.

CREATE TABLE "ScanCrawlPage" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    -- gzip of the page snapshot as JSON; bounded by SCAN_EVIDENCE_LIMITS.
    "payload" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanCrawlPage_pkey" PRIMARY KEY ("id")
);

-- One row per URL per scan. The table is new, so there is nothing to
-- deduplicate before the unique index is created.
CREATE UNIQUE INDEX "ScanCrawlPage_scanId_normalizedUrl_key"
  ON "ScanCrawlPage"("scanId", "normalizedUrl");

CREATE INDEX "ScanCrawlPage_accountId_idx" ON "ScanCrawlPage"("accountId");

-- The retention sweep walks expired evidence and nothing else.
CREATE INDEX "ScanCrawlPage_expiresAt_idx" ON "ScanCrawlPage"("expiresAt");

ALTER TABLE "ScanCrawlPage"
  ADD CONSTRAINT "ScanCrawlPage_scanId_fkey"
  FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScanCrawlPage"
  ADD CONSTRAINT "ScanCrawlPage_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
