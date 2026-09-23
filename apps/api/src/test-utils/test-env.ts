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

/**
 * The MockPaddle surface (`/billing/dev-checkout` and `/webhooks/paddle`) is off
 * unless a deployment opts in — see billing/mock-checkout.ts. The suites that
 * drive a paid scan end to end are exactly the deployment that wants it, so the
 * opt-in is stated here rather than being inferred from NODE_ENV. Tests that
 * assert the closed behaviour pass `mockCheckoutEnabled: false` to createApp.
 */
process.env.FLUXRADAR_ENABLE_MOCK_CHECKOUT ??= 'true';
