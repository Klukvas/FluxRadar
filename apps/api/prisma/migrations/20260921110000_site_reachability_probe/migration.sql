-- The last answer a site gave when we asked whether it will let our crawler in.
--
-- A customer could buy a $120 audit of a site that refuses us, wait for the scan,
-- and receive a refund instead of a report. Nothing before the pay button had
-- ever tried to fetch the site. `createCheckoutSession` now requires a recent
-- row here saying 'reachable', and re-reads it server-side rather than trusting
-- the browser's claim.
--
-- One row per profile (siteProfileId UNIQUE): only the freshest answer is a
-- precondition, and a history of refusals would be a log rather than a check.
-- No backfill: an account with no row has simply not been asked yet, and the
-- scan form runs the probe before the button becomes usable.
CREATE TABLE "SiteReachabilityProbe" (
  "id"            TEXT NOT NULL,
  "accountId"     TEXT NOT NULL,
  "siteProfileId" TEXT NOT NULL,
  "state"         TEXT NOT NULL,
  "startStatus"   INTEGER,
  "fetchError"    TEXT,
  "signalsJson"   TEXT NOT NULL DEFAULT '[]',
  "checkedAt"     TIMESTAMP(3) NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SiteReachabilityProbe_pkey" PRIMARY KEY ("id")
);

-- The table is new and therefore empty, so a plain UNIQUE index cannot meet
-- existing duplicates (see the migration checklist in ~/.claude/rules).
CREATE UNIQUE INDEX "SiteReachabilityProbe_siteProfileId_key"
  ON "SiteReachabilityProbe"("siteProfileId");
CREATE INDEX "SiteReachabilityProbe_accountId_idx"
  ON "SiteReachabilityProbe"("accountId");

ALTER TABLE "SiteReachabilityProbe"
  ADD CONSTRAINT "SiteReachabilityProbe_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SiteReachabilityProbe"
  ADD CONSTRAINT "SiteReachabilityProbe_siteProfileId_fkey"
  FOREIGN KEY ("siteProfileId") REFERENCES "SiteProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
