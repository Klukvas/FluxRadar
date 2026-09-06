import { readFastSpringConfig } from '../billing/fastspring/config.ts';
import { DEFAULT_ANTHROPIC_MODEL, readAnthropicConfig } from './anthropic-config.ts';
import { readObjectStorageConfig, type ObjectStorageConfig } from './object-storage-config.ts';
import { readOAuthConfig, type OAuthProviderConfig } from './oauth-config.ts';
import type { UserIntegrationProvider } from './providers.ts';

export { USER_INTEGRATION_PROVIDERS, isUserIntegrationProvider } from './providers.ts';
export type { UserIntegrationProvider } from './providers.ts';
export type { OAuthProviderConfig } from './oauth-config.ts';

export interface IntegrationConfig {
  readonly frontendOrigin: string;
  readonly google: OAuthProviderConfig | null;
  readonly bing: OAuthProviderConfig | null;
  readonly anthropicApiKey: string | null;
  readonly anthropicModel: string;
  readonly anthropicApiVersion: string;
  readonly pageSpeedApiKey: string | null;
  readonly cruxApiKey: string | null;
  readonly hetznerS3: ObjectStorageConfig | null;
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * The usable configuration only. A provider that is absent AND one that is
 * misconfigured both read as null here, because every caller of this shape can
 * only ask "is it on?". The difference between the two is what
 * `validateRuntimeConfig` and the startup diagnostics report — and in production
 * a misconfigured provider never reaches this function, because the boot fails
 * first.
 */
export function readIntegrationConfig(env: NodeJS.ProcessEnv = process.env): IntegrationConfig {
  const google = readOAuthConfig('google', env);
  const bing = readOAuthConfig('bing', env);
  const storage = readObjectStorageConfig(env);
  return {
    frontendOrigin: optional(env.FRONTEND_ORIGIN) ?? 'http://localhost:5174',
    google: google.state === 'configured' ? google.config : null,
    bing: bing.state === 'configured' ? bing.config : null,
    anthropicApiKey: optional(env.ANTHROPIC_API_KEY),
    anthropicModel: optional(env.ANTHROPIC_MODEL) ?? DEFAULT_ANTHROPIC_MODEL,
    anthropicApiVersion: optional(env.ANTHROPIC_API_VERSION) ?? '2023-06-01',
    pageSpeedApiKey: optional(env.PAGESPEED_API_KEY),
    cruxApiKey: optional(env.CRUX_API_KEY),
    hetznerS3: storage.state === 'configured' ? storage.config : null,
  };
}

/**
 * Secrets the API must have to boot in production. A missing one is reported by
 * name only, never by value. `prisma migrate deploy` does not run this check, so
 * a deploy can migrate successfully and then crash-loop on `startServer` when one
 * of these is absent — aggregating them keeps that failure self-explanatory.
 * INTEGRATION_ENCRYPTION_KEY has no safe production fallback; DATABASE_URL is
 * also validated by its own caller but listed here so a single failed deploy
 * surfaces every gap at once.
 *
 * RESEND_API_KEY/RESEND_FROM_EMAIL are intentionally NOT required: transactional
 * email is optional until Resend is connected. When they are absent in
 * production, `createMailer` returns a `NotConfiguredMailer` and email-dependent
 * flows report the existing `not-configured` status instead of blocking startup
 * or pretending a message was sent.
 *
 * PADDLE_WEBHOOK_SECRET is not required by this release — the MockPaddle webhook
 * is a development-only route and is not mounted in production — but it must
 * stay in PRODUCTION_ENV_FILE until every release that still requires it has
 * been retired; see docs/DEPLOYMENT.md.
 */
export const REQUIRED_PRODUCTION_SECRETS = ['DATABASE_URL', 'INTEGRATION_ENCRYPTION_KEY'] as const;

/**
 * Every optional integration that is allowed to be entirely absent but must
 * never be *half* present. A partial configuration is the dangerous state: it
 * looks connected from the outside while it cannot complete a single request.
 * Each reader answers not_configured / invalid / configured, and only `invalid`
 * fails the boot — by variable NAME, never by value.
 */
function partialIntegrationFailures(env: NodeJS.ProcessEnv): readonly string[] {
  const results = [
    readFastSpringConfig(env),
    readOAuthConfig('google', env),
    readOAuthConfig('bing', env),
    readObjectStorageConfig(env),
    readAnthropicConfig(env),
  ];
  return results.flatMap((result) => (result.state === 'invalid' ? [result.reason] : []));
}

/**
 * Fails fast, before the HTTP server binds, when a production deploy is missing a
 * required secret or carries a half-configured optional integration. Every
 * problem is aggregated into one error so the operator does not rediscover them
 * one redeploy at a time. Development and tests may fall back to SESSION_SECRET
 * for the integration key (see integrations/crypto.ts) and are intentionally not
 * checked here.
 */
export function validateRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }
  const missing = REQUIRED_PRODUCTION_SECRETS.filter((name) => optional(env[name]) === null);
  if (missing.length > 0) {
    throw new Error(`Missing required production configuration: ${missing.join(', ')}`);
  }
  const invalid = partialIntegrationFailures(env);
  if (invalid.length > 0) {
    throw new Error(`Invalid production configuration: ${invalid.join('; ')}`);
  }
}

export function oauthConfigFor(
  config: IntegrationConfig,
  provider: UserIntegrationProvider,
): OAuthProviderConfig | null {
  return provider === 'google' ? config.google : config.bing;
}
