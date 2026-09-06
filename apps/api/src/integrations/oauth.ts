import { randomBytes } from 'node:crypto';

import type { UserIntegrationProvider } from './config.ts';
import type { OAuthProviderConfig } from './config.ts';

export interface OAuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: Date | null;
  readonly scopes: readonly string[];
}

export const GOOGLE_SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const GOOGLE_ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

// Unchanged from the approved consent screen: both Google scopes are read-only
// and neither the Search Console nor the GA4 flow asks for anything beyond them.
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  GOOGLE_SEARCH_CONSOLE_SCOPE,
  GOOGLE_ANALYTICS_SCOPE,
] as const;

const BING_SCOPES = ['webmaster.read'] as const;

export function createOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

export function authorizationUrl(
  provider: UserIntegrationProvider,
  config: OAuthProviderConfig,
  state: string,
): string {
  const url = new URL(
    provider === 'google'
      ? 'https://accounts.google.com/o/oauth2/v2/auth'
      : 'https://www.bing.com/webmasters/oauth/authorize',
  );
  const scopes = provider === 'google' ? GOOGLE_SCOPES : BING_SCOPES;
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);
  if (provider === 'google') {
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
  }
  return url.toString();
}

interface TokenResponse {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly expires_in?: unknown;
  readonly scope?: unknown;
}

async function exchangeCode(
  provider: UserIntegrationProvider,
  config: OAuthProviderConfig,
  code: string,
): Promise<OAuthTokens> {
  const endpoint =
    provider === 'google'
      ? 'https://oauth2.googleapis.com/token'
      : 'https://www.bing.com/webmasters/oauth/token';
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => null)) as TokenResponse | null;
  if (!response.ok || typeof payload?.access_token !== 'string' || payload.access_token === '') {
    throw new Error(`OAuth token exchange failed for ${provider}`);
  }
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : null;
  const scope = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [];
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
    expiresAt: expiresIn === null ? null : new Date(Date.now() + expiresIn * 1000),
    scopes: scope,
  };
}

export async function exchangeOAuthCode(
  provider: UserIntegrationProvider,
  config: OAuthProviderConfig,
  code: string,
): Promise<OAuthTokens> {
  return exchangeCode(provider, config, code);
}

/**
 * Raised when Google refuses the refresh grant itself (revoked consent, deleted
 * client, rotated secret). It is terminal for the stored connection: retrying
 * cannot help, the user has to authorize again.
 */
export class OAuthGrantRevokedError extends Error {
  constructor(provider: UserIntegrationProvider) {
    super(`OAuth refresh grant was rejected for ${provider}`);
    this.name = 'OAuthGrantRevokedError';
  }
}

/**
 * Exchanges a refresh token for a fresh access token. Google does not return a
 * new refresh token here, so the caller keeps the stored one; the returned
 * `refreshToken` is null to make that explicit rather than implied.
 */
export async function refreshOAuthTokens(
  provider: UserIntegrationProvider,
  config: OAuthProviderConfig,
  refreshToken: string,
  fetcher: typeof fetch = fetch,
): Promise<OAuthTokens> {
  const endpoint =
    provider === 'google'
      ? 'https://oauth2.googleapis.com/token'
      : 'https://www.bing.com/webmasters/oauth/token';
  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => null)) as TokenResponse | null;
  if (response.status === 400 || response.status === 401) {
    // invalid_grant is Google's answer for revoked/expired consent.
    throw new OAuthGrantRevokedError(provider);
  }
  if (!response.ok || typeof payload?.access_token !== 'string' || payload.access_token === '') {
    throw new Error(`OAuth token refresh failed for ${provider}`);
  }
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : null;
  const scope = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [];
  return {
    accessToken: payload.access_token,
    refreshToken: null,
    expiresAt: expiresIn === null ? null : new Date(Date.now() + expiresIn * 1000),
    scopes: scope,
  };
}
