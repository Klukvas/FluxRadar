BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Existing password accounts are preserved. Google identities start empty.
ALTER TABLE "Account" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "Account" ADD COLUMN "googleSubject" TEXT;
CREATE UNIQUE INDEX "Account_googleSubject_key" ON "Account"("googleSubject");

CREATE TABLE "GoogleLoginState" (
  "stateHash" TEXT NOT NULL,
  "bindingHash" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "codeVerifier" TEXT NOT NULL,
  "rememberMe" BOOLEAN NOT NULL DEFAULT false,
  "language" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleLoginState_pkey" PRIMARY KEY ("stateHash")
);
CREATE INDEX "GoogleLoginState_expiresAt_idx" ON "GoogleLoginState"("expiresAt");

COMMIT;
