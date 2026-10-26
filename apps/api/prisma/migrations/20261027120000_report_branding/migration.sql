-- Additive: this new table has no rows, so no duplicates or NULL backfill need handling.
-- No orphans are possible. This is not contract-phase. Reversible with DROP TABLE "ReportBranding".
-- CreateTable
CREATE TABLE "ReportBranding" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT NOT NULL,
    "accentColor" TEXT,
    "contactLine" TEXT,
    "logoPng" BYTEA,
    "logoWidth" INTEGER,
    "logoHeight" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportBranding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportBranding_accountId_key" ON "ReportBranding"("accountId");

-- AddForeignKey
ALTER TABLE "ReportBranding" ADD CONSTRAINT "ReportBranding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

