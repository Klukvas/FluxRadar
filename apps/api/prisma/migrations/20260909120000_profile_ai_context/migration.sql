-- Store the owner-provided context used later to build domain-specific AI queries.
ALTER TABLE "SiteProfile" ADD COLUMN "businessDescription" TEXT;
ALTER TABLE "SiteProfile" ADD COLUMN "offerings" TEXT;
ALTER TABLE "SiteProfile" ADD COLUMN "targetLanguages" TEXT;
ALTER TABLE "SiteProfile" ADD COLUMN "targetAudience" TEXT;
