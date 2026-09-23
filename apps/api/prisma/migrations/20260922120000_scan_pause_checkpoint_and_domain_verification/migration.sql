-- Pause/resume, scanned-URL progress and optional domain ownership proof.
--
-- Every change is additive and defaulted, so the previous release keeps running
-- against this schema: it does not write the new columns, it never pauses a
-- scan, and it does not know the two new tables. Both new tables cascade from
-- Account/Scan/SiteProfile for the same reason CheckoutSession does — after a
-- rollback the older code deletes an account without clearing them first, and a
-- RESTRICT foreign key would make that deletion fail.

-- Scan: the pause request, and how much of the site a run has actually read.
ALTER TABLE "Scan" ADD COLUMN "pauseRequestedAt" TIMESTAMP(3);
ALTER TABLE "Scan" ADD COLUMN "scannedUrlCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Scan" ADD COLUMN "discoveredUrlCount" INTEGER NOT NULL DEFAULT 0;

-- Where a paused run got to. Bounded by application limits
-- (SCAN_CHECKPOINT_LIMITS): a frontier of URLs and the stages already finished,
-- never page bodies.
CREATE TABLE "ScanCheckpoint" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "stage" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanCheckpoint_pkey" PRIMARY KEY ("id")
);

-- One checkpoint per scan: resuming has to be unambiguous.
CREATE UNIQUE INDEX "ScanCheckpoint_scanId_key" ON "ScanCheckpoint"("scanId");

CREATE INDEX "ScanCheckpoint_accountId_idx" ON "ScanCheckpoint"("accountId");

-- The retention sweep walks expired checkpoints and nothing else.
CREATE INDEX "ScanCheckpoint_expiresAt_idx" ON "ScanCheckpoint"("expiresAt");

ALTER TABLE "ScanCheckpoint"
  ADD CONSTRAINT "ScanCheckpoint_scanId_fkey"
  FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScanCheckpoint"
  ADD CONSTRAINT "ScanCheckpoint_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Optional proof that an account controls the site in one of its profiles.
-- Nothing in the audit pipeline reads it; it gates no scan and no tariff.
CREATE TABLE "DomainVerification" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "siteProfileId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainVerification_pkey" PRIMARY KEY ("id")
);

-- One proof per site profile: the profile is how an account names a domain.
CREATE UNIQUE INDEX "DomainVerification_siteProfileId_key"
  ON "DomainVerification"("siteProfileId");

CREATE INDEX "DomainVerification_accountId_idx" ON "DomainVerification"("accountId");

ALTER TABLE "DomainVerification"
  ADD CONSTRAINT "DomainVerification_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DomainVerification"
  ADD CONSTRAINT "DomainVerification_siteProfileId_fkey"
  FOREIGN KEY ("siteProfileId") REFERENCES "SiteProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
