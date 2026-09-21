-- A choice of egress locations (D-228).
--
-- Traffic was counted per month for the one proxy there was. Each location is
-- its own VPS on its own plan, so it is now counted per location and month.
-- The old table's key is the month alone and cannot hold two locations, and
-- changing a primary key is a DROP CONSTRAINT the previous release could not
-- survive a rollback onto — so the per-location count is a new table, and the
-- old one is left for that release to keep writing (see schema.prisma).
--
-- The backfill is not a guess: bytes were only ever counted when a crawl
-- actually crossed a proxy, and until now the only proxy was the Kyiv one.
-- The new table starts empty and takes one row per old row, whose key was
-- already unique, so no deduplication is needed before the new key.
CREATE TABLE "CrawlEgressLocationUsage" (
  "location"  TEXT NOT NULL,
  "month"     TEXT NOT NULL,
  "bytes"     BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CrawlEgressLocationUsage_pkey" PRIMARY KEY ("location", "month")
);

INSERT INTO "CrawlEgressLocationUsage" ("location", "month", "bytes", "updatedAt")
SELECT 'ua', "month", "bytes", "updatedAt" FROM "CrawlEgressUsage";

-- Which location a reachability probe left from. Nullable and not backfilled:
-- a row written before this column cannot say, and a NULL matches only a
-- deployment that crawls directly — anywhere else its owner runs the check
-- again, as they would after the 15-minute window anyway.
ALTER TABLE "SiteReachabilityProbe" ADD COLUMN "egressLocation" TEXT;
