CREATE TABLE "FreeCheckClaim" (
    "origin" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FreeCheckClaim_pkey" PRIMARY KEY ("origin")
);

INSERT INTO "FreeCheckClaim" ("origin", "claimedAt")
SELECT "domain", MIN("createdAt")
FROM "Scan"
WHERE "plan" = 'Free'
GROUP BY "domain";
