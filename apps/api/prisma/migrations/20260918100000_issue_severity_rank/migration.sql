-- Additive: a numeric urgency order next to the text severity.
--
-- "severity" is text, and ORDER BY on text is alphabetical — Critical, High,
-- Low, Medium — so the Issue Center listed Low findings above Medium ones.
-- Readers sort by this column instead; the worker writes it with every finding
-- (@fluxradar/contracts severityRank), and existing rows are backfilled here.
-- 4 is "not a known severity", after Low.
ALTER TABLE "Issue" ADD COLUMN "severityRank" INTEGER NOT NULL DEFAULT 4;

UPDATE "Issue"
SET "severityRank" = CASE "severity"
  WHEN 'Critical' THEN 0
  WHEN 'High' THEN 1
  WHEN 'Medium' THEN 2
  WHEN 'Low' THEN 3
  ELSE 4
END;

CREATE INDEX "Issue_scanId_severityRank_fingerprint_idx"
  ON "Issue"("scanId", "severityRank", "fingerprint");
