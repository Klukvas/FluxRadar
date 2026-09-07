/**
 * Vitest setup: deterministic, non-production defaults for env-derived secrets.
 *
 * `pnpm test` loads the repository `.env` when one exists, so a developer
 * checkout picks up SESSION_SECRET and integrations/crypto.ts falls back to it.
 * CI has no `.env`, so DB-backed suites that encrypt integration tokens failed
 * with "INTEGRATION_ENCRYPTION_KEY is not configured". These defaults are
 * test-only placeholders and never override a value the environment already
 * provides; production validation still lives in integrations/config.ts.
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
