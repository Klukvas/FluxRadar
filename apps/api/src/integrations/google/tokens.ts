// Access-token lifecycle for the Google connection. Kept behind a small store
// interface rather than PrismaClient so the refresh, expiry and revocation
// paths are unit-testable without a database.

import type { OAuthProviderConfig } from '../config.ts';
import { decryptIntegrationSecret, encryptIntegrationSecret } from '../crypto.ts';
import {
  GOOGLE_ANALYTICS_SCOPE,
  GOOGLE_SEARCH_CONSOLE_SCOPE,
  OAuthGrantRevokedError,
  refreshOAuthTokens,
} from '../oauth.ts';
import { GoogleApiError, detailFor } from './errors.ts';

/**
 * Refresh this far before the real expiry. A scan may spend a minute inside the
 * Google calls, and a token that expires mid-report is indistinguishable from a
 * revoked one from the caller's side.
 */
export const TOKEN_REFRESH_SKEW_MS = 120_000;

export interface StoredGoogleConnection {
  readonly status: string;
  readonly accessTokenEncrypted: string;
  readonly refreshTokenEncrypted: string | null;
  readonly tokenExpiresAt: Date | null;
  readonly scopesJson: string;
}

export interface GoogleConnectionStore {
  load(accountId: string): Promise<StoredGoogleConnection | null>;
  saveRefreshedAccessToken(
    accountId: string,
    accessTokenEncrypted: string,
    tokenExpiresAt: Date | null,
  ): Promise<void>;
  markNeedsReconnect(accountId: string, detail: string): Promise<void>;
}

export interface GoogleAccess {
  readonly accessToken: string;
  readonly scopes: readonly string[];
  readonly hasSearchConsoleScope: boolean;
  readonly hasAnalyticsScope: boolean;
}

export interface ResolveAccessDeps {
  readonly store: GoogleConnectionStore;
  readonly oauthConfig: OAuthProviderConfig | null;
  readonly now: () => Date;
  readonly fetcher?: typeof fetch;
}

function parseScopes(scopesJson: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(scopesJson);
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [];
  } catch {
    // A corrupt scope record must not read as "every scope granted".
    return [];
  }
}

function accessFrom(accessToken: string, scopes: readonly string[]): GoogleAccess {
  return {
    accessToken,
    scopes,
    hasSearchConsoleScope: scopes.includes(GOOGLE_SEARCH_CONSOLE_SCOPE),
    hasAnalyticsScope: scopes.includes(GOOGLE_ANALYTICS_SCOPE),
  };
}

function isExpiring(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() - now.getTime() <= TOKEN_REFRESH_SKEW_MS;
}

/**
 * Returns a usable access token for the account, refreshing it first when it is
 * at or near expiry. Throws GoogleApiError with `not_connected` /
 * `needs_reconnect` so every caller reports the same states.
 */
export async function resolveGoogleAccess(
  deps: ResolveAccessDeps,
  accountId: string,
): Promise<GoogleAccess> {
  const connection = await deps.store.load(accountId);
  if (connection === null) {
    throw new GoogleApiError('not_connected', detailFor('not_connected'));
  }
  const scopes = parseScopes(connection.scopesJson);
  const now = deps.now();
  if (connection.status !== 'connected') {
    throw new GoogleApiError('needs_reconnect', detailFor('needs_reconnect'));
  }
  if (!isExpiring(connection.tokenExpiresAt, now)) {
    return accessFrom(decryptIntegrationSecret(connection.accessTokenEncrypted), scopes);
  }
  if (connection.refreshTokenEncrypted === null || deps.oauthConfig === null) {
    // Offline access was never granted (or the server lost its client config):
    // there is no way back to a live token without a new authorization.
    await deps.store.markNeedsReconnect(accountId, detailFor('needs_reconnect'));
    throw new GoogleApiError('needs_reconnect', detailFor('needs_reconnect'));
  }
  try {
    const refreshed = await refreshOAuthTokens(
      'google',
      deps.oauthConfig,
      decryptIntegrationSecret(connection.refreshTokenEncrypted),
      deps.fetcher ?? fetch,
    );
    await deps.store.saveRefreshedAccessToken(
      accountId,
      encryptIntegrationSecret(refreshed.accessToken),
      refreshed.expiresAt,
    );
    // Google omits `scope` from some refresh responses; the stored grant stays
    // authoritative in that case.
    return accessFrom(
      refreshed.accessToken,
      refreshed.scopes.length > 0 ? refreshed.scopes : scopes,
    );
  } catch (error) {
    if (error instanceof OAuthGrantRevokedError) {
      await deps.store.markNeedsReconnect(accountId, detailFor('needs_reconnect'));
      throw new GoogleApiError('needs_reconnect', detailFor('needs_reconnect'), error);
    }
    throw new GoogleApiError('request_failed', detailFor('request_failed'), error);
  }
}
