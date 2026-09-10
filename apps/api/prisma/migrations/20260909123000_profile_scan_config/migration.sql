-- Keep the reusable run configuration with the profile, not only with the last scan.
ALTER TABLE "SiteProfile"
ADD COLUMN "scanConfigJson" TEXT NOT NULL DEFAULT '{"plan":"Complete","scope":{"includeSubdomains":false,"maxPages":15,"maxDepth":5,"queryPolicy":"ignore","respectRobots":true,"robotsOverrideConfirmed":false,"userAgent":"desktop"}}';
