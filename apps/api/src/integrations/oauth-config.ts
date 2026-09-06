// OAuth provider configuration for the user-authorized analytics integrations.
//
// Three states, deliberately explicit, mirroring billing/fastspring/config.ts:
//   not_configured — no variable of the provider is set. The integration stays
//                    off and the HTTP layer answers INTEGRATION_NOT_CONFIGURED.
//   invalid        — some variables are set but the set is incomplete or the
//                    production callback is not usable. Fail-closed: production
//                    refuses to boot and the missing NAMES are reported.
//   configured     — the complete set is present.
//
// The redirect URI is the reason this is not a two-state check. A production
// deploy that has a client id and secret but no *_OAUTH_REDIRECT_URI used to
// fall back to the localhost callback, which the provider rejects at the end of
// a consent screen the user already went through — a silent failure that only
// looks like a provider outage. In production the callback must be an HTTPS URL
// on the application host; only development keeps the localhost fallback.

import type { UserIntegrationProvider } from './providers.ts';

export interface OAuthProviderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export type OAuthConfigResult =
  | { readonly state: 'configured'; readonly config: OAuthProviderConfig }
  | { readonly state: 'not_configured' }
  | { readonly state: 'invalid'; readonly missing: readonly string[]; readonly reason: string };

interface ProviderEnvVars {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export const OAUTH_ENV_VARS: Readonly<Record<UserIntegrationProvider, ProviderEnvVars>> = {
  google: {
    clientId: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecret: 'GOOGLE_OAUTH_CLIENT_SECRET',
    redirectUri: 'GOOGLE_OAUTH_REDIRECT_URI',
  },
  bing: {
    clientId: 'BING_OAUTH_CLIENT_ID',
    clientSecret: 'BING_OAUTH_CLIENT_SECRET',
    redirectUri: 'BING_OAUTH_REDIRECT_URI',
  },
};

/** Hosts a production OAuth callback may point at. Nothing else is accepted. */
export const PRODUCTION_CALLBACK_HOSTS: readonly string[] = ['fluxradar.net', 'www.fluxradar.net'];

const DEVELOPMENT_CALLBACK_ORIGIN = 'http://localhost:3310';

function trimmed(value: string | undefined): string | null {
  const result = value?.trim() ?? '';
  return result === '' ? null : result;
}

/** The callback path the API actually serves, per provider. */
export function callbackPathFor(provider: UserIntegrationProvider): string {
  return `/integrations/${provider}/callback`;
}

function developmentRedirectUri(provider: UserIntegrationProvider): string {
  return `${DEVELOPMENT_CALLBACK_ORIGIN}${callbackPathFor(provider)}`;
}

/**
 * Why a production callback is unusable, or null when it is fine. The URI is a
 * public value, but the message names only the variable and the requirement so
 * these strings stay safe to log verbatim next to secret-bearing ones.
 */
function productionRedirectUriProblem(
  provider: UserIntegrationProvider,
  redirectUri: string,
): string | null {
  const variable = OAUTH_ENV_VARS[provider].redirectUri;
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return `${variable} must be an absolute HTTPS URL`;
  }
  if (url.protocol !== 'https:') {
    return `${variable} must use https in production`;
  }
  if (!PRODUCTION_CALLBACK_HOSTS.includes(url.hostname)) {
    return `${variable} must point at ${PRODUCTION_CALLBACK_HOSTS.join(' or ')}`;
  }
  if (!url.pathname.endsWith(callbackPathFor(provider))) {
    return `${variable} must end with ${callbackPathFor(provider)}`;
  }
  return null;
}

export function readOAuthConfig(
  provider: UserIntegrationProvider,
  env: NodeJS.ProcessEnv = process.env,
): OAuthConfigResult {
  const vars = OAUTH_ENV_VARS[provider];
  const clientId = trimmed(env[vars.clientId]);
  const clientSecret = trimmed(env[vars.clientSecret]);
  const redirectUri = trimmed(env[vars.redirectUri]);
  // A redirect URI on its own is not a configuration attempt: .env.example ships
  // the localhost callbacks pre-filled, so only a credential means "connect me".
  if (clientId === null && clientSecret === null) {
    return { state: 'not_configured' };
  }

  const isProduction = env.NODE_ENV === 'production';
  // Outside production the localhost callback is a deliberate convenience, so an
  // absent redirect URI is not a gap there.
  const redirectUriMissing = isProduction && redirectUri === null;
  if (clientId === null || clientSecret === null || redirectUriMissing) {
    const missing = [
      ...(clientId === null ? [vars.clientId] : []),
      ...(clientSecret === null ? [vars.clientSecret] : []),
      ...(redirectUriMissing ? [vars.redirectUri] : []),
    ];

    return {
      state: 'invalid',
      missing,
      reason: `${provider} OAuth is partially configured; missing: ${missing.join(', ')}`,
    };
  }

  const effectiveRedirectUri = redirectUri ?? developmentRedirectUri(provider);
  if (isProduction) {
    const problem = productionRedirectUriProblem(provider, effectiveRedirectUri);
    if (problem !== null) {
      return { state: 'invalid', missing: [vars.redirectUri], reason: problem };
    }
  }
  return {
    state: 'configured',
    config: { clientId, clientSecret, redirectUri: effectiveRedirectUri },
  };
}
