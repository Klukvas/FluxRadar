-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "freeCheckUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountDeletionAudit" (
    "id" TEXT NOT NULL,
    "accountIdHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AccountDeletionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletedScan" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "accountIdHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletedScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteProfile" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "industry" TEXT,
    "region" TEXT,
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "siteProfileId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "paddleTransactionId" TEXT NOT NULL,
    "priceId" TEXT,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entitlement" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "suspended" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT,
    "accountId" TEXT NOT NULL,
    "siteProfileId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "statusReason" TEXT,
    "scopeJson" TEXT NOT NULL,
    "rulesetVersion" TEXT NOT NULL,
    "platformRetryCount" INTEGER NOT NULL DEFAULT 0,
    "moduleRetryCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanModule" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "runtimeStatus" TEXT NOT NULL,
    "exportStatus" TEXT,
    "statusReason" TEXT,
    "coverage" DOUBLE PRECISION,
    "score" DOUBLE PRECISION,
    "applicableChecks" INTEGER,
    "completedApplicableChecks" INTEGER,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "usableOutput" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ScanModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "normalizedResource" TEXT NOT NULL,
    "normalizedSelector" TEXT NOT NULL,
    "normalizedParameter" TEXT NOT NULL,
    "ruleVariant" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "evidenceRef" TEXT,
    "evidenceExcerpt" TEXT,
    "evidenceGroupId" TEXT,
    "recommendation" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "applicableTargets" INTEGER NOT NULL,
    "affectedTargets" INTEGER NOT NULL,
    "rulePenalty" DOUBLE PRECISION NOT NULL,
    "scoreDelta" DOUBLE PRECISION NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiResponseRecord" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "apiVersion" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestIdSource" TEXT NOT NULL,
    "aiRequestKey" TEXT NOT NULL,
    "usageJson" TEXT NOT NULL,
    "usageSource" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "citationsJson" TEXT NOT NULL,
    "finishReason" TEXT NOT NULL,
    "deletionEvidenceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiResponseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConsent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "providersJson" TEXT NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopesJson" TEXT NOT NULL DEFAULT '[]',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationOAuthState" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportArtifact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "paddleEventId" TEXT NOT NULL,
    "accountId" TEXT,
    "paddleTransactionId" TEXT,
    "eventType" TEXT NOT NULL,
    "rawBody" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRecord" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "currency" TEXT,
    "taxAmountUsd" DOUBLE PRECISION,
    "paddleTransactionId" TEXT,
    "paddleEventId" TEXT,
    "paddleSignature" TEXT,
    "priceId" TEXT,
    "refundRequestId" TEXT,
    "refundReasonCode" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "RefundRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DeletedScan_scanId_key" ON "DeletedScan"("scanId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "SiteProfile_accountId_domain_key" ON "SiteProfile"("accountId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_paddleTransactionId_key" ON "Purchase"("paddleTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_purchaseId_key" ON "Entitlement"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "Scan_purchaseId_key" ON "Scan"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "ScanModule_scanId_module_key" ON "ScanModule"("scanId", "module");

-- CreateIndex
CREATE INDEX "Issue_scanId_fingerprint_idx" ON "Issue"("scanId", "fingerprint");

-- CreateIndex
CREATE INDEX "Issue_fingerprint_idx" ON "Issue"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "AiResponseRecord_aiRequestKey_key" ON "AiResponseRecord"("aiRequestKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiConsent_scanId_key" ON "AiConsent"("scanId");

-- CreateIndex
CREATE INDEX "IntegrationConnection_accountId_status_idx" ON "IntegrationConnection"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_accountId_provider_key" ON "IntegrationConnection"("accountId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationOAuthState_stateHash_key" ON "IntegrationOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "IntegrationOAuthState_accountId_provider_idx" ON "IntegrationOAuthState"("accountId", "provider");

-- CreateIndex
CREATE INDEX "IntegrationOAuthState_expiresAt_idx" ON "IntegrationOAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "ExportArtifact_accountId_createdAt_idx" ON "ExportArtifact"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExportArtifact_scanId_format_key" ON "ExportArtifact"("scanId", "format");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_paddleEventId_key" ON "WebhookEvent"("paddleEventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_accountId_idx" ON "WebhookEvent"("accountId");

-- CreateIndex
CREATE INDEX "WebhookEvent_paddleTransactionId_idx" ON "WebhookEvent"("paddleTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRecord_purchaseId_key" ON "RefundRecord"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRecord_idempotencyKey_key" ON "RefundRecord"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Job_scanId_key" ON "Job"("scanId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteProfile" ADD CONSTRAINT "SiteProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_siteProfileId_fkey" FOREIGN KEY ("siteProfileId") REFERENCES "SiteProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_siteProfileId_fkey" FOREIGN KEY ("siteProfileId") REFERENCES "SiteProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanModule" ADD CONSTRAINT "ScanModule_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiResponseRecord" ADD CONSTRAINT "AiResponseRecord_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConsent" ADD CONSTRAINT "AiConsent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConsent" ADD CONSTRAINT "AiConsent_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationOAuthState" ADD CONSTRAINT "IntegrationOAuthState_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportArtifact" ADD CONSTRAINT "ExportArtifact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportArtifact" ADD CONSTRAINT "ExportArtifact_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRecord" ADD CONSTRAINT "RefundRecord_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
