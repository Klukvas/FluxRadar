-- Links a site profile to the Google properties its owner selected. Additive:
-- existing accounts, profiles and scans keep working with no binding row, which
-- the Analytics module reports as "no property selected".
CREATE TABLE "SiteGoogleBinding" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "siteProfileId" TEXT NOT NULL,
    "searchConsoleSiteUrl" TEXT,
    "ga4PropertyId" TEXT,
    "ga4PropertyName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteGoogleBinding_pkey" PRIMARY KEY ("id")
);

-- One binding per site profile: a report must have exactly one Google source.
CREATE UNIQUE INDEX "SiteGoogleBinding_siteProfileId_key"
  ON "SiteGoogleBinding"("siteProfileId");

CREATE INDEX "SiteGoogleBinding_accountId_idx" ON "SiteGoogleBinding"("accountId");

ALTER TABLE "SiteGoogleBinding"
  ADD CONSTRAINT "SiteGoogleBinding_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SiteGoogleBinding"
  ADD CONSTRAINT "SiteGoogleBinding_siteProfileId_fkey"
  FOREIGN KEY ("siteProfileId") REFERENCES "SiteProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
