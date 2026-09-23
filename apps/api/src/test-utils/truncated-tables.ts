// Which tables the database-backed suites clear between files.
//
// It lives in its own module, apart from the harness that runs the TRUNCATE,
// so the guard that checks it against the schema (truncate-coverage.test.ts) is
// a pure unit test. Importing `test-db.ts` for the list would have moved that
// guard into the database-backed half — where a machine with no test database
// skips it, which is precisely the machine most likely to miss a new table.

/** Every table the suites own. Truncated as one statement so order cannot matter. */
export const TRUNCATED_TABLES = [
  'AccountDeletionAudit',
  'DeletedScan',
  'FreeCheckClaim',
  'Session',
  'EmailToken',
  'EmailNotification',
  'Account',
  'SiteProfile',
  'Purchase',
  'Entitlement',
  'Scan',
  'ScanModule',
  'ScanCheckpoint',
  'ScanCrawlPage',
  'ScanCrawlResourceSet',
  'DomainVerification',
  'Issue',
  'RuleCoverageProof',
  'AiResponseRecord',
  'AiConsent',
  'ActionPlan',
  'ActionPlanAttempt',
  'IntegrationConnection',
  'IntegrationOAuthState',
  'SiteGoogleBinding',
  'SiteBingBinding',
  'ExportArtifact',
  'WebhookEvent',
  'RefundRecord',
  'RefundDispatch',
  'ProviderRefund',
  'CheckoutSession',
  'Job',
] as const;
