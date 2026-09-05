export const USER_INTEGRATION_PROVIDERS = ['google', 'bing'] as const;
export type UserIntegrationProvider = (typeof USER_INTEGRATION_PROVIDERS)[number];

export interface OAuthProviderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface IntegrationConfig {
  readonly frontendOrigin: string;
  readonly google: OAuthProviderConfig | null;
  readonly bing: OAuthProviderConfig | null;
  readonly anthropicApiKey: string | null;
  readonly anthropicModel: string;
  readonly anthropicApiVersion: string;
  readonly pageSpeedApiKey: string | null;
  readonly cruxApiKey: string | null;
  readonly hetznerS3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly accessKey: string;
    readonly secretKey: string;
  } | null;
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function oauthConfig(
  clientId: string | undefined,
  clientSecret: string | undefined,
  redirectUri: string | undefined,
  fallbackRedirectUri: string,
): OAuthProviderConfig | null {
  const id = optional(clientId);
  const secret = optional(clientSecret);
  if (id === null || secret === null) {
    return null;
  }
  return {
    clientId: id,
    clientSecret: secret,
    redirectUri: optional(redirectUri) ?? fallbackRedirectUri,
  };
}

export function readIntegrationConfig(env: NodeJS.ProcessEnv = process.env): IntegrationConfig {
  const endpoint = optional(env.HETZNER_S3_ENDPOINT);
  const region = optional(env.HETZNER_S3_REGION);
  const bucket = optional(env.HETZNER_S3_BUCKET);
  const accessKey = optional(env.HETZNER_S3_ACCESS_KEY);
  const secretKey = optional(env.HETZNER_S3_SECRET_KEY);
  const hasS3 =
    endpoint !== null &&
    region !== null &&
    bucket !== null &&
    accessKey !== null &&
    secretKey !== null;

  return {
    frontendOrigin: optional(env.FRONTEND_ORIGIN) ?? 'http://localhost:5174',
    google: oauthConfig(
      env.GOOGLE_OAUTH_CLIENT_ID,
      env.GOOGLE_OAUTH_CLIENT_SECRET,
      env.GOOGLE_OAUTH_REDIRECT_URI,
      'http://localhost:3310/integrations/google/callback',
    ),
    bing: oauthConfig(
      env.BING_OAUTH_CLIENT_ID,
      env.BING_OAUTH_CLIENT_SECRET,
      env.BING_OAUTH_REDIRECT_URI,
      'http://localhost:3310/integrations/bing/callback',
    ),
    anthropicApiKey: optional(env.ANTHROPIC_API_KEY),
    anthropicModel: optional(env.ANTHROPIC_MODEL) ?? 'claude-sonnet-4-20250514',
    anthropicApiVersion: optional(env.ANTHROPIC_API_VERSION) ?? '2023-06-01',
    pageSpeedApiKey: optional(env.PAGESPEED_API_KEY),
    cruxApiKey: optional(env.CRUX_API_KEY),
    hetznerS3: hasS3
      ? {
          endpoint,
          region,
          bucket,
          accessKey,
          secretKey,
        }
      : null,
  };
}

/**
 * Secrets the API must have to boot in production. A missing one is reported by
 * name only, never by value. `prisma migrate deploy` does not run this check, so
 * a deploy can migrate successfully and then crash-loop on `startServer` when one
 * of these is absent — aggregating them keeps that failure self-explanatory.
 * INTEGRATION_ENCRYPTION_KEY and RESEND_* have no safe production fallback;
 * DATABASE_URL and PADDLE_WEBHOOK_SECRET are also validated by their own callers
 * but listed here so a single failed deploy surfaces every gap at once.
 */
export const REQUIRED_PRODUCTION_SECRETS = [
  'DATABASE_URL',
  'PADDLE_WEBHOOK_SECRET',
  'INTEGRATION_ENCRYPTION_KEY',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
] as const;

/**
 * Fails fast, before the HTTP server binds, when a production deploy is missing a
 * required secret. Every missing name is aggregated into one error so the
 * operator does not rediscover them one redeploy at a time. Development and tests
 * may fall back to SESSION_SECRET for the integration key (see
 * integrations/crypto.ts) and are intentionally not checked here.
 */
export function validateRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }
  const missing = REQUIRED_PRODUCTION_SECRETS.filter((name) => optional(env[name]) === null);
  if (missing.length > 0) {
    throw new Error(`Missing required production configuration: ${missing.join(', ')}`);
  }
}

export function isUserIntegrationProvider(value: string): value is UserIntegrationProvider {
  return USER_INTEGRATION_PROVIDERS.includes(value as UserIntegrationProvider);
}

export function oauthConfigFor(
  config: IntegrationConfig,
  provider: UserIntegrationProvider,
): OAuthProviderConfig | null {
  return provider === 'google' ? config.google : config.bing;
}
