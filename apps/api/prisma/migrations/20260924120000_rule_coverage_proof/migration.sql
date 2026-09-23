-- Additive: the repeat-check proof gets its own table.
--
-- It used to live in "ScanModule"."metadataJson", which every scan read loads
-- (/scans, /scans/active, the dashboard, the status poll) only to throw the
-- block away again in JS. That forced a 2 000-target ceiling on the proof, and
-- above it nothing could ever be reported Resolved — on the plans that sell
-- 5 000 and 50 000 URLs. The proof is read by one caller (the Resolved policy
-- of the next Complete scan), so it is stored where only that caller pays for
-- it, gzipped.
--
-- Nothing is migrated: the previous block is an internal artefact of an
-- unreleased policy, and a scan without a row here simply proves nothing and
-- leaves its findings open — the conservative side.
CREATE TABLE "RuleCoverageProof" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "proof" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleCoverageProof_pkey" PRIMARY KEY ("id")
);

-- One row per module of a scan: the module's own write replaces it (upsert),
-- and this is also the lookup the policy reads the scan by.
CREATE UNIQUE INDEX "RuleCoverageProof_scanId_module_key" ON "RuleCoverageProof"("scanId", "module");

ALTER TABLE "RuleCoverageProof" ADD CONSTRAINT "RuleCoverageProof_scanId_fkey"
  FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
