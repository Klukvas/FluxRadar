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

export function isUserIntegrationProvider(value: string): value is UserIntegrationProvider {
  return USER_INTEGRATION_PROVIDERS.includes(value as UserIntegrationProvider);
}

export function oauthConfigFor(
  config: IntegrationConfig,
  provider: UserIntegrationProvider,
): OAuthProviderConfig | null {
  return provider === 'google' ? config.google : config.bing;
}
