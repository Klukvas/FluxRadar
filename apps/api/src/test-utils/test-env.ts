/**
 * Vitest setup: deterministic, non-production defaults for env-derived secrets.
 *
 * The test run no longer loads the repository `.env` — `apps/api/package.json`
 * dropped `--env-file-if-exists`, so a developer's own credentials and database
 * URL cannot reach the suite and a checkout runs exactly what CI runs. That
 * makes these defaults the only source for them: without
 * INTEGRATION_ENCRYPTION_KEY the DB-backed suites fail encrypting integration
 * tokens. They are test-only placeholders, they never override a value the
 * environment already provides, and production validation still lives in
 * integrations/config.ts.
 */
process.env.INTEGRATION_ENCRYPTION_KEY ??= 'test-only-integration-encryption-key';
