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
