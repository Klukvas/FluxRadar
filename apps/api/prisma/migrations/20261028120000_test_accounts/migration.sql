-- Additive: the default keeps every existing row counted exactly as before.
-- Reversible with ALTER TABLE "Account" DROP COLUMN "isTestAccount".
ALTER TABLE "Account" ADD COLUMN "isTestAccount" BOOLEAN NOT NULL DEFAULT false;
