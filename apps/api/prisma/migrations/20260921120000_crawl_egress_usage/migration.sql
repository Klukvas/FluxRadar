-- Monthly traffic through the crawl's egress proxy.
--
-- Every paid crawl leaves through one VPS with a 1 TB monthly allowance, and
-- nothing counted it — the first sign of running out would have been every scan
-- failing at once, reported to us by a customer.
--
-- One row per UTC calendar month, keyed by the month itself so the upsert needs
-- no lookup and two scans finishing together increment rather than overwrite.
-- New table, therefore empty: no deduplication step is needed before the key.
CREATE TABLE "CrawlEgressUsage" (
  "month"     TEXT NOT NULL,
  "bytes"     BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CrawlEgressUsage_pkey" PRIMARY KEY ("month")
);
