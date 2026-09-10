-- Keep the saved configuration revision attached to the profile and every run
-- that used it, including checkouts that may complete asynchronously.
ALTER TABLE "SiteProfile"
ADD COLUMN "scanConfigVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "CheckoutSession"
ADD COLUMN "profileConfigVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Scan"
ADD COLUMN "profileConfigVersion" INTEGER NOT NULL DEFAULT 1;
