// Access-token lifecycle for the Bing connection.
//
// Kept behind a small store interface rather than PrismaClient so the refresh,
// expiry and revocation paths are unit-testable without a database — and so
// every query that does reach the database is written once, scoped by accountId
// (see store.ts). A token is decrypted here and nowhere else.
//
// Bing's refresh grant differs from Google's in one way that matters: its
// response carries `access_token`, `expires_in` and `token_type` but no
// `refresh_token` (learn.microsoft.com/en-us/bingwebmaster/oauth2, step 7), so
// the stored refresh token is kept and reused. `refreshOAuthTokens` already
// returns null for it, which this module relies on rather than re-deriving.

import type { OAuthProviderConfig } from '../config.ts';
import { decryptIntegrationSecret, encryptIntegrationSecret } from '../crypto.ts';
import { BING_WEBMASTER_READ_SCOPE, OAuthGrantRevokedError, refreshOAuthTokens } from '../oauth.ts';
import { BingApiError, detailFor } from './errors.ts';

/**
 * Refresh this far before the real expiry. A scan may spend a minute inside the
 * Bing calls, and a token that expires mid-report is indistinguishable from a
 * revoked one from the caller's side.
 */
export const BING_TOKEN_REFRESH_SKEW_MS = 120_000;

export interface StoredBingConnection {
  readonly status: string;
  readonly accessTokenEncrypted: string;
  readonly refreshTokenEncrypted: string | null;
  readonly tokenExpiresAt: Date | null;
  readonly scopesJson: string;
}

/**
 * Whether a refreshed token actually replaced the stored one.
 *
 * `superseded` means another refresh had already stored a token that lives at
 * least as long, so this one did not overwrite it. Both outcomes are fine for the
 * caller — it holds a token it just obtained — and the distinction exists so the
 * store can refuse a lost update instead of racing for last-write-wins.
 */
export type TokenSaveOutcome = 'stored' | 'superseded';

export interface BingConnectionStore {
  load(accountId: string): Promise<StoredBingConnection | null>;
  saveRefreshedAccessToken(
    accountId: string,
    accessTokenEncrypted: string,
    tokenExpiresAt: Date | null,
  ): Promise<TokenSaveOutcome>;
  markNeedsReconnect(accountId: string, detail: string): Promise<void>;
}

export interface BingAccess {
  readonly accessToken: string;
  readonly scopes: readonly string[];
  readonly hasWebmasterScope: boolean;
}

export interface ResolveBingAccessDeps {
  readonly store: BingConnectionStore;
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

/**
 * Bing writes its scopes with an initial capital in the documentation
 * (`Webmaster.read`) and lower-case in the grant, and returns them space
 * separated. Comparing case-insensitively is what keeps a perfectly good grant
 * from reading as "scope missing".
 */
function grantsWebmasterRead(scopes: readonly string[]): boolean {
  const wanted = BING_WEBMASTER_READ_SCOPE.toLowerCase();
  return scopes.some((scope) => {
    const value = scope.toLowerCase();
    // `webmaster.manage` is a superset of `webmaster.read`; an owner who granted
    // the wider scope has certainly granted the read we ask for.
    return value === wanted || value === 'webmaster.manage';
  });
}

function accessFrom(accessToken: string, scopes: readonly string[]): BingAccess {
  return {
    accessToken,
    scopes,
    // A grant that stated no scope at all is taken at face value: Bing omits the
    // field from some token responses, and refusing there would turn a working
    // connection into a permanent "reconnect" loop that reconnecting cannot fix.
    hasWebmasterScope: scopes.length === 0 || grantsWebmasterRead(scopes),
  };
}

function isExpiring(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() - now.getTime() <= BING_TOKEN_REFRESH_SKEW_MS;
}

/**
 * Refreshes in flight, per account.
 *
 * A scan and the integrations screen can ask for the same account's token in the
 * same second, and each would otherwise post its own refresh grant. Bing does not
 * rotate the refresh token, so a duplicate is not fatal — but it is a second call
 * against a rate-limited endpoint, and the two results then race to be stored.
 * Callers that arrive while one is running wait for it and share its answer.
 */
const refreshesInFlight = new Map<string, Promise<BingAccess>>();

/**
 * Returns a usable Bing access token for the account, refreshing it first when
 * it is at or near expiry. Throws BingApiError with `not_connected` /
 * `needs_reconnect` so every caller reports the same states.
 */
export async function resolveBingAccess(
  deps: ResolveBingAccessDeps,
  accountId: string,
): Promise<BingAccess> {
  const connection = await deps.store.load(accountId);
  if (connection === null) {
    throw new BingApiError('not_connected', detailFor('not_connected'));
  }
  if (connection.status !== 'connected') {
    throw new BingApiError('needs_reconnect', detailFor('needs_reconnect'));
  }
  const scopes = parseScopes(connection.scopesJson);
  if (!isExpiring(connection.tokenExpiresAt, deps.now())) {
    return accessFrom(decryptIntegrationSecret(connection.accessTokenEncrypted), scopes);
  }
  if (connection.refreshTokenEncrypted === null || deps.oauthConfig === null) {
    // No refresh token stored (or the server lost its client config): there is
    // no way back to a live token without a new authorization.
    await deps.store.markNeedsReconnect(accountId, detailFor('needs_reconnect'));
    throw new BingApiError('needs_reconnect', detailFor('needs_reconnect'));
  }
  const running = refreshesInFlight.get(accountId);
  if (running !== undefined) return running;
  const refresh = refreshAccess(deps, accountId, connection.refreshTokenEncrypted, scopes).finally(
    () => {
      refreshesInFlight.delete(accountId);
    },
  );
  refreshesInFlight.set(accountId, refresh);
  return refresh;
}

async function refreshAccess(
  deps: ResolveBingAccessDeps,
  accountId: string,
  refreshTokenEncrypted: string,
  scopes: readonly string[],
): Promise<BingAccess> {
  // Narrowed by the caller; repeated here because this function is reachable
  // only through it and TypeScript cannot carry the narrowing across.
  if (deps.oauthConfig === null) {
    throw new BingApiError('needs_reconnect', detailFor('needs_reconnect'));
  }
  try {
    const refreshed = await refreshOAuthTokens(
      'bing',
      deps.oauthConfig,
      decryptIntegrationSecret(refreshTokenEncrypted),
      deps.fetcher ?? fetch,
    );
    // The store refuses to overwrite a token that outlives this one, so a
    // concurrent refresh in another process cannot be undone by this write. Either
    // outcome is usable here: the token below was just issued.
    await deps.store.saveRefreshedAccessToken(
      accountId,
      encryptIntegrationSecret(refreshed.accessToken),
      refreshed.expiresAt,
    );
    // Bing omits `scope` from the refresh response, so the stored grant stays
    // authoritative unless the refresh actually restated one.
    return accessFrom(
      refreshed.accessToken,
      refreshed.scopes.length > 0 ? refreshed.scopes : scopes,
    );
  } catch (error) {
    if (error instanceof OAuthGrantRevokedError) {
      await deps.store.markNeedsReconnect(accountId, detailFor('needs_reconnect'));
      throw new BingApiError('needs_reconnect', detailFor('needs_reconnect'), error);
    }
    throw new BingApiError('request_failed', detailFor('request_failed'), error);
  }
}
