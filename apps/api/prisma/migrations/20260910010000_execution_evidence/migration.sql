-- Additive execution snapshots: NULL explicitly means historical context was not captured.
ALTER TABLE "CheckoutSession" ADD COLUMN "executionConfigJson" TEXT;
ALTER TABLE "Scan" ADD COLUMN "executionConfigJson" TEXT;
-- Existing AI rows came exclusively from GEO. New writers always state the module.
ALTER TABLE "AiResponseRecord" ADD COLUMN "module" TEXT NOT NULL DEFAULT 'AI SEO / GEO';
ALTER TABLE "AiResponseRecord" ADD COLUMN "promptText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AiResponseRecord" ADD COLUMN "tokenizerVersion" TEXT;
