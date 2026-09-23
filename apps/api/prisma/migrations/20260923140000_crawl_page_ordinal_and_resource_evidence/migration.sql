-- Two additions to the resume evidence, both additive and defaulted.
--
-- 1. `ScanCrawlPage.ordinal` — the position a page had in the crawl. A batched
--    insert gives every row the same `createdAt`, so ordering the restored
--    pages by it was not deterministic. The column defaults to 0, which is
--    exactly right for rows written by the previous release: they fall back to
--    the id tie-break the read path applies after the ordinal.
--
-- 2. `ScanCrawlResourceSet` — the media probes of a paused scan. Without it a
--    resume re-issued up to MEDIA_PROBE_LIMITS.maxProbes requests to the
--    owner's server for answers the interrupted attempt already had.
--
-- The previous release neither writes nor reads either of these, so a rollback
-- keeps working. No backfill exists or is wanted: evidence only exists for a
-- run interrupted after this release. The foreign keys cascade for the same
-- reason the rest of this series does — after a rollback the older code deletes
-- an account or a scan without clearing these rows, and a RESTRICT constraint
-- would turn that into a failed deletion.

ALTER TABLE "ScanCrawlPage" ADD COLUMN "ordinal" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ScanCrawlResourceSet" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    -- gzip of the ResourceSnapshot array as JSON; bounded by SCAN_EVIDENCE_LIMITS.
    "payload" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanCrawlResourceSet_pkey" PRIMARY KEY ("id")
);

-- One row per scan. The table is new, so there is nothing to deduplicate
-- before the unique index is created.
CREATE UNIQUE INDEX "ScanCrawlResourceSet_scanId_key" ON "ScanCrawlResourceSet"("scanId");

CREATE INDEX "ScanCrawlResourceSet_accountId_idx" ON "ScanCrawlResourceSet"("accountId");

-- The retention sweep walks expired evidence and nothing else.
CREATE INDEX "ScanCrawlResourceSet_expiresAt_idx" ON "ScanCrawlResourceSet"("expiresAt");

ALTER TABLE "ScanCrawlResourceSet"
  ADD CONSTRAINT "ScanCrawlResourceSet_scanId_fkey"
  FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScanCrawlResourceSet"
  ADD CONSTRAINT "ScanCrawlResourceSet_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
