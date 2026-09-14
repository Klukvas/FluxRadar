-- Additive: message codes and values behind a finding's evidence and recommendation,
-- rendered per report language. NULL means the finding predates codes (or is AI text)
-- and readers see the stored evidenceExcerpt/recommendation.
ALTER TABLE "Issue" ADD COLUMN "messagesJson" TEXT;
